# $HOWEYCOINS Fee → Buyback → Holder Drop Engine

This is the implementation blueprint for the post-launch utility loop.

## Core loop

Every run, usually every 5 minutes:

1. Claim available Pump.fun creator fees into the operations wallet.
2. Split the claimed SOL/fees into:
   - buyback budget
   - optional gas/reserve buffer
   - optional ops buffer if needed
3. Swap the buyback budget into `$HOWEYCOINS` using PumpSwap-native liquidity, or a Jupiter route that correctly routes through PumpSwap.
4. Snapshot current token holders.
5. Remove ineligible wallets.
6. Pick the airdrop batch.
7. Send bought-back `$HOWEYCOINS` to selected eligible holders.
8. Write public receipts: claim tx, swap tx, snapshot hash, airdrop txs.

## Eligibility rules

A wallet is eligible if:

- It holds `$HOWEYCOINS` at snapshot time.
- It holds **3% or less** of the total supply.
- It is not the deployer wallet, fee-claim wallet, treasury/ops wallet, burn address, LP/pool address, or known exchange/custody wallet.
- It is not blocked for obvious sybil/farming abuse.

A wallet holding **more than 3%** can still hold/trade the coin, but it is skipped for holder-drop selection.

## Recommended batch size

Start with **10 wallets per 5-minute drop**.

Why 10:

- Big enough that holders feel the mechanic is active.
- Small enough that each winner gets a meaningful amount early.
- Easy to post as receipts without spamming hundreds of tiny dust sends.
- Creates 2,880 winner slots per day if the engine runs every 5 minutes.

Scale later:

- Under 500 eligible holders: 5 winners/drop.
- 500–2,000 eligible holders: 10 winners/drop.
- 2,000–10,000 eligible holders: 25 winners/drop.
- 10,000+ eligible holders: 50 winners/drop max unless fees are huge.

Avoid sending dust. If the buyback amount is too small, either skip that interval, roll funds forward, or reduce winner count.

## Selection model

Use capped weighted randomness:

- More tokens = slightly better odds.
- No wallet gets more than the 3% eligibility cap.
- Use square-root balance weighting to avoid whales dominating.
- Exclude recent winners for a cooldown window if farming becomes an issue.

Example winner weight:

```txt
weight = sqrt(holder_balance)
```

This rewards holding without making a 100x larger wallet 100x more likely to win.

## Receipt data to publish

Each drop should produce:

- Run ID
- Timestamp
- Claimed fee amount
- Claim transaction
- Buyback amount
- Swap/buyback transaction
- Snapshot slot
- Snapshot hash
- Eligible holder count
- Excluded >3% wallet count
- Winner count
- Airdrop transaction signatures

## Safety rails before mainnet automation

- Dry-run mode first: calculate winners and receipts without sending transactions.
- Manual approval mode second: generate transactions but require operator approval/signing.
- Fully automated mode last.
- Keep private keys out of the repo.
- Use environment variables or a local keypair path ignored by git.
- Add max spend per run and max spend per day.
- Add a panic-disable switch.
- Never run real swaps or transfers until the token CA, ops wallet, and spending limits are confirmed.

## First build milestone

Build the engine in dry-run mode:

```txt
holders snapshot JSON + fee amount → buyback/drop plan + excluded wallet report
```

Current repo implementation:

- `src/howeyEngine.js` contains the tested pure planning engine.
- `tests/howeyEngine.test.js` covers fee splits, holder exclusions, batch scaling, stable snapshot hashes, and deterministic winner planning.
- `scripts/generate-demo-plan.js` creates `data/howey-run-demo.json` for the public dashboard.
- The website dashboard fetches the JSON and renders the dry-run claim, buyback, snapshot, and airdrop receipt queue.

Useful commands:

```bash
npm test
npm run generate:demo
npm start
```

Then wire real Solana/PumpSwap/Jupiter calls after launch details are final.

## Fully automatic runner

A local money-moving runner now lives at:

```bash
scripts/howey-auto.js
```

It reuses the existing local claim-app environment from `/Users/rasta/Desktop/pumpswap-claimer/.env` when this repo does not have a local `.env`, so the existing Helius RPC/private key setup can be used without committing secrets.

User-approved wallet model:

- Dev wallet is also the ops wallet.
- Dev wallet is also the airdrop sender wallet.
- Dev/ops/airdrop wallet is always excluded from holder drops.
- LP/pool wallets should be added to `LP_POOL_WALLETS` so they are excluded too.

Live loop implemented:

1. Claim Pump creator fees with `@pump-fun/pump-sdk`.
2. Apply fee split and per-run cap.
3. Buy back `$HOWEYCOINS` with Jupiter SOL→mint swap.
4. Snapshot SPL token holders from RPC.
5. Exclude dev/ops/airdrop wallet, `LP_POOL_WALLETS`, manually excluded wallets, zero balances, and >3% holders.
6. Pick weighted random winners.
7. Send SPL token airdrops from the dev/ops wallet.
8. Write receipts to `data/runs/<run>.json` and `data/latest.json`.
9. Track daily buyback spend in `data/howey-auto-state.json` so `MAX_SOL_PER_DAY` is enforced across runs.
10. Website dashboard tries `data/latest.json` first, then falls back to the demo plan.

The script intentionally refuses to run unless both live-spend gates are set:

```bash
ENABLE_REAL_TX=true
FULLY_AUTO=true
```

Useful commands:

```bash
npm run howey:auto:once   # one full loop, then exits
npm run howey:auto        # continuous loop every INTERVAL_MS
```

Safety values to set before enabling:

```bash
DEV_PUBLIC_KEY=Ehr92fYMp2DmzavJCCY4wfGnYLasucDPBnodqjL2agWz
LP_POOL_WALLETS=<comma separated LP/pool token-owner wallets>
MAX_SOL_PER_RUN=0.25
MAX_SOL_PER_DAY=2
MIN_CLAIM_SOL=0.01
MIN_BUYBACK_SOL=0.01
SLIPPAGE_BPS=500
```

Do not run the live loop until LP/pool wallets and spend caps are correct.

## Current pre-launch config

Public values received for launch prep:

```txt
HOWEYCOINS_MINT=G3Q6iQ4xMG3vH9SyKSkupvEeeKiRLvvmCqAQ9iyGpump
DEV_PUBLIC_KEY=Ehr92fYMp2DmzavJCCY4wfGnYLasucDPBnodqjL2agWz
```

Private keys must **not** be committed to this repo, written into docs, pasted into source code, or shown on the website. The transaction engine should read any signing key from a local ignored `.env` file or keypair path only.

Pump.fun coins now migrate to **PumpSwap**, not Raydium, so the buyback engine should not assume Raydium pools. Use PumpSwap directly when supported by the chosen SDK/API, or use Jupiter quote/swap routes only after confirming the route reaches the active PumpSwap liquidity for the mint.
