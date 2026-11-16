import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RestrictionRepository } from '../src/modules/restrictions/restriction-repository.js';

test('active restrictions use the stored pending decision value', async () => {
  const calls = [];
  const pool = {
    query: async (text, values) => {
      calls.push({ text, values });
      if (calls.length === 1) return { rows: [{ count: '2' }] };
      return { rows: [{ id: '7' }, { id: '8' }] };
    },
  };
  const repository = new RestrictionRepository(pool);

  const result = await repository.listActive({ pending: true, pageSize: 25, offset: 0 });

  assert.equal(result.totalItems, 2);
  assert.equal(result.items.length, 2);
  assert.match(calls[0].text, /decision = 'pending'/);
  assert.match(calls[1].text, /decision = 'pending'/);
  assert.deepEqual(calls[1].values, [25, 0]);
});
