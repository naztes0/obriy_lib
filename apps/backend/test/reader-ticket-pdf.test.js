import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateReaderTicketPdf } from '../src/modules/readers/reader-ticket-pdf.js';

test('electronic reader ticket is generated as a PDF document', async () => {
  const buffer = await generateReaderTicketPdf({
    fullName: 'Іваненко Іван Іванович',
    className: '11-А',
    ticketNumber: 'E-42',
    ticketIssuedOn: '2026-11-10',
    ticketExpiresOn: '2027-06-30',
  });

  assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
  assert.ok(buffer.length > 5_000);
});
