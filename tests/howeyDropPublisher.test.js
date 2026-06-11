const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadSocialState,
  publishDropReceipt,
} = require('../src/howeyDropPublisher');

const receipt = {
  runId: 'HOWEY-POST-1',
  claim: { claimedFeesSol: 0.25, claimTx: 'claimSig' },
  buyback: { buybackSol: 0.15, estimatedTokensBought: 5000000, swapTx: 'swapSig' },
  airdrop: {
    status: 'sent',
    totalTokensAirdropped: 5000000,
    winners: [{ address: 'Winner111111111111111111111111111111111111', amount: 5000000, signature: 'airdropSig' }],
  },
};

test('publishDropReceipt skips when POST_TO_X is off', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'howey-social-'));
  let called = false;

  const result = await publishDropReceipt(receipt, {
    postToX: false,
    socialStatePath: path.join(dir, 'state.json'),
    postFn: async () => { called = true; },
  });

  assert.equal(result.status, 'skipped-disabled-or-no-airdrop');
  assert.equal(called, false);
});

test('publishDropReceipt dry run writes a preview and marks the run posted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'howey-social-'));
  const previewPath = path.join(dir, 'preview.json');
  const statePath = path.join(dir, 'state.json');

  const result = await publishDropReceipt(receipt, {
    postToX: true,
    xDryRun: true,
    siteUrl: 'https://howeycoins.org',
    socialStatePath: statePath,
    xDryRunPath: previewPath,
    renderCardPng: async () => path.join(dir, 'card.png'),
  });

  assert.equal(result.status, 'dry-run');
  assert.ok(fs.existsSync(previewPath));
  const preview = JSON.parse(fs.readFileSync(previewPath, 'utf8'));
  assert.match(preview.text, /HOWEY HOLDER DROP/);
  assert.equal(preview.cardPath.endsWith('card.png'), true);
  assert.deepEqual(loadSocialState(statePath).postedRunIds, ['HOWEY-POST-1']);
});

test('publishDropReceipt does not post the same run twice', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'howey-social-'));
  const statePath = path.join(dir, 'state.json');
  let calls = 0;
  const config = {
    postToX: true,
    xDryRun: false,
    socialStatePath: statePath,
    renderCardPng: async () => path.join(dir, 'card.png'),
    postFn: async () => {
      calls += 1;
      return { id: 'tweet-1' };
    },
  };

  const first = await publishDropReceipt(receipt, config);
  const second = await publishDropReceipt(receipt, config);

  assert.equal(first.status, 'posted');
  assert.equal(second.status, 'skipped-already-posted');
  assert.equal(calls, 1);
});
