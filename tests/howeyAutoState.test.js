const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addPendingAirdrop,
  applyDailySpend,
  getDailySpend,
  isAirdropDue,
  markAirdropSent,
  normalizeState,
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

test('pending airdrop state queues buybacks until the five minute airdrop cadence is due', () => {
  const first = addPendingAirdrop({}, 1000);
  const second = addPendingAirdrop(first, 2500);
  const sent = markAirdropSent(second, new Date('2026-06-11T15:00:00Z'));

  assert.equal(second.pendingAirdropRawAmount, 3500);
  assert.equal(sent.pendingAirdropRawAmount, 0);
  assert.equal(sent.lastAirdropAt, '2026-06-11T15:00:00.000Z');
  assert.equal(isAirdropDue(sent, 300_000, new Date('2026-06-11T15:04:59Z')), false);
  assert.equal(isAirdropDue(sent, 300_000, new Date('2026-06-11T15:05:00Z')), true);
});

test('normalizeState preserves older daily spend state while adding airdrop fields', () => {
  const state = normalizeState({ dailySpend: { '2026-06-11': 123 } });

  assert.deepEqual(state.dailySpend, { '2026-06-11': 123 });
  assert.equal(state.pendingAirdropRawAmount, 0);
  assert.equal(state.lastAirdropAt, '');
});
