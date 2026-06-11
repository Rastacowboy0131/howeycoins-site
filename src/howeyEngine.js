const crypto = require('node:crypto');

function round(value, decimals = 9) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function calculateFeeSplit(claimedFeesSol, config) {
  const totalSol = round(Number(claimedFeesSol || 0));
  if (totalSol <= 0) {
    return { totalSol: 0, buybackSol: 0, reserveSol: 0, opsSol: 0 };
  }

  const buybackShare = Number(config.buybackShare ?? 0.85);
  const reserveShare = Number(config.reserveShare ?? 0.1);
  const reserveSol = round(totalSol * reserveShare);
  const buybackSol = round(totalSol * buybackShare);
  const opsSol = round(totalSol - buybackSol - reserveSol);

  return { totalSol, buybackSol, reserveSol, opsSol };
}

function classifyHolders(holders, config) {
  const totalSupply = Number(config.totalSupply || 0);
  const maxWalletShare = Number(config.maxWalletShare ?? 0.03);
  const excludedWallets = new Set((config.excludedWallets || []).map((address) => address.toLowerCase()));
  const excludedByReason = {
    excludedWallet: [],
    overMaxWalletShare: [],
    emptyBalance: [],
  };
  const eligible = [];

  for (const holder of holders || []) {
    const address = String(holder.address || '').trim();
    const balance = Number(holder.balance || 0);
    const enriched = {
      address,
      balance,
      share: totalSupply > 0 ? balance / totalSupply : 0,
      weight: Math.sqrt(Math.max(balance, 0)),
    };

    if (!address || balance <= 0) {
      excludedByReason.emptyBalance.push(enriched);
      continue;
    }

    if (excludedWallets.has(address.toLowerCase())) {
      excludedByReason.excludedWallet.push(enriched);
      continue;
    }

    if (totalSupply > 0 && enriched.share > maxWalletShare) {
      excludedByReason.overMaxWalletShare.push(enriched);
      continue;
    }

    eligible.push(enriched);
  }

  eligible.sort((a, b) => b.balance - a.balance || a.address.localeCompare(b.address));

  return { eligible, excludedByReason };
}

function getBatchSize(eligibleHolderCount) {
  if (eligibleHolderCount <= 0) return 0;
  if (eligibleHolderCount < 500) return Math.min(5, eligibleHolderCount);
  if (eligibleHolderCount <= 2_000) return Math.min(10, eligibleHolderCount);
  if (eligibleHolderCount <= 10_000) return Math.min(25, eligibleHolderCount);
  return Math.min(50, eligibleHolderCount);
}

function snapshotHash(holders, mint) {
  const normalized = (holders || [])
    .map((holder) => ({ address: String(holder.address || ''), balance: Number(holder.balance || 0) }))
    .sort((a, b) => a.address.localeCompare(b.address))
    .map((holder) => `${holder.address}:${holder.balance}`)
    .join('|');

  return crypto.createHash('sha256').update(`${mint || ''}|${normalized}`).digest('hex');
}

function seedToUnit(seed, roundIndex, address) {
  const hex = crypto
    .createHash('sha256')
    .update(`${seed}|${roundIndex}|${address}`)
    .digest('hex')
    .slice(0, 13);
  return parseInt(hex, 16) / 0x1fffffffffffff;
}

function pickWeightedWinners(eligible, count, seed) {
  const pool = [...eligible];
  const winners = [];

  for (let i = 0; i < count && pool.length; i += 1) {
    const totalWeight = pool.reduce((sum, holder) => sum + holder.weight, 0);
    let cursor = seedToUnit(seed, i, pool.map((holder) => holder.address).join(',')) * totalWeight;
    let selectedIndex = pool.length - 1;

    for (let j = 0; j < pool.length; j += 1) {
      cursor -= pool[j].weight;
      if (cursor <= 0) {
        selectedIndex = j;
        break;
      }
    }

    winners.push(pool.splice(selectedIndex, 1)[0]);
  }

  return winners;
}

function allocateTokens(winners, totalTokens) {
  if (!winners.length || totalTokens <= 0) return [];
  const totalWeight = winners.reduce((sum, holder) => sum + holder.weight, 0);
  let distributed = 0;

  return winners.map((winner, index) => {
    const isLast = index === winners.length - 1;
    const amount = isLast
      ? Math.max(0, totalTokens - distributed)
      : Math.max(1, Math.floor((totalTokens * winner.weight) / totalWeight));
    distributed += amount;

    return {
      address: winner.address,
      balance: winner.balance,
      holderShare: round(winner.share, 8),
      weight: round(winner.weight, 6),
      amount,
      signature: '',
      receiptStatus: 'queued-for-manual-send',
    };
  });
}

function planHoweyRun({
  runId,
  timestamp,
  claimedFeesSol,
  claimTx = '',
  holders,
  config,
  seed = '',
}) {
  const split = calculateFeeSplit(claimedFeesSol, config);
  const holderResult = classifyHolders(holders, config);
  const batchSize = getBatchSize(holderResult.eligible.length);
  const estimatedTokensBought = Math.floor(split.buybackSol / Number(config.tokenPriceSol || 1));
  const winners = pickWeightedWinners(holderResult.eligible, batchSize, seed || `${runId}|${timestamp}`);
  const airdrops = allocateTokens(winners, estimatedTokensBought);
  const excludedWalletCount = Object.values(holderResult.excludedByReason).reduce(
    (sum, list) => sum + list.length,
    0,
  );

  return {
    mode: 'dry-run',
    runId,
    timestamp,
    mint: config.mint,
    claim: {
      claimedFeesSol: split.totalSol,
      claimTx,
      status: claimTx ? 'claimed' : 'claim-needed',
    },
    split,
    buyback: {
      buybackSol: split.buybackSol,
      route: 'PumpSwap/Jupiter route required after launch',
      estimatedTokensBought,
      swapTx: '',
      status: 'manual-swap-required',
    },
    snapshot: {
      hash: snapshotHash(holders, config.mint),
      eligibleHolderCount: holderResult.eligible.length,
      excludedWalletCount,
      excludedByReason: holderResult.excludedByReason,
    },
    airdrop: {
      batchSize,
      totalTokensAirdropped: airdrops.reduce((sum, winner) => sum + winner.amount, 0),
      winners: airdrops,
      status: 'manual-send-required',
    },
  };
}

module.exports = {
  calculateFeeSplit,
  classifyHolders,
  getBatchSize,
  planHoweyRun,
  snapshotHash,
};
