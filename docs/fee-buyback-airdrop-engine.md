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

## Current pre-launch config

Public values received for launch prep:

```txt
HOWEYCOINS_MINT=G3Q6iQ4xMG3vH9SyKSkupvEeeKiRLvvmCqAQ9iyGpump
DEV_PUBLIC_KEY=Ehr92fYMp2DmzavJCCY4wfGnYLasucDPBnodqjL2agWz
```

Private keys must **not** be committed to this repo, written into docs, pasted into source code, or shown on the website. The transaction engine should read any signing key from a local ignored `.env` file or keypair path only.

Pump.fun coins now migrate to **PumpSwap**, not Raydium, so the buyback engine should not assume Raydium pools. Use PumpSwap directly when supported by the chosen SDK/API, or use Jupiter quote/swap routes only after confirming the route reaches the active PumpSwap liquidity for the mint.
