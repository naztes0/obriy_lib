/**
 * Перевіряє, що HTTP-процес працює і PostgreSQL відповідає.
 */
export class HealthService {
  constructor(pool) {
    this.pool = pool;
  }

  /** @returns {Promise<{status: string, database: string}>} Стан сервера й БД. */
  async check() {
    await this.pool.query('SELECT 1');
    return { status: 'ok' };
  }
}
