function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function normalizeState(state) {
  return {
    dailySpend: { ...(state?.dailySpend || {}) },
    pendingAirdropRawAmount: Math.max(0, Math.floor(Number(state?.pendingAirdropRawAmount || 0))),
    lastAirdropAt: state?.lastAirdropAt || '',
  };
}

function getDailySpend(state, date = new Date()) {
  const normalized = normalizeState(state);
  return Number(normalized.dailySpend[dayKey(date)] || 0);
}

function applyDailySpend(state, lamports, date = new Date()) {
  const normalized = normalizeState(state);
  const key = dayKey(date);
  normalized.dailySpend[key] = getDailySpend(normalized, date) + Math.max(0, Math.floor(Number(lamports || 0)));
  return normalized;
}

function remainingDailyLamports(state, maxLamportsPerDay, date = new Date()) {
  return Math.max(0, Math.floor(Number(maxLamportsPerDay || 0)) - getDailySpend(state, date));
}

function addPendingAirdrop(state, rawAmount) {
  const normalized = normalizeState(state);
  normalized.pendingAirdropRawAmount += Math.max(0, Math.floor(Number(rawAmount || 0)));
  return normalized;
}

function markAirdropSent(state, date = new Date()) {
  const normalized = normalizeState(state);
  normalized.pendingAirdropRawAmount = 0;
  normalized.lastAirdropAt = date.toISOString();
  return normalized;
}

function isAirdropDue(state, intervalMs, date = new Date()) {
  const normalized = normalizeState(state);
  if (!normalized.lastAirdropAt) return true;
  const last = new Date(normalized.lastAirdropAt).getTime();
  if (!Number.isFinite(last)) return true;
  return date.getTime() - last >= Math.max(0, Number(intervalMs || 0));
}

module.exports = {
  addPendingAirdrop,
  applyDailySpend,
  dayKey,
  getDailySpend,
  isAirdropDue,
  markAirdropSent,
  normalizeState,
  remainingDailyLamports,
};
