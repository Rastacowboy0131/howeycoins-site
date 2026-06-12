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
const BN = require('bn.js');
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
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} = require('@solana/spl-token');
const { OnlinePumpSdk, PumpSdk, getBuyTokenAmountFromSolAmount } = require('@pump-fun/pump-sdk');

const { buildAutomationConfig, shouldRunAutomation, LAMPORTS_PER_SOL, WSOL_MINT } = require('../src/howeyAutoConfig');
const { publishDropReceipt } = require('../src/howeyDropPublisher');
const {
  addPendingAirdrop,
  applyDailySpend,
  isAirdropDue,
  markAirdropSent,
  normalizeState,
  remainingDailyLamports,
} = require('../src/howeyAutoState');
const { classifyHolders, getBatchSize, snapshotHash } = require('../src/howeyEngine');


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

async function getTokenProgramIdForMint(connection, mint) {
  const mintKey = new PublicKey(mint);
  const account = await connection.getAccountInfo(mintKey, 'confirmed');
  if (!account) throw new Error(`Mint account not found: ${mintKey.toBase58()}`);

  if (account.owner.equals(TOKEN_PROGRAM_ID) || account.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return account.owner;
  }

  throw new Error(`Unsupported token program for ${mintKey.toBase58()}: ${account.owner.toBase58()}`);
}

function buildHolderAccountFilters(mint, tokenProgramId = TOKEN_PROGRAM_ID) {
  const mintKey = new PublicKey(mint);
  const filters = [{ memcmp: { offset: 0, bytes: mintKey.toBase58() } }];

  // Legacy SPL token accounts are fixed at 165 bytes. Token-2022 accounts may
  // include extensions and can be larger, so a dataSize filter hides real holders.
  if (tokenProgramId.equals(TOKEN_PROGRAM_ID)) {
    filters.unshift({ dataSize: 165 });
  }

  return filters;
}

async function fetchHolders(connection, mint, tokenProgramId = TOKEN_PROGRAM_ID) {
  const accounts = await connection.getParsedProgramAccounts(tokenProgramId, {
    commitment: 'confirmed',
    filters: buildHolderAccountFilters(mint, tokenProgramId),
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

async function getOwnerTokenBalanceRaw(connection, owner, mint, tokenProgramId = TOKEN_PROGRAM_ID) {
  const response = await connection.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint), programId: tokenProgramId }, 'confirmed');
  return response.value.reduce((sum, item) => {
    const amount = Number(item.account.data.parsed?.info?.tokenAmount?.amount || 0);
    return sum + amount;
  }, 0);
}

async function getOwnerTokenBalanceRawAnyProgram(connection, owner, mint) {
  const response = await connection.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) }, 'confirmed');
  return response.value.reduce((sum, item) => {
    const amount = Number(item.account.data.parsed?.info?.tokenAmount?.amount || 0);
    return sum + amount;
  }, 0);
}

async function getBuybackInputAmount({ connection, wallet, config, state = {}, now = new Date() }) {
  if (config.buybackInputMint === WSOL_MINT) {
    const balance = await connection.getBalance(wallet.publicKey, 'confirmed');
    const spendable = Math.max(0, balance - config.gasReserveLamports);
    const budgeted = Math.floor(spendable * config.buybackShare);
    const runCapped = config.maxLamportsPerRun > 0 ? Math.min(budgeted, config.maxLamportsPerRun) : budgeted;
    const dailyRemaining = config.maxLamportsPerDay > 0
      ? remainingDailyLamports(state, config.maxLamportsPerDay, now)
      : runCapped;
    return Math.max(0, Math.min(runCapped, dailyRemaining));
  }

  const solBalance = await connection.getBalance(wallet.publicKey, 'confirmed');
  if (solBalance < config.gasReserveLamports) return 0;

  const tokenBalance = await getOwnerTokenBalanceRawAnyProgram(connection, wallet.publicKey, config.buybackInputMint);
  return Math.max(0, Math.floor(tokenBalance * config.buybackShare));
}

async function getBuybackLamportsLeavingGas({ connection, wallet, config, state = {}, now = new Date() }) {
  return getBuybackInputAmount({ connection, wallet, config: { ...config, buybackInputMint: WSOL_MINT }, state, now });
}

async function buyBackWithJupiter({ connection, wallet, config, inputAmount, tokenProgramId = TOKEN_PROGRAM_ID }) {
  if (inputAmount < config.minBuybackInputAmount) {
    return { status: 'skipped-low-buyback', inputAmount, outputRawAmount: 0, signature: '' };
  }

  const quoteUrl = new URL(`${config.jupiterQuoteApi}/quote`);
  quoteUrl.searchParams.set('inputMint', config.buybackInputMint);
  quoteUrl.searchParams.set('outputMint', config.mint);
  quoteUrl.searchParams.set('amount', String(inputAmount));
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

  const before = await getOwnerTokenBalanceRaw(connection, wallet.publicKey, config.mint, tokenProgramId);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction(signature, 'confirmed');
  const after = await getOwnerTokenBalanceRaw(connection, wallet.publicKey, config.mint, tokenProgramId);

  return {
    status: 'bought-back',
    inputAmount,
    inputLamports: config.buybackInputMint === WSOL_MINT ? inputAmount : 0,
    inputSymbol: config.buybackInputSymbol,
    inputMint: config.buybackInputMint,
    inputDecimals: config.buybackInputDecimals,
    outputRawAmount: Math.max(0, after - before),
    signature,
    quoteOutAmount: Number(quote.outAmount || 0),
    routePlan: quote.routePlan || [],
  };
}

async function buyBackWithPump({ connection, wallet, config, lamports, tokenProgramId = TOKEN_PROGRAM_ID }) {
  if (lamports < config.minBuybackLamports) {
    return { status: 'skipped-low-buyback', inputLamports: lamports, outputRawAmount: 0, signature: '' };
  }

  const mint = new PublicKey(config.mint);
  const online = new OnlinePumpSdk(connection);
  const pump = new PumpSdk();
  const global = await online.fetchGlobal();
  const feeConfig = await online.fetchFeeConfig();
  const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } = await online.fetchBuyState(mint, wallet.publicKey, tokenProgramId);
  if (bondingCurve.complete) {
    return { status: 'skipped-pump-curve-complete', inputLamports: lamports, outputRawAmount: 0, signature: '' };
  }

  const mintSupply = new BN(String(await getMintSupply(connection, config.mint)));
  const quoteAmount = new BN(String(lamports));
  const amount = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig,
    mintSupply,
    bondingCurve,
    amount: quoteAmount,
    quoteMint: bondingCurve.quoteMint,
  });
  if (amount.lte(new BN(0))) {
    return { status: 'skipped-pump-zero-output', inputLamports: lamports, outputRawAmount: 0, signature: '' };
  }

  const slippage = config.slippageBps / 100;
  const instructions = tokenProgramId.equals(TOKEN_2022_PROGRAM_ID)
    ? await pump.buyV2Instructions({
      global,
      bondingCurveAccountInfo,
      bondingCurve,
      associatedUserAccountInfo,
      mint,
      user: wallet.publicKey,
      amount,
      quoteAmount,
      slippage,
      tokenProgram: tokenProgramId,
    })
    : await pump.buyInstructions({
      global,
      bondingCurveAccountInfo,
      bondingCurve,
      associatedUserAccountInfo,
      mint,
      user: wallet.publicKey,
      amount,
      solAmount: quoteAmount,
      slippage,
      tokenProgram: tokenProgramId,
    });

  const before = await getOwnerTokenBalanceRaw(connection, wallet.publicKey, config.mint, tokenProgramId);
  const tx = new Transaction().add(...instructions);
  const signature = await sendAndConfirmTransaction(connection, tx, [wallet], { commitment: 'confirmed' });
  const after = await getOwnerTokenBalanceRaw(connection, wallet.publicKey, config.mint, tokenProgramId);

  return {
    status: 'bought-back-pump',
    inputAmount: lamports,
    inputLamports: lamports,
    outputRawAmount: Math.max(0, after - before),
    signature,
    quoteOutAmount: Number(amount.toString()),
    routePlan: [{ swapInfo: { label: 'Pump.fun bonding curve' } }],
  };
}

async function buyBackTokens({ connection, wallet, config, inputAmount, tokenProgramId = TOKEN_PROGRAM_ID }) {
  if (config.buybackInputMint !== WSOL_MINT) {
    return buyBackWithJupiter({ connection, wallet, config, inputAmount, tokenProgramId });
  }

  try {
    return await buyBackWithJupiter({ connection, wallet, config, inputAmount, tokenProgramId });
  } catch (error) {
    log('jupiter-buyback-fallback', { reason: error.message.slice(0, 180) });
    return buyBackWithPump({ connection, wallet, config, lamports: inputAmount, tokenProgramId });
  }
}

async function sendAirdrops({ connection, wallet, config, winners, tokenProgramId = TOKEN_PROGRAM_ID }) {
  const mint = new PublicKey(config.mint);
  const sourceAta = getAssociatedTokenAddressSync(mint, wallet.publicKey, false, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);
  const receipts = [];

  for (const winner of winners) {
    const recipient = new PublicKey(winner.address);
    const destinationAta = getAssociatedTokenAddressSync(mint, recipient, true, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);
    const tx = new Transaction();
    const destinationInfo = await connection.getAccountInfo(destinationAta, 'confirmed');
    if (!destinationInfo) {
      tx.add(createAssociatedTokenAccountInstruction(wallet.publicKey, destinationAta, recipient, mint, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID));
    }
    tx.add(createTransferInstruction(sourceAta, destinationAta, wallet.publicKey, BigInt(winner.amount), [], tokenProgramId));
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

function formatInputAmount(rawAmount, decimals) {
  return Number(rawAmount || 0) / (10 ** Number(decimals || 0));
}

async function runOnce({ connection, wallet, config }) {
  const started = new Date();
  const runId = makeRunId(started);
  log('run-start', { runId, wallet: wallet.publicKey.toBase58(), mint: config.mint });
  const tokenProgramId = await getTokenProgramIdForMint(connection, config.mint);
  log('token-program', { mint: config.mint, tokenProgramId: tokenProgramId.toBase58() });

  let state = normalizeState(readState(config));

  const claim = await claimCreatorFees({ connection, wallet, config });
  log('claim-result', { status: claim.status, claimableSol: lamportsToSol(claim.claimableLamports), signature: claim.signature });

  const buybackInputAmount = await getBuybackInputAmount({ connection, wallet, config, state, now: started });
  let buyback = { status: 'skipped', inputAmount: buybackInputAmount, inputLamports: 0, inputSymbol: config.buybackInputSymbol, inputMint: config.buybackInputMint, inputDecimals: config.buybackInputDecimals, signature: '', outputRawAmount: 0 };

  if (buybackInputAmount >= config.minBuybackInputAmount) {
    buyback = await buyBackTokens({ connection, wallet, config, inputAmount: buybackInputAmount, tokenProgramId });
    state = addPendingAirdrop(state, buyback.outputRawAmount || 0);
    state = applyDailySpend(state, buyback.inputAmount || 0, started);
    log('buyback-result', {
      status: buyback.status,
      inputAmount: formatInputAmount(buyback.inputAmount, config.buybackInputDecimals),
      inputSymbol: config.buybackInputSymbol,
      inputMint: config.buybackInputMint,
      outputRawAmount: buyback.outputRawAmount,
      signature: buyback.signature,
    });
  } else {
    log('buyback-skipped', {
      reason: 'below-min-input-or-gas-reserve',
      spendableInputAmount: formatInputAmount(buybackInputAmount, config.buybackInputDecimals),
      inputSymbol: config.buybackInputSymbol,
      gasReserveSol: config.gasReserveSol,
    });
  }

  let snapshot = null;
  let airdrop = {
    status: 'queued',
    batchSize: 0,
    pendingRawAmount: state.pendingAirdropRawAmount,
    nextAirdropAfterMs: config.airdropIntervalMs,
    winners: [],
  };

  if (state.pendingAirdropRawAmount > 0 && isAirdropDue(state, config.airdropIntervalMs, started)) {
    const [holders, totalSupply] = await Promise.all([
      fetchHolders(connection, config.mint, tokenProgramId),
      getMintSupply(connection, config.mint),
    ]);
    const holderConfig = { totalSupply, maxWalletShare: config.maxWalletShare, excludedWallets: config.excludedWallets };
    const classified = classifyHolders(holders, holderConfig);
    const batchSize = getBatchSize(classified.eligible.length);
    const winners = pickWeightedWinners(classified.eligible, batchSize, `${runId}|${buyback.signature}|${state.pendingAirdropRawAmount}`);
    const plannedAirdrops = allocateAirdrops(winners, state.pendingAirdropRawAmount);
    const sentAirdrops = await sendAirdrops({ connection, wallet, config, winners: plannedAirdrops, tokenProgramId });

    snapshot = {
      hash: snapshotHash(holders, config.mint),
      slot: await connection.getSlot('confirmed'),
      totalSupply,
      holderCount: holders.length,
      eligibleHolderCount: classified.eligible.length,
      excludedWalletCount: Object.values(classified.excludedByReason).reduce((sum, list) => sum + list.length, 0),
      excludedByReason: classified.excludedByReason,
    };
    airdrop = {
      status: 'sent',
      batchSize,
      totalTokensAirdropped: sentAirdrops.reduce((sum, winner) => sum + winner.amount, 0),
      winners: sentAirdrops,
    };
    state = markAirdropSent(state, started);
  } else if (state.pendingAirdropRawAmount <= 0) {
    airdrop.status = 'skipped-no-pending-tokens';
  }

  writeState(config, state);

  const receipt = {
    mode: 'fully-auto',
    runId,
    timestamp: started.toISOString(),
    mint: config.mint,
    cadence: {
      claimAndBuybackEveryMs: config.intervalMs,
      airdropEveryMs: config.airdropIntervalMs,
      gasReserveSol: config.gasReserveSol,
    },
    claim: { status: claim.status, claimedFeesSol: lamportsToSol(claim.claimableLamports), claimTx: claim.signature },
    buyback: {
      status: buyback.status,
      buybackSol: lamportsToSol(buyback.inputLamports || 0),
      inputAmount: formatInputAmount(buyback.inputAmount || 0, config.buybackInputDecimals),
      inputRawAmount: buyback.inputAmount || 0,
      inputSymbol: config.buybackInputSymbol,
      inputMint: config.buybackInputMint,
      estimatedTokensBought: buyback.outputRawAmount,
      swapTx: buyback.signature,
      route: buyback.signature ? 'Jupiter quote/swap; USDC-funded buyback route' : '',
    },
    snapshot,
    airdrop,
    state: {
      pendingAirdropRawAmount: state.pendingAirdropRawAmount,
      lastAirdropAt: state.lastAirdropAt,
    },
  };
  await writeReceipt(config, receipt);
  try {
    const social = await publishDropReceipt(receipt, config);
    log('x-drop-post', { status: social.status, runId: social.runId, tweetId: social.tweetId || '', previewPath: social.previewPath || '' });
  } catch (error) {
    console.error(`[howey-auto] x-drop-post failed: ${error.stack || error.message}`);
  }
  log('run-complete', { runId, buybackStatus: buyback.status, airdropStatus: airdrop.status });
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
    airdropIntervalMs: config.airdropIntervalMs,
    gasReserveSol: config.gasReserveSol,
    buybackShare: config.buybackShare,
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
  buildHolderAccountFilters,
  fetchHolders,
  getTokenProgramIdForMint,
  getBuybackLamportsLeavingGas,
  getBuybackInputAmount,
  runOnce,
};
