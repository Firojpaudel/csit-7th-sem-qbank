const SUBJECTS = [
  { id: 'advanced-java', title: 'Advanced Java Programming' },
  { id: 'data-mining', title: 'Data Warehousing and Data Mining' },
  { id: 'pom', title: 'Principles of Management' },
  { id: 'software-project-management', title: 'Software Project Management' }
];

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const MODEL = 'openrouter/free';

let state = {
  apiKey: localStorage.getItem('or_api_key') || '',
  groqKey: localStorage.getItem('groq_api_key') || '',
  useTurbo: localStorage.getItem('use_turbo') === 'true',
  neonEnabled: localStorage.getItem('neon_enabled') === 'true',
  selectedYear: localStorage.getItem('selected_year') || 'all',
  sessionToken: localStorage.getItem('session_token') || '',
  currentUser: null,
  subjects: {},
  activeSubject: 'advanced-java',
  filter: 'all', // all, answered, unanswered
  search: '',
  isGeneratingAll: false,
  settingsOpen: false
};

function setCurrentUser(user) {
  state.currentUser = user || null;
  render();
}

async function fetchMe() {
  const token = state.sessionToken;
  if (!token) return setCurrentUser(null);
  try {
    const resp = await fetch('/me', { headers: { 'Authorization': `Bearer ${token}` } });
    if (!resp.ok) { setCurrentUser(null); return; }
    const data = await resp.json();
    setCurrentUser(data.user);
    // if user has keys stored on server, fetch masked indicators
    try { await fetchUserKeys(); } catch (e) { /* ignore */ }
  } catch (e) {
    setCurrentUser(null);
  }
}

async function fetchUserKeys() {
  if (!state.sessionToken) return;
  try {
    const resp = await fetch('/me/keys', { headers: { 'Authorization': `Bearer ${state.sessionToken}` } });
    if (!resp.ok) return;
    const data = await resp.json();
    state.userKeys = data || {};
  } catch (e) { state.userKeys = {}; }
}

async function saveUserKeys(apiKey, groqKey) {
  if (!state.sessionToken) throw new Error('Not signed in');
  const resp = await fetch('/me/keys', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.sessionToken}` }, body: JSON.stringify({ apiKey, groqKey }) });
  if (!resp.ok) throw new Error('Could not save keys');
  await fetchUserKeys();
}

// Utilities for rendering
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Year tagging helpers (stored in localStorage as simple map question->year)
function loadYearMap() {
  return JSON.parse(localStorage.getItem('csit_years') || '{}');
}

function saveYearMap(map) {
  localStorage.setItem('csit_years', JSON.stringify(map));
}

function getYearForQuestion(qText) {
  const map = loadYearMap();
  return map[qText] || 'unknown';
}

function setYearForQuestion(qText, year) {
  const map = loadYearMap();
  if (year === 'unknown' || !year) delete map[qText]; else map[qText] = year;
  saveYearMap(map);
}

function getYearsForSubject(subId) {
  const qs = state.subjects[subId].questions || [];
  const map = loadYearMap();
  const years = new Set();
  years.add('all');
  years.add('unknown');
  const yearRegex = /\b(19|20)\d{2}\b/g;
  for (const q of qs) {
    const text = typeof q === 'object' ? q.text : q;
    const y = map[text];
    if (y) {
      years.add(y);
      continue;
    }
    // attempt to auto-detect year in text
    const found = text.match(yearRegex);
    if (found && found.length) {
      // take first match
      years.add(found[0]);
      // persist detection so UI remembers it
      map[text] = found[0];
    }
  }
  // save any auto-detected years into map
  saveYearMap(map);
  return Array.from(years);
}

// Auto-tag all questions in a subject by scanning for year patterns (e.g. 2022)
function autoTagYearsForSubject(subId) {
  const qs = state.subjects[subId].questions || [];
  const map = loadYearMap();
  const yearRegex = /\b(19|20)\d{2}\b/g;
  let changed = false;
  for (const q of qs) {
    const text = typeof q === 'object' ? q.text : q;
    if (map[text]) continue;
    const found = text.match(yearRegex);
    if (found && found.length) {
      map[text] = found[0];
      changed = true;
    }
  }
  if (changed) saveYearMap(map);
  render();
}

function setYearFilter(year) {
  state.selectedYear = year;
  localStorage.setItem('selected_year', year);
  render();
}

function assignYear(subjectId, questionIndex) {
  const q = state.subjects[subjectId].questions[questionIndex];
  const text = typeof q === 'object' ? q.text : q;
  const current = getYearForQuestion(text);
  const input = prompt('Assign year for this question (e.g. 2022). Leave empty to clear.', current === 'unknown' ? '' : current);
  if (input === null) return; // cancelled
  const year = (String(input).trim() || 'unknown');
  setYearForQuestion(text, year === 'unknown' ? 'unknown' : year);
  render();
}

function isCodeLike(text) {
  if (!text || typeof text !== 'string') return false;
  const lines = text.split('\n').map(l=>l.trim());
  // If many lines start with typical code tokens or contain semicolons/braces
  const codeHints = ['class ', 'public ', 'private ', 'protected ', 'System.out', 'console.log', 'def ', 'function ', ';', '{', '}', '#include', 'import '];
  let hints = 0;
  for (const h of codeHints) if (text.indexOf(h) !== -1) hints++;
  const indentedLines = lines.filter(l => l.startsWith(' ') || l.startsWith('\t')).length;
  if (hints >= 1 && lines.length > 1) return true;
  if (indentedLines >= Math.max(2, Math.floor(lines.length/3))) return true;
  return false;
}

function renderQuestionContent(text) {
  if (!text) return '';
  // clean trailing separator lines like '---' or '...' to avoid ugly triples
  function cleanQuestionText(t) {
    const lines = String(t).split('\n');
    while (lines.length && /^\s*[-._]{2,}\s*$/.test(lines[lines.length-1])) lines.pop();
    while (lines.length && /^\s*\.\.\.\s*$/.test(lines[lines.length-1])) lines.pop();
    return lines.join('\n').trim();
  }
  text = cleanQuestionText(text);
  if (isCodeLike(text)) {
    const escaped = escapeHtml(text);
    // try to guess language (Java common in this dataset)
    return `<pre class="question-code"><code class="language-java">${escaped}</code></pre>`;
  }
  // Not code-like: convert newlines to <br> but keep monospace styling via CSS
  const escaped = escapeHtml(text).replace(/\n/g, '<br>');
  return `<div class="question-text">${escaped}</div>`;
}

// Initialize State merging logic with static DB and local storage answers
async function init() {
  const savedAnswers = JSON.parse(localStorage.getItem('csit_answers') || '{}');

  SUBJECTS.forEach(sub => {
    state.subjects[sub.id] = {
      title: sub.title,
      questions: [],
      answers: savedAnswers[sub.id] || {},
      status: 'idle',
      error: null
    };
  });

  // Merge year_map.json into localStorage if present (don't override user edits)
  try {
    const resp = await fetch('assets/year_map.json', {cache: 'no-store'});
    if (resp.ok) {
      const remoteMap = await resp.json();
      const localMap = loadYearMap();
      const merged = Object.assign({}, remoteMap, localMap);
      // only write if localMap was empty or remote added new entries
      if (Object.keys(merged).length > Object.keys(localMap).length) {
        saveYearMap(merged);
      }
    }
  } catch (e) {
    // ignore fetch errors (app still works)
    console.warn('Could not load year_map.json', e && e.message);
  }

  loadDataFromDB();
  setupEventListeners();
  await fetchMe();
  render();
}

function loadDataFromDB() {
  SUBJECTS.forEach(sub => {
    state.subjects[sub.id].questions = QUESTIONS_DB[sub.id] || [];
  });
}

function saveAnswers() {
  const answersToSave = {};
  SUBJECTS.forEach(sub => {
    answersToSave[sub.id] = state.subjects[sub.id].answers;
  });
  localStorage.setItem('csit_answers', JSON.stringify(answersToSave));
}

function getSystemPrompt() {
  return `You are an expert computer science tutor helping CSIT (BSc CSIT, Tribhuvan University, Nepal) 7th semester students.

Answer the following exam question in a clear, structured, and exam-appropriate format:
- Use headings if the answer has multiple parts
- Use bullet points or numbered lists where appropriate
- Include relevant definitions, diagrams described in text, and examples
- Keep the answer thorough but concise - suitable for a 10-mark university exam question
- If the question asks to "explain", give a conceptual explanation with an example
- If it asks to "compare", use a comparison table
- If it asks to "list", give a numbered list with brief explanations`;
}

async function callAI(questionText) {
  if (state.useTurbo) {
    if (!state.groqKey) throw new Error('Groq API Key missing for Turbo Mode.');
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.groqKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: getSystemPrompt() },
          { role: 'user', content: questionText }
        ],
      })
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Turbo Mode failed.');
    }
    const data = await response.json();
    return data.choices[0].message.content;
  } else {
    if (!state.apiKey) throw new Error('OpenRouter API Key missing.');
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://csit-questionbank.app',
        'X-Title': 'CSIT Question Bank'
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: getSystemPrompt() },
          { role: 'user', content: questionText }
        ]
      })
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Standard generation failed.');
    }
    const data = await response.json();
    return data.choices[0].message.content;
  }
}

// Actions
function setSubject(id) {
  state.activeSubject = id;
  render();
}

function setFilter(filter) {
  state.filter = filter;
  render();
}

function setSearch(query) {
  state.search = query.toLowerCase();
  render();
}

function toggleSettings() {
  state.settingsOpen = !state.settingsOpen;
  render();
}

function saveSettings(e) {
  e.preventDefault();
  const formData = new FormData(e.target);
  const key = formData.get('apiKey').trim();
  const groqKey = formData.get('groqKey')?.trim() || '';
  const turbo = formData.get('useTurbo') === 'on';
  const neonEnabled = formData.get('useNeon') === 'on';
  // Save toggles locally; save API keys to server if signed in
  localStorage.setItem('use_turbo', turbo);
  localStorage.setItem('neon_enabled', neonEnabled);
  state.useTurbo = turbo;
  state.neonEnabled = neonEnabled;

  if (state.currentUser) {
    // Save keys server-side
    saveUserKeys(key || null, groqKey || null).then(()=>{
      state.apiKey = '';
      state.groqKey = '';
      toggleSettings();
    }).catch(err=>{ alert('Failed to save keys: '+(err.message||err)); });
  } else {
    localStorage.setItem('or_api_key', key);
    localStorage.setItem('groq_api_key', groqKey);
    state.apiKey = key;
    state.groqKey = groqKey;
    toggleSettings();
  }
}

async function handleSignIn(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const email = fd.get('email').trim();
  const password = fd.get('password');
  try {
    const resp = await fetch('/signin', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password }) });
    if (!resp.ok) return alert('Sign in failed');
    const data = await resp.json();
    state.sessionToken = data.token;
    localStorage.setItem('session_token', data.token);
    await fetchMe();
    toggleSettings();
  } catch (e) { alert('Sign in failed'); }
}

async function handleSignUp(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const email = fd.get('email').trim();
  const password = fd.get('password');
  try {
    const resp = await fetch('/signup', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password }) });
    if (!resp.ok) { const err = await resp.json().catch(()=>({})); return alert(err.error || 'Sign up failed'); }
    const data = await resp.json();
    state.sessionToken = data.token;
    localStorage.setItem('session_token', data.token);
    await fetchMe();
    toggleSettings();
  } catch (e) { alert('Sign up failed'); }
}

function signOut() {
  state.sessionToken = '';
  localStorage.removeItem('session_token');
  setCurrentUser(null);
  render();
}

function toggleAnswer(subjectId, questionIndex) {
  const qState = state.subjects[subjectId].questions[questionIndex];
  qState.expanded = !qState.expanded;
  render();
}

async function handleGenerateAnswer(subjectId, questionIndex) {
  const subject = state.subjects[subjectId];
  const questionText = subject.questions[questionIndex].text || subject.questions[questionIndex];
  const qObj = typeof subject.questions[questionIndex] === 'object' ? subject.questions[questionIndex] : { text: questionText };
  
  if (typeof subject.questions[questionIndex] === 'string') {
      subject.questions[questionIndex] = qObj;
  }

  if (!state.useTurbo && !state.apiKey) {
    alert("Please set your OpenRouter API Key in settings first.");
    toggleSettings();
    return;
  }

  qObj.generating = true;
  qObj.error = null;
  render();

  try {
    const answer = await callAI(qObj.text);
    subject.answers[qObj.text] = answer;
    saveAnswers();
    // Fire-and-forget save to Neon if enabled
    if (state.neonEnabled) {
      sendToNeon(state.activeSubject, qObj.text, answer).catch((err)=>{
        console.warn('Neon save failed:', err.message || err);
      });
    }
    qObj.expanded = true;
  } catch (err) {
    qObj.error = err.message;
  } finally {
    qObj.generating = false;
    render();
  }
}

// Send an answer to the backend Neon service
async function sendToNeon(subjectId, questionText, answerText) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (state.sessionToken) headers['Authorization'] = `Bearer ${state.sessionToken}`;
    await fetch('/saveAnswer', {
      method: 'POST',
      headers,
      body: JSON.stringify({ subject: subjectId, question: questionText, answer: answerText })
    });
  } catch (e) {
    throw e;
  }
}

async function handleGenerateAll(subjectId) {
  const subject = state.subjects[subjectId];
  if (!state.useTurbo && !state.apiKey) {
    alert("Please set your OpenRouter API Key in settings first.");
    toggleSettings();
    return;
  }

  const unanswered = subject.questions.filter(q => {
    const text = typeof q === 'object' ? q.text : q;
    return !subject.answers[text];
  });
  
  if (unanswered.length === 0) return;

  if (!confirm(`This will generate answers for ${unanswered.length} questions. This may take a while or hit API rate limits. Continue?`)) {
    return;
  }

  state.isGeneratingAll = true;
  for (let i = 0; i < subject.questions.length; i++) {
     const questionText = typeof subject.questions[i] === 'object' ? subject.questions[i].text : subject.questions[i];
     if (!subject.answers[questionText]) {
        await handleGenerateAnswer(subjectId, i);
        // Add a small delay to prevent rate limits
        await new Promise(r => setTimeout(r, 1000));
     }
  }
  state.isGeneratingAll = false;
}

function copyAnswer(subjectId, questionIdx) {
  const subject = state.subjects[subjectId];
  const qStr = typeof subject.questions[questionIdx] === 'object' ? subject.questions[questionIdx].text : subject.questions[questionIdx];
  const text = subject.answers[qStr];
  if(text) {
    navigator.clipboard.writeText(text).then(() => {
      alert("Answer copied to clipboard!");
    });
  }
}

const aiPromptBuilder = (questionText, ai) => {
    const prompt = getSystemPrompt() + "\n\nQuestion: " + questionText;
    const encoded = encodeURIComponent(prompt);
    if(ai === 'chatgpt') return `https://chatgpt.com/?q=${encoded}`;
    if(ai === 'claude') return `https://claude.ai/new?q=${encoded}`;
};

// UI Components
function renderStats() {
  let totalQs = 0;
  let totalAns = 0;

  SUBJECTS.forEach(sub => {
    const qs = state.subjects[sub.id].questions.length;
    const ans = Object.keys(state.subjects[sub.id].answers).length;
    totalQs += qs;
    totalAns += ans;
  });

  if (!state.headerStatsOpen) {
    return `<button class="btn btn-outline" onclick="toggleStats()" aria-label="Show stats"><i class="ph-bold ph-list"></i></button>`;
  }

  return `
    <div class="stats-popover">
      <div><strong>TOTAL:</strong> ${totalQs}</div>
      <div><strong>DONE:</strong> ${totalAns}</div>
      <div class="stats-bar"><div class="stats-bar-fill" style="width: ${totalQs ? (totalAns/totalQs)*100 : 0}%"></div></div>
      <div style="margin-top:8px; text-align:right;"><button class="btn" onclick="toggleStats()">Close</button></div>
    </div>
  `;
}

function renderSettingsModal() {
  if (!state.settingsOpen) return '';
  // If user logged in, show account and sign out option
  const apiToggleChecked = state.useTurbo ? 'checked' : '';
  const neonChecked = state.neonEnabled ? 'checked' : '';

  const accountSection = state.currentUser ? `
    <div style="display:flex; flex-direction:column; gap:10px;">
      <div style="font-weight:700">Signed in as ${escapeHtml(state.currentUser.email)}</div>
      <div style="display:flex; gap:8px;"><button class="btn" onclick="signOut()">Sign out</button></div>
    </div>
  ` : `
    <div style="display:flex; gap:12px; flex-direction:column;">
      <form onsubmit="handleSignIn(event)">
        <div class="form-group"><label>Email</label><input name="email" class="input-brutal" required></div>
        <div class="form-group"><label>Password</label><input name="password" type="password" class="input-brutal" required></div>
        <div style="display:flex; gap:8px;"><button class="btn btn-primary" type="submit">Sign in</button></div>
      </form>
      <hr />
      <form onsubmit="handleSignUp(event)">
        <div class="form-group"><label>Email</label><input name="email" class="input-brutal" required></div>
        <div class="form-group"><label>Password</label><input name="password" type="password" class="input-brutal" required></div>
        <div style="display:flex; gap:8px;"><button class="btn" type="submit">Sign up</button></div>
      </form>
    </div>
  `;

  return `
    <div class="modal-overlay" onclick="toggleSettings()"></div>
    <div class="modal card">
      <div class="modal-header">
        <h2>Settings</h2>
        <button class="btn btn-secondary" onclick="toggleSettings()" style="padding: 5px 10px;">X</button>
      </div>
      <form onsubmit="saveSettings(event)" style="display:flex; flex-direction: column; gap: 16px;">
        <div class="form-group">
          <label>OpenRouter API Key (Standard)</label>
          <input type="password" name="apiKey" value="${state.currentUser && state.userKeys && state.userKeys.api_key_masked ? state.userKeys.api_key_masked : (state.apiKey||'')}" class="input-brutal" placeholder="sk-or-... (optional if Turbo enabled)">
          <small>Get a free key from <a href="https://openrouter.ai/keys" target="_blank">openrouter.ai</a></small>
        </div>

        <div class="form-group">
          <label style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" name="useTurbo" ${apiToggleChecked} style="width:auto; transform:scale(1.1);">
            Enable Turbo Mode (Groq)
          </label>
        </div>

        <div class="form-group" style="${state.useTurbo ? '' : 'opacity:0.7'}">
          <label>Groq API Key</label>
          <input type="password" name="groqKey" value="${state.currentUser && state.userKeys && state.userKeys.groq_key_masked ? state.userKeys.groq_key_masked : (state.groqKey||'')}" class="input-brutal" placeholder="gsk_...">
        </div>

        <div class="form-group">
          <label style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" name="useNeon" ${neonChecked} style="width:auto; transform:scale(1.1);">
            Save answers to Neon DB (server-side)
          </label>
          <small style="color:var(--text-muted);">Server must have NEON_API environment variable set.</small>
        </div>

        <button type="submit" class="btn btn-primary" style="width:100%">Save Settings</button>
      </form>

      <hr style="margin:18px 0; border:none; border-top:1px solid var(--border-weak);" />

      ${accountSection}
    </div>
  `;
}

function renderTabs() {
  return SUBJECTS.map(sub => `
    <button class="tab ${state.activeSubject === sub.id ? 'active' : ''}" 
            onclick="setSubject('${sub.id}')">
      ${sub.title}
    </button>
  `).join('');
}


function renderQuestionList() {
  const currentSub = state.subjects[state.activeSubject];
  
  if (currentSub.questions.length === 0) {
    return `<div class="card" style="text-align: center; padding: 3rem;">
        <h3>No Questions Found</h3>
        <p>Please paste raw text into the corresponding text file for this subject and populate <strong>db.js</strong> manually.</p>
    </div>`;
  }
  
  let processedQs = currentSub.questions.map((q, idx) => {
      const text = typeof q === 'object' ? q.text : q;
      const isAnswered = !!currentSub.answers[text];
      return { 
          originalIdx: idx, 
          text: text, 
          obj: typeof q === 'object' ? q : { text }, 
          isAnswered,
          answer: currentSub.answers[text]
      };
  });

  // Apply year filter (after processedQs is available)
  if (state.selectedYear && state.selectedYear !== 'all') {
      const sel = state.selectedYear;
      processedQs = processedQs.filter(q => {
          const y = getYearForQuestion(q.text) || 'unknown';
          if (sel === 'unknown') return !y || y === 'unknown';
          return String(y) === String(sel);
      });
  }
  
  if (state.filter === 'answered') {
      processedQs = processedQs.filter(q => q.isAnswered);
  } else if (state.filter === 'unanswered') {
      processedQs = processedQs.filter(q => !q.isAnswered);
  }
  

  if (state.search) {
      processedQs = processedQs.filter(q => q.text.toLowerCase().includes(state.search));
  }
  
  if (processedQs.length === 0) {
      return `<p style="text-align: center; font-weight: bold; margin-top: 30px;">No questions match your filter.</p>`;
  }

  return processedQs.map((q, displayIdx) => {
    const badgeHtml = q.isAnswered 
      ? '<span class="status-badge badge-answered"><i class="ph-bold ph-check-circle"></i> ANSWERED</span>'
      : '<span class="status-badge badge-unanswered"><i class="ph-bold ph-clock"></i> UNANSWERED</span>';

    const renderAiLinksHelper = () => {
      return `
        <div class="ai-links">
                <a href="${aiPromptBuilder(q.text, 'chatgpt')}" target="_blank" class="btn btn-glow btn-chatgpt" title="Ask ChatGPT"><img src="assets/chatgpt.png" alt="ChatGPT" class="ai-logo"> Ask ChatGPT</a>
                <a href="${aiPromptBuilder(q.text, 'claude')}" target="_blank" class="btn btn-glow btn-claude" title="Ask Claude"><img src="assets/claude-color.png" alt="Claude" class="ai-logo"> Ask Claude</a>
        </div>
      `;
    };

    let actionsHtml = '';
    let contentHtml = '';

    if (q.obj.generating) {
      actionsHtml = `<button class="btn btn-primary" disabled style="opacity:0.8;"><i class="ph-bold ph-spinner ph-spin"></i> Generating...</button>`;
    } else if (q.isAnswered) {
      actionsHtml = `
        <button class="btn btn-secondary" onclick="toggleAnswer('${state.activeSubject}', ${q.originalIdx})">
          ${q.obj.expanded ? '<i class="ph-bold ph-caret-up"></i> Hide Answer' : '<i class="ph-bold ph-caret-down"></i> Show Answer'}
        </button>
        <button class="btn" onclick="handleGenerateAnswer('${state.activeSubject}', ${q.originalIdx})"><i class="ph-bold ph-arrows-clockwise"></i> Regenerate</button>
        ${renderAiLinksHelper()}
      `;
      
      if (q.obj.expanded) {
        // Simple markdown parsing for the answer
        let formattedAnswer = window.marked ? marked.parse(q.answer) : q.answer;
            
        contentHtml = `
          <div class="answer-box">
             <div class="answer-actions">
               <button class="btn btn-secondary" onclick="copyAnswer('${state.activeSubject}', ${q.originalIdx})" style="font-size: 0.8rem; padding: 5px 10px;">Copy Text</button>
             </div>
             ${formattedAnswer}
          </div>
        `;
      }
    } else {
      actionsHtml = `
          <button class="btn btn-primary" onclick="handleGenerateAnswer('${state.activeSubject}', ${q.originalIdx})"><i class="ph-bold ph-sparkle"></i> Generate Answer</button>
          ${renderAiLinksHelper()}
      `;
    }

    let errorHtml = '';
    if (q.obj.error) {
      // Friendly, styled error message with hint
      const safeMsg = String(q.obj.error).replace(/</g, '&lt;').replace(/>/g, '&gt;');
      errorHtml = `<div class="answer-state error">${safeMsg}. If this is an endpoint or API issue, check Settings and your API key.</div>`;
    }

    return `
      <div class="card question-card">
        <div class="question-header">
          <div class="q-number">Q${displayIdx + 1}</div>
          ${badgeHtml}
        </div>
        ${renderQuestionContent(q.text)}
        ${errorHtml}
        <div class="question-actions" style="margin-top: 15px; display: flex; flex-wrap:wrap; gap: 10px; align-items: center;">
          ${actionsHtml}
        </div>
        ${contentHtml}
      </div>
    `;
  }).join('');
}


// Main Render Function
function render() {
  const container = document.getElementById('app');
  // If user is not signed in, show onboarding/sign-in screen only
  if (!state.currentUser) {
    container.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:center; min-height:60vh;">
        <div class="card" style="max-width:520px; width:100%; padding:28px; text-align:left;">
          <h2>Welcome — Please sign in</h2>
          <p style="color:var(--text-muted);">Sign in or create an account to continue. Your API keys will be stored securely per account.</p>
          <div style="display:flex; gap:12px; margin-top:18px;">
            <button class="btn btn-primary" onclick="toggleSettings()">Sign in / Sign up</button>
            <button class="btn" onclick="() => { /* optionally show info */ }">Learn more</button>
          </div>
        </div>
      </div>
    `;
    return;
  }

  const currentSub = state.subjects[state.activeSubject];
  const totalQs = currentSub.questions.length;
  const answeredQs = Object.keys(currentSub.answers).length;

  container.innerHTML = `
    <header class="header">
      <div class="header-content">
        <div style="display:flex; align-items:center; gap:16px;">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
            <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="var(--primary)" />
            <path d="M7 9h10v1H7zM7 12h6v1H7z" fill="white" />
          </svg>
          <div>
            <h1 style="margin:0;">CSIT 7th Sem — Question Bank</h1>
            <p class="subtitle" style="margin:4px 0 0;">Curated exam questions with AI-assisted answers</p>
          </div>
        </div>
          <div class="header-controls">
          ${renderStats()}
          <button class="btn btn-ghost" onclick="toggleSettings()" aria-label="Settings" title="Settings">
            <i class="ph-bold ph-gear" style="font-size:18px"></i>
          </button>
        </div>
      </div>
    </header>

    ${renderSettingsModal()}

    <main class="main-content">
      <div class="tabs">
        ${renderTabs()}
      </div>

      <div class="subject-header">
        <div>
          <h2>${currentSub.title}</h2>
          <p class="stats-text">${totalQs} Questions • ${answeredQs} Answered</p>
        </div>
          <div style="display: flex; gap: 10px; align-items:center;">
            <button class="btn btn-primary btn-glow" onclick="handleGenerateAll('${state.activeSubject}')" ${state.isGeneratingAll ? 'disabled' : ''}>
              ${state.isGeneratingAll ? '<i class="ph-bold ph-spinner ph-spin"></i> Generating...' : '<i class="ph-bold ph-lightning"></i> Generate All Missing'}
            </button>
            <button class="btn btn-primary btn-glow" onclick="window.print()"><i class="ph-bold ph-printer"></i> Export PDF</button>
          </div>
      </div>

      <div style="margin:16px 0 24px; display:flex; gap:8px; flex-wrap:wrap;">
        ${getYearsForSubject(state.activeSubject).map(y => {
          const label = String(y) === 'unknown' ? 'No Year' : String(y);
          const sel = String(state.selectedYear || 'all');
          return `<button class="year-pill ${sel === String(y) ? 'active' : ''}" onclick="setYearFilter('${y}')">${label}</button>`;
        }).join('')}
      </div>

      <div class="controls-bar">
         <div class="search-wrap">
           <i class="ph-bold ph-magnifying-glass search-icon"></i>
           <input type="text" 
           class="search-bar input-brutal" 
           placeholder="Search questions..." 
           value="${state.search}"
           oninput="setSearch(this.value)">
         </div>
               
        <div class="filters">
          <button class="filter-btn ${state.filter === 'all' ? 'active' : ''}" onclick="setFilter('all')">All</button>
          <button class="filter-btn ${state.filter === 'unanswered' ? 'active' : ''}" onclick="setFilter('unanswered')">Unanswered</button>
          <button class="filter-btn ${state.filter === 'answered' ? 'active' : ''}" onclick="setFilter('answered')">Answered <span>${answeredQs}</span></button>
        </div>
      </div>

      <div class="question-list">
        ${renderQuestionList()}
      </div>
    </main>
  `;
  
  setTimeout(() => {
    if(window.renderMathInElement) {
      renderMathInElement(container, {
        delimiters: [
          {left: "$$", right: "$$", display: true},
          {left: "\\[", right: "\\]", display: true},
          {left: "$", right: "$", display: false},
          {left: "\\(", right: "\\)", display: false}
        ],
        throwOnError: false
      });
    }
    // Syntax highlight any code blocks in answers and questions
    if (window.hljs && typeof window.hljs.highlightAll === 'function') {
      try { window.hljs.highlightAll(); } catch (e) { /* ignore */ }
    }
  }, 50);
}

function setupEventListeners() {
  // Can add global listeners here if needed
}

// Start App
document.addEventListener('DOMContentLoaded', init);
