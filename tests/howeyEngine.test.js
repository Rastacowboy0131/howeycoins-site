const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateFeeSplit,
  classifyHolders,
  getBatchSize,
  planHoweyRun,
  snapshotHash,
} = require('../src/howeyEngine');

const baseConfig = {
  mint: 'G3Q6iQ4xMG3vH9SyKSkupvEeeKiRLvvmCqAQ9iyGpump',
  totalSupply: 1_000_000_000,
  buybackShare: 0.85,
  reserveShare: 0.1,
  opsShare: 0.05,
  maxWalletShare: 0.03,
  tokenPriceSol: 0.000000025,
  excludedWallets: ['DEVWALLET111111111111111111111111111111111', 'OPS11111111111111111111111111111111111111'],
};

const holders = [
  { address: 'DEVWALLET111111111111111111111111111111111', balance: 22_000_000 },
  { address: 'OPS11111111111111111111111111111111111111', balance: 9_000_000 },
  { address: 'WHALE1111111111111111111111111111111111111', balance: 45_000_000 },
  { address: 'HOLDER_A11111111111111111111111111111111111', balance: 25_000_000 },
  { address: 'HOLDER_B22222222222222222222222222222222222', balance: 10_000_000 },
  { address: 'HOLDER_C33333333333333333333333333333333333', balance: 2_500_000 },
  { address: 'HOLDER_D44444444444444444444444444444444444', balance: 500_000 },
  { address: 'DUST5555555555555555555555555555555555555', balance: 0 },
];

test('calculateFeeSplit routes claimed fees into buyback, reserve, and ops budgets', () => {
  const split = calculateFeeSplit(4, baseConfig);

  assert.equal(split.buybackSol, 3.4);
  assert.equal(split.reserveSol, 0.4);
  assert.equal(split.opsSol, 0.2);
  assert.equal(split.totalSol, 4);
});

test('classifyHolders skips excluded wallets, zero balances, and wallets above 3 percent supply', () => {
  const result = classifyHolders(holders, baseConfig);

  assert.deepEqual(result.eligible.map((holder) => holder.address), [
    'HOLDER_A11111111111111111111111111111111111',
    'HOLDER_B22222222222222222222222222222222222',
    'HOLDER_C33333333333333333333333333333333333',
    'HOLDER_D44444444444444444444444444444444444',
  ]);
  assert.equal(result.excludedByReason.excludedWallet.length, 2);
  assert.equal(result.excludedByReason.overMaxWalletShare.length, 1);
  assert.equal(result.excludedByReason.emptyBalance.length, 1);
});

test('getBatchSize scales winners by eligible holder count with a 50 wallet cap', () => {
  assert.equal(getBatchSize(25), 5);
  assert.equal(getBatchSize(700), 10);
  assert.equal(getBatchSize(5_000), 25);
  assert.equal(getBatchSize(25_000), 50);
});

test('snapshotHash is stable regardless of input holder ordering', () => {
  const first = snapshotHash(holders, baseConfig.mint);
  const second = snapshotHash([...holders].reverse(), baseConfig.mint);

  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('planHoweyRun creates a dry-run receipt with deterministic winners and per-wallet airdrops', () => {
  const plan = planHoweyRun({
    runId: 'HOWEY-0001',
    timestamp: '2026-06-11T16:20:00.000Z',
    claimedFeesSol: 4,
    claimTx: 'CLAIM_SIGNATURE_123',
    holders,
    config: baseConfig,
    seed: 'howey-test-seed',
  });

  assert.equal(plan.mode, 'dry-run');
  assert.equal(plan.runId, 'HOWEY-0001');
  assert.equal(plan.claim.claimedFeesSol, 4);
  assert.equal(plan.claim.claimTx, 'CLAIM_SIGNATURE_123');
  assert.equal(plan.buyback.buybackSol, 3.4);
  assert.equal(plan.buyback.estimatedTokensBought, 136_000_000);
  assert.equal(plan.snapshot.eligibleHolderCount, 4);
  assert.equal(plan.snapshot.excludedWalletCount, 4);
  assert.equal(plan.airdrop.winners.length, 4);
  assert.equal(plan.airdrop.totalTokensAirdropped, 136_000_000);
  assert.ok(plan.airdrop.winners.every((winner) => winner.amount > 0));
  assert.deepEqual(
    plan.airdrop.winners.map((winner) => winner.address),
    planHoweyRun({
      runId: 'HOWEY-0001',
      timestamp: '2026-06-11T16:20:00.000Z',
      claimedFeesSol: 4,
      claimTx: 'CLAIM_SIGNATURE_123',
      holders,
      config: baseConfig,
      seed: 'howey-test-seed',
    }).airdrop.winners.map((winner) => winner.address),
  );
});
