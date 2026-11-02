function mapSchoolClass(row) {
  return {
    id: String(row.id),
    name: row.name,
    isActive: row.is_active,
  };
}

export class SchoolClassRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async list({ status }) {
    const condition =
      status === 'active' ? 'WHERE is_active = true' : status === 'inactive' ? 'WHERE is_active = false' : '';
    const result = await this.pool.query(
      `SELECT id, name, is_active
       FROM school_classes
       ${condition}
       ORDER BY lower(name), id`,
    );
    return result.rows.map(mapSchoolClass);
  }

  async findById(classId) {
    const result = await this.pool.query(
      'SELECT id, name, is_active FROM school_classes WHERE id = $1',
      [classId],
    );
    return result.rowCount ? mapSchoolClass(result.rows[0]) : null;
  }

  async create(name) {
    const result = await this.pool.query(
      `INSERT INTO school_classes (name)
       VALUES ($1)
       RETURNING id, name, is_active`,
      [name],
    );
    return mapSchoolClass(result.rows[0]);
  }

  async updateName(classId, name) {
    const result = await this.pool.query(
      `UPDATE school_classes
       SET name = $2
       WHERE id = $1
       RETURNING id, name, is_active`,
      [classId, name],
    );
    return result.rowCount ? mapSchoolClass(result.rows[0]) : null;
  }

  async setActive(classId, isActive) {
    const result = await this.pool.query(
      `UPDATE school_classes
       SET is_active = $2
       WHERE id = $1
       RETURNING id, name, is_active`,
      [classId, isActive],
    );
    return result.rowCount ? mapSchoolClass(result.rows[0]) : null;
  }
}
