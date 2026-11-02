import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool } from '../src/database.js';

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const pool = createPool();
const client = await pool.connect();

try {
  await client.query('SELECT pg_advisory_lock(68416001)');
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
    .sort();

  for (const name of files) {
    const existing = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
    if (existing.rowCount) continue;

    const sql = await readFile(join(migrationsDirectory, name), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
      console.log(`Applied ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${name} failed: ${error.message}`, { cause: error });
    }
  }
} finally {
  await client.query('SELECT pg_advisory_unlock(68416001)');
  client.release();
  await pool.end();
}
