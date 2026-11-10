const ENTITY_FILES = {
  book: ['books', 'books.csv'],
  copy: ['copies', 'copies.csv'],
  reader: ['readers', 'readers.csv'],
  loan: ['loans', 'loans.csv'],
  loan_event: ['loanEvents', 'loan_events.csv'],
  loan_extension: ['loanExtensions', 'loan_extensions.csv'],
  copy_event: ['copyEvents', 'copy_events.csv'],
  reader_block: ['readerBlocks', 'reader_blocks.csv'],
  unblock_request: ['unblockRequests', 'unblock_requests.csv'],
};

function conflict(file, row, field, message) {
  return { file, row, field, message };
}

async function findRepeatedBatch(client, sourceName, contentHash) {
  const result = await client.query(
    `SELECT id, record_counts, completed_at
     FROM import_batches
     WHERE source_name = $1 AND content_hash = $2`,
    [sourceName, contentHash],
  );
  if (!result.rowCount) return null;
  return {
    batchId: String(result.rows[0].id),
    recordCounts: result.rows[0].record_counts,
    completedAt: result.rows[0].completed_at,
  };
}

async function checkSourceLinks(client, sourceName, importPackage, errors) {
  for (const [entityKind, [dataKey, file]] of Object.entries(ENTITY_FILES)) {
    const records = importPackage.data[dataKey];
    if (!records.length) continue;
    const keys = records.map((record) => record.source_id);
    const existing = await client.query(
      `SELECT source_key
       FROM import_record_links
       WHERE source_name = $1 AND entity_kind = $2 AND source_key = ANY($3::text[])`,
      [sourceName, entityKind, keys],
    );
    const existingKeys = new Set(existing.rows.map((row) => row.source_key));
    for (const [index, record] of records.entries()) {
      if (existingKeys.has(record.source_id)) {
        errors.push(
          conflict(
            file,
            index + 2,
            'source_id',
            'Цей запис уже імпортовано з указаного джерела.',
          ),
        );
      }
    }
  }
}

async function checkUniqueDatabaseValues(client, importPackage, errors) {
  const books = importPackage.data.books.filter((record) => record.isbn_normalized);
  if (books.length) {
    const result = await client.query(
      `SELECT isbn_normalized FROM books
       WHERE isbn_normalized = ANY($1::text[])`,
      [books.map((record) => record.isbn_normalized)],
    );
    const existing = new Set(result.rows.map((row) => row.isbn_normalized));
    for (const record of books) {
      if (existing.has(record.isbn_normalized)) {
        errors.push(
          conflict('books.csv', importPackage.data.books.indexOf(record) + 2, 'isbn', 'ISBN уже існує в БД.'),
        );
      }
    }
  }

  const copies = importPackage.data.copies;
  if (copies.length) {
    const result = await client.query(
      `SELECT upper(inventory_number) AS value FROM book_copies
       WHERE upper(inventory_number) = ANY($1::text[])`,
      [copies.map((record) => record.inventory_number_normalized)],
    );
    const existing = new Set(result.rows.map((row) => row.value));
    for (const [index, record] of copies.entries()) {
      if (existing.has(record.inventory_number_normalized)) {
        errors.push(
          conflict(
            'copies.csv',
            index + 2,
            'inventory_number',
            'Інвентарний номер уже існує в БД.',
          ),
        );
      }
    }
  }

  const readers = importPackage.data.readers;
  if (readers.length) {
    const result = await client.query(
      `SELECT upper(ticket_number) AS value FROM reader_personal_data
       WHERE upper(ticket_number) = ANY($1::text[])`,
      [readers.map((record) => record.ticket_number_normalized)],
    );
    const existing = new Set(result.rows.map((row) => row.value));
    for (const [index, record] of readers.entries()) {
      if (existing.has(record.ticket_number_normalized)) {
        errors.push(
          conflict(
            'readers.csv',
            index + 2,
            'ticket_number',
            'Номер квитка вже існує в БД.',
          ),
        );
      }
    }
  }
}

async function inspectWithClient(client, sourceName, importPackage) {
  const repeated = await findRepeatedBatch(client, sourceName, importPackage.contentHash);
  if (repeated) return { status: 'repeated', ...repeated };

  const errors = [];
  await checkSourceLinks(client, sourceName, importPackage, errors);
  await checkUniqueDatabaseValues(client, importPackage, errors);
  return errors.length ? { status: 'conflict', errors } : { status: 'ready' };
}

async function saveLink(client, { sourceName, batchId, entityKind, sourceKey, targetId }) {
  await client.query(
    `INSERT INTO import_record_links (
       source_name, batch_id, entity_kind, source_key, target_id
     ) VALUES ($1, $2, $3, $4, $5)`,
    [sourceName, batchId, entityKind, sourceKey, targetId],
  );
}

async function saveAuthors(client, bookId, authors) {
  for (const [index, name] of authors.entries()) {
    const author = await client.query(
      `INSERT INTO authors (name)
       VALUES ($1)
       ON CONFLICT (name_normalized) DO UPDATE SET name = authors.name
       RETURNING id`,
      [name],
    );
    await client.query(
      `INSERT INTO book_authors (book_id, author_id, position)
       VALUES ($1, $2, $3)`,
      [bookId, author.rows[0].id, index + 1],
    );
  }
}

async function findOrCreateClass(client, className, cache) {
  if (cache.has(className)) return cache.get(className);
  const inserted = await client.query(
    `INSERT INTO school_classes (name)
     VALUES ($1)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [className],
  );
  const classId = inserted.rowCount
    ? String(inserted.rows[0].id)
    : String(
        (
          await client.query('SELECT id FROM school_classes WHERE lower(name) = lower($1)', [
            className,
          ])
        ).rows[0].id,
      );
  cache.set(className, classId);
  return classId;
}

async function insertBooks(client, context) {
  const ids = new Map();
  for (const record of context.importPackage.data.books) {
    const result = await client.query(
      `INSERT INTO books (
         title, publisher, publication_year, isbn, is_textbook, archived_at
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        record.title,
        record.publisher,
        record.publication_year,
        record.isbn,
        record.is_textbook,
        record.archived_at,
      ],
    );
    const id = String(result.rows[0].id);
    await saveAuthors(client, id, record.authors);
    await saveLink(client, {
      ...context,
      entityKind: 'book',
      sourceKey: record.source_id,
      targetId: id,
    });
    ids.set(record.source_id, id);
  }
  return ids;
}

async function insertCopies(client, context, bookIds) {
  const ids = new Map();
  for (const record of context.importPackage.data.copies) {
    const result = await client.query(
      `INSERT INTO book_copies (
         book_id, inventory_number, condition, defect_description,
         is_temporarily_unavailable, is_lost, archived_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        bookIds.get(record.book_source_id),
        record.inventory_number,
        record.condition,
        record.defect_description,
        record.is_temporarily_unavailable,
        record.is_lost,
        record.archived_at,
      ],
    );
    const id = String(result.rows[0].id);
    await saveLink(client, {
      ...context,
      entityKind: 'copy',
      sourceKey: record.source_id,
      targetId: id,
    });
    ids.set(record.source_id, id);
  }
  return ids;
}

async function insertReaders(client, context) {
  const ids = new Map();
  const classIds = new Map();
  for (const record of context.importPackage.data.readers) {
    const classId = record.class_name
      ? await findOrCreateClass(client, record.class_name, classIds)
      : null;
    const reader = await client.query('INSERT INTO readers DEFAULT VALUES RETURNING id');
    const id = String(reader.rows[0].id);
    await client.query(
      `INSERT INTO reader_personal_data (
         reader_id, full_name, category, class_id, phone, address,
         ticket_number, ticket_type, ticket_issued_on, ticket_expires_on,
         employment_ended_on, archived_at, archive_reason
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        record.full_name,
        record.category,
        classId,
        record.phone,
        record.address,
        record.ticket_number,
        record.ticket_type,
        record.ticket_issued_on,
        record.ticket_expires_on,
        record.employment_ended_on,
        record.archived_at,
        record.archive_reason,
      ],
    );
    if (record.archived_at) {
      await client.query(
        `INSERT INTO reader_record_events (
           reader_id, event_type, actor_id, occurred_at, reason
         ) VALUES ($1, 'archived', NULL, $2, $3)`,
        [id, record.archived_at, record.archive_reason],
      );
    }
    await saveLink(client, {
      ...context,
      entityKind: 'reader',
      sourceKey: record.source_id,
      targetId: id,
    });
    ids.set(record.source_id, id);
  }
  return ids;
}

async function insertLoans(client, context, readerIds, copyIds) {
  const ids = new Map();
  for (const record of context.importPackage.data.loans) {
    const result = await client.query(
      `INSERT INTO loans (
         reader_id, copy_id, issued_at, issued_by, initial_due_date, current_due_date,
         status, returned_at, compensated_at, issue_condition, issue_defect_snapshot,
         return_condition, return_defect_snapshot, reader_category_snapshot,
         class_name_snapshot, import_source_key, performed_by_snapshot
       ) VALUES (
         $1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
       ) RETURNING id`,
      [
        readerIds.get(record.reader_source_id),
        copyIds.get(record.copy_source_id),
        record.issued_at,
        record.initial_due_date,
        record.current_due_date,
        record.status,
        record.returned_at,
        record.compensated_at,
        record.issue_condition,
        record.issue_defect_snapshot,
        record.return_condition,
        record.return_defect_snapshot,
        record.reader_category_snapshot,
        record.class_name_snapshot,
        record.source_id,
        record.performed_by,
      ],
    );
    const id = String(result.rows[0].id);
    await saveLink(client, {
      ...context,
      entityKind: 'loan',
      sourceKey: record.source_id,
      targetId: id,
    });
    ids.set(record.source_id, id);
  }
  return ids;
}

async function insertLoanEvents(client, context, loanIds) {
  const eventsByLoan = Map.groupBy(
    context.importPackage.data.loanEvents,
    (record) => record.loan_source_id,
  );
  for (const loan of context.importPackage.data.loans) {
    const importedEvents = eventsByLoan.get(loan.source_id) ?? [];
    if (importedEvents.length) continue;
    await client.query(
      `INSERT INTO loan_status_events (
         loan_id, from_status, to_status, actor_id, occurred_at, performed_by_snapshot
       ) VALUES ($1, NULL, 'issued', NULL, $2, $3)`,
      [loanIds.get(loan.source_id), loan.issued_at, loan.performed_by],
    );
    const finalStatusTime =
      loan.status === 'returned'
        ? loan.returned_at
        : loan.status === 'compensated'
          ? loan.compensated_at
          : null;
    if (finalStatusTime) {
      await client.query(
        `INSERT INTO loan_status_events (
           loan_id, from_status, to_status, actor_id, occurred_at, performed_by_snapshot
         ) VALUES ($1, 'issued', $2, NULL, $3, $4)`,
        [loanIds.get(loan.source_id), loan.status, finalStatusTime, loan.performed_by],
      );
    }
  }

  for (const record of context.importPackage.data.loanEvents) {
    const result = await client.query(
      `INSERT INTO loan_status_events (
         loan_id, from_status, to_status, actor_id, occurred_at, comment,
         import_source_key, performed_by_snapshot
       ) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)
       RETURNING id`,
      [
        loanIds.get(record.loan_source_id),
        record.from_status,
        record.to_status,
        record.occurred_at,
        record.comment,
        record.source_id,
        record.performed_by,
      ],
    );
    await saveLink(client, {
      ...context,
      entityKind: 'loan_event',
      sourceKey: record.source_id,
      targetId: String(result.rows[0].id),
    });
  }
}

async function insertLoanExtensions(client, context, loanIds) {
  for (const record of context.importPackage.data.loanExtensions) {
    const result = await client.query(
      `INSERT INTO loan_extensions (
         loan_id, old_due_date, new_due_date, reason, actor_id, occurred_at,
         import_source_key, performed_by_snapshot
       ) VALUES ($1, $2, $3, $4, NULL, $5, $6, $7)
       RETURNING id`,
      [
        loanIds.get(record.loan_source_id),
        record.old_due_date,
        record.new_due_date,
        record.reason,
        record.occurred_at,
        record.source_id,
        record.performed_by,
      ],
    );
    await saveLink(client, {
      ...context,
      entityKind: 'loan_extension',
      sourceKey: record.source_id,
      targetId: String(result.rows[0].id),
    });
  }
}

async function insertCopyEvents(client, context, copyIds) {
  for (const record of context.importPackage.data.copyEvents) {
    const result = await client.query(
      `INSERT INTO book_copy_events (
         copy_id, kind, old_value, new_value, reason, actor_id, occurred_at,
         import_source_key, performed_by_snapshot
       ) VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8)
       RETURNING id`,
      [
        copyIds.get(record.copy_source_id),
        record.kind,
        record.old_value,
        record.new_value,
        record.reason,
        record.occurred_at,
        record.source_id,
        record.performed_by,
      ],
    );
    await saveLink(client, {
      ...context,
      entityKind: 'copy_event',
      sourceKey: record.source_id,
      targetId: String(result.rows[0].id),
    });
  }
}

async function insertReaderBlocks(client, context, readerIds, loanIds) {
  const ids = new Map();
  for (const record of context.importPackage.data.readerBlocks) {
    const result = await client.query(
      `INSERT INTO reader_blocks (
         reader_id, source_loan_id, source_loan_reference, reason_code,
         confirmed_at, confirmed_by, minimum_until, is_indefinite,
         resolved_at, resolved_by, resolution_comment, annulled_at,
         annulled_by, annul_reason, import_source_key, confirmed_by_snapshot,
         resolved_by_snapshot, annulled_by_snapshot
       ) VALUES (
         $1, $2, $2, $3, $4, NULL, $5, $6, $7, NULL, $8, $9,
         NULL, $10, $11, $12, $13, $14
       ) RETURNING id`,
      [
        readerIds.get(record.reader_source_id),
        loanIds.get(record.loan_source_id),
        record.reason_code,
        record.confirmed_at,
        record.minimum_until,
        record.is_indefinite,
        record.resolved_at,
        record.resolution_comment,
        record.annulled_at,
        record.annul_reason,
        record.source_id,
        record.confirmed_by,
        record.resolved_by,
        record.annulled_by,
      ],
    );
    const id = String(result.rows[0].id);
    await saveLink(client, {
      ...context,
      entityKind: 'reader_block',
      sourceKey: record.source_id,
      targetId: id,
    });
    ids.set(record.source_id, id);
  }
  return ids;
}

async function insertUnblockRequests(client, context, blockIds) {
  for (const record of context.importPackage.data.unblockRequests) {
    const result = await client.query(
      `INSERT INTO reader_unblock_requests (
         block_id, requested_by, requested_at, request_comment, decision,
         decided_by, decided_at, decision_comment, import_source_key,
         requested_by_snapshot, decided_by_snapshot
       ) VALUES ($1, NULL, $2, $3, $4, NULL, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        blockIds.get(record.block_source_id),
        record.requested_at,
        record.request_comment,
        record.decision,
        record.decided_at,
        record.decision_comment,
        record.source_id,
        record.requested_by,
        record.decided_by,
      ],
    );
    await saveLink(client, {
      ...context,
      entityKind: 'unblock_request',
      sourceKey: record.source_id,
      targetId: String(result.rows[0].id),
    });
  }
}

async function advanceElectronicTicketSequence(client, readers) {
  if (!readers.some((record) => record.ticket_type === 'electronic')) return;
  await client.query(`
    SELECT setval(
      'electronic_ticket_number_seq',
      GREATEST(
        (SELECT last_value FROM electronic_ticket_number_seq),
        COALESCE((
          SELECT max(substring(ticket_number FROM '^E-([0-9]+)$')::bigint)
          FROM reader_personal_data
          WHERE ticket_type = 'electronic' AND ticket_number ~ '^E-[0-9]+$'
        ), 1)
      ),
      true
    )
  `);
}

export class ImportRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async inspectPackage(sourceName, importPackage) {
    const client = await this.pool.connect();
    try {
      return await inspectWithClient(client, sourceName, importPackage);
    } finally {
      client.release();
    }
  }

  async importPackage(sourceName, operatorName, importPackage) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [sourceName]);
      const inspection = await inspectWithClient(client, sourceName, importPackage);
      if (inspection.status === 'repeated') {
        await client.query('COMMIT');
        return inspection;
      }
      if (inspection.status === 'conflict') {
        await client.query('ROLLBACK');
        return inspection;
      }

      const batch = await client.query(
        `INSERT INTO import_batches (
           source_name, content_hash, operator_name, record_counts
         ) VALUES ($1, $2, $3, $4::jsonb)
         RETURNING id, completed_at`,
        [sourceName, importPackage.contentHash, operatorName, JSON.stringify(importPackage.recordCounts)],
      );
      const context = {
        sourceName,
        batchId: String(batch.rows[0].id),
        importPackage,
      };
      const bookIds = await insertBooks(client, context);
      const copyIds = await insertCopies(client, context, bookIds);
      const readerIds = await insertReaders(client, context);
      const loanIds = await insertLoans(client, context, readerIds, copyIds);
      await insertLoanEvents(client, context, loanIds);
      await insertLoanExtensions(client, context, loanIds);
      await insertCopyEvents(client, context, copyIds);
      const blockIds = await insertReaderBlocks(client, context, readerIds, loanIds);
      await insertUnblockRequests(client, context, blockIds);
      await advanceElectronicTicketSequence(client, importPackage.data.readers);

      await client.query('COMMIT');
      return {
        status: 'imported',
        batchId: context.batchId,
        recordCounts: importPackage.recordCounts,
        completedAt: batch.rows[0].completed_at,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
