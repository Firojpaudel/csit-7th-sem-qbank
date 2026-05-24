const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key] && value) process.env[key] = value;
  });
}

loadDotEnv();

const app = express();
app.use(bodyParser.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const NEON = process.env.NEON_API || process.env.DATABASE_URL || process.env.NEON_DATABASE_URL; // set this on the server environment
if (!NEON) {
  console.warn('NEON_API not set in environment; /saveAnswer will return 503');
}

let pool;
if (NEON) {
  pool = new Pool({ connectionString: NEON });
  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          token TEXT,
          api_key TEXT,
          groq_key TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS answers (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          subject TEXT,
          question TEXT,
          answer TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
          UNIQUE(user_id, subject, question)
        );
      `);
      // ensure columns exist for older schemas
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key TEXT;`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS groq_key TEXT;`);
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
    // find user from token if provided
    const auth = req.headers['authorization'];
    let userId = null;
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice(7);
      const r = await pool.query('SELECT id FROM users WHERE token=$1', [token]);
      if (r.rows.length) userId = r.rows[0].id;
    }

    if (userId) {
      await pool.query(`INSERT INTO answers(user_id, subject, question, answer)
        VALUES($1,$2,$3,$4)
        ON CONFLICT (user_id, subject, question)
        DO UPDATE SET answer = EXCLUDED.answer, created_at = now()
      `, [userId, subject, question, answer]);
    } else {
      const existing = await pool.query('SELECT id FROM answers WHERE user_id IS NULL AND subject=$1 AND question=$2', [subject, question]);
      if (existing.rows.length) {
        await pool.query('UPDATE answers SET answer=$1, created_at=now() WHERE id=$2', [answer, existing.rows[0].id]);
      } else {
        await pool.query('INSERT INTO answers(subject, question, answer) VALUES($1,$2,$3)', [subject, question, answer]);
      }
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('Neon insert failed', e);
    return res.status(500).json({ error: 'Insert failed' });
  }
});

app.get('/answers', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Neon not configured' });
  try {
    const auth = req.headers['authorization'];
    let userId = null;
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice(7);
      const r = await pool.query('SELECT id FROM users WHERE token=$1', [token]);
      if (r.rows.length) userId = r.rows[0].id;
    }

    let query, params;
    if (userId) {
      query = `SELECT subject, question, answer, user_id FROM answers WHERE user_id = $1 OR user_id IS NULL ORDER BY created_at DESC`;
      params = [userId];
    } else {
      query = `SELECT subject, question, answer, user_id FROM answers WHERE user_id IS NULL ORDER BY created_at DESC`;
      params = [];
    }
    const r = await pool.query(query, params);
    return res.json({ ok: true, answers: r.rows });
  } catch (e) {
    console.error('Fetch answers failed', e);
    return res.status(500).json({ error: 'Fetch failed' });
  }
});

const crypto = require('crypto');

app.post('/signup', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Neon not configured' });
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });
  try {
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    const token = crypto.randomBytes(24).toString('hex');
    const r = await pool.query('INSERT INTO users(email, password_hash, token) VALUES($1,$2,$3) RETURNING id, email, token', [email, hash, token]);
    const user = r.rows[0];
    return res.json({ ok: true, token: user.token, user: { id: user.id, email: user.email } });
  } catch (e) {
    console.error('Signup failed', e);
    const detail = e && (e.detail || e.message) ? `: ${e.detail || e.message}` : '';
    return res.status(500).json({ error: `Signup failed or email exists${detail}` });
  }
});

app.post('/signin', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Neon not configured' });
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });
  try {
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    const r = await pool.query('SELECT id, email FROM users WHERE email=$1 AND password_hash=$2', [email, hash]);
    if (!r.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const token = crypto.randomBytes(24).toString('hex');
    await pool.query('UPDATE users SET token=$1 WHERE id=$2', [token, r.rows[0].id]);
    return res.json({ ok: true, token, user: { id: r.rows[0].id, email: r.rows[0].email } });
  } catch (e) {
    console.error('Signin failed', e);
    return res.status(500).json({ error: 'Signin failed' });
  }
});

app.get('/me', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Neon not configured' });
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  const token = auth.slice(7);
  try {
    const r = await pool.query('SELECT id, email, api_key IS NOT NULL AS has_api_key, groq_key IS NOT NULL AS has_groq_key FROM users WHERE token=$1', [token]);
    if (!r.rows.length) return res.status(401).json({ error: 'Invalid token' });
    const row = r.rows[0];
    return res.json({ ok: true, user: { id: row.id, email: row.email, has_api_key: row.has_api_key, has_groq_key: row.has_groq_key } });
  } catch (e) {
    return res.status(500).json({ error: 'Lookup failed' });
  }
});

// Return masked keys for the signed-in user (does not reveal full secret)
app.get('/me/keys', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Neon not configured' });
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  const token = auth.slice(7);
  try {
    const r = await pool.query('SELECT id, email, api_key, groq_key FROM users WHERE token=$1', [token]);
    if (!r.rows.length) return res.status(401).json({ error: 'Invalid token' });
    const u = r.rows[0];
    const mask = (s) => { if (!s) return null; return s.slice(0,4) + '••••' + s.slice(-4); };
    return res.json({ ok: true, api_key_masked: mask(u.api_key), groq_key_masked: mask(u.groq_key) });
  } catch (e) { console.error('me/keys failed', e); return res.status(500).json({ error: 'Lookup failed' }); }
});

// Save API keys for the signed-in user
app.post('/me/keys', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Neon not configured' });
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  const token = auth.slice(7);
  const { apiKey, groqKey } = req.body || {};
  try {
    const r = await pool.query('SELECT id FROM users WHERE token=$1', [token]);
    if (!r.rows.length) return res.status(401).json({ error: 'Invalid token' });
    const userId = r.rows[0].id;
    await pool.query('UPDATE users SET api_key=$1, groq_key=$2 WHERE id=$3', [apiKey || null, groqKey || null, userId]);
    return res.json({ ok: true });
  } catch (e) { console.error('me/keys save failed', e); return res.status(500).json({ error: 'Save failed' }); }
});

app.listen(3000, () => console.log('Neon backend listening on :3000')); 
