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
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          token TEXT,
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
      await pool.query('INSERT INTO answers(subject, question, answer) VALUES($1,$2,$3)', [subject, question, answer]);
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('Neon insert failed', e);
    return res.status(500).json({ error: 'Insert failed' });
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
    return res.status(500).json({ error: 'Signup failed or email exists' });
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
    const r = await pool.query('SELECT id, email FROM users WHERE token=$1', [token]);
    if (!r.rows.length) return res.status(401).json({ error: 'Invalid token' });
    return res.json({ ok: true, user: r.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Lookup failed' });
  }
});

app.listen(3000, () => console.log('Neon backend listening on :3000')); 
