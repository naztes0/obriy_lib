import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SchoolClassService } from '../src/modules/school-classes/school-class-service.js';

test('school classes list uses active status by default', async () => {
  let received;
  const service = new SchoolClassService({
    list: async (filters) => {
      received = filters;
      return [{ id: '1', name: '10-А', isActive: true }];
    },
  });

  const result = await service.list(new URLSearchParams());

  assert.deepEqual(received, { status: 'active' });
  assert.equal(result[0].name, '10-А');
});

test('school class creation normalizes whitespace', async () => {
  let received;
  const service = new SchoolClassService({
    create: async (name) => {
      received = name;
      return { id: '2', name, isActive: true };
    },
  });

  const result = await service.create({ name: '  10-А   клас  ' });

  assert.equal(received, '10-А клас');
  assert.equal(result.id, '2');
});

test('school class creation maps a duplicate name conflict', async () => {
  const service = new SchoolClassService({
    create: async () => {
      const error = new Error('duplicate');
      error.code = '23505';
      error.constraint = 'school_classes_name_unique';
      throw error;
    },
  });

  await assert.rejects(
    service.create({ name: '10-А' }),
    (error) => error.code === 'CLASS_NAME_EXISTS' && error.status === 409,
  );
});

test('school class rename rejects an invalid id before querying', async () => {
  const service = new SchoolClassService({
    updateName: async () => assert.fail('repository must not be called'),
  });

  await assert.rejects(
    service.rename('abc', { name: '11-Б' }),
    (error) => error.code === 'INVALID_CLASS_ID' && error.status === 400,
  );
});

test('school class activity requires a boolean', async () => {
  const service = new SchoolClassService({});

  await assert.rejects(
    service.setActive('1', { isActive: 'false' }),
    (error) => error.code === 'VALIDATION_ERROR' && Boolean(error.details.fields.isActive),
  );
});

test('school class activity returns not found for a missing class', async () => {
  const service = new SchoolClassService({ setActive: async () => null });

  await assert.rejects(
    service.setActive('999', { isActive: false }),
    (error) => error.code === 'CLASS_NOT_FOUND' && error.status === 404,
  );
});
