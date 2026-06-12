const test = require('node:test');
const assert = require('node:assert/strict');
const { PublicKey } = require('@solana/web3.js');
const { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } = require('@solana/spl-token');

const { buildHolderAccountFilters, getTokenProgramIdForMint } = require('../scripts/howey-auto');

const mint = 'EoS9ryavC2ZX2XAfKn7dGDwbopFcrCQgVsj3GEs7eNFa';

test('getTokenProgramIdForMint returns Token-2022 owner for Token-2022 mints', async () => {
  const connection = {
    getAccountInfo: async (publicKey, commitment) => {
      assert.equal(publicKey.toBase58(), mint);
      assert.equal(commitment, 'confirmed');
      return { owner: TOKEN_2022_PROGRAM_ID };
    },
  };

  const programId = await getTokenProgramIdForMint(connection, mint);

  assert.equal(programId.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58());
});

test('getTokenProgramIdForMint keeps legacy SPL token mints on the legacy token program', async () => {
  const connection = {
    getAccountInfo: async () => ({ owner: TOKEN_PROGRAM_ID }),
  };

  const programId = await getTokenProgramIdForMint(connection, new PublicKey(mint));

  assert.equal(programId.toBase58(), TOKEN_PROGRAM_ID.toBase58());
});

test('buildHolderAccountFilters omits dataSize for Token-2022 holder scans', () => {
  assert.deepEqual(buildHolderAccountFilters(mint, TOKEN_PROGRAM_ID), [
    { dataSize: 165 },
    { memcmp: { offset: 0, bytes: mint } },
  ]);

  assert.deepEqual(buildHolderAccountFilters(mint, TOKEN_2022_PROGRAM_ID), [
    { memcmp: { offset: 0, bytes: mint } },
  ]);
});
