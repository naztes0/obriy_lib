import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { ReaderService } from '../src/modules/readers/reader-service.js';
import { ReaderRepository } from '../src/modules/readers/reader-repository.js';
import { LoanService } from '../src/modules/loans/loan-service.js';
import { LoanRepository } from '../src/modules/loans/loan-repository.js';
import { ReportService } from '../src/modules/reports/report-service.js';
import { ReportRepository } from '../src/modules/reports/report-repository.js';
import { CorrectionRepository } from '../src/modules/loans/correction-repository.js';
import { CopyRepository } from '../src/modules/copies/copy-repository.js';
import { createApp } from '../src/app.js';
import { createServer } from 'node:http';

test('class membership and current obligations with real PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.match(new URL(connectionString).pathname, /_test$/);
  const schema = `workflow_${Date.now()}`;
  const admin = new pg.Pool({ connectionString });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}` });
  try {
    const dir = new URL('../migrations/', import.meta.url);
    for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) {
      await pool.query(await readFile(new URL(name, dir), 'utf8'));
    }
    const actor = (await pool.query("INSERT INTO staff_accounts(login,display_name,password_hash,role) VALUES ('manager','Тест','unused','manager') RETURNING id::text,role")).rows[0];
    const a = (await pool.query("INSERT INTO school_classes(name) VALUES ('7-А') RETURNING id::text")).rows[0].id;
    const b = (await pool.query("INSERT INTO school_classes(name) VALUES ('8-А') RETURNING id::text")).rows[0].id;
    const readers = new ReaderService(new ReaderRepository(pool));
    let reader = await readers.createReader({ fullName: 'Тестовий Учень', category: 'student', classId: a, phone: '+380501234567', ticketType: 'electronic', ticketExpiresOn: '2099-06-30' }, actor);
    const originalId = reader.id;
    const list = (classId) => readers.listReaders(new URLSearchParams({ category: 'student', classId, pageSize: '1' }));
    assert.equal((await list(a)).meta.totalItems, 1);
    const book = (await pool.query("INSERT INTO books(title,publisher) VALUES ('Тестова книга','Тест') RETURNING id")).rows[0].id;
    const copy = (await pool.query("INSERT INTO book_copies(book_id,inventory_number,condition) VALUES ($1,'TEST-1','good') RETURNING id::text", [book])).rows[0].id;
    const loans = new LoanService(new LoanRepository(pool), { now: () => new Date('2026-01-01T10:00:00Z') });
    const loan = await loans.issueLoan({ readerId: reader.id, copyId: copy }, actor, 'integration-issue-1');
    reader = await readers.updateReader(reader.id, { classId: b, version: reader.version }, actor);
    assert.equal(reader.id, originalId);
    assert.equal((await list(a)).meta.totalItems, 0);
    assert.equal((await list(b)).data[0].id, originalId);
    assert.equal((await loans.getLoan(loan.id)).classNameAtIssue, '7-А');
    await assert.rejects(readers.updateReader(reader.id, { classId: a, version: '1' }, actor), (e) => e.code === 'VERSION_CONFLICT');
    const reports = new ReportService(new ReportRepository(pool), { now: () => new Date('2026-11-15T10:00:00Z') });
    const search = new URLSearchParams({ className: '8-А', dateFrom: '2099-01-01', dateTo: '2099-12-31' });
    assert.equal((await reports.getReport('overdue-loans', search)).meta.totalItems, 1);
    assert.equal((await reports.getReport('current-loans', search)).items[0].className, '8-А');
    const lostCopy = (await pool.query("INSERT INTO book_copies(book_id,inventory_number,condition,is_lost) VALUES ($1,'LOST-1','good',true) RETURNING id", [book])).rows[0].id;
    await pool.query("INSERT INTO book_copy_events(copy_id,kind,new_value,actor_id) VALUES ($1,'lost_in_fund','{}',$2)", [lostCopy, actor.id]);
    assert.equal((await reports.getReport('unresolved-losses', search)).meta.summary.withoutResponsibleReader, 1);
    reader = await readers.updateReader(reader.id, { classId: null, version: reader.version }, actor);
    assert.equal(reader.schoolClass, null);
    assert.equal(reader.currentLoans.length, 1);
    assert.equal((await readers.getElectronicTicketPdf(reader.id)).buffer.subarray(0,4).toString(), '%PDF');
    const copy2 = (await pool.query("INSERT INTO book_copies(book_id,inventory_number,condition) VALUES ($1,'TEST-2','good') RETURNING id::text", [book])).rows[0].id;
    assert.equal((await loans.issueLoan({ readerId: reader.id, copyId: copy2 }, actor, 'integration-no-class')).classNameAtIssue, null);
    await assert.rejects(readers.listReaders(new URLSearchParams({ classId: 'invalid' })), (e) => e.code === 'INVALID_QUERY');
    const corrections=new CorrectionRepository(pool);
    const makeCopy=async(number,isTextbook=false)=>{
      if(isTextbook) await pool.query('UPDATE books SET is_textbook=true WHERE id=$1',[book]);
      return (await pool.query("INSERT INTO book_copies(book_id,inventory_number,condition) VALUES ($1,$2,'good') RETURNING id::text",[book,number])).rows[0].id;
    };
    const correctionCopy=await makeCopy('CORRECT-1');
    const correctionLoan=await loans.issueLoan({readerId:reader.id,copyId:correctionCopy},actor,'correction-loan');
    const targetCopy=await makeCopy('CORRECT-2');
    const context={actorId:actor.id,requestKey:'correct-participants',reason:'Помилково вибраний примірник',version:correctionLoan.version,copyId:targetCopy};
    await corrections.execute('correct_participants',correctionLoan.id,context);
    await corrections.execute('correct_participants',correctionLoan.id,context);
    assert.equal((await loans.getLoan(correctionLoan.id)).copy.id,targetCopy);
    assert.equal(Number((await pool.query("SELECT count(*) FROM operation_corrections WHERE operation='correct_participants'")).rows[0].count),1);
    const voidCopy=await makeCopy('VOID-1');
    const voidLoan=await loans.issueLoan({readerId:reader.id,copyId:voidCopy},actor,'void-issue');
    const voidContext={actorId:actor.id,requestKey:'void-request',reason:'Фактичної передачі не було',version:voidLoan.version,confirmNoTransfer:true};
    await corrections.execute('void_loan',voidLoan.id,voidContext);
    assert.equal((await corrections.execute('void_loan',voidLoan.id,voidContext)).voided,true);
    assert.equal((await pool.query('SELECT 1 FROM loans WHERE id=$1',[voidLoan.id])).rowCount,0);
    const lostRow=(await pool.query('SELECT version::text FROM book_copies WHERE id=$1',[lostCopy])).rows[0];
    await corrections.execute('settle_fund_loss',String(lostCopy),{actorId:actor.id,requestKey:'settle-loss',reason:'Рішення про списання',version:lostRow.version});
    assert.equal((await reports.getReport('unresolved-losses',search)).meta.summary.withoutResponsibleReader,0);
    const settled=(await pool.query('SELECT version::text FROM book_copies WHERE id=$1',[lostCopy])).rows[0];
    assert.equal((await new CopyRepository(pool).writeOffCopy(String(lostCopy),{version:settled.version,reason:'Списання',actorId:actor.id,requestKey:'write-settled'})).status,'written_off');
    const textbookCopy=await makeCopy('TEXTBOOK-1',true);
    const textbookLoan=await loans.issueLoan({readerId:reader.id,copyId:textbookCopy,dueDate:'2026-06-30'},actor,'custom-due-date');
    assert.equal(textbookLoan.currentDueDate,'2026-06-30');
    const server=createServer(createApp({pool,services:{authService:{authenticateToken:async(token)=>({...actor,role:token==='librarian'?'librarian':'manager'})}}}));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      const base=`http://127.0.0.1:${server.address().port}`;
      for(const path of [`/api/v1/readers/${reader.id}/blocks`,`/api/v1/loans/${textbookLoan.id}/void`,`/api/v1/copies/${textbookCopy}/settle-loss`]) {
        const denied=await fetch(base+path,{method:'POST',headers:{Cookie:'obriy_session=librarian','Content-Type':'application/json'},body:'{}'});
        assert.equal(denied.status,403,path);
      }
      for(const path of [`/api/v1/readers/${reader.id}/history?pageSize=1`,`/api/v1/loans/${voidLoan.id}/audit`,`/api/v1/copies/${targetCopy}/history?dateFrom=2026-01-01`,`/api/v1/restrictions?pending=true`]) {
        const response=await fetch(base+path,{headers:{Cookie:'obriy_session=manager'}});
        assert.equal(response.status,200,path+': '+await response.text());
      }
    } finally { await new Promise(resolve=>server.close(resolve)); }
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
