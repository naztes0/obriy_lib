import { createPool } from '../src/database.js';
import { hashPassword } from '../src/modules/auth/password.js';

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
    const passwordHash = await hashPassword(password);
    await client.query(
      `INSERT INTO staff_accounts (login, display_name, password_hash, role)
       VALUES ($1, $2, $3, 'manager')`,
      [login, displayName, passwordHash],
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
