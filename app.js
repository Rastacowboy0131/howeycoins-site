const menuButton = document.querySelector('.mobile-menu');
const nav = document.querySelector('.nav');

menuButton?.addEventListener('click', () => {
  const isOpen = nav.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(isOpen));
});

nav?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    nav.classList.remove('open');
    menuButton?.setAttribute('aria-expanded', 'false');
  });
});

const copyButton = document.querySelector('.ca-copy');

function fallbackCopyText(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand('copy');
  textArea.remove();
}

copyButton?.addEventListener('click', async () => {
  const ca = copyButton.dataset.copy;
  const status = copyButton.querySelector('.copy-status');
  if (!ca) return;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(ca);
    } else {
      fallbackCopyText(ca);
    }
    copyButton.classList.add('copied');
    if (status) status.textContent = 'Copied';
    window.setTimeout(() => {
      copyButton.classList.remove('copied');
      if (status) status.textContent = 'Click to copy';
    }, 1800);
  } catch (error) {
    fallbackCopyText(ca);
    copyButton.classList.add('copied');
    if (status) status.textContent = 'Copied';
    window.setTimeout(() => {
      copyButton.classList.remove('copied');
      if (status) status.textContent = 'Click to copy';
    }, 1800);
  }
});

const countdownTarget = new Date();
countdownTarget.setHours(countdownTarget.getHours() + 14);
countdownTarget.setMinutes(countdownTarget.getMinutes() + 11);
countdownTarget.setSeconds(countdownTarget.getSeconds() + 29);

const units = {
  days: document.getElementById('days'),
  hours: document.getElementById('hours'),
  minutes: document.getElementById('minutes'),
  seconds: document.getElementById('seconds'),
};

function pad(value) {
  return String(value).padStart(2, '0');
}

function updateCountdown() {
  const now = new Date();
  let diff = Math.max(0, countdownTarget - now);
  const days = Math.floor(diff / 86_400_000);
  diff -= days * 86_400_000;
  const hours = Math.floor(diff / 3_600_000);
  diff -= hours * 3_600_000;
  const minutes = Math.floor(diff / 60_000);
  diff -= minutes * 60_000;
  const seconds = Math.floor(diff / 1000);

  units.days.textContent = pad(days);
  units.hours.textContent = pad(hours);
  units.minutes.textContent = pad(minutes);
  units.seconds.textContent = pad(seconds);
}

updateCountdown();
setInterval(updateCountdown, 1000);

const quiz = document.getElementById('howeyQuiz');
const quizResult = document.getElementById('quizResult');

quiz?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(quiz);
  const answered = ['q1', 'q2', 'q3', 'q4'].every((key) => data.has(key));

  if (!answered) {
    quizResult.innerHTML = `
      <strong>Incomplete test.</strong>
      <span>The court requires all four answers before legal confusion can be generated.</span>
    `;
    return;
  }

  const score = ['q1', 'q2', 'q3', 'q4'].reduce((sum, key) => sum + Number(data.get(key)), 0);
  let title = 'Mildly Confused';
  let message = 'You noticed the red flags, but you are still pretending this is educational.';

  if (score >= 150) {
    title = 'Maximum Green Bag Disorder';
    message = 'You have turned the red flag into a green bag. The Howey Test has been passed, failed, appealed, and memed.';
  } else if (score >= 115) {
    title = 'Legally Confused, Spiritually Bullish';
    message = 'You understand enough to be dangerous and not enough to stop clicking.';
  } else if (score >= 80) {
    title = 'Parody Enjoyer';
    message = 'You came for the fake ICO lore and stayed for the holder-drop roulette.';
  }

  quizResult.innerHTML = `
    <strong>${title}: ${score}/180</strong>
    <span>${message}</span>
  `;
});

const howeyStats = {
  // Replace these after launch with real on-chain/Pump.fun values.
  mint: 'G3Q6iQ4xMG3vH9SyKSkupvEeeKiRLvvmCqAQ9iyGpump',
  creatorFeesSol: null,
  buybackInputAmount: null,
  buybackInputSymbol: 'USDC',
  supplyBoughtBack: null,
  totalBuybacks: null,
  holdersAirdropped: null,
  receipts: [],
};

function solscanLink(signatureOrAddress) {
  if (!signatureOrAddress) return '#';
  return `https://solscan.io/tx/${signatureOrAddress}`;
}

function shortAddress(address) {
  if (!address || address.length <= 12) return address || '';
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function formatTokens(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatSol(value) {
  return `${Number(value || 0).toFixed(3)} SOL`;
}

function formatInput(value, symbol = 'USDC') {
  const decimals = symbol === 'USDC' ? 2 : 4;
  return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: decimals })} ${symbol}`;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function receiptRowsFromPlan(plan) {
  if (!plan?.airdrop?.winners?.length) return [];
  return plan.airdrop.winners.map((winner, index) => ({
    time: `${plan.runId} #${index + 1}`,
    buyback: formatInput(plan.buyback.inputAmount ?? plan.buyback.buybackSol, plan.buyback.inputSymbol || 'USDC'),
    wallet: shortAddress(winner.address),
    amount: formatTokens(winner.amount),
    signature: winner.signature,
    status: winner.receiptStatus || 'queued',
  }));
}

function renderEnginePlan(plan) {
  if (!plan) return;

  const claimedFeesSol = plan.claim.claimedFeesSol ?? (Number(plan.claim.claimableLamports || 0) / 1_000_000_000);
  const boughtBack = plan.buyback.estimatedTokensBought ?? plan.buyback.outputRawAmount ?? 0;
  const winners = plan.airdrop.winners || [];

  howeyStats.creatorFeesSol = claimedFeesSol;
  howeyStats.buybackInputAmount = plan.buyback.inputAmount ?? plan.buyback.buybackSol ?? 0;
  howeyStats.buybackInputSymbol = plan.buyback.inputSymbol || 'USDC';
  howeyStats.supplyBoughtBack = boughtBack;
  howeyStats.totalBuybacks = plan.buyback.status === 'skipped' ? 0 : 1;
  howeyStats.holdersAirdropped = winners.length;
  howeyStats.receipts = receiptRowsFromPlan(plan);

  setText('engineMode', String(plan.mode || 'dry-run').toUpperCase());
  setText('planRunId', plan.runId);
  setText('claimStatus', plan.claim.status);
  setText('claimAmount', formatSol(claimedFeesSol));
  setText('buybackRoute', plan.buyback.route || plan.buyback.status || 'route pending');
  setText('buybackAmount', `${formatInput(plan.buyback.inputAmount ?? plan.buyback.buybackSol, plan.buyback.inputSymbol || 'USDC')} → est. ${formatTokens(boughtBack)} $HOWEYCOINS`);
  setText('snapshotHash', plan.snapshot?.hash ? `${plan.snapshot.hash.slice(0, 12)}...${plan.snapshot.hash.slice(-8)}` : 'snapshot pending');
  setText('eligibleCount', String(plan.snapshot?.eligibleHolderCount || 0));
  setText('excludedCount', String(plan.snapshot?.excludedWalletCount || 0));
  setText('airdropBatch', String(plan.airdrop.batchSize || winners.length || 0));
  setText('airdropTotal', formatTokens(plan.airdrop.totalTokensAirdropped || 0));
}

function renderStats() {
  setText('statFees', howeyStats.buybackInputAmount == null ? 'Waiting' : formatInput(howeyStats.buybackInputAmount, howeyStats.buybackInputSymbol));
  setText('statSupply', howeyStats.supplyBoughtBack == null ? 'Pending' : formatTokens(howeyStats.supplyBoughtBack));
  setText('statMint', shortAddress(howeyStats.mint));
  setText('statBuybacks', howeyStats.totalBuybacks == null ? 'Pending' : String(howeyStats.totalBuybacks));
  setText('statHolders', howeyStats.holdersAirdropped == null ? 'Pending' : String(howeyStats.holdersAirdropped));

  const dropLog = document.getElementById('dropLog');
  if (!dropLog) return;

  const rows = howeyStats.receipts;
  if (!rows.length) {
    dropLog.innerHTML = `
      <div class="drop-row pending-row" role="row">
        <span>USDC buyback and holder-drop receipts will appear here as Railway publishes live receipts.</span>
      </div>
    `;
    return;
  }

  dropLog.innerHTML = rows.map((row) => {
    const receipt = row.signature
      ? `<a href="${solscanLink(row.signature)}" target="_blank" rel="noreferrer">Solscan</a>`
      : `<span>${row.status || 'Waiting for tx'}</span>`;

    return `
      <div class="drop-row" role="row">
        <span>${row.time}</span>
        <span>${row.buyback}</span>
        <code>${row.wallet}</code>
        <span>${row.amount}</span>
        <span>${receipt}</span>
      </div>
    `;
  }).join('');
}

async function loadLatestReceiptPlan() {
  const planSources = [window.HOWEY_LATEST_RECEIPT_URL || './data/latest.json'];
  try {
    let plan = null;
    for (const source of planSources) {
      const response = await fetch(source, { cache: 'no-store' });
      if (!response.ok) continue;
      plan = await response.json();
      break;
    }
    if (!plan) throw new Error('No receipt plan available');
    renderEnginePlan(plan);
  } catch (error) {
    console.warn('Using pre-launch fallback stats:', error);
  } finally {
    renderStats();
  }
}

loadLatestReceiptPlan();
