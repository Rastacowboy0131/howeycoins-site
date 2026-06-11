function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function normalizeState(state) {
  return {
    dailySpend: { ...(state?.dailySpend || {}) },
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

module.exports = {
  applyDailySpend,
  dayKey,
  getDailySpend,
  remainingDailyLamports,
};
