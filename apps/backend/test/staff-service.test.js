import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { test } from 'node:test';
import { StaffService } from '../src/modules/staff/staff-service.js';

function passwordHash(password, salt = '00112233445566778899aabbccddeeff') {
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

const manager = { id: '1', role: 'manager' };

test('staff list passes activity and pagination', async () => {
  let received;
  const service = new StaffService({
    listStaff: async (query) => {
      received = query;
      return { staff: [{ id: '2' }], totalItems: 26 };
    },
  });

  const result = await service.listStaff(
    new URLSearchParams({ activity: 'inactive', page: '2', pageSize: '25' }),
  );

  assert.deepEqual(received, { activity: 'inactive', pageSize: 25, offset: 25 });
  assert.equal(result.meta.totalPages, 2);
});

test('manager creates only a librarian with a hashed password', async () => {
  let created;
  const service = new StaffService({
    createLibrarian: async (values) => {
      created = values;
      return { status: 'created', staffId: '2' };
    },
    findStaffById: async () => ({
      id: '2',
      login: 'lib.one',
      display_name: 'Перший Бібліотекар',
      role: 'librarian',
      is_active: true,
      created_at: new Date('2026-11-10T10:00:00.000Z'),
    }),
  });

  const result = await service.createLibrarian({
    login: ' lib.one ',
    displayName: ' Перший   Бібліотекар ',
    password: 'safe-password',
    role: 'manager',
  });

  assert.equal(created.login, 'lib.one');
  assert.equal(created.displayName, 'Перший Бібліотекар');
  assert.match(created.passwordHash, /^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.notEqual(created.passwordHash, 'safe-password');
  assert.equal(result.role, 'librarian');
});

test('staff creation maps a duplicate login', async () => {
  const service = new StaffService({
    createLibrarian: async () => ({ status: 'duplicate_login' }),
  });

  await assert.rejects(
    service.createLibrarian({
      login: 'librarian',
      displayName: 'Бібліотекар',
      password: 'safe-password',
    }),
    (error) => error.status === 409 && error.code === 'STAFF_LOGIN_EXISTS',
  );
});

test('manager can deactivate a librarian and receives the updated account', async () => {
  let received;
  const service = new StaffService({
    setLibrarianActivity: async (staffId, isActive) => {
      received = { staffId, isActive };
      return { status: 'updated' };
    },
    findStaffById: async () => ({
      id: '2',
      login: 'librarian',
      display_name: 'Бібліотекар',
      role: 'librarian',
      is_active: false,
      created_at: new Date(),
    }),
  });

  const result = await service.setLibrarianActivity('2', { isActive: false });

  assert.deepEqual(received, { staffId: '2', isActive: false });
  assert.equal(result.isActive, false);
});

test('manager account cannot be targeted by librarian management actions', async () => {
  const service = new StaffService({
    setLibrarianActivity: async () => ({ status: 'manager_protected' }),
  });

  await assert.rejects(
    service.setLibrarianActivity('1', { isActive: false }),
    (error) => error.status === 422 && error.code === 'MANAGER_ACCOUNT_PROTECTED',
  );
});

test('changing a librarian password returns session revocation confirmation', async () => {
  let hash;
  const service = new StaffService({
    changeLibrarianPassword: async (_id, passwordHashValue) => {
      hash = passwordHashValue;
      return { status: 'updated' };
    },
  });

  const result = await service.changeLibrarianPassword('2', {
    newPassword: 'another-safe-password',
  });

  assert.match(hash, /^scrypt:/);
  assert.deepEqual(result, { staffId: '2', sessionsRevoked: true });
});

test('manager changes own name without changing role or login', async () => {
  let received;
  const service = new StaffService({
    updateManagerProfile: async (id, name) => {
      received = { id, name };
      return { status: 'updated' };
    },
    findStaffById: async () => ({
      id: '1',
      login: 'manager',
      display_name: 'Новий Завідувач',
      role: 'manager',
      is_active: true,
      created_at: new Date(),
    }),
  });

  const result = await service.updateOwnProfile(manager, { displayName: ' Новий  Завідувач ' });

  assert.deepEqual(received, { id: '1', name: 'Новий Завідувач' });
  assert.equal(result.login, 'manager');
  assert.equal(result.role, 'manager');
});

test('manager must provide the current password before changing it', async () => {
  const service = new StaffService({
    findStaffById: async () => ({
      id: '1',
      role: 'manager',
      password_hash: passwordHash('current-password'),
    }),
  });

  await assert.rejects(
    service.changeOwnPassword(manager, {
      currentPassword: 'wrong-password',
      newPassword: 'new-safe-password',
    }),
    (error) => error.status === 401 && error.code === 'CURRENT_PASSWORD_INVALID',
  );
});

test('manager password change hashes the new password and revokes sessions', async () => {
  const currentHash = passwordHash('admin');
  let received;
  const service = new StaffService({
    findStaffById: async () => ({ id: '1', role: 'manager', password_hash: currentHash }),
    changeManagerPassword: async (id, expectedHash, newHash) => {
      received = { id, expectedHash, newHash };
      return { status: 'updated' };
    },
  });

  const result = await service.changeOwnPassword(manager, {
    currentPassword: 'admin',
    newPassword: 'new-safe-password',
  });

  assert.equal(received.id, '1');
  assert.equal(received.expectedHash, currentHash);
  assert.match(received.newHash, /^scrypt:/);
  assert.deepEqual(result, { staffId: '1', sessionsRevoked: true });
});
