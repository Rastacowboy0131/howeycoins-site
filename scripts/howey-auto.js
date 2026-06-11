#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

// Reuse the local claim app .env if this repo does not have one yet.
const fallbackClaimEnv = '/Users/rasta/Desktop/pumpswap-claimer/.env';
if (fs.existsSync(fallbackClaimEnv)) {
  require('dotenv').config({ path: fallbackClaimEnv, override: false });
}

const bs58 = require('bs58').default;
const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} = require('@solana/spl-token');
const { OnlinePumpSdk } = require('@pump-fun/pump-sdk');

const { buildAutomationConfig, shouldRunAutomation, LAMPORTS_PER_SOL } = require('../src/howeyAutoConfig');
const { applyDailySpend, remainingDailyLamports } = require('../src/howeyAutoState');
const { classifyHolders, getBatchSize, snapshotHash } = require('../src/howeyEngine');

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

function log(message, data) {
  const suffix = data === undefined ? '' : ` ${JSON.stringify(data)}`;
  console.log(`[howey-auto] ${message}${suffix}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lamportsToSol(lamports) {
  return Number(lamports || 0) / LAMPORTS_PER_SOL;
}

function loadWallet(privateKey) {
  const trimmed = String(privateKey || '').trim();
  if (trimmed.startsWith('[')) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed)));
  }
  return Keypair.fromSecretKey(bs58.decode(trimmed));
}

async function claimCreatorFees({ connection, wallet, config }) {
  const sdk = new OnlinePumpSdk(connection);
  const creator = wallet.publicKey;
  const claimable = await sdk.getCreatorVaultBalanceBothPrograms(creator);
  const claimableLamports = typeof claimable === 'bigint' ? Number(claimable) : Number(claimable);

  if (claimableLamports < config.minClaimLamports) {
    return { status: 'skipped-low-claimable', claimableLamports, signature: '' };
  }

  const instructions = await sdk.collectCoinCreatorFeeInstructions(creator);
  if (!instructions?.length) {
    return { status: 'skipped-no-instructions', claimableLamports, signature: '' };
  }

  const tx = new Transaction().add(...instructions);
  const signature = await sendAndConfirmTransaction(connection, tx, [wallet], { commitment: 'confirmed' });
  return { status: 'claimed', claimableLamports, signature };
}

async function getMintSupply(connection, mint) {
  const supply = await connection.getTokenSupply(new PublicKey(mint), 'confirmed');
  return Number(supply.value.amount);
}

async function fetchHolders(connection, mint) {
  const mintKey = new PublicKey(mint);
  const accounts = await connection.getParsedProgramAccounts(TOKEN_PROGRAM_ID, {
    commitment: 'confirmed',
    filters: [
      { dataSize: 165 },
      { memcmp: { offset: 0, bytes: mintKey.toBase58() } },
    ],
  });

  const balances = new Map();
  for (const account of accounts) {
    const info = account.account.data.parsed?.info;
    const owner = info?.owner;
    const amount = Number(info?.tokenAmount?.amount || 0);
    if (!owner || amount <= 0) continue;
    balances.set(owner, (balances.get(owner) || 0) + amount);
  }

  return [...balances.entries()].map(([address, balance]) => ({ address, balance }));
}

function pickWeightedWinners(eligible, count, seed) {
  const crypto = require('node:crypto');
  const pool = [...eligible];
  const winners = [];

  for (let i = 0; i < count && pool.length; i += 1) {
    const totalWeight = pool.reduce((sum, holder) => sum + holder.weight, 0);
    const hex = crypto.createHash('sha256').update(`${seed}|${i}|${pool.map((h) => h.address).join(',')}`).digest('hex').slice(0, 13);
    let cursor = (parseInt(hex, 16) / 0x1fffffffffffff) * totalWeight;
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

function allocateAirdrops(winners, totalRawAmount) {
  if (!winners.length || totalRawAmount <= 0) return [];
  const totalWeight = winners.reduce((sum, holder) => sum + holder.weight, 0);
  let distributed = 0;

  return winners.map((winner, index) => {
    const amount = index === winners.length - 1
      ? Math.max(0, totalRawAmount - distributed)
      : Math.max(1, Math.floor((totalRawAmount * winner.weight) / totalWeight));
    distributed += amount;
    return { ...winner, amount, signature: '', receiptStatus: 'pending-send' };
  });
}

async function getOwnerTokenBalanceRaw(connection, owner, mint) {
  const response = await connection.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) }, 'confirmed');
  return response.value.reduce((sum, item) => {
    const amount = Number(item.account.data.parsed?.info?.tokenAmount?.amount || 0);
    return sum + amount;
  }, 0);
}

async function buyBackWithJupiter({ connection, wallet, config, lamports }) {
  if (lamports < config.minBuybackLamports) {
    return { status: 'skipped-low-buyback', inputLamports: lamports, outputRawAmount: 0, signature: '' };
  }

  const quoteUrl = new URL(`${config.jupiterQuoteApi}/quote`);
  quoteUrl.searchParams.set('inputMint', WSOL_MINT);
  quoteUrl.searchParams.set('outputMint', config.mint);
  quoteUrl.searchParams.set('amount', String(lamports));
  quoteUrl.searchParams.set('slippageBps', String(config.slippageBps));
  quoteUrl.searchParams.set('onlyDirectRoutes', 'false');

  const quoteResponse = await fetch(quoteUrl);
  if (!quoteResponse.ok) {
    throw new Error(`Jupiter quote failed: ${quoteResponse.status} ${await quoteResponse.text()}`);
  }
  const quote = await quoteResponse.json();

  const swapResponse = await fetch(`${config.jupiterQuoteApi}/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
  });
  if (!swapResponse.ok) {
    throw new Error(`Jupiter swap failed: ${swapResponse.status} ${await swapResponse.text()}`);
  }
  const swap = await swapResponse.json();
  const tx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, 'base64'));
  tx.sign([wallet]);

  const before = await getOwnerTokenBalanceRaw(connection, wallet.publicKey, config.mint);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction(signature, 'confirmed');
  const after = await getOwnerTokenBalanceRaw(connection, wallet.publicKey, config.mint);

  return {
    status: 'bought-back',
    inputLamports: lamports,
    outputRawAmount: Math.max(0, after - before),
    signature,
    quoteOutAmount: Number(quote.outAmount || 0),
    routePlan: quote.routePlan || [],
  };
}

async function sendAirdrops({ connection, wallet, config, winners }) {
  const mint = new PublicKey(config.mint);
  const sourceAta = getAssociatedTokenAddressSync(mint, wallet.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const receipts = [];

  for (const winner of winners) {
    const recipient = new PublicKey(winner.address);
    const destinationAta = getAssociatedTokenAddressSync(mint, recipient, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const tx = new Transaction();
    const destinationInfo = await connection.getAccountInfo(destinationAta, 'confirmed');
    if (!destinationInfo) {
      tx.add(createAssociatedTokenAccountInstruction(wallet.publicKey, destinationAta, recipient, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
    }
    tx.add(createTransferInstruction(sourceAta, destinationAta, wallet.publicKey, BigInt(winner.amount), [], TOKEN_PROGRAM_ID));
    const signature = await sendAndConfirmTransaction(connection, tx, [wallet], { commitment: 'confirmed' });
    receipts.push({ ...winner, signature, receiptStatus: 'sent' });
  }

  return receipts;
}

function makeRunId(date = new Date()) {
  return `HOWEY-${date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
}

async function writeReceipt(config, receipt) {
  const runPath = path.join(process.cwd(), config.receiptDir, `${receipt.runId}.json`);
  const latestPath = path.join(process.cwd(), config.latestReceiptPath);
  fs.mkdirSync(path.dirname(runPath), { recursive: true });
  fs.mkdirSync(path.dirname(latestPath), { recursive: true });
  fs.writeFileSync(runPath, `${JSON.stringify(receipt, null, 2)}\n`);
  fs.writeFileSync(latestPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { runPath, latestPath };
}

function readState(config) {
  const statePath = path.join(process.cwd(), config.statePath);
  if (!fs.existsSync(statePath)) return { dailySpend: {} };
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function writeState(config, state) {
  const statePath = path.join(process.cwd(), config.statePath);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function runOnce({ connection, wallet, config }) {
  const started = new Date();
  const runId = makeRunId(started);
  log('run-start', { runId, wallet: wallet.publicKey.toBase58(), mint: config.mint });

  const state = readState(config);
  const remainingToday = remainingDailyLamports(state, config.maxLamportsPerDay, started);
  if (remainingToday < config.minBuybackLamports) {
    const receipt = {
      mode: 'fully-auto',
      runId,
      timestamp: started.toISOString(),
      mint: config.mint,
      claim: { status: 'skipped-daily-cap', claimableLamports: 0, signature: '' },
      buyback: { status: 'skipped-daily-cap', inputLamports: 0, signature: '', outputRawAmount: 0 },
      snapshot: null,
      airdrop: { status: 'skipped', winners: [] },
      limits: { remainingDailySol: lamportsToSol(remainingToday), maxSolPerDay: config.maxSolPerDay },
    };
    await writeReceipt(config, receipt);
    log('daily-cap-reached', { remainingDailySol: lamportsToSol(remainingToday), maxSolPerDay: config.maxSolPerDay });
    return receipt;
  }

  const claim = await claimCreatorFees({ connection, wallet, config });
  log('claim-result', { status: claim.status, claimableSol: lamportsToSol(claim.claimableLamports), signature: claim.signature });

  const buybackLamports = Math.min(
    Math.floor(claim.claimableLamports * config.buybackShare),
    config.maxLamportsPerRun,
    remainingToday,
  );

  if (claim.status !== 'claimed' || buybackLamports < config.minBuybackLamports) {
    const receipt = {
      mode: 'fully-auto',
      runId,
      timestamp: started.toISOString(),
      mint: config.mint,
      claim,
      buyback: { status: 'skipped', inputLamports: buybackLamports, signature: '', outputRawAmount: 0 },
      snapshot: null,
      airdrop: { status: 'skipped', winners: [] },
    };
    await writeReceipt(config, receipt);
    return receipt;
  }

  const buyback = await buyBackWithJupiter({ connection, wallet, config, lamports: buybackLamports });
  const updatedState = applyDailySpend(state, buyback.inputLamports || 0, started);
  writeState(config, updatedState);
  log('buyback-result', { status: buyback.status, inputSol: lamportsToSol(buyback.inputLamports), outputRawAmount: buyback.outputRawAmount, signature: buyback.signature });

  const [holders, totalSupply] = await Promise.all([
    fetchHolders(connection, config.mint),
    getMintSupply(connection, config.mint),
  ]);
  const holderConfig = { totalSupply, maxWalletShare: config.maxWalletShare, excludedWallets: config.excludedWallets };
  const classified = classifyHolders(holders, holderConfig);
  const batchSize = getBatchSize(classified.eligible.length);
  const winners = pickWeightedWinners(classified.eligible, batchSize, `${runId}|${buyback.signature}`);
  const plannedAirdrops = allocateAirdrops(winners, buyback.outputRawAmount);
  const sentAirdrops = await sendAirdrops({ connection, wallet, config, winners: plannedAirdrops });

  const receipt = {
    mode: 'fully-auto',
    runId,
    timestamp: started.toISOString(),
    mint: config.mint,
    claim: { status: claim.status, claimedFeesSol: lamportsToSol(claim.claimableLamports), claimTx: claim.signature },
    buyback: {
      status: buyback.status,
      buybackSol: lamportsToSol(buyback.inputLamports),
      estimatedTokensBought: buyback.outputRawAmount,
      swapTx: buyback.signature,
      route: 'Jupiter quote/swap; verify routePlan for PumpSwap liquidity',
    },
    snapshot: {
      hash: snapshotHash(holders, config.mint),
      slot: await connection.getSlot('confirmed'),
      totalSupply,
      holderCount: holders.length,
      eligibleHolderCount: classified.eligible.length,
      excludedWalletCount: Object.values(classified.excludedByReason).reduce((sum, list) => sum + list.length, 0),
      excludedByReason: classified.excludedByReason,
    },
    airdrop: {
      status: 'sent',
      batchSize,
      totalTokensAirdropped: sentAirdrops.reduce((sum, winner) => sum + winner.amount, 0),
      winners: sentAirdrops,
    },
  };
  await writeReceipt(config, receipt);
  log('run-complete', { runId, winners: sentAirdrops.length });
  return receipt;
}

async function main() {
  const config = buildAutomationConfig(process.env);
  const readiness = shouldRunAutomation(config);
  if (!readiness.ok) {
    console.error('[howey-auto] Refusing to run live automation. Missing:', readiness.missing.join(', '));
    console.error('[howey-auto] This script spends SOL/tokens. Set ENABLE_REAL_TX=true and FULLY_AUTO=true only when ready.');
    process.exit(1);
  }

  const wallet = loadWallet(config.privateKey);
  if (config.devPublicKey && wallet.publicKey.toBase58() !== config.devPublicKey) {
    throw new Error(`PRIVATE_KEY wallet ${wallet.publicKey.toBase58()} does not match DEV_PUBLIC_KEY ${config.devPublicKey}`);
  }

  const connection = new Connection(config.rpcUrl, 'confirmed');
  log('started', {
    wallet: wallet.publicKey.toBase58(),
    mint: config.mint,
    intervalMs: config.intervalMs,
    maxSolPerRun: config.maxSolPerRun,
    maxSolPerDay: config.maxSolPerDay,
    excludedWallets: config.excludedWallets.length,
  });

  do {
    try {
      await runOnce({ connection, wallet, config });
    } catch (error) {
      console.error(`[howey-auto] run failed: ${error.stack || error.message}`);
    }
    if (config.loopOnce) break;
    await sleep(config.intervalMs);
  } while (true);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[howey-auto] fatal: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  allocateAirdrops,
  fetchHolders,
  runOnce,
};
