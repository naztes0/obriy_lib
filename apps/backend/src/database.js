import pg from 'pg';

const { Pool } = pg;

export function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({ connectionString, max: 10 });
  pool.on('error', (error) => {
    console.error('Idle database connection failed:', error.message);
  });
  return pool;
}
