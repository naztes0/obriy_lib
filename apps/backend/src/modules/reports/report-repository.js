function toDateOnly(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function addValue(values, value) {
  values.push(value);
  return `$${values.length}`;
}

function addPeriodFilters(conditions, values, expression, filters) {
  if (filters.dateFrom !== null) {
    conditions.push(
      `(${expression} AT TIME ZONE 'Europe/Kyiv')::date >= ${addValue(values, filters.dateFrom)}::date`,
    );
  }
  if (filters.dateTo !== null) {
    conditions.push(
      `(${expression} AT TIME ZONE 'Europe/Kyiv')::date <= ${addValue(values, filters.dateTo)}::date`,
    );
  }
}

function addReaderSnapshotFilters(conditions, values, filters, category, className) {
  if (filters.category !== null) {
    conditions.push(`${category} = ${addValue(values, filters.category)}`);
  }
  if (filters.className !== null) {
    conditions.push(`lower(${className}) = lower(${addValue(values, filters.className)})`);
  }
}

function readerFromRow(row) {
  return {
    id: String(row.reader_id),
    fullName: row.full_name,
    ticketNumber: row.ticket_number,
    isPersonalDataDeleted: row.personal_data_deleted_at !== null,
  };
}

function bookFromRow(row) {
  return { id: String(row.book_id), title: row.title };
}

function copyFromRow(row) {
  return { id: String(row.copy_id), inventoryNumber: row.inventory_number };
}

function overdueDays(dueDate, today) {
  const due = toDateOnly(dueDate);
  if (due === null || due >= today) return 0;
  return Math.floor((Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${due}T00:00:00.000Z`)) / 86_400_000);
}

const FUND_ROWS = `SELECT bc.id AS copy_id, bc.inventory_number, bc.condition,
                          bc.defect_description, bc.is_temporarily_unavailable,
                          bc.is_lost, bc.archived_at AS copy_archived_at,
                          b.id AS book_id, b.title, b.archived_at AS book_archived_at,
                          CASE
                            WHEN b.archived_at IS NOT NULL OR bc.archived_at IS NOT NULL THEN 'archived'
                            WHEN bc.is_lost THEN 'lost'
                            WHEN bc.condition = 'damaged' THEN 'damaged'
                            WHEN bc.condition = 'unrecorded' THEN 'unrecorded'
                            WHEN bc.is_temporarily_unavailable THEN 'temporarily_unavailable'
                            WHEN EXISTS (
                              SELECT 1 FROM loans l
                              WHERE l.copy_id = bc.id AND l.status IN ('issued', 'lost')
                            ) THEN 'on_loan'
                            ELSE 'available'
                          END AS availability
                   FROM book_copies bc
                   JOIN books b ON b.id = bc.book_id`;

const LOAN_REPORT_ROWS = `SELECT l.id, l.status, l.issued_at, l.current_due_date,
                                 l.reader_category_snapshot, l.class_name_snapshot,
                                 l.reader_id, rpd.full_name, rpd.ticket_number,
                                 r.personal_data_deleted_at,
                                 bc.id AS copy_id, bc.inventory_number,
                                 b.id AS book_id, b.title
                          FROM loans l
                          JOIN readers r ON r.id = l.reader_id
                          LEFT JOIN reader_personal_data rpd ON rpd.reader_id = l.reader_id
                          JOIN book_copies bc ON bc.id = l.copy_id
                          JOIN books b ON b.id = bc.book_id`;

const LOSS_ROWS = `SELECT bc.id AS copy_id, bc.inventory_number, bc.condition,
                          b.id AS book_id, b.title,
                          l.id AS loan_id, l.reader_id, l.reader_category_snapshot,
                          l.class_name_snapshot, rpd.full_name, rpd.ticket_number,
                          r.personal_data_deleted_at,
                          loss_event.kind AS loss_kind,
                          loss_event.occurred_at AS loss_recorded_at
                   FROM book_copies bc
                   JOIN books b ON b.id = bc.book_id
                   LEFT JOIN loans l ON l.copy_id = bc.id AND l.status = 'lost'
                   LEFT JOIN readers r ON r.id = l.reader_id
                   LEFT JOIN reader_personal_data rpd ON rpd.reader_id = l.reader_id
                   LEFT JOIN LATERAL (
                     SELECT bce.kind, bce.occurred_at
                     FROM book_copy_events bce
                     WHERE bce.copy_id = bc.id
                       AND bce.kind IN ('lost', 'lost_in_fund', 'erroneous_return')
                     ORDER BY bce.occurred_at DESC, bce.id DESC
                     LIMIT 1
                   ) loss_event ON true
                   WHERE bc.is_lost = true`;

const BLOCK_ROWS = `SELECT rb.id, rb.reason_code, rb.confirmed_at, rb.minimum_until,
                           rb.is_indefinite, rb.resolved_at, rb.annulled_at, rb.version,
                           rb.reader_id, rpd.full_name, rpd.ticket_number,
                           r.personal_data_deleted_at,
                           COALESCE(l.reader_category_snapshot, rpd.category) AS category,
                           COALESCE(l.class_name_snapshot, sc.name) AS class_name,
                           rb.source_loan_reference
                    FROM reader_blocks rb
                    JOIN readers r ON r.id = rb.reader_id
                    LEFT JOIN reader_personal_data rpd ON rpd.reader_id = rb.reader_id
                    LEFT JOIN school_classes sc ON sc.id = rpd.class_id
                    LEFT JOIN loans l ON l.id = rb.source_loan_id`;

const DAMAGED_ROWS = `SELECT bc.id AS copy_id, bc.inventory_number, bc.defect_description,
                             bc.archived_at AS copy_archived_at,
                             b.id AS book_id, b.title,
                             damage_event.occurred_at AS damage_recorded_at
                      FROM book_copies bc
                      JOIN books b ON b.id = bc.book_id
                      LEFT JOIN LATERAL (
                        SELECT bce.occurred_at
                        FROM book_copy_events bce
                        WHERE bce.copy_id = bc.id
                          AND bce.kind IN ('created', 'condition_changed', 'returned')
                        ORDER BY bce.occurred_at DESC, bce.id DESC
                        LIMIT 1
                      ) damage_event ON true
                      WHERE bc.condition = 'damaged'`;

function mapFund(row) {
  return {
    book: bookFromRow(row),
    copy: {
      ...copyFromRow(row),
      condition: row.condition,
      defectDescription: row.defect_description,
      availability: row.availability,
      isTemporarilyUnavailable: row.is_temporarily_unavailable,
      isLost: row.is_lost,
      isArchived: row.copy_archived_at !== null || row.book_archived_at !== null,
    },
  };
}

function mapLoan(row, today) {
  return {
    id: String(row.id),
    status: row.status,
    issuedAt: row.issued_at,
    currentDueDate: toDateOnly(row.current_due_date),
    overdueDays: overdueDays(row.current_due_date, today),
    reader: readerFromRow(row),
    readerCategory: row.reader_category_snapshot,
    className: row.class_name_snapshot,
    book: bookFromRow(row),
    copy: copyFromRow(row),
  };
}

export class ReportRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async getReport(reportType, query) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const report = await this.runReport(reportType, query, client);
      await client.query('COMMIT');
      return report;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async runReport(reportType, query, db) {
    switch (reportType) {
      case 'fund':
        return await this.fund(query, db);
      case 'current-loans':
        return await this.loans(query, false, db);
      case 'overdue-loans':
        return await this.loans(query, true, db);
      case 'unresolved-losses':
        return await this.losses(query, db);
      case 'blocks':
        return await this.blocks(query, db);
      case 'damaged-copies':
        return await this.damagedCopies(query, db);
      case 'reader-activity':
        return await this.readerActivity(query, db);
      default:
        throw new Error(`Unsupported report type: ${reportType}`);
    }
  }

  async fund({ pageSize, offset }, db) {
    const summaryResult = await db.query(
      `WITH fund AS (${FUND_ROWS})
       SELECT count(*) AS total,
              count(*) FILTER (WHERE availability = 'available') AS available,
              count(*) FILTER (WHERE availability = 'on_loan') AS on_loan,
              count(*) FILTER (WHERE availability = 'lost') AS lost,
              count(*) FILTER (WHERE availability = 'damaged') AS damaged,
              count(*) FILTER (WHERE availability = 'unrecorded') AS unrecorded,
              count(*) FILTER (WHERE availability = 'temporarily_unavailable') AS temporarily_unavailable,
              count(*) FILTER (WHERE availability = 'archived') AS archived
       FROM fund`,
    );
    const result = await db.query(
      `WITH fund AS (${FUND_ROWS})
       SELECT * FROM fund
       ORDER BY lower(title), inventory_number, copy_id
       LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    );
    const row = summaryResult.rows[0];
    return {
      totalItems: Number(row.total),
      summary: {
        totalCopies: Number(row.total),
        available: Number(row.available),
        onLoan: Number(row.on_loan),
        lost: Number(row.lost),
        damaged: Number(row.damaged),
        unrecorded: Number(row.unrecorded),
        temporarilyUnavailable: Number(row.temporarily_unavailable),
        archived: Number(row.archived),
      },
      items: result.rows.map(mapFund),
    };
  }

  async loans({ filters, today, pageSize, offset }, overdue, db) {
    const values = [];
    const conditions = [`l.status = 'issued'`];
    if (overdue) conditions.push(`l.current_due_date < ${addValue(values, today)}::date`);
    addPeriodFilters(conditions, values, 'l.issued_at', filters);
    addReaderSnapshotFilters(
      conditions,
      values,
      filters,
      'l.reader_category_snapshot',
      'l.class_name_snapshot',
    );
    const where = `WHERE ${conditions.join(' AND ')}`;
    const summaryResult = await db.query(
      `SELECT count(*) AS total, count(DISTINCT l.reader_id) AS readers
       FROM loans l ${where}`,
      values,
    );
    const limit = addValue(values, pageSize);
    const skip = addValue(values, offset);
    const result = await db.query(
      `${LOAN_REPORT_ROWS}
       ${where}
       ORDER BY l.current_due_date, l.id
       LIMIT ${limit} OFFSET ${skip}`,
      values,
    );
    const summary = summaryResult.rows[0];
    return {
      totalItems: Number(summary.total),
      summary: {
        loans: Number(summary.total),
        readers: Number(summary.readers),
      },
      items: result.rows.map((row) => mapLoan(row, today)),
    };
  }

  async losses({ filters, pageSize, offset }, db) {
    const values = [];
    const conditions = [];
    addPeriodFilters(conditions, values, 'loss_recorded_at', filters);
    addReaderSnapshotFilters(
      conditions,
      values,
      filters,
      'reader_category_snapshot',
      'class_name_snapshot',
    );
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const summaryResult = await db.query(
      `WITH losses AS (${LOSS_ROWS})
       SELECT count(*) AS total,
              count(*) FILTER (WHERE loan_id IS NOT NULL) AS reader_responsibility,
              count(*) FILTER (WHERE loan_id IS NULL) AS without_responsible_reader
       FROM losses ${where}`,
      values,
    );
    const limit = addValue(values, pageSize);
    const skip = addValue(values, offset);
    const result = await db.query(
      `WITH losses AS (${LOSS_ROWS})
       SELECT * FROM losses ${where}
       ORDER BY loss_recorded_at DESC NULLS LAST, copy_id DESC
       LIMIT ${limit} OFFSET ${skip}`,
      values,
    );
    const summary = summaryResult.rows[0];
    return {
      totalItems: Number(summary.total),
      summary: {
        unresolvedLosses: Number(summary.total),
        readerResponsibility: Number(summary.reader_responsibility),
        withoutResponsibleReader: Number(summary.without_responsible_reader),
      },
      items: result.rows.map((row) => ({
        lossRecordedAt: row.loss_recorded_at,
        source: row.loan_id === null ? 'fund' : 'reader',
        lossKind: row.loss_kind,
        loanId: row.loan_id === null ? null : String(row.loan_id),
        reader: row.reader_id === null ? null : readerFromRow(row),
        readerCategory: row.reader_category_snapshot,
        className: row.class_name_snapshot,
        book: bookFromRow(row),
        copy: { ...copyFromRow(row), condition: row.condition },
      })),
    };
  }

  async blocks({ filters, pageSize, offset }, db) {
    const values = [];
    const conditions = [];
    addPeriodFilters(conditions, values, 'rb.confirmed_at', filters);
    addReaderSnapshotFilters(
      conditions,
      values,
      filters,
      `COALESCE(l.reader_category_snapshot, rpd.category)`,
      `COALESCE(l.class_name_snapshot, sc.name)`,
    );
    if (filters.blockStatus === 'active') {
      conditions.push('rb.resolved_at IS NULL AND rb.annulled_at IS NULL');
    } else if (filters.blockStatus === 'resolved') {
      conditions.push('rb.resolved_at IS NOT NULL');
    } else if (filters.blockStatus === 'annulled') {
      conditions.push('rb.annulled_at IS NOT NULL');
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const summaryResult = await db.query(
      `WITH blocks AS (${BLOCK_ROWS} ${where})
       SELECT count(*) AS total,
              count(*) FILTER (WHERE resolved_at IS NULL AND annulled_at IS NULL) AS active,
              count(*) FILTER (WHERE resolved_at IS NOT NULL) AS resolved,
              count(*) FILTER (WHERE annulled_at IS NOT NULL) AS annulled,
              count(*) FILTER (
                WHERE is_indefinite AND resolved_at IS NULL AND annulled_at IS NULL
              ) AS indefinite
       FROM blocks`,
      values,
    );
    const limit = addValue(values, pageSize);
    const skip = addValue(values, offset);
    const result = await db.query(
      `${BLOCK_ROWS} ${where}
       ORDER BY rb.confirmed_at DESC, rb.id DESC
       LIMIT ${limit} OFFSET ${skip}`,
      values,
    );
    const summary = summaryResult.rows[0];
    return {
      totalItems: Number(summary.total),
      summary: {
        blocks: Number(summary.total),
        active: Number(summary.active),
        resolved: Number(summary.resolved),
        annulled: Number(summary.annulled),
        activeIndefinite: Number(summary.indefinite),
      },
      items: result.rows.map((row) => ({
        id: String(row.id),
        status:
          row.annulled_at !== null ? 'annulled' : row.resolved_at !== null ? 'resolved' : 'active',
        reasonCode: row.reason_code,
        confirmedAt: row.confirmed_at,
        minimumUntil: toDateOnly(row.minimum_until),
        isIndefinite: row.is_indefinite,
        resolvedAt: row.resolved_at,
        annulledAt: row.annulled_at,
        sourceLoanId: String(row.source_loan_reference),
        reader: readerFromRow(row),
        readerCategory: row.category,
        className: row.class_name,
        version: String(row.version),
      })),
    };
  }

  async damagedCopies({ filters, pageSize, offset }, db) {
    const values = [];
    const conditions = [];
    addPeriodFilters(conditions, values, 'damage_event.occurred_at', filters);
    const where = conditions.length ? `AND ${conditions.join(' AND ')}` : '';
    const summaryResult = await db.query(
      `WITH damaged AS (${DAMAGED_ROWS} ${where}) SELECT count(*) AS total FROM damaged`,
      values,
    );
    const limit = addValue(values, pageSize);
    const skip = addValue(values, offset);
    const result = await db.query(
      `${DAMAGED_ROWS} ${where}
       ORDER BY damage_recorded_at DESC NULLS LAST, copy_id DESC
       LIMIT ${limit} OFFSET ${skip}`,
      values,
    );
    const total = Number(summaryResult.rows[0].total);
    return {
      totalItems: total,
      summary: { damagedCopies: total },
      items: result.rows.map((row) => ({
        damageRecordedAt: row.damage_recorded_at,
        defectDescription: row.defect_description,
        isArchived: row.copy_archived_at !== null,
        book: bookFromRow(row),
        copy: copyFromRow(row),
      })),
    };
  }

  async readerActivity({ filters, pageSize, offset }, db) {
    const values = [];
    const conditions = [];
    addPeriodFilters(conditions, values, 'l.issued_at', filters);
    addReaderSnapshotFilters(
      conditions,
      values,
      filters,
      'l.reader_category_snapshot',
      'l.class_name_snapshot',
    );
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const summaryResult = await db.query(
      `SELECT count(*) AS total, count(DISTINCT l.reader_id) AS readers
       FROM loans l ${where}`,
      values,
    );
    const titles = await db.query(
      `SELECT b.id AS book_id, b.title, count(*) AS issues,
              count(DISTINCT l.reader_id) AS readers
       FROM loans l
       JOIN book_copies bc ON bc.id = l.copy_id
       JOIN books b ON b.id = bc.book_id
       ${where}
       GROUP BY b.id, b.title
       ORDER BY issues DESC, lower(b.title), b.id`,
      values,
    );
    const classes = await db.query(
      `SELECT l.class_name_snapshot AS class_name, count(*) AS issues
       FROM loans l ${where}
       GROUP BY l.class_name_snapshot
       ORDER BY issues DESC, l.class_name_snapshot NULLS LAST`,
      values,
    );
    const categories = await db.query(
      `SELECT l.reader_category_snapshot AS category, count(*) AS issues
       FROM loans l ${where}
       GROUP BY l.reader_category_snapshot
       ORDER BY l.reader_category_snapshot`,
      values,
    );
    const limit = addValue(values, pageSize);
    const skip = addValue(values, offset);
    const result = await db.query(
      `${LOAN_REPORT_ROWS}
       ${where}
       ORDER BY l.issued_at DESC, l.id DESC
       LIMIT ${limit} OFFSET ${skip}`,
      values,
    );
    const summary = summaryResult.rows[0];
    return {
      totalItems: Number(summary.total),
      summary: {
        issues: Number(summary.total),
        distinctReaders: Number(summary.readers),
        byTitles: titles.rows.map((row) => ({
          book: bookFromRow(row),
          issues: Number(row.issues),
          distinctReaders: Number(row.readers),
        })),
        byClasses: classes.rows.map((row) => ({
          className: row.class_name,
          issues: Number(row.issues),
        })),
        byCategories: categories.rows.map((row) => ({
          category: row.category,
          issues: Number(row.issues),
        })),
      },
      items: result.rows.map((row) => mapLoan(row, '0000-01-01')),
    };
  }
}
