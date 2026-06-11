const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAutomationConfig,
  parseAddressList,
  shouldRunAutomation,
  toLamports,
} = require('../src/howeyAutoConfig');

test('parseAddressList merges comma and newline separated wallets with blanks removed', () => {
  assert.deepEqual(parseAddressList('dev111, pool222\n\n pool333 ,'), ['dev111', 'pool222', 'pool333']);
});

test('buildAutomationConfig treats dev wallet as ops and airdrop wallet by default and excludes it', () => {
  const config = buildAutomationConfig({
    RPC_URL: 'https://example-rpc.invalid',
    PRIVATE_KEY: 'fake-key-for-test',
    HOWEYCOINS_MINT: 'Mint111111111111111111111111111111111111111',
    DEV_PUBLIC_KEY: 'Dev1111111111111111111111111111111111111111',
    LP_POOL_WALLETS: 'Pool1111111111111111111111111111111111111,Pool2222222222222222222222222222222222222',
  });

  assert.equal(config.opsPublicKey, 'Dev1111111111111111111111111111111111111111');
  assert.equal(config.airdropPublicKey, 'Dev1111111111111111111111111111111111111111');
  assert.equal(config.enableRealTx, false);
  assert.equal(config.fullyAuto, false);
  assert.ok(config.excludedWallets.includes('Dev1111111111111111111111111111111111111111'));
  assert.ok(config.excludedWallets.includes('Pool1111111111111111111111111111111111111'));
});

test('buildAutomationConfig requires explicit real transaction and full auto flags before automation can run', () => {
  const baseEnv = {
    RPC_URL: 'https://example-rpc.invalid',
    PRIVATE_KEY: 'fake-key-for-test',
    HOWEYCOINS_MINT: 'Mint111111111111111111111111111111111111111',
    DEV_PUBLIC_KEY: 'Dev1111111111111111111111111111111111111111',
  };

  assert.equal(shouldRunAutomation(buildAutomationConfig(baseEnv)).ok, false);
  assert.equal(shouldRunAutomation(buildAutomationConfig({ ...baseEnv, ENABLE_REAL_TX: 'true' })).ok, false);

  const ready = shouldRunAutomation(buildAutomationConfig({
    ...baseEnv,
    ENABLE_REAL_TX: 'true',
    FULLY_AUTO: 'true',
    GAS_RESERVE_SOL: '0.1',
  }));

  assert.equal(ready.ok, true);
});

test('buildAutomationConfig defaults to claim/buyback every minute, airdrop every five minutes, and full buyback above gas reserve', () => {
  const config = buildAutomationConfig({});

  assert.equal(config.intervalMs, 60_000);
  assert.equal(config.airdropIntervalMs, 300_000);
  assert.equal(config.gasReserveLamports, 100_000_000);
  assert.equal(config.buybackShare, 1);
  assert.equal(config.maxLamportsPerRun, 0);
  assert.equal(config.maxLamportsPerDay, 0);
});

test('toLamports converts SOL strings into integer lamports', () => {
  assert.equal(toLamports('0.25'), 250_000_000);
  assert.equal(toLamports('1'), 1_000_000_000);
});
