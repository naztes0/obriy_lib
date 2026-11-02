import { randomBytes, scryptSync } from 'node:crypto';
import { createPool } from '../src/database.js';

const login = process.env.BOOTSTRAP_LOGIN?.trim();
const displayName = process.env.BOOTSTRAP_DISPLAY_NAME?.trim();
const password = process.env.BOOTSTRAP_PASSWORD;

if (!login || !displayName || !password || password === 'change-me-before-running') {
  throw new Error('Set BOOTSTRAP_LOGIN, BOOTSTRAP_DISPLAY_NAME and a non-default BOOTSTRAP_PASSWORD');
}

const pool = createPool();
const client = await pool.connect();

try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(68416002)');
  const existing = await client.query("SELECT id FROM staff_accounts WHERE role = 'manager' LIMIT 1");
  if (existing.rowCount) {
    await client.query('COMMIT');
    console.log('A manager account already exists; no account was created.');
  } else {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    await client.query(
      `INSERT INTO staff_accounts (login, display_name, password_hash, role)
       VALUES ($1, $2, $3, 'manager')`,
      [login, displayName, `scrypt:${salt}:${hash}`],
    );
    await client.query('COMMIT');
    console.log('Initial manager account created.');
  }
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
