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
  subjects: {},
  activeSubject: 'advanced-java',
  filter: 'all', // all, answered, unanswered
  search: '',
  isGeneratingAll: false,
  settingsOpen: false
};

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
  for (const q of qs) {
    const text = typeof q === 'object' ? q.text : q;
    const y = map[text];
    if (y) years.add(y);
  }
  return Array.from(years);
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
function init() {
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
  
  localStorage.setItem('or_api_key', key);
  localStorage.setItem('groq_api_key', groqKey);
  localStorage.setItem('use_turbo', turbo);
  localStorage.setItem('neon_enabled', neonEnabled);
  
  state.apiKey = key;
  state.groqKey = groqKey;
  state.useTurbo = turbo;
  state.neonEnabled = neonEnabled;
  toggleSettings();
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
    await fetch('/saveAnswer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

  return `
    <div class="stats-box">
      <div><strong>TOTAL:</strong> ${totalQs}</div>
      <div><strong>DONE:</strong> ${totalAns}</div>
      <div style="width: 100%; height: 8px; border: 2px solid var(--border); background: #eee; margin-top: 5px;">
        <div style="width: ${totalQs ? (totalAns/totalQs)*100 : 0}%; height: 100%; background: var(--success);"></div>
      </div>
    </div>
  `;
}

function renderSettingsModal() {
  if (!state.settingsOpen) return '';
  return `
    <div class="modal-overlay" onclick="toggleSettings()"></div>
    <div class="modal card">
      <div class="modal-header">
        <h2>Settings</h2>
        <button class="btn btn-secondary" onclick="toggleSettings()" style="padding: 5px 10px;">X</button>
      </div>
      <form onsubmit="saveSettings(event)" style="display:flex; flex-direction: column; gap: 15px;">
        <div class="form-group">
          <label>OpenRouter API Key (Standard)</label>
          <input type="password" name="apiKey" value="${state.apiKey}" class="input-brutal" placeholder="sk-or-... (optional if Turbo enabled)">
          <small>Get a free key from <a href="https://openrouter.ai/keys" target="_blank">openrouter.ai</a></small>
        </div>
        
        <div class="form-group">
          <label style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" name="useTurbo" ${state.useTurbo ? 'checked' : ''} style="width:auto; transform:scale(1.2);">
            Enable Turbo Mode 🚀 (Groq)
          </label>
        </div>
        
        <div class="form-group" style="${state.useTurbo ? '' : 'opacity:0.5'}">
          <label>Groq API Key</label>
          <input type="password" name="groqKey" value="${state.groqKey}" class="input-brutal" placeholder="gsk_...">
        </div>

        <div class="form-group">
          <label style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" name="useNeon" ${state.neonEnabled ? 'checked' : ''} style="width:auto; transform:scale(1.1);">
            Save answers to Neon DB (server-side)
          </label>
          <small style="color:var(--text-muted);">The Neon connection string must be configured on the server in the environment.</small>
        </div>

        <div class="status-indicator">
          Mode: ${state.useTurbo ? '<span style="color:#d946ef">Turbo Enabled</span>' : '<span style="color:var(--primary)">Standard Enabled</span>'}
          ${state.neonEnabled ? '<div style="margin-top:8px; font-size:13px; color:var(--text-muted);">Neon: Enabled (server)</div>' : ''}
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%">Save Settings</button>
      </form>
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
  
  // Apply filters and search
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
  
  if (state.filter === 'answered') {
      processedQs = processedQs.filter(q => q.isAnswered);
  } else if (state.filter === 'unanswered') {
      processedQs = processedQs.filter(q => !q.isAnswered);
  }
  
  // Year filtering
  if (state.selectedYear && state.selectedYear !== 'all') {
    processedQs = processedQs.filter(q => {
      const y = getYearForQuestion(q.text);
      if (state.selectedYear === 'unknown') return y === 'unknown';
      return y === state.selectedYear;
    });
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
                <a href="${aiPromptBuilder(q.text, 'chatgpt')}" target="_blank" class="btn btn-glow btn-chatgpt"><i class="ph-bold ph-chat-circle-text"></i> ChatGPT</a>
                <a href="${aiPromptBuilder(q.text, 'claude')}" target="_blank" class="btn btn-glow btn-claude"><i class="ph-bold ph-brain"></i> Claude</a>
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
        <button class="btn btn-secondary" onclick="assignYear('${state.activeSubject}', ${q.originalIdx})">Tag Year</button>
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
          <button class="btn btn-secondary" onclick="assignYear('${state.activeSubject}', ${q.originalIdx})">Tag Year</button>
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
          <button class="btn btn-primary" onclick="toggleSettings()">Settings</button>
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

      <div style="margin-bottom:18px; display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
        ${getYearsForSubject(state.activeSubject).map(y => `
          <button class="filter-btn ${state.selectedYear === y ? 'active' : ''}" onclick="setYearFilter('${y}')">${y === 'all' ? 'All Years' : (y === 'unknown' ? 'Unassigned' : y)}</button>
        `).join('')}
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
