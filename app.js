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
const API_BASE = localStorage.getItem('api_base') || (window.location.hostname.includes('.app.github.dev')
  ? window.location.origin.replace('-5500.', '-3000.')
  : 'http://localhost:3000');

let state = {
  apiKey: localStorage.getItem('or_api_key') || '',
  groqKey: localStorage.getItem('groq_api_key') || '',
  useTurbo: localStorage.getItem('use_turbo') === 'true',
  neonEnabled: localStorage.getItem('neon_enabled') !== 'false',
  selectedYear: localStorage.getItem('selected_year') || 'all',
  sessionToken: localStorage.getItem('session_token') || '',
  currentUser: null,
  subjects: {},
  activeSubject: 'advanced-java',
  filter: 'all', // all, answered, unanswered
  search: '',
  isGeneratingAll: false,
  settingsOpen: false,
  authMode: 'signin',
  neonStatus: 'loading',
  userKeys: {},
  theme: localStorage.getItem('theme') || 'dark'
};

function setCurrentUser(user) {
  state.currentUser = user || null;
  render();
}

async function fetchMe() {
  const token = state.sessionToken;
  if (!token) return setCurrentUser(null);
  try {
    const resp = await fetch(`${API_BASE}/me`, { headers: { 'Authorization': `Bearer ${token}` } });
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
    // 1. Get masked versions for settings display
    const resp = await fetch(`${API_BASE}/me/keys`, { headers: { 'Authorization': `Bearer ${state.sessionToken}` } });
    if (resp.ok) {
      const data = await resp.json();
      state.userKeys = data || {};
    }

    // 2. Get full decrypted keys and restore them silently
    const fullResp = await fetch(`${API_BASE}/me/keys/full`, { headers: { 'Authorization': `Bearer ${state.sessionToken}` } });
    if (fullResp.ok) {
      const full = await fullResp.json();
      // Only restore if the user doesn't already have the key locally (or if server has a newer/different one)
      if (full.apiKey && (!state.apiKey || state.apiKey !== full.apiKey)) {
        state.apiKey = full.apiKey;
        localStorage.setItem('or_api_key', full.apiKey);
      }
      if (full.groqKey && (!state.groqKey || state.groqKey !== full.groqKey)) {
        state.groqKey = full.groqKey;
        localStorage.setItem('groq_api_key', full.groqKey);
      }
    }
  } catch (e) { state.userKeys = {}; }
}

async function saveUserKeys(apiKey, groqKey) {
  if (!state.sessionToken) throw new Error('Not signed in');
  const resp = await fetch(`${API_BASE}/me/keys`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.sessionToken}` }, body: JSON.stringify({ apiKey, groqKey }) });
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
    const y = typeof q === 'object' && q.year ? q.year : (map[text] || 'unknown');
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

  // Check if text contains common HTML tags (like <table, <p, <div, <tbody, etc.)
  if (/<(table|p|div|pre|code|span|br|strong|em|ul|li|ol|tr|td|th)\b[^>]*>/i.test(text)) {
    return `<div class="question-text">${text}</div>`;
  }

  if (isCodeLike(text)) {
    const escaped = escapeHtml(text);
    // try to guess language (Java common in this dataset)
    return `<pre class="question-code"><code class="language-java">${escaped}</code></pre>`;
  }
  const escaped = escapeHtml(text);
  if (text.includes('\t') || text.split('\n').some(line => line.includes('  '))) {
    // Preserve space alignment for columns / transaction datasets
    return `<div class="question-text question-monospace">${escaped}</div>`;
  }
  return `<div class="question-text">${escaped}</div>`;
}


async function fetchAnswers() {
  if (!state.neonEnabled) {
    state.neonStatus = 'unconfigured';
    return;
  }
  try {
    const headers = {};
    if (state.sessionToken) {
      headers['Authorization'] = `Bearer ${state.sessionToken}`;
    }
    const resp = await fetch(`${API_BASE}/answers`, { headers });
    if (resp.status === 503) {
      state.neonStatus = 'unconfigured';
      return;
    }
    if (!resp.ok) {
      state.neonStatus = 'error';
      return;
    }
    const data = await resp.json();
    if (data.ok && data.answers) {
      data.answers.forEach(row => {
        const sub = state.subjects[row.subject];
        if (sub) {
          sub.answers[row.question] = row.answer;
        }
      });
      state.neonStatus = 'connected';
      saveAnswers();
      render();
    }
  } catch (e) {
    console.warn('Neon DB answers sync failed:', e);
    state.neonStatus = 'error';
  }
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



  loadDataFromDB();
  setupEventListeners();
  await fetchMe();
  await fetchAnswers();
  document.documentElement.setAttribute('data-theme', state.theme);
  if (!state.currentUser) {
    state.settingsOpen = true;
    state.authMode = 'signin';
  }
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

function toggleKeyVisibility(fieldName) {
  const inp = document.querySelector(`input[name="${fieldName}"]`);
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  const btn = document.getElementById(`toggle-${fieldName}`);
  if (btn) {
    const icon = btn.querySelector('i');
    if (icon) {
      icon.className = inp.type === 'password' ? 'ph-bold ph-eye' : 'ph-bold ph-eye-slash';
    }
  }
}

function toggleStats() {
  state.headerStatsOpen = !state.headerStatsOpen;
  render();
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', state.theme);
  document.documentElement.setAttribute('data-theme', state.theme);
  render();
}

function openAuthMode(mode) {
  state.authMode = mode;
  state.settingsOpen = true;
  render();
}

function setAuthMode(mode) {
  state.authMode = mode;
  state.settingsOpen = true;
  render();
}

function saveSettings(e) {
  e.preventDefault();
  const formData = new FormData(e.target);
  const key = formData.get('apiKey').trim();
  const groqKey = formData.get('groqKey')?.trim() || '';
  const turbo = formData.get('useTurbo') === 'on';
  const neonEnabled = formData.get('useNeon') === 'on';

  // Save settings in state and localStorage
  localStorage.setItem('use_turbo', turbo);
  localStorage.setItem('neon_enabled', neonEnabled);
  state.useTurbo = turbo;
  state.neonEnabled = neonEnabled;

  // Only save to localStorage and state if the user entered a real, unmasked key
  if (key && !key.includes('•')) {
    localStorage.setItem('or_api_key', key);
    state.apiKey = key;
  }
  if (groqKey && !groqKey.includes('•')) {
    localStorage.setItem('groq_api_key', groqKey);
    state.groqKey = groqKey;
  }

  if (state.currentUser) {
    const apiToBackup = (key && !key.includes('•')) ? key : null;
    const groqToBackup = (groqKey && !groqKey.includes('•')) ? groqKey : null;
    
    // Only call server backup if they actually provided new keys
    if (apiToBackup || groqToBackup) {
      saveUserKeys(apiToBackup, groqToBackup).then(()=>{
        fetchAnswers();
        toggleSettings();
      }).catch(err=>{ alert('Failed to backup keys on server: '+(err.message||err)); });
    } else {
      fetchAnswers();
      toggleSettings();
    }
  } else {
    fetchAnswers();
    toggleSettings();
  }
}



async function handleSignIn(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const email = fd.get('email').trim();
  const password = fd.get('password');
  try {
    const resp = await fetch(`${API_BASE}/signin`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password }) });
    if (!resp.ok) {
      const err = await resp.json().catch(()=>({}));
      return alert(err.error || 'Sign in failed');
    }
    const data = await resp.json();
    state.sessionToken = data.token;
    localStorage.setItem('session_token', data.token);
    await fetchMe();
    await fetchAnswers();
    toggleSettings();
  } catch (e) { alert('Sign in failed'); }
}

async function handleSignUp(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const email = fd.get('email').trim();
  const password = fd.get('password');
  try {
    const resp = await fetch(`${API_BASE}/signup`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password }) });
    if (!resp.ok) { const err = await resp.json().catch(()=>({})); return alert(err.error || 'Sign up failed'); }
    const data = await resp.json();
    state.sessionToken = data.token;
    localStorage.setItem('session_token', data.token);
    await fetchMe();
    await fetchAnswers();
    toggleSettings();
  } catch (e) { alert('Sign up failed'); }
}

function signOut() {
  state.sessionToken = '';
  localStorage.removeItem('session_token');
  setCurrentUser(null);
  const savedAnswers = JSON.parse(localStorage.getItem('csit_answers') || '{}');
  SUBJECTS.forEach(sub => {
    state.subjects[sub.id].answers = savedAnswers[sub.id] || {};
  });
  fetchAnswers();
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

  if (state.useTurbo) {
    if (!state.groqKey) {
      alert("Please set your Groq API Key in settings first for Turbo Mode.");
      toggleSettings();
      return;
    }
  } else {
    if (!state.apiKey) {
      alert("Please set your OpenRouter API Key in settings first.");
      toggleSettings();
      return;
    }
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
    await fetch(`${API_BASE}/saveAnswer`, {
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
  if (state.useTurbo) {
    if (!state.groqKey) {
      alert("Please set your Groq API Key in settings first for Turbo Mode.");
      toggleSettings();
      return;
    }
  } else {
    if (!state.apiKey) {
      alert("Please set your OpenRouter API Key in settings first.");
      toggleSettings();
      return;
    }
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
  return '';
}

function renderSettingsModal() {
  if (!state.settingsOpen) return '';
  if (!state.currentUser) {
    const isSignIn = state.authMode !== 'signup';
    return `
      <div class="modal-overlay" onclick="toggleSettings()"></div>
      <div class="modal card animate-fade">
        <div class="modal-header">
          <h2>${isSignIn ? 'Sign In' : 'Create Account'}</h2>
          <button class="btn btn-secondary" onclick="toggleSettings()" style="padding: 5px 10px;">X</button>
        </div>
        <p style="color:var(--text-muted); margin-bottom:20px; font-size:14px;">
          ${isSignIn ? 'Sign in to save your model answers and sync keys securely.' : 'Create an account so you can save answers and store your API keys per user.'}
        </p>
        ${isSignIn ? `
          <div style="display:flex; gap:12px; flex-direction:column;">
            <form onsubmit="handleSignIn(event)">
              <div class="form-group"><label>Email Address</label><input name="email" type="email" placeholder="you@example.com" class="input-brutal" required></div>
              <div class="form-group"><label>Password</label><input name="password" type="password" placeholder="••••••••" class="input-brutal" required></div>
              <div style="display:flex; flex-direction:column; gap:10px; margin-top:8px;">
                <button class="btn btn-primary" type="submit" style="width: 100%; justify-content: center;">Sign In</button>
                <button class="btn btn-secondary" type="button" onclick="setAuthMode('signup')" style="width: 100%; justify-content: center;">Create New Account</button>
              </div>
            </form>
          </div>
        ` : `
          <div style="display:flex; gap:12px; flex-direction:column;">
            <form onsubmit="handleSignUp(event)">
              <div class="form-group"><label>Email Address</label><input name="email" type="email" placeholder="you@example.com" class="input-brutal" required></div>
              <div class="form-group"><label>Password</label><input name="password" type="password" placeholder="••••••••" class="input-brutal" required></div>
              <div style="display:flex; flex-direction:column; gap:10px; margin-top:8px;">
                <button class="btn btn-primary" type="submit" style="width: 100%; justify-content: center;">Create Account</button>
                <button class="btn btn-secondary" type="button" onclick="setAuthMode('signin')" style="width: 100%; justify-content: center;">Back to Sign In</button>
              </div>
            </form>
          </div>
        `}
        <div style="text-align:center; margin-top: 20px; border-top: 1px solid var(--border); padding-top: 16px;">
          <a href="#" onclick="toggleSettings(); return false;" style="color:var(--primary); font-weight:600; text-decoration:none; font-size:14px;">
             Or continue as Guest <i class="ph-bold ph-arrow-right" style="vertical-align:middle; margin-left:4px;"></i>
          </a>
        </div>
      </div>
    `;
  }

  // If user logged in, show account and API key settings
  const apiToggleChecked = state.useTurbo ? 'checked' : '';
  const neonChecked = state.neonEnabled ? 'checked' : '';

  const apiPlaceholder = state.currentUser && state.userKeys && state.userKeys.api_key_masked
    ? `Saved on Server: ${state.userKeys.api_key_masked}`
    : "sk-or-... (optional if Turbo enabled)";
  const groqPlaceholder = state.currentUser && state.userKeys && state.userKeys.groq_key_masked
    ? `Saved on Server: ${state.userKeys.groq_key_masked}`
    : "gsk_...";

  const accountSection = `
    <div class="account-section">
      <div class="account-info">
        <i class="ph-bold ph-user-circle" style="font-size:20px; color:var(--primary);"></i>
        <div>
          <div style="font-size:11px; color:var(--text-muted); font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">Signed in as</div>
          <div style="font-weight:700; font-size:14px;">${escapeHtml(state.currentUser.email)}</div>
        </div>
      </div>
      <button class="btn btn-signout" onclick="signOut()"><i class="ph-bold ph-sign-out"></i> Sign out</button>
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
          <div class="key-input-wrap">
            <input type="password" name="apiKey" value="${state.apiKey || ''}" class="input-brutal" placeholder="${apiPlaceholder}">
            <button type="button" id="toggle-apiKey" class="btn btn-eye" onclick="toggleKeyVisibility('apiKey')" title="Toggle visibility">
              <i class="ph-bold ph-eye"></i>
            </button>
          </div>
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
          <div class="key-input-wrap">
            <input type="password" name="groqKey" value="${state.groqKey || ''}" class="input-brutal" placeholder="${groqPlaceholder}">
            <button type="button" id="toggle-groqKey" class="btn btn-eye" onclick="toggleKeyVisibility('groqKey')" title="Toggle visibility">
              <i class="ph-bold ph-eye"></i>
            </button>
          </div>
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
          const y = q.obj.year || getYearForQuestion(q.text) || 'unknown';
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

    const yearVal = q.obj.year || getYearForQuestion(q.text) || 'Unknown';
    const typeVal = q.obj.type || 'General Questions';
    const yearBadge = `<span class="status-badge badge-year"><i class="ph-bold ph-calendar"></i> ${yearVal}</span>`;
    const typeBadge = `<span class="status-badge badge-type"><i class="ph-bold ph-tag"></i> ${typeVal}</span>`;

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
        <button class="btn btn-regenerate" onclick="handleGenerateAnswer('${state.activeSubject}', ${q.originalIdx})"><i class="ph-bold ph-arrows-clockwise"></i> Regenerate</button>
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
        <div class="question-header" style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
          <div class="q-number">Q${displayIdx + 1}</div>
          ${badgeHtml}
          ${yearBadge}
          ${typeBadge}
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

  const currentSub = state.subjects[state.activeSubject];
  const totalQs = currentSub.questions.length;
  const answeredQs = Object.keys(currentSub.answers).length;

  let neonIndicator = '';
  if (state.neonStatus === 'connected') {
    neonIndicator = `<span class="db-badge connected" title="Neon DB Sync Active"><span class="pulse-dot"></span> NEON ONLINE</span>`;
  } else if (state.neonStatus === 'error') {
    neonIndicator = `<span class="db-badge error" title="Neon DB Sync Error">NEON OFFLINE</span>`;
  } else {
    neonIndicator = `<span class="db-badge unconfigured" title="Neon DB Unconfigured">LOCAL ONLY</span>`;
  }

  let authControl = '';
  if (state.currentUser) {
    authControl = `
      <div class="user-profile" onclick="toggleSettings()">
        <div class="avatar"><i class="ph-bold ph-user-circle"></i></div>
        <span class="user-email" title="${escapeHtml(state.currentUser.email)}">${escapeHtml(state.currentUser.email.split('@')[0])}</span>
      </div>
    `;
  } else {
    authControl = `
      <button class="btn btn-secondary btn-login" onclick="openAuthMode('signin')">
        <i class="ph-bold ph-sign-in"></i> Sign In
      </button>
    `;
  }

  container.innerHTML = `
    <header class="header">
      <div class="header-content">
        <div style="display:flex; align-items:center; gap:16px;">
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
            <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="var(--primary)" />
            <path d="M7 9h10v1H7zM7 12h6v1H7z" fill="white" />
          </svg>
          <div>
            <h1 style="margin:0;">CSIT 7th Sem — Question Bank</h1>
            <p class="subtitle" style="margin:4px 0 0;">Curated exam questions with AI-assisted answers</p>
          </div>
        </div>
        <div class="header-controls">
          ${neonIndicator}
          ${authControl}
          <button class="btn btn-ghost" onclick="toggleTheme()" aria-label="Toggle Theme" title="Toggle Theme">
            <i class="ph-bold ${state.theme === 'dark' ? 'ph-sun' : 'ph-moon'}" style="font-size:18px"></i>
          </button>
          <button class="btn btn-ghost" onclick="toggleSettings()" aria-label="Settings" title="Settings">
            <i class="ph-bold ph-gear" style="font-size:18px"></i>
          </button>
        </div>
      </div>
    </header>

    ${renderSettingsModal()}

    <div class="dashboard-layout">
      <aside class="sidebar-panel">
        <div class="sidebar-section">
          <h3>Subjects</h3>
          <div class="tabs">
            ${renderTabs()}
          </div>
        </div>

        <div class="sidebar-section quick-stats-card">
          <h3>Quick Stats</h3>
          <div class="stats-grid">
            <div class="stat-box">
              <span class="stat-num">${totalQs}</span>
              <span class="stat-lbl">Questions</span>
            </div>
            <div class="stat-box">
              <span class="stat-num glow-green">${answeredQs}</span>
              <span class="stat-lbl">Answered</span>
            </div>
          </div>
          <div class="progress-bar-container">
            <div class="progress-fill" style="width: ${totalQs ? (answeredQs / totalQs) * 100 : 0}%"></div>
          </div>
          <span class="progress-pct">${totalQs ? Math.round((answeredQs / totalQs) * 100) : 0}% Mastered</span>
        </div>
      </aside>

      <main class="content-panel">
        <div class="subject-header">
          <div>
            <h2>${currentSub.title}</h2>
            <p class="stats-text">${totalQs} Questions • ${answeredQs} Answered</p>
          </div>
          <div style="display: flex; gap: 10px; align-items:center; flex-wrap:wrap;">
            <button class="btn btn-primary btn-glow" onclick="handleGenerateAll('${state.activeSubject}')" ${state.isGeneratingAll ? 'disabled' : ''}>
              ${state.isGeneratingAll ? '<i class="ph-bold ph-spinner ph-spin"></i> Generating...' : '<i class="ph-bold ph-lightning"></i> Generate All Missing'}
            </button>
            <button class="btn btn-primary btn-glow" onclick="window.print()"><i class="ph-bold ph-printer"></i> Export PDF</button>
          </div>
        </div>

        <div class="year-filters-section">
          <span class="section-label">Exam Year:</span>
          <div class="year-pills-list">
            ${getYearsForSubject(state.activeSubject).map(y => {
              const label = String(y) === 'unknown' ? 'No Year' : String(y);
              const sel = String(state.selectedYear || 'all');
              return `<button class="year-pill ${sel === String(y) ? 'active' : ''}" onclick="setYearFilter('${y}')">${label}</button>`;
            }).join('')}
          </div>
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
    </div>
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
