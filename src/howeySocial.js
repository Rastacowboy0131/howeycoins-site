const fs = require('node:fs');
const path = require('node:path');

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatSol(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0.000';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function formatTokenAmount(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  return Math.round(n).toLocaleString('en-US');
}

function shortAddress(address, head = 6, tail = 6) {
  const value = String(address || '');
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function solscanTxUrl(signature) {
  return `https://solscan.io/tx/${signature}`;
}

function shouldPostDropReceipt(receipt, config = {}) {
  return Boolean(
    config.postToX &&
    receipt?.airdrop?.status === 'sent' &&
    Array.isArray(receipt.airdrop.winners) &&
    receipt.airdrop.winners.length > 0,
  );
}

function buildWinnerLines(winners, maxWinners = 3) {
  return (winners || []).slice(0, maxWinners).map((winner, index) => {
    const address = shortAddress(winner.address);
    const amount = formatTokenAmount(winner.amount);
    const link = winner.signature ? solscanTxUrl(winner.signature) : '';
    return `${index + 1}. ${address} — ${amount} HOWEY${link ? `\n${link}` : ''}`;
  });
}

function buildDropPostText(receipt, config = {}) {
  const siteUrl = config.siteUrl || 'https://howeycoins.org';
  const winners = receipt?.airdrop?.winners || [];
  const extraCount = Math.max(0, winners.length - 3);
  const winnerLines = buildWinnerLines(winners, 3);
  const extraLine = extraCount > 0 ? [`+ ${extraCount} more holders on the receipt`] : [];

  const lines = [
    'HOWEY HOLDER DROP',
    '',
    `Creator fees claimed: ${formatSol(receipt?.claim?.claimedFeesSol)} SOL`,
    `Buyback: ${formatSol(receipt?.buyback?.buybackSol)} SOL`,
    `Bought: ${formatTokenAmount(receipt?.buyback?.estimatedTokensBought)} HOWEY`,
    '',
    `Airdropped to ${winners.length} holder${winners.length === 1 ? '' : 's'}:`,
    ...winnerLines,
    ...extraLine,
    '',
    `Full receipt: ${siteUrl}`,
  ];

  let text = lines.filter((line) => line !== undefined).join('\n');
  if (text.length <= 280) return text;

  const firstWinner = winners[0];
  const compactLines = [
    'HOWEY HOLDER DROP',
    '',
    `Creator fees claimed: ${formatSol(receipt?.claim?.claimedFeesSol)} SOL`,
    `Buyback: ${formatSol(receipt?.buyback?.buybackSol)} SOL`,
    `Bought: ${formatTokenAmount(receipt?.buyback?.estimatedTokensBought)} HOWEY`,
  ];
  if (firstWinner) {
    compactLines.push(
      '',
      `Winner: ${shortAddress(firstWinner.address)} — ${formatTokenAmount(firstWinner.amount)} HOWEY`,
    );
    if (firstWinner.signature) compactLines.push(solscanTxUrl(firstWinner.signature));
  }
  compactLines.push('', `Full receipt: ${siteUrl}`);
  text = compactLines.join('\n');
  return text.length <= 280 ? text : `${text.slice(0, 276)}...`;
}

function buildDropCardSvg(receipt, config = {}) {
  const siteUrl = config.siteUrl || 'https://howeycoins.org';
  const winners = receipt?.airdrop?.winners || [];
  const claimedSol = `${formatSol(receipt?.claim?.claimedFeesSol)} SOL`;
  const buybackSol = `${formatSol(receipt?.buyback?.buybackSol)} SOL`;
  const bought = `${formatTokenAmount(receipt?.buyback?.estimatedTokensBought)} HOWEY`;
  const airdropped = `${formatTokenAmount(receipt?.airdrop?.totalTokensAirdropped)} HOWEY`;
  const holderCount = `${winners.length} HOLDER${winners.length === 1 ? '' : 'S'}`;
  const runId = receipt?.runId || 'HOWEY-RUN';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#071a12"/>
      <stop offset="0.45" stop-color="#0a3b22"/>
      <stop offset="1" stop-color="#e33b2f"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect width="1200" height="675" fill="url(#bg)"/>
  <circle cx="1010" cy="100" r="210" fill="#ffd34e" opacity="0.18"/>
  <circle cx="132" cy="570" r="260" fill="#15ff81" opacity="0.13"/>
  <rect x="70" y="58" width="1060" height="559" rx="38" fill="#fff8df" filter="url(#shadow)"/>
  <rect x="92" y="82" width="1016" height="511" rx="28" fill="#10251b"/>
  <rect x="92" y="82" width="1016" height="90" rx="28" fill="#e23a2d"/>
  <text x="120" y="140" font-family="Arial Black, Impact, sans-serif" font-size="46" fill="#fff8df">HOWEYCOINS HOLDER DROP</text>
  <text x="1080" y="138" text-anchor="end" font-family="Arial Black, Impact, sans-serif" font-size="30" fill="#fff8df">$HOWEY</text>

  <text x="120" y="222" font-family="Arial, sans-serif" font-size="25" fill="#8fffc1">CREATOR FEES CLAIMED</text>
  <text x="120" y="282" font-family="Arial Black, Impact, sans-serif" font-size="62" fill="#fff8df">${escapeXml(claimedSol)}</text>

  <text x="120" y="348" font-family="Arial, sans-serif" font-size="25" fill="#8fffc1">BUYBACK</text>
  <text x="120" y="408" font-family="Arial Black, Impact, sans-serif" font-size="58" fill="#fff8df">${escapeXml(buybackSol)}</text>

  <text x="610" y="222" font-family="Arial, sans-serif" font-size="25" fill="#8fffc1">BOUGHT BACK</text>
  <text x="610" y="282" font-family="Arial Black, Impact, sans-serif" font-size="50" fill="#fff8df">${escapeXml(bought)}</text>

  <text x="610" y="348" font-family="Arial, sans-serif" font-size="25" fill="#8fffc1">AIRDROPPED</text>
  <text x="610" y="408" font-family="Arial Black, Impact, sans-serif" font-size="50" fill="#fff8df">${escapeXml(airdropped)}</text>
  <text x="610" y="462" font-family="Arial Black, Impact, sans-serif" font-size="44" fill="#ffd34e">${escapeXml(holderCount)}</text>

  <rect x="120" y="500" width="960" height="1" fill="#8fffc1" opacity="0.5"/>
  <text x="120" y="545" font-family="Arial, sans-serif" font-size="24" fill="#fff8df">${escapeXml(runId)}</text>
  <text x="1080" y="545" text-anchor="end" font-family="Arial, sans-serif" font-size="24" fill="#fff8df">${escapeXml(siteUrl)}</text>
  <text x="120" y="582" font-family="Arial Black, Impact, sans-serif" font-size="22" fill="#ffd34e">THE FAKE ICO LEARNED HOW TO AIRDROP</text>
</svg>`;
}

async function renderDropCardPng(receipt, config = {}) {
  const outDir = config.cardOutputDir || path.join(process.cwd(), 'data', 'cards');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${receipt.runId || Date.now()}-howey-drop.png`);
  const svg = buildDropCardSvg(receipt, config);
  const sharp = require('sharp');
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  return outPath;
}

module.exports = {
  buildDropCardSvg,
  buildDropPostText,
  escapeXml,
  formatSol,
  formatTokenAmount,
  renderDropCardPng,
  shouldPostDropReceipt,
  shortAddress,
  solscanTxUrl,
};
