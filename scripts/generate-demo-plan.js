const fs = require('node:fs');
const path = require('node:path');
const { planHoweyRun } = require('../src/howeyEngine');

const config = {
  mint: 'G3Q6iQ4xMG3vH9SyKSkupvEeeKiRLvvmCqAQ9iyGpump',
  totalSupply: 1_000_000_000,
  buybackShare: 0.85,
  reserveShare: 0.1,
  opsShare: 0.05,
  maxWalletShare: 0.03,
  tokenPriceSol: 0.000000025,
  excludedWallets: [
    'Ehr92fYMp2DmzavJCCY4wfGnYLasucDPBnodqjL2agWz',
    'HOWEYOPS11111111111111111111111111111111111',
    'HOWEYBURN111111111111111111111111111111111',
  ],
};

const holders = [
  { address: 'Ehr92fYMp2DmzavJCCY4wfGnYLasucDPBnodqjL2agWz', balance: 18_500_000 },
  { address: 'HOWEYOPS11111111111111111111111111111111111', balance: 11_000_000 },
  { address: 'WhaleSkip1111111111111111111111111111111111', balance: 41_250_000 },
  { address: 'BeachBag11111111111111111111111111111111111', balance: 27_200_000 },
  { address: 'GreenFlag222222222222222222222222222222222', balance: 19_750_000 },
  { address: 'NotAnICO3333333333333333333333333333333333', balance: 14_100_000 },
  { address: 'HoweyEnjoyer4444444444444444444444444444444', balance: 7_700_000 },
  { address: 'PalmTree55555555555555555555555555555555555', balance: 4_250_000 },
  { address: 'CourtJester6666666666666666666666666666666', balance: 1_500_000 },
  { address: 'DustWallet77777777777777777777777777777777', balance: 0 },
];

const plan = planHoweyRun({
  runId: 'HOWEY-DRYRUN-0001',
  timestamp: '2026-06-11T16:20:00.000Z',
  claimedFeesSol: 4,
  claimTx: 'dry-run-claim-placeholder',
  holders,
  config,
  seed: 'howeycoins-public-demo',
});

const outputDir = path.join(__dirname, '..', 'fixtures');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'howey-run-demo.json'), `${JSON.stringify(plan, null, 2)}\n`);
console.log(`Wrote ${path.join(outputDir, 'howey-run-demo.json')}`);
