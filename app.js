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
const API_BASE = localStorage.getItem('api_base') || (
  window.location.hostname.includes('.app.github.dev')
    ? window.location.origin.replace('-5500.', '-3000.')
    : (window.location.hostname.includes('firojpaudel.com.np') || window.location.hostname.includes('onrender.com')
        ? 'https://csit-7th-sem-qbank.onrender.com'
        : (window.location.port ? `${window.location.protocol}//${window.location.hostname}:3000` : 'http://localhost:3000'))
);


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
  theme: localStorage.getItem('theme') || 'dark',
  viewMode: localStorage.getItem('view_mode') || 'board'
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
    console.log('[Keys Sync] Syncing keys from server...');
    // 1. Get masked versions for settings display
    const resp = await fetch(`${API_BASE}/me/keys`, { headers: { 'Authorization': `Bearer ${state.sessionToken}` } });
    if (resp.ok) {
      const data = await resp.json();
      state.userKeys = data || {};
      console.log('[Keys Sync] Masked keys loaded:', state.userKeys);
    }

    // 2. Get full decrypted keys and restore them silently
    const fullResp = await fetch(`${API_BASE}/me/keys/full`, { headers: { 'Authorization': `Bearer ${state.sessionToken}` } });
    if (fullResp.ok) {
      const full = await fullResp.json();
      console.log('[Keys Sync] Full keys fetched:', { hasApi: !!full.apiKey, hasGroq: !!full.groqKey });
      
      let needsUpload = false;
      let uploadApi = null;
      let uploadGroq = null;

      // Handle OpenRouter API Key
      if (full.apiKey) {
        if (state.apiKey !== full.apiKey) {
          console.log('[Keys Sync] Restoring OpenRouter key from server');
          state.apiKey = full.apiKey;
          localStorage.setItem('or_api_key', full.apiKey);
        }
      } else if (state.apiKey) {
        console.log('[Keys Sync] Server is missing OpenRouter key, queueing upload of local key');
        needsUpload = true;
        uploadApi = state.apiKey;
      }

      // Handle Groq API Key
      if (full.groqKey) {
        if (state.groqKey !== full.groqKey) {
          console.log('[Keys Sync] Restoring Groq key from server');
          state.groqKey = full.groqKey;
          localStorage.setItem('groq_api_key', full.groqKey);
        }
      } else if (state.groqKey) {
        console.log('[Keys Sync] Server is missing Groq key, queueing upload of local key');
        needsUpload = true;
        uploadGroq = state.groqKey;
      }

      if (needsUpload) {
        console.log('[Keys Sync] Uploading local keys to database backup...');
        await saveUserKeys(uploadApi || state.apiKey, uploadGroq || state.groqKey, true);
        const resp2 = await fetch(`${API_BASE}/me/keys`, { headers: { 'Authorization': `Bearer ${state.sessionToken}` } });
        if (resp2.ok) {
          state.userKeys = await resp2.json() || {};
        }
      }
    }
  } catch (e) {
    console.error('[Keys Sync] Error syncing keys:', e);
    state.userKeys = {};
  }
}

async function saveUserKeys(apiKey, groqKey, skipRefetch = false) {
  if (!state.sessionToken) throw new Error('Not signed in');
  const resp = await fetch(`${API_BASE}/me/keys`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.sessionToken}` }, body: JSON.stringify({ apiKey, groqKey }) });
  if (!resp.ok) throw new Error('Could not save keys');
  if (!skipRefetch) {
    await fetchUserKeys();
  }
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
  const map = loadYearMap();
  const years = new Set();
  years.add('all');
  years.add('unknown');
  const yearRegex = /\b(19|20)\d{2}\b/g;

  if (state.viewMode === 'chapters') {
    const chapters = state.subjects[subId].chapters || [];
    for (const ch of chapters) {
      for (const q of ch.questions) {
        const text = q.text;
        const y = q.year || map[text] || 'unknown';
        if (y) {
          years.add(y);
        }
      }
    }
  } else {
    const qs = state.subjects[subId].questions || [];
    for (const q of qs) {
      const text = typeof q === 'object' ? q.text : q;
      const y = typeof q === 'object' && q.year ? q.year : (map[text] || 'unknown');
      if (y) {
        years.add(y);
      }
    }
  }
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
  const lines = text.split('\n').map(l => l.trim());
  // If many lines start with typical code tokens or contain semicolons/braces
  const codeHints = ['class ', 'public ', 'private ', 'protected ', 'System.out', 'console.log', 'def ', 'function ', ';', '{', '}', '#include', 'import '];
  let hints = 0;
  for (const h of codeHints) if (text.indexOf(h) !== -1) hints++;
  const indentedLines = lines.filter(l => l.startsWith(' ') || l.startsWith('\t')).length;
  if (hints >= 1 && lines.length > 1) return true;
  if (indentedLines >= Math.max(2, Math.floor(lines.length / 3))) return true;
  return false;
}

function renderQuestionContent(text) {
  if (!text) return '';
  // clean trailing separator lines like '---' or '...' to avoid ugly triples
  function cleanQuestionText(t) {
    const lines = String(t).split('\n');
    while (lines.length && /^\s*[-._]{2,}\s*$/.test(lines[lines.length - 1])) lines.pop();
    while (lines.length && /^\s*\.\.\.\s*$/.test(lines[lines.length - 1])) lines.pop();
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
      chapters: [],
      answers: savedAnswers[sub.id] || {},
      status: 'idle',
      error: null
    };
  });

  // Configure Markdown for Mermaid diagrams
  if (window.marked) {
    const renderer = new marked.Renderer();
    const originalCodeRenderer = renderer.code.bind(renderer);
    renderer.code = function (codeArg, languageArg, isEscaped) {
      let code = codeArg;
      let language = languageArg;

      // Support marked v5+ object signature
      if (codeArg && typeof codeArg === 'object') {
        code = codeArg.text;
        language = codeArg.lang || codeArg.language;
      }

      if (language === 'mermaid') {
        // Decode HTML entities if marked/browser pre-escaped them
        let rawCode = code;
        try {
          const txt = document.createElement("textarea");
          txt.innerHTML = rawCode;
          rawCode = txt.value;
        } catch (e) { }
        return `<div class="mermaid-container"><pre class="mermaid">${rawCode}</pre></div>`;
      }
      return originalCodeRenderer(codeArg, languageArg, isEscaped);
    };
    marked.use({ renderer });
  }



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
    if (typeof IMPORTANT_QUESTIONS_DB !== 'undefined' && IMPORTANT_QUESTIONS_DB[sub.id]) {
      state.subjects[sub.id].chapters = JSON.parse(JSON.stringify(IMPORTANT_QUESTIONS_DB[sub.id]));
    } else {
      state.subjects[sub.id].chapters = [];
    }
  });
}

function saveAnswers() {
  const answersToSave = {};
  SUBJECTS.forEach(sub => {
    answersToSave[sub.id] = state.subjects[sub.id].answers;
  });
  localStorage.setItem('csit_answers', JSON.stringify(answersToSave));
}

// ── Subject-specific exam preparation system prompts ────────────────────────
const SUBJECT_PROMPTS = {
  'advanced-java': `You are an expert Java programming instructor and examiner for BSc CSIT (Tribhuvan University, Nepal) 7th Semester — Advanced Java Programming.

**CRITICAL EXAM PREPARATION CONTEXT:**
- EXAM PREPARATION: The user is preparing for university board exams. Answer properly, following standard university marking schemes. Make answers structured, clear, and easy to read.
- DO NOT OVERENGINEER: For all programming solutions, KEEP CODE AS EASY AND CLEAR AS POSSIBLE. Do NOT use complex architectures, custom wrappers, or unnecessary design patterns. Use minimal, direct, standard library APIs (e.g., basic Swing/AWT, direct JDBC statement, direct TCP Sockets, basic RMI interfaces). The code must be extremely easy to understand, memorize, and write by hand on paper during the board exam.

Course scope: Swing GUI, AWT, JDBC, Servlets, JSP, JavaBeans, RMI, Java Networking (Sockets, URL, HTTP), Multithreading, Collections, Generics, Lambda, Stream API, Design Patterns in Java.

You are answering a university exam question worth 5–16 marks. Follow these rules strictly:

**Answer Format:**
- Start with a crisp 1–2 line definition or concept overview
- Use clear numbered sections for multi-part questions
- Include working Java code examples (properly indented, with step-by-step comments) whenever the question involves programming
- For comparison questions, use a markdown table
- For "explain" questions: definition → working mechanism → real-world use case → code snippet
- For listing questions: numbered list with 1-line explanation per point
- End with a brief summary sentence

**Depth & Length:**
- 5-mark questions: ~200–300 words + code if relevant
- 10-mark questions: ~400–600 words + code + diagram described in text
- 16-mark questions: ~700–1000 words, multiple sections, code, table, example

**Java Code & Exam Optimization Rules:**
- KEEP CODE SIMPLE & MEMORIZABLE: Design code examples to be minimal, clear, robust, and extremely easy to write by hand on paper.
- PROPERLY DOCUMENT (COMMENT) THE CODE: Provide clear, sequential, step-by-step inline comments (using '//') explaining exactly what key classes, methods, parameters, and GUI setups do so the code is easy to understand and remember.
- All Java code must be syntactically correct, basic, and fully compilable.
- Mention Java version context where relevant (Java 8+ features like lambdas, streams).`,

  'data-mining': `You are an expert Data Warehousing and Data Mining (DWDM) professor and examiner for BSc CSIT (Tribhuvan University, Nepal) 7th Semester.

**CRITICAL EXAM PREPARATION CONTEXT:**
- EXAM PREPARATION: The user is preparing for university board exams. Answer properly, following standard university marking schemes. Make answers structured, clear, and easy to read.
- DO NOT OVERENGINEER: For any pseudo-code, algorithms, or calculations, KEEP THE LOGIC AS EASY AND CLEAR AS POSSIBLE. The formulas, numbers, and derivations must be extremely easy to understand, memorize, and write by hand on paper during the board exam.

Course scope: Data Warehousing concepts (OLAP, OLTP, star/snowflake/fact constellation schemas, data cube), ETL, Data Preprocessing (cleaning, integration, transformation, reduction), Association Rule Mining (Apriori, FP-Growth, confidence, support, lift), Classification (Decision Trees, Naive Bayes, KNN, SVM, Neural Networks, Evaluation metrics), Clustering (K-Means, DBSCAN, Hierarchical), Regression, Web Mining, Text Mining.

You are answering a university exam question worth 5–16 marks. Follow these rules strictly:

**Answer Format:**
- Begin with a precise definition or concept statement
- Use numbered steps for algorithms (e.g., Apriori steps, K-Means iterations)
- Show worked numerical examples wherever the question involves calculation (support/confidence, distance metrics, Gini index, entropy, information gain)
- Use tables to compare techniques (e.g., OLAP vs OLTP, clustering algorithms)
- Draw ASCII diagrams for schemas (star schema, decision tree structure) or describe them clearly
- For "explain" questions: concept → mathematical definition → worked example → advantages/limitations

**Depth & Length:**
- 5-mark questions: ~200–300 words + formula + small example
- 10-mark questions: ~400–600 words + worked example + diagram/table
- 16-mark questions: ~700–1000 words, full algorithm walkthrough with example data

**Algorithm & Numerical/Code Optimization Rules:**
- SIMPLE ALGORITHMS: If pseudo-code or implementation code is required, keep it highly simplified, straightforward, and optimized for hand-written exams (no complex data structures, just clear procedural/OOP logic). Add inline comments explaining each step.
- STEP-BY-STEP MATH: Show worked mathematical formulas clearly before applying numbers. Break down all steps (such as log base 2 arithmetic in Entropy or distance computations) sequentially, keeping them simple and easy to reproduce on paper.
- Reference real-world applications (retail analytics, fraud detection, healthcare).`,

  'pom': `You are an expert Management professor and examiner for BSc CSIT (Tribhuvan University, Nepal) 7th Semester — Principles of Management.

**CRITICAL EXAM PREPARATION CONTEXT:**
- EXAM PREPARATION: The user is preparing for university board exams. Answer properly, following standard university marking schemes. Make answers structured, clear, and easy to read.
- DO NOT OVERENGINEER: Keep explanations and frameworks straightforward, clear, and direct. The concepts must be extremely easy to understand, memorize, and write by hand on paper during the board exam.

Course scope: Evolution of management thought (Classical, Behavioral, Quantitative, Systems, Contingency), Functions of management (Planning, Organizing, Staffing, Leading, Controlling), Decision Making, Organizational Structure & Design, Motivation theories (Maslow, Herzberg, McGregor, Vroom), Leadership styles, Communication, Conflict management, Change management, MBO, Corporate Social Responsibility.

You are answering a university exam question worth 5–16 marks. Follow these rules strictly:

**Answer Format:**
- Start with a clear definition of the concept
- Use headings to structure different aspects of the answer
- Include a real-world business example (a company name + scenario) for every major concept
- For theories: name → core idea → key assumptions → application → criticism
- For comparison questions: side-by-side table
- For process/function questions: numbered sequential steps
- End with practical implications for modern organizations

**Depth & Length:**
- 5-mark questions: ~200–300 words, definition + 3–4 key points + example
- 10-mark questions: ~400–600 words, theory overview + diagram + real example + analysis
- 16-mark questions: ~700–900 words, comprehensive coverage with case study-style example

**Exam-Friendly Structured Answers:**
- Break down explanations into bullet points or simple, sequential sections that a student can easily memorize and structure in a paper-based board exam.
- Reference management theorists by name (e.g., Henri Fayol, Peter Drucker, Frederick Taylor).
- Relate concepts to IT industry context where possible (managing software teams, agile orgs).`,

  'software-project-management': `You are an expert Software Project Management professor and examiner for BSc CSIT (Tribhuvan University, Nepal) 7th Semester.

**CRITICAL EXAM PREPARATION CONTEXT:**
- EXAM PREPARATION: The user is preparing for university board exams. Answer properly, following standard university marking schemes. Make answers structured, clear, and easy to read.
- DO NOT OVERENGINEER: For any estimation formulas, scheduling derivations, or project management methodologies, KEEP THE SOLUTIONS AS EASY AND CLEAR AS POSSIBLE. The formulas, network diagrams, and calculations must be extremely easy to understand, memorize, and write by hand on paper during the board exam.

Course scope: Software project planning, estimation techniques (COCOMO, Function Point, Use Case Point), scheduling (Gantt charts, PERT, CPM, network diagrams), risk management, software quality assurance (SQA), software metrics and measurement, project monitoring and control, team management, configuration management, SDLC models (Waterfall, Agile, Scrum, XP, Spiral), project closure, software contracts and procurement.

You are answering a university exam question worth 5–16 marks. Follow these rules strictly:

**Answer Format:**
- Begin with a precise definition or purpose statement
- For process/methodology questions: numbered steps with explanation of each
- For estimation questions: show the formula, worked numerical example with realistic values
- For comparison questions: table format (e.g., Agile vs Waterfall, PERT vs CPM)
- Include diagrams described in text where relevant (Gantt chart structure, network diagram, risk matrix)
- For risk management: identify → analyze → plan → monitor framework
- End with why it matters in real software projects

**Depth & Length:**
- 5-mark questions: ~200–300 words + formula or table
- 10-mark questions: ~400–600 words + worked example + comparison
- 16-mark questions: ~700–1000 words, full process description + example project + metrics

**Formula & Calculation Optimization Rules:**
- CLEAR FORMULAS: State all estimation or scheduling formulas explicitly (e.g., COCOMO effort/time, Function Point, PERT expected time/standard deviation).
- ANNOTATED VARIABLES: Properly label and define each variable inside the formula so they are easily memorized.
- STEP-BY-STEP CALCULATIONS: Break down calculations into clear, sequential steps. Use simple, realistic numbers so that the derivation is intuitive and easy to reproduce by hand during exams.
- Reference standard bodies where appropriate (IEEE, ISO, PMI/PMBOK).`
};

function getSystemPromptForSubject(subjectId) {
  return SUBJECT_PROMPTS[subjectId] || SUBJECT_PROMPTS['advanced-java'];
}
// ────────────────────────────────────────────────────────────────────────────


async function callAI(questionText, subjectId) {
  const sysPrompt = getSystemPromptForSubject(subjectId || state.activeSubject);
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
          { role: 'system', content: sysPrompt },
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
        'X-Title': 'CSIT 7th Sem Question Bank'
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: sysPrompt },
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

function setViewMode(mode) {
  state.viewMode = mode;
  localStorage.setItem('view_mode', mode);
  // Reset selectedYear to 'all' to prevent mismatching years in different view modes
  state.selectedYear = 'all';
  localStorage.setItem('selected_year', 'all');
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
      saveUserKeys(apiToBackup, groqToBackup).then(() => {
        fetchAnswers();
        toggleSettings();
      }).catch(err => { alert('Failed to backup keys on server: ' + (err.message || err)); });
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
    const resp = await fetch(`${API_BASE}/signin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
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
    const resp = await fetch(`${API_BASE}/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    if (!resp.ok) { const err = await resp.json().catch(() => ({})); return alert(err.error || 'Sign up failed'); }
    const data = await resp.json();
    state.sessionToken = data.token;
    localStorage.setItem('session_token', data.token);
    await fetchMe();
    await fetchAnswers();
    toggleSettings();
  } catch (e) { alert('Sign up failed'); }
}

function signOut() {
  // Clear session
  state.sessionToken = '';
  localStorage.removeItem('session_token');

  // ✅ Wipe API keys from memory AND localStorage so no guest can reuse them
  state.apiKey = '';
  state.groqKey = '';
  state.userKeys = {};
  localStorage.removeItem('or_api_key');
  localStorage.removeItem('groq_api_key');

  // Clear answers that came from Neon (they belong to the signed-in user)
  SUBJECTS.forEach(sub => {
    state.subjects[sub.id].answers = {};
  });
  localStorage.removeItem('csit_answers');

  setCurrentUser(null);
  state.neonStatus = 'unconfigured';
  state.settingsOpen = true;
  state.authMode = 'signin';
  state.filter = 'all';
  render();
}

function toggleAnswer(subjectId, mode, idx1, idx2) {
  let qObj;
  if (mode === 'chapters') {
    qObj = state.subjects[subjectId].chapters[idx1].questions[idx2];
  } else {
    qObj = state.subjects[subjectId].questions[idx1];
  }
  qObj.expanded = !qObj.expanded;
  render();
}

async function handleGenerateAnswer(subjectId, mode, idx1, idx2) {
  // ✅ Auth gate — must be signed in
  if (!state.currentUser) {
    openAuthMode('signin');
    return;
  }

  const subject = state.subjects[subjectId];
  let qObj;
  if (mode === 'chapters') {
    qObj = subject.chapters[idx1].questions[idx2];
  } else {
    qObj = subject.questions[idx1];
    if (typeof qObj === 'string') {
      subject.questions[idx1] = { text: qObj };
      qObj = subject.questions[idx1];
    }
  }

  const questionText = qObj.text;

  if (state.useTurbo) {
    if (!state.groqKey) {
      alert("Please set your Groq API Key in Settings first for Turbo Mode.");
      toggleSettings();
      return;
    }
  } else {
    if (!state.apiKey) {
      alert("Please set your OpenRouter API Key in Settings first.");
      toggleSettings();
      return;
    }
  }

  qObj.generating = true;
  qObj.error = null;
  render();

  try {
    const answer = await callAI(questionText, subjectId);
    subject.answers[questionText] = answer;
    saveAnswers();
    // Fire-and-forget save to Neon if enabled
    if (state.neonEnabled) {
      sendToNeon(subjectId, questionText, answer).catch((err) => {
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
  // ✅ Auth gate
  if (!state.currentUser) {
    openAuthMode('signin');
    return;
  }

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

  let unanswered = [];
  if (state.viewMode === 'chapters') {
    subject.chapters.forEach((ch, chIdx) => {
      ch.questions.forEach((q, qIdx) => {
        if (!subject.answers[q.text]) {
          unanswered.push({ mode: 'chapters', idx1: chIdx, idx2: qIdx });
        }
      });
    });
  } else {
    subject.questions.forEach((q, qIdx) => {
      const text = typeof q === 'object' ? q.text : q;
      if (!subject.answers[text]) {
        unanswered.push({ mode: 'board', idx1: qIdx });
      }
    });
  }

  if (unanswered.length === 0) return;

  if (!confirm(`This will generate answers for ${unanswered.length} questions. This may take a while or hit API rate limits. Continue?`)) {
    return;
  }

  state.isGeneratingAll = true;
  for (const item of unanswered) {
    if (state.viewMode === 'chapters') {
      const q = subject.chapters[item.idx1].questions[item.idx2];
      if (!subject.answers[q.text]) {
        await handleGenerateAnswer(subjectId, 'chapters', item.idx1, item.idx2);
        // Add a small delay to prevent rate limits
        await new Promise(r => setTimeout(r, 1000));
      }
    } else {
      const q = subject.questions[item.idx1];
      const text = typeof q === 'object' ? q.text : q;
      if (!subject.answers[text]) {
        await handleGenerateAnswer(subjectId, 'board', item.idx1);
        // Add a small delay to prevent rate limits
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  state.isGeneratingAll = false;
}

function copyAnswer(subjectId, mode, idx1, idx2) {
  const subject = state.subjects[subjectId];
  let qObj;
  if (mode === 'chapters') {
    qObj = subject.chapters[idx1].questions[idx2];
  } else {
    qObj = subject.questions[idx1];
  }
  const qStr = typeof qObj === 'object' ? qObj.text : qObj;
  const text = subject.answers[qStr];
  if (text) {
    navigator.clipboard.writeText(text).then(() => {
      alert("Answer copied to clipboard!");
    });
  }
}

const aiPromptBuilder = (questionText, ai, subjectId) => {
  const sysPrompt = getSystemPromptForSubject(subjectId || state.activeSubject);
  const subjectName = SUBJECTS.find(s => s.id === (subjectId || state.activeSubject))?.title || 'BSc CSIT 7th Semester';
  const prompt = `${sysPrompt}

---
SUBJECT: ${subjectName} (BSc CSIT, Tribhuvan University, Nepal — 7th Semester Exam Preparation)

Please answer the following exam question in full detail, exam-ready format:

${questionText}`;
  const encoded = encodeURIComponent(prompt);
  if (ai === 'chatgpt') return `https://chatgpt.com/?q=${encoded}`;
  if (ai === 'claude') return `https://claude.ai/new?q=${encoded}`;
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
          <button type="button" class="btn btn-close" onclick="toggleSettings()"><i class="ph-bold ph-x"></i></button>
        </div>
        <p style="color:var(--text-muted); margin-bottom:20px; font-size:14px;">
          ${isSignIn ? 'Sign in to save your model answers and sync keys securely.' : 'Create an account so you can save answers and store your API keys per user.'}
        </p>
        ${isSignIn ? `
          <div style="display:flex; gap:12px; flex-direction:column;">
            <form onsubmit="handleSignIn(event)" onkeydown="if(event.key === 'Enter') { const btn = this.querySelector('button[type=\\'submit\\']'); if(btn) { event.preventDefault(); btn.click(); } }">
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
            <form onsubmit="handleSignUp(event)" onkeydown="if(event.key === 'Enter') { const btn = this.querySelector('button[type=\\'submit\\']'); if(btn) { event.preventDefault(); btn.click(); } }">
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
        <button type="button" class="btn btn-close" onclick="toggleSettings()"><i class="ph-bold ph-x"></i></button>
      </div>
      <form onsubmit="saveSettings(event)" onkeydown="if(event.key === 'Enter' && event.target.tagName !== 'TEXTAREA') { const btn = this.querySelector('button[type=\\'submit\\']'); if(btn) { event.preventDefault(); btn.click(); } }" style="display:flex; flex-direction: column; gap: 16px;">
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


function renderQuestionCard(q, displayIdx, mode, idx1, idx2) {
  const badgeHtml = state.currentUser ? (q.isAnswered
    ? '<span class="status-badge badge-answered"><i class="ph-bold ph-check-circle"></i> ANSWERED</span>'
    : '<span class="status-badge badge-unanswered"><i class="ph-bold ph-clock"></i> UNANSWERED</span>') : '';

  const yearVal = q.obj.year || getYearForQuestion(q.text) || 'Unknown';
  const typeVal = q.obj.type || 'General Questions';
  const yearBadge = `<span class="status-badge badge-year"><i class="ph-bold ph-calendar"></i> ${yearVal}</span>`;
  const typeBadge = `<span class="status-badge badge-type"><i class="ph-bold ph-tag"></i> ${typeVal}</span>`;

  const renderAiLinksHelper = () => {
    return `
      <div class="ai-links">
        <a href="${aiPromptBuilder(q.text, 'chatgpt', state.activeSubject)}" target="_blank" class="btn btn-glow btn-chatgpt" title="Ask ChatGPT"><img src="assets/chatgpt.png" alt="ChatGPT" class="ai-logo"> Ask ChatGPT</a>
        <a href="${aiPromptBuilder(q.text, 'claude', state.activeSubject)}" target="_blank" class="btn btn-glow btn-claude" title="Ask Claude"><img src="assets/claude-color.png" alt="Claude" class="ai-logo"> Ask Claude</a>
      </div>
    `;
  };

  let actionsHtml = '';
  let contentHtml = '';

  if (!state.currentUser) {
    actionsHtml = `
      <button class="btn btn-signin-gate" onclick="openAuthMode('signin')">
        <i class="ph-bold ph-lock"></i> Sign In to Generate Answer
      </button>
      ${renderAiLinksHelper()}
    `;
  } else if (q.obj.generating) {
    actionsHtml = `<button class="btn btn-primary" disabled style="opacity:0.8;"><i class="ph-bold ph-spinner ph-spin"></i> Generating...</button>`;
  } else if (q.isAnswered) {
    actionsHtml = `
      <button class="btn btn-secondary" onclick="toggleAnswer('${state.activeSubject}', '${mode}', ${idx1}, ${idx2})">
        ${q.obj.expanded ? '<i class="ph-bold ph-caret-up"></i> Hide Answer' : '<i class="ph-bold ph-caret-down"></i> Show Answer'}
      </button>
      <button class="btn btn-regenerate" onclick="handleGenerateAnswer('${state.activeSubject}', '${mode}', ${idx1}, ${idx2})"><i class="ph-bold ph-arrows-clockwise"></i> Regenerate</button>
      ${renderAiLinksHelper()}
    `;

    if (q.obj.expanded) {
      let formattedAnswer = window.marked ? marked.parse(q.answer) : q.answer;
      contentHtml = `
        <div class="answer-box">
           <div class="answer-actions">
             <button class="btn btn-secondary" onclick="copyAnswer('${state.activeSubject}', '${mode}', ${idx1}, ${idx2})" style="font-size: 0.8rem; padding: 5px 10px;">Copy Text</button>
           </div>
           ${formattedAnswer}
        </div>
      `;
    }
  } else {
    actionsHtml = `
        <button class="btn btn-primary" onclick="handleGenerateAnswer('${state.activeSubject}', '${mode}', ${idx1}, ${idx2})"><i class="ph-bold ph-sparkle"></i> Generate Answer</button>
        ${renderAiLinksHelper()}
    `;
  }

  let errorHtml = '';
  if (q.obj.error) {
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
}

function renderQuestionList() {
  const currentSub = state.subjects[state.activeSubject];

  if (state.viewMode === 'chapters') {
    if (!currentSub.chapters || currentSub.chapters.length === 0) {
      return `<div class="card" style="text-align: center; padding: 3rem;">
          <h3>No Chapters Found</h3>
          <p>Please populate <strong>db_important.js</strong> manually.</p>
      </div>`;
    }

    let renderedChapters = [];
    let qCounter = 0;

    currentSub.chapters.forEach((ch, chIdx) => {
      let questionsInChapter = ch.questions.map((q, idx) => {
        const text = q.text;
        const isAnswered = !!currentSub.answers[text];
        return {
          originalIdx: idx,
          chapterIdx: chIdx,
          text: text,
          obj: q,
          isAnswered,
          answer: currentSub.answers[text]
        };
      });

      // Filter by Year
      if (state.selectedYear && state.selectedYear !== 'all') {
        const sel = state.selectedYear;
        questionsInChapter = questionsInChapter.filter(q => {
          const y = q.obj.year || getYearForQuestion(q.text) || 'unknown';
          if (sel === 'unknown') return !y || y === 'unknown';
          return String(y) === String(sel);
        });
      }

      // Filter by Answered status
      if (state.filter === 'answered') {
        questionsInChapter = questionsInChapter.filter(q => q.isAnswered);
      } else if (state.filter === 'unanswered') {
        questionsInChapter = questionsInChapter.filter(q => !q.isAnswered);
      }

      // Filter by Search text
      if (state.search) {
        questionsInChapter = questionsInChapter.filter(q => q.text.toLowerCase().includes(state.search));
      }

      if (questionsInChapter.length > 0) {
        const chapterHtml = `
          <div class="chapter-block">
            <div class="chapter-title">
              <span class="chapter-number">Ch ${chIdx + 1}</span>
              <span>${ch.chapter}</span>
            </div>
            <div class="chapter-questions-list">
              ${questionsInChapter.map(q => {
                const card = renderQuestionCard(q, qCounter, 'chapters', q.chapterIdx, q.originalIdx);
                qCounter++;
                return card;
              }).join('')}
            </div>
          </div>
        `;
        renderedChapters.push(chapterHtml);
      }
    });

    if (renderedChapters.length === 0) {
      return `<p style="text-align: center; font-weight: bold; margin-top: 30px;">No questions match your filter.</p>`;
    }

    return renderedChapters.join('');
  } else {
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

    // Apply year filter
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
      return renderQuestionCard(q, displayIdx, 'board', q.originalIdx);
    }).join('');
  }
}


// Main Render Function
function render() {
  const searchFocused = document.activeElement && document.activeElement.id === 'question-search-input';
  const selectionStart = searchFocused ? document.activeElement.selectionStart : null;
  const selectionEnd = searchFocused ? document.activeElement.selectionEnd : null;

  const container = document.getElementById('app');

  const currentSub = state.subjects[state.activeSubject];
  const totalQs = state.viewMode === 'chapters'
    ? (currentSub.chapters ? currentSub.chapters.reduce((acc, c) => acc + c.questions.length, 0) : 0)
    : currentSub.questions.length;
  const answeredQs = state.viewMode === 'chapters'
    ? (currentSub.chapters ? currentSub.chapters.reduce((acc, c) => acc + c.questions.filter(q => currentSub.answers[q.text]).length, 0) : 0)
    : currentSub.questions.filter(q => currentSub.answers[typeof q === 'object' ? q.text : q]).length;

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
            <h1 style="margin:0;">CSIT PrepSphere</h1>
            <p class="subtitle" style="margin:4px 0 0;">7th Semester QBank & AI Study Assistant</p>
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

        ${state.currentUser ? `
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
        ` : ''}
      </aside>

      <main class="content-panel">
        <div class="subject-header">
          <div>
            <h2>${currentSub.title}</h2>
            <p class="stats-text">${totalQs} Questions${state.currentUser ? ` • ${answeredQs} Answered` : ''}</p>
            <div class="view-mode-selector" style="margin-top: 10px;">
              <button class="view-mode-btn ${state.viewMode === 'board' ? 'active' : ''}" onclick="setViewMode('board')">
                <i class="ph-bold ph-file-text"></i> Past Board Exams
              </button>
              <button class="view-mode-btn ${state.viewMode === 'chapters' ? 'active' : ''}" onclick="setViewMode('chapters')">
                <i class="ph-bold ph-list-numbers"></i> Chapter-Wise QBank
              </button>
            </div>
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
            id="question-search-input"
            class="search-bar input-brutal" 
            placeholder="Search questions..." 
            value="${state.search}"
            oninput="setSearch(this.value)">
          </div>
                 
          ${state.currentUser ? `
          <div class="filters">
            <button class="filter-btn ${state.filter === 'all' ? 'active' : ''}" onclick="setFilter('all')">All</button>
            <button class="filter-btn ${state.filter === 'unanswered' ? 'active' : ''}" onclick="setFilter('unanswered')">Unanswered</button>
            <button class="filter-btn ${state.filter === 'answered' ? 'active' : ''}" onclick="setFilter('answered')">Answered <span>${answeredQs}</span></button>
          </div>
          ` : ''}
        </div>

        <div class="question-list">
          ${renderQuestionList()}
        </div>
      </main>
    </div>
  `;

  if (searchFocused) {
    const searchInput = document.getElementById('question-search-input');
    if (searchInput) {
      searchInput.focus();
      if (selectionStart !== null && selectionEnd !== null) {
        searchInput.setSelectionRange(selectionStart, selectionEnd);
      }
    }
  }

  setTimeout(() => {
    if (window.renderMathInElement) {
      renderMathInElement(container, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\[", right: "\\]", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false }
        ],
        throwOnError: false
      });
    }
    // Syntax highlight any code blocks in answers and questions
    if (window.hljs && typeof window.hljs.highlightAll === 'function') {
      try { window.hljs.highlightAll(); } catch (e) { /* ignore */ }
    }
    // Render Mermaid diagrams dynamically
    if (window.mermaid) {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: state.theme === 'light' ? 'default' : 'dark',
          securityLevel: 'loose'
        });
        mermaid.run({
          querySelector: '.mermaid:not([data-processed="true"])'
        }).catch(err => {
          console.warn("Mermaid rendering failed:", err);
        });
      } catch (e) {
        console.warn("Mermaid initialization failed:", e);
      }
    }
  }, 50);
}

function setupEventListeners() {
  // Can add global listeners here if needed
}

// Start App
document.addEventListener('DOMContentLoaded', init);
