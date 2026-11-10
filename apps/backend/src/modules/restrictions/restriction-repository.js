function toDateOnly(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function mapActor(id, displayName) {
  return displayName ? { id: id === null ? null : String(id), displayName } : null;
}

function mapRequest(row) {
  return {
    id: String(row.id),
    blockId: String(row.block_id),
    requestedBy: mapActor(row.requested_by, row.requested_by_name),
    requestedAt: row.requested_at,
    requestComment: row.request_comment,
    decision: row.decision,
    decidedBy: mapActor(row.decided_by, row.decided_by_name),
    decidedAt: row.decided_at,
    decisionComment: row.decision_comment,
    version: String(row.version),
  };
}

function mapBlock(row, requests = []) {
  const status = row.annulled_at
    ? 'annulled'
    : row.resolved_at
      ? 'resolved'
      : 'active';
  return {
    id: String(row.id),
    readerId: String(row.reader_id),
    status,
    sourceLoan: {
      id: String(row.source_loan_reference),
      isAvailable: row.source_loan_id !== null,
      status: row.source_loan_status,
      dueDate: toDateOnly(row.source_loan_due_date),
      lostAt: row.source_loan_lost_at,
    },
    reasonCode: row.reason_code,
    confirmedAt: row.confirmed_at,
    confirmedBy: mapActor(row.confirmed_by, row.confirmed_by_name),
    minimumUntil: toDateOnly(row.minimum_until),
    isIndefinite: row.is_indefinite,
    resolvedAt: row.resolved_at,
    resolvedBy: mapActor(row.resolved_by, row.resolved_by_name),
    resolutionComment: row.resolution_comment,
    annulledAt: row.annulled_at,
    annulledBy: mapActor(row.annulled_by, row.annulled_by_name),
    annulReason: row.annul_reason,
    version: String(row.version),
    unblockRequests: requests,
  };
}

const BLOCK_SELECT = `SELECT rb.*,
                             COALESCE(confirmer.display_name, rb.confirmed_by_snapshot) AS confirmed_by_name,
                             COALESCE(resolver.display_name, rb.resolved_by_snapshot) AS resolved_by_name,
                             COALESCE(annuller.display_name, rb.annulled_by_snapshot) AS annulled_by_name,
                             l.id AS source_loan_id,
                             l.status AS source_loan_status,
                             l.current_due_date AS source_loan_due_date,
                             lost_event.lost_at AS source_loan_lost_at
                      FROM reader_blocks rb
                      LEFT JOIN staff_accounts confirmer ON confirmer.id = rb.confirmed_by
                      LEFT JOIN staff_accounts resolver ON resolver.id = rb.resolved_by
                      LEFT JOIN staff_accounts annuller ON annuller.id = rb.annulled_by
                      LEFT JOIN loans l ON l.id = rb.source_loan_id
                      LEFT JOIN LATERAL (
                        SELECT max(lse.occurred_at) AS lost_at
                        FROM loan_status_events lse
                        WHERE lse.loan_id = l.id AND lse.to_status = 'lost'
                      ) lost_event ON true`;

const REQUEST_SELECT = `SELECT rur.*,
                               COALESCE(requester.display_name, rur.requested_by_snapshot) AS requested_by_name,
                               COALESCE(decider.display_name, rur.decided_by_snapshot) AS decided_by_name
                        FROM reader_unblock_requests rur
                        LEFT JOIN staff_accounts requester ON requester.id = rur.requested_by
                        LEFT JOIN staff_accounts decider ON decider.id = rur.decided_by`;

async function reserveRequest(client, { actorId, operation, requestKey }) {
  const inserted = await client.query(
    `INSERT INTO processed_requests (actor_id, operation, request_key)
     VALUES ($1, $2, $3)
     ON CONFLICT (actor_id, operation, request_key) DO NOTHING
     RETURNING id`,
    [actorId, operation, requestKey],
  );
  if (inserted.rowCount) return { isNew: true };
  const existing = await client.query(
    `SELECT result_entity_id FROM processed_requests
     WHERE actor_id = $1 AND operation = $2 AND request_key = $3`,
    [actorId, operation, requestKey],
  );
  return { isNew: false, resultId: String(existing.rows[0].result_entity_id) };
}

async function completeRequest(client, { actorId, operation, requestKey, resultId }) {
  await client.query(
    `UPDATE processed_requests SET result_entity_id = $4
     WHERE actor_id = $1 AND operation = $2 AND request_key = $3`,
    [actorId, operation, requestKey, resultId],
  );
}

async function hasBlockingGrounds(client, readerId, today) {
  const result = await client.query(
    `SELECT
       EXISTS (
         SELECT 1 FROM loans l
         WHERE l.reader_id = $1
           AND l.status = 'issued'
           AND l.current_due_date < $2::date - 7
       ) AS has_overdue,
       EXISTS (
         SELECT 1 FROM loans l
         WHERE l.reader_id = $1
           AND l.status = 'lost'
           AND (
             SELECT (max(lse.occurred_at) AT TIME ZONE 'Europe/Kyiv')::date
             FROM loan_status_events lse
             WHERE lse.loan_id = l.id AND lse.to_status = 'lost'
           ) < $2::date - 14
       ) AS has_unresolved_loss`,
    [readerId, today],
  );
  return result.rows[0].has_overdue || result.rows[0].has_unresolved_loss;
}

export class RestrictionRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async listReaderBlocks(readerId) {
    const reader = await this.pool.query('SELECT id FROM readers WHERE id = $1', [readerId]);
    if (!reader.rowCount) return null;

    const blocks = await this.pool.query(
      `${BLOCK_SELECT}
       WHERE rb.reader_id = $1
       ORDER BY rb.confirmed_at DESC, rb.id DESC`,
      [readerId],
    );
    if (!blocks.rowCount) return [];

    const blockIds = blocks.rows.map((row) => row.id);
    const requests = await this.pool.query(
      `${REQUEST_SELECT}
       WHERE rur.block_id = ANY($1::bigint[])
       ORDER BY rur.requested_at DESC, rur.id DESC`,
      [blockIds],
    );
    const requestsByBlock = new Map();
    for (const row of requests.rows) {
      const key = String(row.block_id);
      const values = requestsByBlock.get(key) ?? [];
      values.push(mapRequest(row));
      requestsByBlock.set(key, values);
    }
    return blocks.rows.map((row) => mapBlock(row, requestsByBlock.get(String(row.id)) ?? []));
  }

  async findBlockById(blockId) {
    const block = await this.pool.query(`${BLOCK_SELECT} WHERE rb.id = $1`, [blockId]);
    if (!block.rowCount) return null;
    const requests = await this.pool.query(
      `${REQUEST_SELECT}
       WHERE rur.block_id = $1
       ORDER BY rur.requested_at DESC, rur.id DESC`,
      [blockId],
    );
    return mapBlock(block.rows[0], requests.rows.map(mapRequest));
  }

  async confirmBlock(readerId, { sourceLoanId, reasonCode, today, actorId, requestKey }) {
    const client = await this.pool.connect();
    const operation = `confirm_reader_block:${readerId}`;
    try {
      await client.query('BEGIN');
      const reservation = await reserveRequest(client, { actorId, operation, requestKey });
      if (!reservation.isNew) {
        await client.query('COMMIT');
        return { status: 'repeated', blockId: reservation.resultId };
      }

      const reader = await client.query(
        `SELECT reader_id FROM reader_personal_data
         WHERE reader_id = $1 FOR UPDATE`,
        [readerId],
      );
      if (!reader.rowCount) return await this.rollbackStatus(client, 'reader_not_found');

      const active = await client.query(
        `SELECT id FROM reader_blocks
         WHERE reader_id = $1 AND resolved_at IS NULL AND annulled_at IS NULL`,
        [readerId],
      );
      if (active.rowCount) return await this.rollbackStatus(client, 'already_blocked');

      const loan = await client.query(
        `SELECT l.id, l.reader_id, l.status, l.current_due_date,
                (
                  SELECT max(lse.occurred_at)
                  FROM loan_status_events lse
                  WHERE lse.loan_id = l.id AND lse.to_status = 'lost'
                ) AS lost_at,
                l.status = 'issued' AND l.current_due_date < $2::date - 7 AS overdue_eligible,
                l.status = 'lost' AND (
                  SELECT (max(lse.occurred_at) AT TIME ZONE 'Europe/Kyiv')::date
                  FROM loan_status_events lse
                  WHERE lse.loan_id = l.id AND lse.to_status = 'lost'
                ) < $2::date - 14 AS loss_eligible
         FROM loans l
         WHERE l.id = $1
         FOR UPDATE OF l`,
        [sourceLoanId, today],
      );
      if (!loan.rowCount) return await this.rollbackStatus(client, 'loan_not_found');
      const loanRow = loan.rows[0];
      if (String(loanRow.reader_id) !== readerId) {
        return await this.rollbackStatus(client, 'loan_reader_mismatch');
      }
      const groundIsValid =
        (reasonCode === 'overdue' && loanRow.overdue_eligible) ||
        (reasonCode === 'unresolved_loss' && loanRow.loss_eligible);
      if (!groundIsValid) return await this.rollbackStatus(client, 'ground_not_reached');

      const previous = await client.query(
        `SELECT count(*) AS total FROM reader_blocks
         WHERE reader_id = $1 AND resolved_at IS NOT NULL AND annulled_at IS NULL`,
        [readerId],
      );
      const isIndefinite = Number(previous.rows[0].total) > 0;
      const minimumUntil = isIndefinite ? null : addDays(today, 30);
      const inserted = await client.query(
        `INSERT INTO reader_blocks (
           reader_id, source_loan_id, source_loan_reference, reason_code,
           confirmed_by, minimum_until, is_indefinite
         ) VALUES ($1, $2, $2, $3, $4, $5, $6)
         RETURNING id`,
        [readerId, sourceLoanId, reasonCode, actorId, minimumUntil, isIndefinite],
      );
      const blockId = String(inserted.rows[0].id);
      await completeRequest(client, { actorId, operation, requestKey, resultId: blockId });
      await client.query('COMMIT');
      return { status: 'created', blockId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createUnblockRequest(blockId, { comment, actorId, requestKey }) {
    const client = await this.pool.connect();
    const operation = `request_reader_unblock:${blockId}`;
    try {
      await client.query('BEGIN');
      const reservation = await reserveRequest(client, { actorId, operation, requestKey });
      if (!reservation.isNew) {
        await client.query('COMMIT');
        return { status: 'repeated', requestId: reservation.resultId, blockId };
      }
      const block = await client.query(
        `SELECT id, resolved_at, annulled_at, is_indefinite
         FROM reader_blocks WHERE id = $1 FOR UPDATE`,
        [blockId],
      );
      if (!block.rowCount) return await this.rollbackStatus(client, 'block_not_found');
      const row = block.rows[0];
      if (row.resolved_at !== null || row.annulled_at !== null) {
        return await this.rollbackStatus(client, 'block_not_active');
      }
      if (row.is_indefinite) return await this.rollbackStatus(client, 'indefinite_block');
      const pending = await client.query(
        `SELECT id FROM reader_unblock_requests
         WHERE block_id = $1 AND decision = 'pending'`,
        [blockId],
      );
      if (pending.rowCount) return await this.rollbackStatus(client, 'request_exists');

      const inserted = await client.query(
        `INSERT INTO reader_unblock_requests (block_id, requested_by, request_comment)
         VALUES ($1, $2, $3) RETURNING id`,
        [blockId, actorId, comment],
      );
      const requestId = String(inserted.rows[0].id);
      await completeRequest(client, { actorId, operation, requestKey, resultId: requestId });
      await client.query('COMMIT');
      return { status: 'created', requestId, blockId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async unblockDirectly(blockId, { version, comment, today, actorId, requestKey }) {
    const client = await this.pool.connect();
    const operation = `unblock_reader:${blockId}`;
    try {
      await client.query('BEGIN');
      const reservation = await reserveRequest(client, { actorId, operation, requestKey });
      if (!reservation.isNew) {
        await client.query('COMMIT');
        return { status: 'repeated', blockId: reservation.resultId };
      }
      const block = await client.query(
        `SELECT id, reader_id, minimum_until, is_indefinite, resolved_at, annulled_at, version
         FROM reader_blocks WHERE id = $1 FOR UPDATE`,
        [blockId],
      );
      if (!block.rowCount) return await this.rollbackStatus(client, 'block_not_found');
      const row = block.rows[0];
      const status = await this.validateUnblock(client, row, version, today);
      if (status) return await this.rollbackStatus(client, status);

      await client.query(
        `UPDATE reader_blocks
         SET resolved_at = now(), resolved_by = $2, resolution_comment = $3,
             version = version + 1
         WHERE id = $1`,
        [blockId, actorId, comment],
      );
      await client.query(
        `UPDATE reader_unblock_requests
         SET decision = 'approved', decided_by = $2, decided_at = now(),
             decision_comment = $3, version = version + 1
         WHERE block_id = $1 AND decision = 'pending'`,
        [blockId, actorId, comment],
      );
      await completeRequest(client, { actorId, operation, requestKey, resultId: blockId });
      await client.query('COMMIT');
      return { status: 'resolved', blockId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async decideUnblockRequest(requestId, { version, decision, comment, today, actorId, requestKey }) {
    const client = await this.pool.connect();
    const operation = `decide_reader_unblock:${requestId}`;
    try {
      await client.query('BEGIN');
      const reservation = await reserveRequest(client, { actorId, operation, requestKey });
      if (!reservation.isNew) {
        await client.query('COMMIT');
        return { status: 'repeated', blockId: reservation.resultId };
      }
      const request = await client.query(
        `SELECT rur.id, rur.block_id, rur.decision AS request_decision,
                rur.version AS request_version, rb.reader_id, rb.minimum_until,
                rb.is_indefinite, rb.resolved_at, rb.annulled_at, rb.version AS block_version
         FROM reader_unblock_requests rur
         JOIN reader_blocks rb ON rb.id = rur.block_id
         WHERE rur.id = $1
         FOR UPDATE OF rur, rb`,
        [requestId],
      );
      if (!request.rowCount) return await this.rollbackStatus(client, 'request_not_found');
      const row = request.rows[0];
      if (row.request_decision !== 'pending') {
        return await this.rollbackStatus(client, 'request_decided');
      }
      if (String(row.request_version) !== version) {
        return await this.rollbackStatus(client, 'version_conflict');
      }
      if (row.resolved_at !== null || row.annulled_at !== null) {
        return await this.rollbackStatus(client, 'block_not_active');
      }
      if (decision === 'approved') {
        const status = await this.validateUnblock(
          client,
          row,
          String(row.block_version),
          today,
        );
        if (status) return await this.rollbackStatus(client, status);
        await client.query(
          `UPDATE reader_blocks
           SET resolved_at = now(), resolved_by = $2, resolution_comment = $3,
               version = version + 1
           WHERE id = $1`,
          [row.block_id, actorId, comment],
        );
      }
      await client.query(
        `UPDATE reader_unblock_requests
         SET decision = $2, decided_by = $3, decided_at = now(),
             decision_comment = $4, version = version + 1
         WHERE id = $1`,
        [requestId, decision, actorId, comment],
      );
      await completeRequest(client, {
        actorId,
        operation,
        requestKey,
        resultId: String(row.block_id),
      });
      await client.query('COMMIT');
      return { status: decision, blockId: String(row.block_id) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async annulBlock(blockId, { version, reason, actorId, requestKey }) {
    const client = await this.pool.connect();
    const operation = `annul_reader_block:${blockId}`;
    try {
      await client.query('BEGIN');
      const reservation = await reserveRequest(client, { actorId, operation, requestKey });
      if (!reservation.isNew) {
        await client.query('COMMIT');
        return { status: 'repeated', blockId: reservation.resultId };
      }
      const block = await client.query(
        `SELECT id, reader_id, annulled_at, version
         FROM reader_blocks WHERE id = $1 FOR UPDATE`,
        [blockId],
      );
      if (!block.rowCount) return await this.rollbackStatus(client, 'block_not_found');
      const row = block.rows[0];
      if (row.annulled_at !== null) return await this.rollbackStatus(client, 'already_annulled');
      if (String(row.version) !== version) {
        return await this.rollbackStatus(client, 'version_conflict');
      }
      await client.query(
        `UPDATE reader_blocks
         SET annulled_at = now(), annulled_by = $2, annul_reason = $3,
             version = version + 1
         WHERE id = $1`,
        [blockId, actorId, reason],
      );
      await client.query(
        `WITH ranked AS (
           SELECT id,
                  row_number() OVER (ORDER BY confirmed_at, id) AS position,
                  ((confirmed_at AT TIME ZONE 'Europe/Kyiv')::date + 30) AS first_minimum_until
           FROM reader_blocks
           WHERE reader_id = $1 AND annulled_at IS NULL
         ), desired AS (
           SELECT id,
                  position > 1 AS is_indefinite,
                  CASE WHEN position = 1 THEN first_minimum_until ELSE NULL END AS minimum_until
           FROM ranked
         )
         UPDATE reader_blocks rb
         SET is_indefinite = desired.is_indefinite,
             minimum_until = desired.minimum_until,
             version = rb.version + 1
         FROM desired
         WHERE rb.id = desired.id
           AND (
             rb.is_indefinite IS DISTINCT FROM desired.is_indefinite
             OR rb.minimum_until IS DISTINCT FROM desired.minimum_until
           )`,
        [row.reader_id],
      );
      await client.query(
        `UPDATE reader_unblock_requests
         SET decision = 'rejected', decided_by = $2, decided_at = now(),
             decision_comment = 'Блокування анульовано', version = version + 1
         WHERE block_id = $1 AND decision = 'pending'`,
        [blockId, actorId],
      );
      await completeRequest(client, { actorId, operation, requestKey, resultId: blockId });
      await client.query('COMMIT');
      return { status: 'annulled', blockId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async validateUnblock(client, row, version, today) {
    if (row.resolved_at !== null || row.annulled_at !== null) return 'block_not_active';
    if (String(row.version ?? row.block_version) !== version) return 'version_conflict';
    if (row.is_indefinite) return 'indefinite_block';
    if (toDateOnly(row.minimum_until) > today) return 'minimum_period';
    if (await hasBlockingGrounds(client, String(row.reader_id), today)) return 'grounds_remain';
    return null;
  }

  async rollbackStatus(client, status) {
    await client.query('ROLLBACK');
    return { status };
  }
}
