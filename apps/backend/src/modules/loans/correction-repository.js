import { AppError } from '../../http/app-error.js';

const fail = (code, message, status = 422) => { throw new AppError(status, code, message); };

export class CorrectionRepository {
  constructor(pool) { this.pool = pool; }

  async execute(operation, entityId, { actorId, requestKey, reason, version, readerId, copyId, confirmNoTransfer }) {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${actorId}:${operation}:${requestKey}`]);
      const prior = await db.query('SELECT entity_id,result FROM operation_corrections WHERE actor_id=$1 AND operation=$2 AND request_key=$3', [actorId, operation, requestKey]);
      if (prior.rowCount) {
        if (String(prior.rows[0].entity_id) !== entityId) fail('REQUEST_CONFLICT','Цей ключ належить іншому запису.',409);
        await db.query('COMMIT'); return prior.rows[0].result;
      }
      let before; let after; let result;
      if (operation === 'correct_participants' || operation === 'void_loan') {
        const found = await db.query('SELECT * FROM loans WHERE id=$1 FOR UPDATE', [entityId]);
        if (!found.rowCount) fail('LOAN_NOT_FOUND', 'Видачу не знайдено.', 404);
        const loan = found.rows[0]; before = loan;
        await db.query('SELECT id FROM book_copies WHERE id=$1 FOR UPDATE',[loan.copy_id]);
        if (String(loan.version) !== version) fail('VERSION_CONFLICT', 'Видача змінилася. Оновіть дані.', 409);
        if (loan.status !== 'issued') fail('CORRECTION_NOT_ALLOWED', 'Виправлення можливе лише для видачі без повернення, втрати чи відшкодування.');
        const later = await db.query(`SELECT 1 FROM loan_extensions WHERE loan_id=$1
          UNION ALL SELECT 1 FROM loan_status_events WHERE loan_id=$1 AND from_status IS NOT NULL
          UNION ALL SELECT 1 FROM reader_blocks WHERE source_loan_id=$1
          UNION ALL SELECT 1 FROM book_copy_events WHERE copy_id=$2 AND occurred_at >= $3 AND kind NOT IN ('issued','participants_corrected') LIMIT 1`, [entityId, loan.copy_id, loan.issued_at]);
        if (later.rowCount) fail('LATER_EVENTS_EXIST', 'Є пов’язані події. Цю видачу не можна виправити цим способом.');
        if (operation === 'void_loan') {
          if (!confirmNoTransfer) fail('CONFIRMATION_REQUIRED', 'Підтвердьте, що фактичної передачі не було.');
          await db.query('DELETE FROM loans WHERE id=$1', [entityId]);
          after = { voided: true }; result = { id: entityId, voided: true };
        } else {
          const targetReader = readerId ?? String(loan.reader_id);
          const targetCopy = copyId ?? String(loan.copy_id);
          if (targetReader === String(loan.reader_id) && targetCopy === String(loan.copy_id)) fail('UNCHANGED', 'Оберіть іншого читача або примірник.');
          const reader = await db.query(`SELECT rpd.*,sc.name AS class_name FROM reader_personal_data rpd
            LEFT JOIN school_classes sc ON sc.id=rpd.class_id WHERE reader_id=$1 FOR UPDATE OF rpd`, [targetReader]);
          if (!reader.rowCount) fail('READER_NOT_FOUND', 'Читача не знайдено.', 404);
          const person = reader.rows[0];
          const due = await db.query(`SELECT ($1::date < (now() AT TIME ZONE 'Europe/Kyiv')::date) AS expired,
            ($2::date IS NOT NULL AND $2::date <= (now() AT TIME ZONE 'Europe/Kyiv')::date) AS employment_ended`,
          [person.ticket_expires_on, person.employment_ended_on]);
          if (person.archived_at || (person.category === 'student' && (due.rows[0].expired || person.ticket_expires_on < loan.current_due_date)) ||
            due.rows[0].employment_ended) fail('READER_UNAVAILABLE', 'Читач або його квиток не дозволяє цю видачу.');
          const blocks = await db.query('SELECT 1 FROM reader_blocks WHERE reader_id=$1 AND resolved_at IS NULL AND annulled_at IS NULL', [targetReader]);
          if (blocks.rowCount) fail('READER_BLOCKED', 'Читача заблоковано.');
          const copies = await db.query(`SELECT bc.*,b.archived_at AS book_archived_at FROM book_copies bc JOIN books b ON b.id=bc.book_id
            WHERE bc.id=ANY($1::bigint[]) ORDER BY bc.id FOR UPDATE OF bc`, [[loan.copy_id, targetCopy]]);
          const copy = copies.rows.find((c) => String(c.id) === targetCopy);
          if (!copy) fail('COPY_NOT_FOUND', 'Примірник не знайдено.', 404);
          if (copy.archived_at || copy.book_archived_at || copy.is_lost || copy.is_temporarily_unavailable || !['good','worn'].includes(copy.condition)) fail('COPY_UNAVAILABLE', 'Примірник недоступний.');
          const open = await db.query("SELECT 1 FROM loans WHERE copy_id=$1 AND status IN ('issued','lost') AND id<>$2", [targetCopy, entityId]);
          if (open.rowCount) fail('COPY_ALREADY_ON_LOAN', 'Примірник уже видано.', 409);
          const laterCopyLoans=await db.query('SELECT 1 FROM loans WHERE copy_id=$1 AND issued_at>$2 AND id<>$3 LIMIT 1',[targetCopy,loan.issued_at,entityId]);
          if(laterCopyLoans.rowCount) fail('LATER_EVENTS_EXIST','Правильний примірник має пізніші видачі.');
          const updated = await db.query(`UPDATE loans SET reader_id=$2,copy_id=$3,reader_category_snapshot=$4,class_name_snapshot=$5,
            issue_condition=$6,issue_defect_snapshot=$7,version=version+1 WHERE id=$1 RETURNING *`,
          [entityId,targetReader,targetCopy,
            targetReader===String(loan.reader_id)?loan.reader_category_snapshot:person.category,
            targetReader===String(loan.reader_id)?loan.class_name_snapshot:person.class_name,
            targetCopy===String(loan.copy_id)?loan.issue_condition:copy.condition,
            targetCopy===String(loan.copy_id)?loan.issue_defect_snapshot:copy.defect_description]);
          after = updated.rows[0]; result = { id: entityId, corrected: true };
          for (const id of new Set([String(loan.copy_id),targetCopy])) {
            await db.query(`INSERT INTO book_copy_events(copy_id,kind,old_value,new_value,reason,actor_id,loan_id,request_key)
              VALUES ($1,'participants_corrected',$2,$3,$4,$5,$6,$7)`, [id,JSON.stringify({readerId:loan.reader_id,copyId:loan.copy_id}),JSON.stringify({readerId:targetReader,copyId:targetCopy}),reason,actorId,entityId,requestKey]);
          }
        }
      } else {
        const found = await db.query('SELECT * FROM book_copies WHERE id=$1 FOR UPDATE', [entityId]);
        if (!found.rowCount) fail('COPY_NOT_FOUND', 'Примірник не знайдено.', 404);
        const copy = found.rows[0]; before = copy;
        if (String(copy.version) !== version) fail('VERSION_CONFLICT', 'Примірник змінився. Оновіть дані.', 409);
        if (!copy.is_lost) fail('COPY_NOT_LOST', 'Примірник не позначений втраченим.');
        const open = await db.query("SELECT * FROM loans WHERE copy_id=$1 AND status IN ('issued','lost') FOR UPDATE", [entityId]);
        const latest=await db.query("SELECT kind,loan_id FROM book_copy_events WHERE copy_id=$1 AND kind IN ('lost','lost_in_fund','erroneous_return','loss_settled','loss_corrected','found','returned') ORDER BY occurred_at DESC,id DESC LIMIT 1",[entityId]);
        if(latest.rows[0]?.kind==='loss_settled') fail('LOSS_ALREADY_SETTLED','Втрату вже врегульовано.');
        if(latest.rows[0]?.kind==='lost' && !open.rowCount) fail('LOAN_LOSS','Втрату за видачею виправляйте через її картку.');
        if (operation === 'settle_fund_loss') {
          if (open.rowCount) fail('OPEN_LOAN', 'Втрату за видачею врегульовуйте через картку видачі.');
          after = { isLost: true, settled: true }; result = { id: entityId, settled: true };
        } else {
          if (open.rowCount) fail('OPEN_LOAN', 'Для втрати за видачею виправте статус у картці видачі.');
          await db.query('UPDATE book_copies SET is_lost=false,version=version+1 WHERE id=$1', [entityId]);
          after = { isLost: false }; result = { id: entityId, corrected: true };
        }
        await db.query(`INSERT INTO book_copy_events(copy_id,kind,old_value,new_value,reason,actor_id,request_key)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [entityId,operation === 'settle_fund_loss' ? 'loss_settled' : 'loss_corrected', JSON.stringify({isLost:true}), JSON.stringify(after), reason, actorId, requestKey]);
        if (operation === 'settle_fund_loss') await db.query('UPDATE book_copies SET version=version+1 WHERE id=$1', [entityId]);
      }
      await db.query(`INSERT INTO operation_corrections(actor_id,operation,entity_id,request_key,reason,old_value,new_value,result)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [actorId,operation,entityId,requestKey,reason,JSON.stringify(before),JSON.stringify(after),JSON.stringify(result)]);
      await db.query('COMMIT'); return result;
    } catch (e) { await db.query('ROLLBACK'); throw e; }
    finally { db.release(); }
  }
}
