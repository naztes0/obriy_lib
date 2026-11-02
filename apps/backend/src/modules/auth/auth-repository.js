export class AuthRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findAccountByLogin(login) {
    const result = await this.pool.query(
      `SELECT id, login, display_name, password_hash, role, is_active
       FROM staff_accounts
       WHERE lower(login) = lower($1)
       LIMIT 1`,
      [login],
    );
    return result.rows[0] ?? null;
  }

  async createSession({ id, staffId, tokenHash, expiresAt }) {
    await this.pool.query(
      `INSERT INTO staff_sessions (id, staff_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [id, staffId, tokenHash, expiresAt],
    );
  }

  async findActiveSession(tokenHash) {
    const result = await this.pool.query(
      `SELECT s.id AS session_id, s.expires_at,
              a.id, a.login, a.display_name, a.role, a.is_active
       FROM staff_sessions s
       JOIN staff_accounts a ON a.id = s.staff_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND a.is_active = true
       LIMIT 1`,
      [tokenHash],
    );
    return result.rows[0] ?? null;
  }

  async revokeSession(tokenHash) {
    await this.pool.query(
      `UPDATE staff_sessions
       SET revoked_at = COALESCE(revoked_at, now())
       WHERE token_hash = $1`,
      [tokenHash],
    );
  }
}
