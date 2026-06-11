const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDropPostText,
  buildDropCardSvg,
  shouldPostDropReceipt,
  shortAddress,
  solscanTxUrl,
} = require('../src/howeySocial');

const receipt = {
  runId: 'HOWEY-20260611183023',
  timestamp: '2026-06-11T18:30:23.000Z',
  mint: 'G3Q6iQ4xMG3vH9SyKSkupvEeeKiRLvvmCqAQ9iyGpump',
  claim: {
    status: 'claimed',
    claimedFeesSol: 0.421337,
    claimTx: 'claimSig111111111111111111111111111111111111111111111111111111111111',
  },
  buyback: {
    status: 'bought-back',
    buybackSol: 0.321337,
    estimatedTokensBought: 12450000,
    swapTx: 'swapSig111111111111111111111111111111111111111111111111111111111111',
  },
  airdrop: {
    status: 'sent',
    totalTokensAirdropped: 12450000,
    winners: [
      {
        address: '7xQabcdefabcdefabcdefabcdefabcdefabcdefp91',
        amount: 3100000,
        signature: 'airdropSig111111111111111111111111111111111111111111111111111111111111',
        receiptStatus: 'sent',
      },
      {
        address: 'Bk2abcdefabcdefabcdefabcdefabcdefabcdefLx8',
        amount: 9350000,
        signature: 'airdropSig222222222222222222222222222222222222222222222222222222222222',
        receiptStatus: 'sent',
      },
    ],
  },
};

test('shortAddress keeps a readable head and tail', () => {
  assert.equal(shortAddress('7xQabcdefabcdefabcdefabcdefabcdefabcdefp91'), '7xQabc...defp91');
});

test('solscanTxUrl links to Solscan transactions', () => {
  assert.equal(
    solscanTxUrl('abc123'),
    'https://solscan.io/tx/abc123',
  );
});

test('shouldPostDropReceipt only allows sent airdrops with winners and POST_TO_X enabled', () => {
  assert.equal(shouldPostDropReceipt(receipt, { postToX: true }), true);
  assert.equal(shouldPostDropReceipt(receipt, { postToX: false }), false);
  assert.equal(shouldPostDropReceipt({ ...receipt, airdrop: { status: 'queued', winners: [] } }, { postToX: true }), false);
});

test('buildDropPostText summarizes fees, buyback, winners, and Solscan links', () => {
  const text = buildDropPostText(receipt, { siteUrl: 'https://howeycoins.org' });

  assert.match(text, /HOWEY HOLDER DROP/);
  assert.match(text, /Creator fees claimed: 0\.421 SOL/);
  assert.match(text, /Buyback: 0\.321 SOL/);
  assert.match(text, /Bought: 12,450,000 HOWEY/);
  assert.match(text, /7xQabc\.\.\.defp91/);
  assert.match(text, /https:\/\/solscan\.io\/tx\/airdropSig111/);
  assert.match(text, /Full receipt: https:\/\/howeycoins\.org/);
  assert.ok(text.length <= 280);
});

test('buildDropCardSvg creates a branded receipt card with escaped values', () => {
  const svg = buildDropCardSvg(receipt, { siteUrl: 'https://howeycoins.org?a=<bad>' });

  assert.match(svg, /^<svg /);
  assert.match(svg, /HOWEYCOINS HOLDER DROP/);
  assert.match(svg, /0\.421 SOL/);
  assert.match(svg, /12,450,000 HOWEY/);
  assert.match(svg, /2 HOLDERS/);
  assert.doesNotMatch(svg, /<bad>/);
  assert.match(svg, /&lt;bad&gt;/);
});
