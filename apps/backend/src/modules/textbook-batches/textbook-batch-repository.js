function toDateOnly(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

const ERROR_MESSAGES = {
  duplicate_copy: 'Цей примірник повторюється в пакеті.',
  reader_not_found: 'Читача не знайдено.',
  reader_not_student: 'Масова видача доступна лише учням.',
  reader_not_in_class: 'Учень не належить до вибраного класу.',
  reader_archived: 'Картка учня перебуває в архіві.',
  reader_blocked: 'Учень має активне блокування.',
  ticket_expired: 'Строк читацького квитка завершився.',
  due_date_after_ticket: 'Строк повернення пізніший за завершення квитка.',
  copy_not_found: 'Примірник не знайдено.',
  book_not_textbook: 'Видання не має ознаки «Підручник».',
  book_archived: 'Книга перебуває в архіві.',
  copy_archived: 'Примірник перебуває в архіві.',
  copy_lost: 'Примірник позначений втраченим.',
  copy_temporarily_unavailable: 'Примірник тимчасово недоступний.',
  copy_damaged: 'Пошкоджений примірник не можна видати.',
  copy_condition_unrecorded: 'Перед видачею потрібно зафіксувати стан примірника.',
  copy_on_loan: 'Примірник уже має незавершену видачу.',
};

function issueError(code) {
  return { code, message: ERROR_MESSAGES[code] };
}

async function evaluateBatch(queryable, { classId, dueDate, issueDate, items }, { lock }) {
  const schoolClass = await queryable.query(
    `SELECT id, name, is_active FROM school_classes
     WHERE id = $1${lock ? ' FOR SHARE' : ''}`,
    [classId],
  );
  if (!schoolClass.rowCount) return { status: 'class_not_found' };
  if (!schoolClass.rows[0].is_active) return { status: 'class_inactive' };

  const readerIds = [...new Set(items.map((item) => item.readerId))].sort(
    (left, right) => Number(left) - Number(right),
  );
  const copyIds = [...new Set(items.map((item) => item.copyId))].sort(
    (left, right) => Number(left) - Number(right),
  );
  const readers = await queryable.query(
    `SELECT rpd.reader_id, rpd.full_name, rpd.ticket_number, rpd.category,
            rpd.class_id, sc.name AS class_name, rpd.ticket_expires_on,
            rpd.archived_at
     FROM reader_personal_data rpd
     LEFT JOIN school_classes sc ON sc.id = rpd.class_id
     WHERE rpd.reader_id = ANY($1::bigint[])
     ORDER BY rpd.reader_id${lock ? ' FOR UPDATE OF rpd' : ''}`,
    [readerIds],
  );
  const activeBlocks = await queryable.query(
    `SELECT reader_id FROM reader_blocks
     WHERE reader_id = ANY($1::bigint[])
       AND resolved_at IS NULL
       AND annulled_at IS NULL`,
    [readerIds],
  );
  const copies = await queryable.query(
    `SELECT bc.id, bc.inventory_number, bc.condition, bc.defect_description,
            bc.is_temporarily_unavailable, bc.is_lost, bc.archived_at,
            b.id AS book_id, b.title, b.is_textbook, b.archived_at AS book_archived_at
     FROM book_copies bc
     JOIN books b ON b.id = bc.book_id
     WHERE bc.id = ANY($1::bigint[])
     ORDER BY bc.id${lock ? ' FOR UPDATE OF bc' : ''}`,
    [copyIds],
  );
  const openLoans = await queryable.query(
    `SELECT copy_id FROM loans
     WHERE copy_id = ANY($1::bigint[]) AND status IN ('issued', 'lost')`,
    [copyIds],
  );

  const readersById = new Map(readers.rows.map((row) => [String(row.reader_id), row]));
  const blockedReaders = new Set(activeBlocks.rows.map((row) => String(row.reader_id)));
  const copiesById = new Map(copies.rows.map((row) => [String(row.id), row]));
  const copiesOnLoan = new Set(openLoans.rows.map((row) => String(row.copy_id)));
  const copyCounts = new Map();
  for (const item of items) {
    copyCounts.set(item.copyId, (copyCounts.get(item.copyId) ?? 0) + 1);
  }

  const evaluatedItems = items.map((item, index) => {
    const reader = readersById.get(item.readerId);
    const copy = copiesById.get(item.copyId);
    const errors = [];
    if (copyCounts.get(item.copyId) > 1) errors.push(issueError('duplicate_copy'));

    if (!reader) {
      errors.push(issueError('reader_not_found'));
    } else {
      if (reader.category !== 'student') errors.push(issueError('reader_not_student'));
      if (String(reader.class_id) !== classId) errors.push(issueError('reader_not_in_class'));
      if (reader.archived_at !== null) errors.push(issueError('reader_archived'));
      if (blockedReaders.has(item.readerId)) errors.push(issueError('reader_blocked'));
      const ticketExpiresOn = toDateOnly(reader.ticket_expires_on);
      if (ticketExpiresOn !== null && ticketExpiresOn < issueDate) {
        errors.push(issueError('ticket_expired'));
      }
      if (ticketExpiresOn !== null && dueDate > ticketExpiresOn) {
        errors.push(issueError('due_date_after_ticket'));
      }
    }

    if (!copy) {
      errors.push(issueError('copy_not_found'));
    } else {
      if (!copy.is_textbook) errors.push(issueError('book_not_textbook'));
      if (copy.book_archived_at !== null) errors.push(issueError('book_archived'));
      if (copy.archived_at !== null) errors.push(issueError('copy_archived'));
      if (copy.is_lost) errors.push(issueError('copy_lost'));
      if (copy.is_temporarily_unavailable) {
        errors.push(issueError('copy_temporarily_unavailable'));
      }
      if (copy.condition === 'damaged') errors.push(issueError('copy_damaged'));
      if (copy.condition === 'unrecorded') {
        errors.push(issueError('copy_condition_unrecorded'));
      }
      if (copiesOnLoan.has(item.copyId)) errors.push(issueError('copy_on_loan'));
    }

    return {
      index,
      reader:
        reader === undefined
          ? { id: item.readerId, fullName: null, ticketNumber: null }
          : {
              id: item.readerId,
              fullName: reader.full_name,
              ticketNumber: reader.ticket_number,
            },
      book:
        copy === undefined
          ? null
          : { id: String(copy.book_id), title: copy.title },
      copy:
        copy === undefined
          ? { id: item.copyId, inventoryNumber: null, condition: null }
          : {
              id: item.copyId,
              inventoryNumber: copy.inventory_number,
              condition: copy.condition,
            },
      dueDate,
      isValid: errors.length === 0,
      errors,
      internal: { reader, copy },
    };
  });
  const publicItems = evaluatedItems.map(({ internal, ...item }) => item);
  const validCount = publicItems.filter((item) => item.isValid).length;
  return {
    status: 'ok',
    schoolClass: {
      id: String(schoolClass.rows[0].id),
      name: schoolClass.rows[0].name,
    },
    evaluatedItems,
    preview: {
      schoolClass: {
        id: String(schoolClass.rows[0].id),
        name: schoolClass.rows[0].name,
      },
      issueDate,
      dueDate,
      totalItems: publicItems.length,
      validItems: validCount,
      invalidItems: publicItems.length - validCount,
      canConfirm: validCount === publicItems.length,
      items: publicItems,
    },
  };
}

function mapBatchLoan(row) {
  return {
    id: String(row.id),
    status: row.status,
    reader: {
      id: String(row.reader_id),
      fullName: row.full_name,
      ticketNumber: row.ticket_number,
    },
    book: { id: String(row.book_id), title: row.title },
    copy: { id: String(row.copy_id), inventoryNumber: row.inventory_number },
    currentDueDate: toDateOnly(row.current_due_date),
    version: String(row.version),
  };
}

export class TextbookBatchRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async previewBatch(input) {
    return await evaluateBatch(this.pool, input, { lock: false });
  }

  async findBatchIdByRequest(actorId, requestKey) {
    const result = await this.pool.query(
      `SELECT id FROM textbook_issue_batches
       WHERE actor_id = $1 AND request_key = $2`,
      [actorId, requestKey],
    );
    return result.rowCount ? String(result.rows[0].id) : null;
  }

  async createBatch(input, { actorId, requestKey }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT id FROM textbook_issue_batches
         WHERE actor_id = $1 AND request_key = $2`,
        [actorId, requestKey],
      );
      if (existing.rowCount) {
        await client.query('COMMIT');
        return { status: 'repeated', batchId: String(existing.rows[0].id) };
      }

      const evaluated = await evaluateBatch(client, input, { lock: true });
      if (evaluated.status !== 'ok') {
        await client.query('ROLLBACK');
        return evaluated;
      }
      if (!evaluated.preview.canConfirm) {
        const repeated = await client.query(
          `SELECT id FROM textbook_issue_batches
           WHERE actor_id = $1 AND request_key = $2`,
          [actorId, requestKey],
        );
        if (repeated.rowCount) {
          await client.query('COMMIT');
          return { status: 'repeated', batchId: String(repeated.rows[0].id) };
        }
        await client.query('ROLLBACK');
        return { status: 'validation_failed', preview: evaluated.preview };
      }

      const insertedBatch = await client.query(
        `INSERT INTO textbook_issue_batches (class_name_snapshot, actor_id, request_key)
         VALUES ($1, $2, $3)
         ON CONFLICT (actor_id, request_key) DO NOTHING
         RETURNING id`,
        [evaluated.schoolClass.name, actorId, requestKey],
      );
      if (!insertedBatch.rowCount) {
        const repeated = await client.query(
          `SELECT id FROM textbook_issue_batches
           WHERE actor_id = $1 AND request_key = $2`,
          [actorId, requestKey],
        );
        await client.query('COMMIT');
        return { status: 'repeated', batchId: String(repeated.rows[0].id) };
      }
      const batchId = String(insertedBatch.rows[0].id);
      const readerIds = evaluated.evaluatedItems.map((item) => item.reader.id);
      const copyIds = evaluated.evaluatedItems.map((item) => item.copy.id);
      const conditions = evaluated.evaluatedItems.map((item) => item.internal.copy.condition);
      const defects = evaluated.evaluatedItems.map(
        (item) => item.internal.copy.defect_description,
      );
      const loans = await client.query(
        `INSERT INTO loans (
           reader_id, copy_id, issued_by, initial_due_date, current_due_date, status,
           issue_condition, issue_defect_snapshot, reader_category_snapshot,
           class_name_snapshot, batch_id
         )
         SELECT input.reader_id, input.copy_id, $5, $6::date, $6::date, 'issued',
                input.condition, input.defect, 'student', $7, $8
         FROM unnest($1::bigint[], $2::bigint[], $3::text[], $4::text[])
           AS input(reader_id, copy_id, condition, defect)
         RETURNING id, copy_id`,
        [
          readerIds,
          copyIds,
          conditions,
          defects,
          actorId,
          input.dueDate,
          evaluated.schoolClass.name,
          batchId,
        ],
      );
      const loanIds = loans.rows.map((row) => String(row.id));
      const issuedCopyIds = loans.rows.map((row) => String(row.copy_id));
      await client.query(
        `INSERT INTO loan_status_events (
           loan_id, from_status, to_status, actor_id, request_key
         )
         SELECT input.loan_id, NULL, 'issued', $2, $3
         FROM unnest($1::bigint[]) AS input(loan_id)`,
        [loanIds, actorId, requestKey],
      );
      const eventValues = issuedCopyIds.map((copyId) => {
        const item = evaluated.evaluatedItems.find((value) => value.copy.id === copyId);
        return JSON.stringify({
          condition: item.internal.copy.condition,
          defectDescription: item.internal.copy.defect_description,
        });
      });
      await client.query(
        `INSERT INTO book_copy_events (
           copy_id, kind, old_value, new_value, actor_id, loan_id, request_key
         )
         SELECT input.copy_id, 'issued', input.event_value, input.event_value,
                $4, input.loan_id, $5
         FROM unnest($1::bigint[], $2::bigint[], $3::text[])
           AS input(copy_id, loan_id, event_value)`,
        [issuedCopyIds, loanIds, eventValues, actorId, requestKey],
      );
      await client.query('COMMIT');
      return { status: 'created', batchId };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505' && error.constraint === 'loans_one_open_per_copy') {
        return { status: 'state_changed' };
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async findBatchById(batchId) {
    const batch = await this.pool.query(
      `SELECT tib.id, tib.class_name_snapshot, tib.created_at,
              sa.id AS actor_id, sa.display_name AS actor_name
       FROM textbook_issue_batches tib
       JOIN staff_accounts sa ON sa.id = tib.actor_id
       WHERE tib.id = $1`,
      [batchId],
    );
    if (!batch.rowCount) return null;
    const loans = await this.pool.query(
      `SELECT l.id, l.status, l.reader_id, rpd.full_name, rpd.ticket_number,
              l.copy_id, bc.inventory_number, b.id AS book_id, b.title,
              l.current_due_date, l.version
       FROM loans l
       LEFT JOIN reader_personal_data rpd ON rpd.reader_id = l.reader_id
       JOIN book_copies bc ON bc.id = l.copy_id
       JOIN books b ON b.id = bc.book_id
       WHERE l.batch_id = $1
       ORDER BY l.id`,
      [batchId],
    );
    const row = batch.rows[0];
    return {
      id: String(row.id),
      className: row.class_name_snapshot,
      createdAt: row.created_at,
      actor: { id: String(row.actor_id), displayName: row.actor_name },
      issueCount: loans.rowCount,
      loans: loans.rows.map(mapBatchLoan),
    };
  }
}
