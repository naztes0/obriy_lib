export class HealthService {
  constructor(pool) {
    this.pool = pool;
  }

  async check() {
    await this.pool.query('SELECT 1');
    return { status: 'ok' };
  }
}
