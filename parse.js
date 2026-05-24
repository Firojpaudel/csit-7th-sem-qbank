const fs = require('fs');

const SUBJECTS = [
  { file: 'raw_advanced_java.txt', id: 'advanced-java' },
  { file: 'raw_data_mining.txt', id: 'data-mining' },
  { file: 'raw_pom.txt', id: 'pom' },
  { file: 'raw_software_project_management.txt', id: 'software-project-management' }
];

const IGNORE_LINES = [
  "Tribhuvan University",
  "Institute of Science and Technology",
  "Bachelor Level",
  "Computer Science and Information Technology",
  "csc409", "csc410", "mgt411", "csc415",
  "Advanced Java Programming",
  "Data Warehousing and Data Mining",
  "Principles of Management",
  "Software Project Management",
  "Full Marks",
  "Pass Marks",
  "Time:",
  "Candidates are required to give",
  "their answers in their own words as far as practicable",
  "The figures in the margin indicate full marks.",
  "Section A",
  "Section B",
  "Section C",
  "Group A",
  "Group B",
  "Group C",
  "Attempt any",
  "Question",
  "LONG QUESTION",
  "SHORT QUESTION",
  "Home", "About", "Contact", "Privacy", "Terms", "Hamro CSIT", "Question Bank",
  "Semester", "Model-Set", "----"
];

let db = {
  "advanced-java": [],
  "data-mining": [],
  "pom": [],
  "software-project-management": []
};

for (const sub of SUBJECTS) {
  if (!fs.existsSync(sub.file)) continue;
  
  const text = fs.readFileSync(sub.file, 'utf8');
  const lines = text.split('\n');
  
  let questions = [];
  let currentQuestion = [];
  let isCapturing = false;
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;
    
    // Check if line should be completely ignored (header noise, etc)
    let shouldIgnore = IGNORE_LINES.some(ignore => line.toLowerCase().includes(ignore.toLowerCase()));
    
    // Check if line is just a year (e.g., 2082, 2079)
    if (line.match(/^20\d{2}$/) || line.match(/^(20\d{2})\s*(Old\.?|New\.?|\(Old\)|\(New\))$/)) {
      shouldIgnore = true;
    }
    
    if (shouldIgnore) continue;

    // Check if line is a single question number indicating next question (1 to 2 digits max)
    if (line.match(/^\d{1,2}[A-Za-z]?\.?$/)) {
      if (currentQuestion.length > 0) {
        questions.push(currentQuestion.join('\n'));
        currentQuestion = [];
      }
      isCapturing = true; // Started a new question
      continue; // Skip appending the number itself
    } else if (line.match(/^Q\.?\s*(No\.?)?\s*\d{1,2}[\.:\)]?\s*/i)) {
      if (currentQuestion.length > 0) {
        questions.push(currentQuestion.join('\n'));
        currentQuestion = [];
      }
      isCapturing = true;
      line = line.replace(/^Q\.?\s*(No\.?)?\s*\d{1,2}[\.:\)]?\s*/i, '');
      if (line) currentQuestion.push(line);
      continue;
    }
    
    if (isCapturing) {
      currentQuestion.push(line);
    }
  }
  
  if (currentQuestion.length > 0) {
    questions.push(currentQuestion.join('\n'));
  }
  
  // Clean question texts and remove duplicates
  let finalQuestions = questions
    .map(q => q.trim())
    .filter(q => q.length > 10) // Ignore too short fragments
    .filter((q, idx, arr) => arr.indexOf(q) === idx); // De-duplicate
    
  db[sub.id] = finalQuestions;
}

const dbOutput = `const QUESTIONS_DB = ${JSON.stringify(db, null, 2)};`;
fs.writeFileSync('db.js', dbOutput);
console.log("Successfully parsed files and updated db.js!");
