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
    <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#dff7ff"/>
      <stop offset="0.45" stop-color="#54c6e4"/>
      <stop offset="1" stop-color="#0577a9"/>
    </linearGradient>
    <linearGradient id="pool" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#c7fbff"/>
      <stop offset="1" stop-color="#0783b3"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect width="1200" height="675" fill="url(#sky)"/>
  <circle cx="965" cy="92" r="135" fill="#ffd34e" opacity="0.28"/>
  <path d="M0 245c112-42 207-31 300-5 96 27 156-34 251-23 85 10 130 49 219 41 102-9 151-61 252-48 82 11 118 50 178 44v96H0z" fill="#0d4962" opacity="0.58"/>
  <path d="M0 315c160 20 276-26 421-6 128 18 235 49 381 14 124-30 214-8 317 13 42 8 70 8 81 6v333H0z" fill="url(#pool)"/>
  <path d="M0 339c157 44 274 36 422 7 129-25 230-63 375-34 142 29 226 72 372 45" fill="none" stroke="#f5ffff" stroke-width="7" opacity="0.36"/>
  <g transform="translate(34 78) scale(.58)" opacity="0.78">
    <path d="M102 214c32 145 28 283-18 474h82c-25-187-19-329 33-480z" fill="#69351f"/>
    <path d="M145 116C45 138-20 205-61 315 21 258 89 230 171 219 96 274 56 337 43 414c65-76 121-122 205-151-45 71-54 140-28 207 31-100 78-174 159-233-89 0-158 22-224 63 35-73 90-128 158-166-81-8-138 13-202 61 19-45 50-78 95-102-21 4-41 12-61 23z" fill="#0f6d3c"/>
  </g>
  <g transform="translate(1000 72) scale(.5) rotate(8)" opacity="0.76">
    <path d="M110 240c26 135 19 265-25 445h80c-23-181-14-313 31-447z" fill="#69351f"/>
    <path d="M150 130C46 148-24 215-68 326 18 265 91 235 177 224 100 282 62 348 53 426c64-78 125-128 212-159-48 74-55 145-25 213 29-103 82-180 167-240-96 4-168 30-236 75 33-77 90-137 160-177-84-7-145 17-209 69 20-47 55-83 102-109-26 5-50 15-74 32z" fill="#11814a"/>
  </g>
  <rect width="1200" height="675" fill="#06152b" opacity="0.20"/>
  <rect x="70" y="58" width="1060" height="559" rx="38" fill="#fff8df" filter="url(#shadow)"/>
  <rect x="92" y="82" width="1016" height="511" rx="28" fill="#10251b" opacity="0.94"/>
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
