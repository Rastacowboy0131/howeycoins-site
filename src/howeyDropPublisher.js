const fs = require('node:fs');
const path = require('node:path');

const {
  buildDropPostText,
  renderDropCardPng,
  shouldPostDropReceipt,
} = require('./howeySocial');

function loadSocialState(statePath) {
  if (!statePath || !fs.existsSync(statePath)) return { postedRunIds: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return {
      ...parsed,
      postedRunIds: Array.isArray(parsed.postedRunIds) ? parsed.postedRunIds : [],
    };
  } catch {
    return { postedRunIds: [] };
  }
}

function saveSocialState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function markRunPosted(state, runId) {
  const postedRunIds = Array.isArray(state.postedRunIds) ? state.postedRunIds : [];
  if (postedRunIds.includes(runId)) return state;
  return {
    ...state,
    postedRunIds: [...postedRunIds, runId].slice(-500),
  };
}

async function postToXWithTwitterApi({ text, cardPath, config }) {
  const required = ['xApiKey', 'xApiSecret', 'xAccessToken', 'xAccessTokenSecret'];
  const missing = required.filter((key) => !config[key]);
  if (missing.length) {
    throw new Error(`Missing X API credentials: ${missing.join(', ')}`);
  }

  const { TwitterApi } = require('twitter-api-v2');
  const client = new TwitterApi({
    appKey: config.xApiKey,
    appSecret: config.xApiSecret,
    accessToken: config.xAccessToken,
    accessSecret: config.xAccessTokenSecret,
  });

  const mediaId = await client.v1.uploadMedia(cardPath, { mimeType: 'image/png' });
  const tweet = await client.v2.tweet({ text, media: { media_ids: [mediaId] } });
  return { id: tweet?.data?.id || '', raw: tweet };
}

async function publishDropReceipt(receipt, config = {}) {
  if (!shouldPostDropReceipt(receipt, config)) {
    return { status: 'skipped-disabled-or-no-airdrop' };
  }

  const runId = receipt.runId || `${receipt.timestamp || Date.now()}`;
  const socialStatePath = config.socialStatePath || path.join(process.cwd(), 'data', 'howey-social-state.json');
  const state = loadSocialState(socialStatePath);
  if (state.postedRunIds.includes(runId)) {
    return { status: 'skipped-already-posted', runId };
  }

  const text = buildDropPostText(receipt, config);
  const cardPath = await (config.renderCardPng || renderDropCardPng)(receipt, config);

  if (config.xDryRun) {
    const previewPath = config.xDryRunPath || path.join(process.cwd(), 'data', 'x-drop-preview.json');
    fs.mkdirSync(path.dirname(previewPath), { recursive: true });
    fs.writeFileSync(previewPath, `${JSON.stringify({ runId, text, cardPath }, null, 2)}\n`);
    saveSocialState(socialStatePath, markRunPosted(state, runId));
    return { status: 'dry-run', runId, text, cardPath, previewPath };
  }

  const postFn = config.postFn || postToXWithTwitterApi;
  const post = await postFn({ text, cardPath, receipt, config });
  const nextState = markRunPosted({ ...state, lastPost: { runId, tweetId: post?.id || '', postedAt: new Date().toISOString() } }, runId);
  saveSocialState(socialStatePath, nextState);
  return { status: 'posted', runId, text, cardPath, tweetId: post?.id || '' };
}

module.exports = {
  loadSocialState,
  markRunPosted,
  postToXWithTwitterApi,
  publishDropReceipt,
  saveSocialState,
};
