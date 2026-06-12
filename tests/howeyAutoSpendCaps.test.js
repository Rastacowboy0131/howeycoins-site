const test = require('node:test');
const assert = require('node:assert/strict');
const { PublicKey } = require('@solana/web3.js');

const { getBuybackLamportsLeavingGas } = require('../scripts/howey-auto');

const wallet = { publicKey: new PublicKey('3sz9FEtPcRgpsvNX8F1hGAbMaeC8pZ6NR12ENsfdXYn5') };

function connectionWithBalance(lamports) {
  return {
    getBalance: async (publicKey, commitment) => {
      assert.equal(publicKey.toBase58(), wallet.publicKey.toBase58());
      assert.equal(commitment, 'confirmed');
      return lamports;
    },
  };
}

test('getBuybackLamportsLeavingGas caps a buyback by per-run spend limit', async () => {
  const lamports = await getBuybackLamportsLeavingGas({
    connection: connectionWithBalance(200_000_000),
    wallet,
    config: {
      gasReserveLamports: 50_000_000,
      buybackShare: 1,
      maxLamportsPerRun: 25_000_000,
      maxLamportsPerDay: 0,
    },
    state: { dailySpend: {} },
    now: new Date('2026-06-12T12:00:00Z'),
  });

  assert.equal(lamports, 25_000_000);
});

test('getBuybackLamportsLeavingGas caps a buyback by remaining daily spend limit', async () => {
  const lamports = await getBuybackLamportsLeavingGas({
    connection: connectionWithBalance(200_000_000),
    wallet,
    config: {
      gasReserveLamports: 50_000_000,
      buybackShare: 1,
      maxLamportsPerRun: 0,
      maxLamportsPerDay: 100_000_000,
    },
    state: { dailySpend: { '2026-06-12': 80_000_000 } },
    now: new Date('2026-06-12T12:00:00Z'),
  });

  assert.equal(lamports, 20_000_000);
});
