const LAMPORTS_PER_SOL = 1_000_000_000;

function parseBool(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toLamports(sol) {
  const value = Number(sol || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value * LAMPORTS_PER_SOL);
}

function parseAddressList(value) {
  return String(value || '')
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function unique(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = String(value).toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function buildAutomationConfig(env = process.env) {
  const devPublicKey = env.DEV_PUBLIC_KEY || env.OPS_PUBLIC_KEY || 'Ehr92fYMp2DmzavJCCY4wfGnYLasucDPBnodqjL2agWz';
  const opsPublicKey = env.OPS_PUBLIC_KEY || devPublicKey;
  const airdropPublicKey = env.AIRDROP_PUBLIC_KEY || opsPublicKey;
  const lpPoolWallets = parseAddressList(env.LP_POOL_WALLETS || env.POOL_WALLETS || '');
  const manuallyExcluded = parseAddressList(env.EXCLUDED_WALLETS || '');
  const excludedWallets = unique([
    devPublicKey,
    opsPublicKey,
    airdropPublicKey,
    ...lpPoolWallets,
    ...manuallyExcluded,
  ]);

  return {
    rpcUrl: env.RPC_URL || env.HELIUS_RPC_URL || '',
    privateKey: env.PRIVATE_KEY || '',
    mint: env.HOWEYCOINS_MINT || 'G3Q6iQ4xMG3vH9SyKSkupvEeeKiRLvvmCqAQ9iyGpump',
    devPublicKey,
    opsPublicKey,
    airdropPublicKey,
    lpPoolWallets,
    excludedWallets,
    enableRealTx: parseBool(env.ENABLE_REAL_TX),
    fullyAuto: parseBool(env.FULLY_AUTO),
    dryRun: !parseBool(env.ENABLE_REAL_TX),
    intervalMs: Math.max(30_000, parseNumber(env.INTERVAL_MS, 300_000)),
    minClaimLamports: toLamports(env.MIN_CLAIM_SOL || '0.01'),
    minBuybackLamports: toLamports(env.MIN_BUYBACK_SOL || env.MIN_CLAIM_SOL || '0.01'),
    maxSolPerRun: parseNumber(env.MAX_SOL_PER_RUN, 0.25),
    maxSolPerDay: parseNumber(env.MAX_SOL_PER_DAY, 2),
    maxLamportsPerRun: toLamports(env.MAX_SOL_PER_RUN || '0.25'),
    maxLamportsPerDay: toLamports(env.MAX_SOL_PER_DAY || '2'),
    buybackShare: parseNumber(env.BUYBACK_SHARE, 0.85),
    reserveShare: parseNumber(env.RESERVE_SHARE, 0.1),
    opsShare: parseNumber(env.OPS_SHARE, 0.05),
    maxWalletShare: parseNumber(env.MAX_WALLET_SHARE, 0.03),
    slippageBps: Math.trunc(parseNumber(env.SLIPPAGE_BPS, 500)),
    loopOnce: parseBool(env.LOOP_ONCE),
    jupiterQuoteApi: env.JUPITER_QUOTE_API || 'https://quote-api.jup.ag/v6',
    totalSupply: parseNumber(env.TOTAL_SUPPLY, 1_000_000_000),
    receiptDir: env.RECEIPT_DIR || 'data/runs',
    latestReceiptPath: env.LATEST_RECEIPT_PATH || 'data/latest.json',
    statePath: env.STATE_PATH || 'data/howey-auto-state.json',
  };
}

function shouldRunAutomation(config) {
  const missing = [];
  if (!config.rpcUrl) missing.push('RPC_URL or HELIUS_RPC_URL');
  if (!config.privateKey) missing.push('PRIVATE_KEY');
  if (!config.mint) missing.push('HOWEYCOINS_MINT');
  if (!config.devPublicKey) missing.push('DEV_PUBLIC_KEY');
  if (!config.enableRealTx) missing.push('ENABLE_REAL_TX=true');
  if (!config.fullyAuto) missing.push('FULLY_AUTO=true');
  if (!config.maxLamportsPerRun) missing.push('MAX_SOL_PER_RUN');
  if (!config.maxLamportsPerDay) missing.push('MAX_SOL_PER_DAY');

  return {
    ok: missing.length === 0,
    missing,
  };
}

module.exports = {
  LAMPORTS_PER_SOL,
  buildAutomationConfig,
  parseAddressList,
  shouldRunAutomation,
  toLamports,
};
