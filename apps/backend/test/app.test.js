import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, test } from 'node:test';
import { createApp } from '../src/app.js';
import { AppError } from '../src/http/app-error.js';

const runningServers = [];
const silentLogger = { error() { } };

after(async () => {
  await Promise.all(
    runningServers.splice(0).map(
      (server) => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    ),
  );
});

async function startTestServer(pool, options = {}) {
  const server = createServer(createApp({ pool, logger: silentLogger, ...options }));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  runningServers.push(server);

  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}


test('GET /health returns ok when PostgreSQL responds', async () => {
  let queryText;
  const baseUrl = await startTestServer({
    query: async (text) => {
      queryText = text;
      return {};
    },
  });

  const response = await fetch(`${baseUrl}/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { data: { status: 'ok' } });
  assert.equal(queryText, 'SELECT 1');
});

test('GET /health returns a safe structured error when PostgreSQL is unavailable', async () => {
  const baseUrl = await startTestServer({
    query: async () => {
      throw new Error('connection details that must not reach a client');
    },
  });

  const response = await fetch(`${baseUrl}/health`);
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.error.code, 'DATABASE_UNAVAILABLE');
  assert.equal(body.error.message, 'Сервіс тимчасово недоступний.');
  assert.equal(body.error.requestId, response.headers.get('x-request-id'));
  assert.doesNotMatch(JSON.stringify(body), /connection details/);
});

test('unknown routes return a structured 404 error', async () => {
  const baseUrl = await startTestServer({ query: async () => ({}) });
  const response = await fetch(`${baseUrl}/missing`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.error.code, 'NOT_FOUND');
  assert.equal(body.error.requestId, response.headers.get('x-request-id'));
});

test('known paths reject unsupported methods', async () => {
  const baseUrl = await startTestServer({ query: async () => ({}) });
  const response = await fetch(`${baseUrl}/health`, { method: 'POST' });
  const body = await response.json();

  assert.equal(response.status, 405);
  assert.equal(body.error.code, 'METHOD_NOT_ALLOWED');
  assert.deepEqual(body.error.details.allowedMethods, ['GET']);
});

test('catalog routes require an authenticated session', async () => {
  const authService = {
    authenticateToken: async () => {
      throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Увійдіть у систему.');
    },
    login: async () => { },
    logout: async () => { },
  };
  const baseUrl = await startTestServer(
    { query: async () => ({}) },
    { services: { authService, catalogService: {} } },
  );

  const response = await fetch(`${baseUrl}/api/v1/books`);

  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.error.code, 'AUTHENTICATION_REQUIRED');
});

test('authenticated catalog requests return paginated data', async () => {
  const authService = {
    authenticateToken: async (token) => {
      assert.equal(token, 'test-session');
      return { id: '1', role: 'manager' };
    },
    login: async () => { },
    logout: async () => { },
  };
  const catalogService = {
    listBooks: async () => ({
      data: [{ id: '1', title: 'Кобзар' }],
      meta: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
    }),
    getBook: async () => null,
  };
  const baseUrl = await startTestServer(
    { query: async () => ({}) },
    { services: { authService, catalogService } },
  );

  const response = await fetch(`${baseUrl}/api/v1/books`, {
    headers: { Cookie: 'obriy_session=test-session' },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.data, [{ id: '1', title: 'Кобзар' }]);
  assert.deepEqual(body.meta, { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 });
});

test('login places the session token only in an HttpOnly cookie', async () => {
  const authService = {
    login: async ({ login, password }) => {
      assert.equal(login, 'manager');
      assert.equal(password, 'secret');
      return {
        token: 'a'.repeat(43),
        expiresAt: new Date('2026-10-20T18:00:00.000Z'),
        staff: { id: '1', login: 'manager', displayName: 'Завідувач', role: 'manager' },
      };
    },
    authenticateToken: async () => { },
    logout: async () => { },
  };
  const baseUrl = await startTestServer(
    { query: async () => ({}) },
    { services: { authService, catalogService: {} } },
  );

  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'manager', password: 'secret' }),
  });
  const body = await response.json();
  const cookie = response.headers.get('set-cookie');

  assert.equal(response.status, 200);
  assert.equal(body.data.token, undefined);
  assert.match(cookie, /^obriy_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
});

test('authenticated book create and update routes pass JSON to the catalog service', async () => {
  const authService = {
    authenticateToken: async () => ({ id: '1', role: 'manager' }),
    login: async () => {},
    logout: async () => {},
  };
  const catalogService = {
    createBook: async (input) => ({ id: '10', ...input }),
    updateBook: async (bookId, input) => ({ id: bookId, ...input }),
  };
  const baseUrl = await startTestServer(
    { query: async () => ({}) },
    { services: { authService, catalogService } },
  );
  const headers = {
    Cookie: 'obriy_session=test-session',
    'Content-Type': 'application/json',
  };

  const createResponse = await fetch(`${baseUrl}/api/v1/books`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: 'Кобзар' }),
  });
  const updateResponse = await fetch(`${baseUrl}/api/v1/books/10`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ publisher: 'Дніпро' }),
  });

  assert.equal(createResponse.status, 201);
  assert.deepEqual(await createResponse.json(), { data: { id: '10', title: 'Кобзар' } });
  assert.equal(updateResponse.status, 200);
  assert.deepEqual(await updateResponse.json(), { data: { id: '10', publisher: 'Дніпро' } });
});

test('copy routes pass the actor and JSON to the copy service', async () => {
  const actor = { id: '3', role: 'librarian' };
  const authService = {
    authenticateToken: async () => actor,
    login: async () => {},
    logout: async () => {},
  };
  let received;
  const copyService = {
    createCopy: async (bookId, input, requestActor) => {
      received = { bookId, input, actor: requestActor };
      return { id: '20', ...input };
    },
  };
  const baseUrl = await startTestServer(
    { query: async () => ({}) },
    { services: { authService, catalogService: {}, copyService } },
  );

  const response = await fetch(`${baseUrl}/api/v1/books/10/copies`, {
    method: 'POST',
    headers: {
      Cookie: 'obriy_session=test-session',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inventoryNumber: 'INV-20', condition: 'good' }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(received, {
    bookId: '10',
    input: { inventoryNumber: 'INV-20', condition: 'good' },
    actor,
  });
});

test('fund loss route passes JSON, actor and idempotency key to the copy service', async () => {
  const actor = { id: '3', role: 'librarian' };
  const authService = {
    authenticateToken: async () => actor,
    login: async () => {},
    logout: async () => {},
  };
  let received;
  const copyService = {
    markLostInFund: async (copyId, input, requestActor, key) => {
      received = { copyId, input, actor: requestActor, key };
      return { id: copyId, isLost: true };
    },
  };
  const baseUrl = await startTestServer(
    { query: async () => ({}) },
    { services: { authService, catalogService: {}, copyService } },
  );

  const response = await fetch(`${baseUrl}/api/v1/copies/20/loss`, {
    method: 'POST',
    headers: {
      Cookie: 'obriy_session=test-session',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'fund-loss-http-1',
    },
    body: JSON.stringify({ version: '2', reason: 'Не знайдено у фонді' }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(received, {
    copyId: '20',
    input: { version: '2', reason: 'Не знайдено у фонді' },
    actor,
    key: 'fund-loss-http-1',
  });
});

test('school class list is available to an authenticated librarian', async () => {
  const authService = {
    authenticateToken: async () => ({ id: '2', role: 'librarian' }),
    login: async () => {},
    logout: async () => {},
  };
  const schoolClassService = {
    list: async () => [{ id: '1', name: '10-А', isActive: true }],
  };
  const baseUrl = await startTestServer(
    { query: async () => ({}) },
    { services: { authService, catalogService: {}, copyService: {}, schoolClassService } },
  );

  const response = await fetch(`${baseUrl}/api/v1/school-classes`, {
    headers: { Cookie: 'obriy_session=test-session' },
  });

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, [{ id: '1', name: '10-А', isActive: true }]);
});

test('school class changes are forbidden for a librarian', async () => {
  const authService = {
    authenticateToken: async () => ({ id: '2', role: 'librarian' }),
    login: async () => {},
    logout: async () => {},
  };
  const baseUrl = await startTestServer(
    { query: async () => ({}) },
    {
      services: {
        authService,
        catalogService: {},
        copyService: {},
        schoolClassService: { create: async () => assert.fail('service must not be called') },
      },
    },
  );

  const response = await fetch(`${baseUrl}/api/v1/school-classes`, {
    method: 'POST',
    headers: {
      Cookie: 'obriy_session=test-session',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: '10-А' }),
  });

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'ACCESS_DENIED');
});

test('manager can create a school class', async () => {
  const actor = { id: '1', role: 'manager' };
  const authService = {
    authenticateToken: async () => actor,
    login: async () => {},
    logout: async () => {},
  };
  let received;
  const schoolClassService = {
    create: async (input) => {
      received = input;
      return { id: '3', name: input.name, isActive: true };
    },
  };
  const baseUrl = await startTestServer(
    { query: async () => ({}) },
    { services: { authService, catalogService: {}, copyService: {}, schoolClassService } },
  );

  const response = await fetch(`${baseUrl}/api/v1/school-classes`, {
    method: 'POST',
    headers: {
      Cookie: 'obriy_session=test-session',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: '11-Б' }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(received, { name: '11-Б' });
});

test('reader create route passes JSON and the actor to the reader service', async () => {
  const actor = { id: '2', role: 'librarian' };
  const authService = {
    authenticateToken: async () => actor,
    login: async () => {},
    logout: async () => {},
  };
  let received;
  const readerService = {
    createReader: async (input, requestActor) => {
      received = { input, actor: requestActor };
      return { id: '12', ...input };
    },
  };
  const baseUrl = await startTestServer(
    { query: async () => ({}) },
    {
      services: {
        authService,
        catalogService: {},
        copyService: {},
        schoolClassService: {},
        readerService,
      },
    },
  );
  const input = {
    fullName: 'Іваненко Іван',
    category: 'student',
    classId: '3',
    phone: '+380501234567',
    ticketType: 'existing',
    ticketNumber: 'T-12',
    ticketExpiresOn: '2027-06-30',
  };

  const response = await fetch(`${baseUrl}/api/v1/readers`, {
    method: 'POST',
    headers: {
      Cookie: 'obriy_session=test-session',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(received, { input, actor });
});

test('reader archive route passes JSON, actor and idempotency key', async () => {
  const actor = { id: '2', role: 'librarian' };
  const authService = {
    authenticateToken: async () => actor,
    login: async () => {},
    logout: async () => {},
  };
  let received;
  const readerService = {
    archiveReader: async (readerId, input, requestActor, key) => {
      received = { readerId, input, actor: requestActor, key };
      return { id: readerId, isArchived: true };
    },
  };
  const baseUrl = await startTestServer(
    { query: async () => ({}) },
    {
      services: {
        authService,
        catalogService: {},
        copyService: {},
        schoolClassService: {},
        readerService,
      },
    },
  );

  const response = await fetch(`${baseUrl}/api/v1/readers/12/archive`, {
    method: 'POST',
    headers: {
      Cookie: 'obriy_session=test-session',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'archive-reader-http-1',
    },
    body: JSON.stringify({ version: '3', reason: 'За зверненням' }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(received, {
    readerId: '12',
    input: { version: '3', reason: 'За зверненням' },
    actor,
    key: 'archive-reader-http-1',
  });
});

test('reader restore route is forbidden for a librarian', async () => {
  const authService = {
    authenticateToken: async () => ({ id: '2', role: 'librarian' }),
    login: async () => {},
    logout: async () => {},
  };
  const readerService = {
    restoreReader: async () => assert.fail('service must not be called'),
  };
  const baseUrl = await startTestServer(
    { query: async () => ({}) },
    {
      services: {
        authService,
        catalogService: {},
        copyService: {},
        schoolClassService: {},
        readerService,
      },
    },
  );

  const response = await fetch(`${baseUrl}/api/v1/readers/12/restore`, {
    method: 'POST',
    headers: {
      Cookie: 'obriy_session=test-session',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'restore-reader-http-1',
    },
    body: JSON.stringify({ version: '4' }),
  });

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'ACCESS_DENIED');
});

test('loan issue route passes JSON, actor and idempotency key', async () => {
  const actor = { id: '2', role: 'librarian' };
  const authService = {
    authenticateToken: async () => actor,
    login: async () => {},
    logout: async () => {},
  };
  let received;
  const loanService = {
    issueLoan: async (input, requestActor, key) => {
      received = { input, actor: requestActor, key };
      return { id: '30', status: 'issued' };
    },
  };
  const baseUrl = await startTestServer(
    { query: async () => ({}) },
    {
      services: {
        authService,
        catalogService: {},
        copyService: {},
        schoolClassService: {},
        readerService: {},
        loanService,
      },
    },
  );
  const input = { readerId: '4', copyId: '8' };

  const response = await fetch(`${baseUrl}/api/v1/loans`, {
    method: 'POST',
    headers: {
      Cookie: 'obriy_session=test-session',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'issue-request-http-1',
    },
    body: JSON.stringify(input),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(received, { input, actor, key: 'issue-request-http-1' });
});
