function mapStaff(row) {
  return {
    id: String(row.id),
    login: row.login,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export class StaffRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async listStaff({ activity, pageSize, offset }) {
    const values = [];
    let where = '';
    if (activity !== 'all') {
      values.push(activity === 'active');
      where = 'WHERE is_active = $1';
    }
    const countResult = await this.pool.query(
      `SELECT count(*) AS total FROM staff_accounts ${where}`,
      values,
    );
    values.push(pageSize, offset);
    const result = await this.pool.query(
      `SELECT id, login, display_name, role, is_active, created_at
       FROM staff_accounts ${where}
       ORDER BY CASE role WHEN 'manager' THEN 0 ELSE 1 END,
                lower(display_name), id
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return {
      staff: result.rows.map(mapStaff),
      totalItems: Number(countResult.rows[0].total),
    };
  }

  async createLibrarian({ login, displayName, passwordHash }) {
    try {
      const result = await this.pool.query(
        `INSERT INTO staff_accounts (login, display_name, password_hash, role)
         VALUES ($1, $2, $3, 'librarian')
         RETURNING id`,
        [login, displayName, passwordHash],
      );
      return { status: 'created', staffId: String(result.rows[0].id) };
    } catch (error) {
      if (error.code === '23505' && error.constraint === 'staff_accounts_login_unique') {
        return { status: 'duplicate_login' };
      }
      throw error;
    }
  }

  async findStaffById(staffId) {
    const result = await this.pool.query(
      `SELECT id, login, display_name, password_hash, role, is_active, created_at
       FROM staff_accounts WHERE id = $1`,
      [staffId],
    );
    return result.rowCount ? result.rows[0] : null;
  }

  async setLibrarianActivity(staffId, isActive) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT id, role, is_active FROM staff_accounts WHERE id = $1 FOR UPDATE`,
        [staffId],
      );
      if (!current.rowCount) {
        await client.query('ROLLBACK');
        return { status: 'not_found' };
      }
      if (current.rows[0].role !== 'librarian') {
        await client.query('ROLLBACK');
        return { status: 'manager_protected' };
      }
      await client.query('UPDATE staff_accounts SET is_active = $2 WHERE id = $1', [
        staffId,
        isActive,
      ]);
      if (!isActive) {
        await client.query(
          `UPDATE staff_sessions
           SET revoked_at = COALESCE(revoked_at, now())
           WHERE staff_id = $1 AND revoked_at IS NULL`,
          [staffId],
        );
      }
      await client.query('COMMIT');
      return { status: 'updated' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async changeLibrarianPassword(staffId, passwordHash) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT id, role FROM staff_accounts WHERE id = $1 FOR UPDATE`,
        [staffId],
      );
      if (!current.rowCount) {
        await client.query('ROLLBACK');
        return { status: 'not_found' };
      }
      if (current.rows[0].role !== 'librarian') {
        await client.query('ROLLBACK');
        return { status: 'manager_protected' };
      }
      await client.query('UPDATE staff_accounts SET password_hash = $2 WHERE id = $1', [
        staffId,
        passwordHash,
      ]);
      await client.query(
        `UPDATE staff_sessions
         SET revoked_at = COALESCE(revoked_at, now())
         WHERE staff_id = $1 AND revoked_at IS NULL`,
        [staffId],
      );
      await client.query('COMMIT');
      return { status: 'updated' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateManagerProfile(staffId, displayName) {
    const result = await this.pool.query(
      `UPDATE staff_accounts SET display_name = $2
       WHERE id = $1 AND role = 'manager'
       RETURNING id`,
      [staffId, displayName],
    );
    return result.rowCount ? { status: 'updated' } : { status: 'not_found' };
  }

  async changeManagerPassword(staffId, expectedHash, passwordHash) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT id, role, password_hash FROM staff_accounts WHERE id = $1 FOR UPDATE`,
        [staffId],
      );
      if (!current.rowCount || current.rows[0].role !== 'manager') {
        await client.query('ROLLBACK');
        return { status: 'not_found' };
      }
      if (current.rows[0].password_hash !== expectedHash) {
        await client.query('ROLLBACK');
        return { status: 'concurrent_change' };
      }
      await client.query('UPDATE staff_accounts SET password_hash = $2 WHERE id = $1', [
        staffId,
        passwordHash,
      ]);
      await client.query(
        `UPDATE staff_sessions
         SET revoked_at = COALESCE(revoked_at, now())
         WHERE staff_id = $1 AND revoked_at IS NULL`,
        [staffId],
      );
      await client.query('COMMIT');
      return { status: 'updated' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
