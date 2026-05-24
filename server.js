const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');

const app = express();
app.use(bodyParser.json());

const NEON = process.env.NEON_API; // set this on the server environment
if (!NEON) {
  console.warn('NEON_API not set in environment; /saveAnswer will return 503');
}

let pool;
if (NEON) {
  pool = new Pool({ connectionString: NEON });
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS answers (
        id SERIAL PRIMARY KEY,
        subject TEXT,
        question TEXT,
        answer TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      )`);
    } catch (e) {
      console.error('Failed to ensure answers table exists', e);
    }
  })();
}

app.post('/saveAnswer', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Neon not configured on server' });
  const { subject, question, answer } = req.body || {};
  if (!question || !answer) return res.status(400).json({ error: 'Missing question or answer' });
  try {
    await pool.query('INSERT INTO answers(subject, question, answer) VALUES($1,$2,$3)', [subject, question, answer]);
    return res.json({ ok: true });
  } catch (e) {
    console.error('Neon insert failed', e);
    return res.status(500).json({ error: 'Insert failed' });
  }
});

app.listen(3000, () => console.log('Neon backend listening on :3000')); 
