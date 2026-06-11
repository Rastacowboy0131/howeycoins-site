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
  supplyBoughtBack: null,
  totalBuybacks: 0,
  holdersAirdropped: 0,
  receipts: [],
};

const demoReceipts = [
  {
    time: 'Launch + 05m',
    buyback: 'pending',
    wallet: '7H0w...eyC0',
    amount: 'pending',
    signature: '',
  },
  {
    time: 'Launch + 10m',
    buyback: 'pending',
    wallet: 'Gr33...Bag',
    amount: 'pending',
    signature: '',
  },
  {
    time: 'Launch + 15m',
    buyback: 'pending',
    wallet: 'SECn...ope',
    amount: 'pending',
    signature: '',
  },
];

function solscanLink(signatureOrAddress) {
  if (!signatureOrAddress) return '#';
  return `https://solscan.io/tx/${signatureOrAddress}`;
}

function shortAddress(address) {
  if (!address || address.length <= 12) return address || '';
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function renderStats() {
  setText('statFees', howeyStats.creatorFeesSol == null ? 'Pre-launch' : `${howeyStats.creatorFeesSol.toFixed(3)} SOL`);
  setText('statSupply', howeyStats.supplyBoughtBack == null ? 'Pre-launch' : howeyStats.supplyBoughtBack.toLocaleString());
  setText('statMint', shortAddress(howeyStats.mint));
  setText('statBuybacks', String(howeyStats.totalBuybacks));
  setText('statHolders', String(howeyStats.holdersAirdropped));

  const dropLog = document.getElementById('dropLog');
  if (!dropLog) return;

  const rows = howeyStats.receipts.length ? howeyStats.receipts : demoReceipts;
  dropLog.innerHTML = rows.map((row) => {
    const receipt = row.signature
      ? `<a href="${solscanLink(row.signature)}" target="_blank" rel="noreferrer">Solscan</a>`
      : '<span>Waiting for tx</span>';

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

renderStats();
