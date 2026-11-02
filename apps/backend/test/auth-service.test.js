import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { test } from 'node:test';
import { AuthService } from '../src/modules/auth/auth-service.js';

function passwordHash(password, salt = '00112233445566778899aabbccddeeff') {
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

test('login verifies the password and stores only a hash of the session token', async () => {
  let createdSession;
  const repository = {
    findAccountByLogin: async () => ({
      id: '7',
      login: 'manager',
      display_name: 'Завідувач',
      password_hash: passwordHash('correct-password'),
      role: 'manager',
      is_active: true,
    }),
    createSession: async (session) => {
      createdSession = session;
    },
  };
  const service = new AuthService(repository, {
    sessionTtlMilliseconds: 60_000,
    now: () => new Date('2026-10-20T10:00:00.000Z'),
  });

  const result = await service.login({ login: ' manager ', password: 'correct-password' });

  assert.equal(result.staff.id, '7');
  assert.equal(result.staff.role, 'manager');
  assert.equal(result.expiresAt.toISOString(), '2026-10-20T10:01:00.000Z');
  assert.match(result.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(createdSession.tokenHash, /^[0-9a-f]{64}$/);
  assert.notEqual(createdSession.tokenHash, result.token);
});

test('login rejects a wrong password without creating a session', async () => {
  let sessionCreated = false;
  const repository = {
    findAccountByLogin: async () => ({
      id: '7',
      login: 'manager',
      display_name: 'Завідувач',
      password_hash: passwordHash('correct-password'),
      role: 'manager',
      is_active: true,
    }),
    createSession: async () => {
      sessionCreated = true;
    },
  };
  const service = new AuthService(repository, { sessionTtlMilliseconds: 60_000 });

  await assert.rejects(
    service.login({ login: 'manager', password: 'wrong-password' }),
    (error) => error.code === 'INVALID_CREDENTIALS' && error.status === 401,
  );
  assert.equal(sessionCreated, false);
});

test('authenticateToken returns the current active staff account', async () => {
  const repository = {
    findActiveSession: async (tokenHash) => ({
      id: '9',
      login: 'librarian',
      display_name: 'Бібліотекар',
      role: 'librarian',
      is_active: true,
      tokenHash,
    }),
  };
  const service = new AuthService(repository, { sessionTtlMilliseconds: 60_000 });
  const token = 'a'.repeat(43);

  const staff = await service.authenticateToken(token);

  assert.deepEqual(staff, {
    id: '9',
    login: 'librarian',
    displayName: 'Бібліотекар',
    role: 'librarian',
  });
});
