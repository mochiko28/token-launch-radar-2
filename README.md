# token-launch-radar-2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mochiko28/token-launch-radar-2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mochiko28/token-launch-radar-2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar ranks DeFi protocols that record no token by what their token would be worth if their record stayed as it is, and gives each one a farm plan with a dollar cost and a time for every step.

- **Value model** (`dashboard/model.js`): implied value = value if launched x launch odds within 12 months. Value if launched is a size curve fitted on the snapshot's trading tokens (one point per token) applied to TVL carried a week at its 7-day change; every term is tested held-out twice (leave-one-out and walk-forward by listing date) and only what helps is fitted. Launch odds are a hazard from a logistic fit of "holds a token" on TVL and days listed over 437 peers, also tested leave-one-out and walk-forward (AUC). The cover runs self-checks on load, including a digest that matches the page's rows to `board.json`.
- **Separation**: pre-token protocols are ranked; wrapped, bridged, staked and exchange products (the snapshot's own watchlist rule, applied to every protocol) are set aside; protocols whose token trades are the calibration set, shown with the model's fit beside their market cap.
- **Farm plans**: cheapest of the protocol's main chains, a decision step with the drop share needed to break even, capital sized so the expected drop covers gas, fees and hands-on time twice, weekly upkeep, an exit rule from its TVL and a sell rule from the model's band.
- **Page**: sortable and filterable board (search, family, scope, plan verdict, chain), a detail view per protocol, a radar chart of days without a token against airdrop yield. State lives in the URL hash.

The same `model.js` runs in `main.ts` (to write `board.json`) and in the page, so the board and the screenshots come from one function.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
# open out/dashboard/index.html; tools/render.sh rebuilds and recaptures the screenshots
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
