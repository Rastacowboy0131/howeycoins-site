const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyDailySpend,
  getDailySpend,
  remainingDailyLamports,
} = require('../src/howeyAutoState');

test('daily spend state tracks spend by UTC day', () => {
  const state = { dailySpend: {} };
  const date = new Date('2026-06-11T15:00:00Z');

  const next = applyDailySpend(state, 250_000_000, date);

  assert.equal(getDailySpend(next, date), 250_000_000);
  assert.equal(getDailySpend(next, new Date('2026-06-12T00:00:00Z')), 0);
});

test('remainingDailyLamports clamps remaining spend at zero', () => {
  const state = applyDailySpend({ dailySpend: {} }, 2_500_000_000, new Date('2026-06-11T15:00:00Z'));

  assert.equal(remainingDailyLamports(state, 2_000_000_000, new Date('2026-06-11T16:00:00Z')), 0);
  assert.equal(remainingDailyLamports(state, 3_000_000_000, new Date('2026-06-11T16:00:00Z')), 500_000_000);
});
