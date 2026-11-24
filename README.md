# token-launch-radar-2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mochiko28/token-launch-radar-2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mochiko28/token-launch-radar-2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar ranks DeFi protocols for which the snapshot records no token by the value a launch could carry. The value curve is fitted on the snapshot's own traded peers using TVL, seven-day growth and listing age, and tested on held-out protocols. Each ranked protocol gets a costed farm plan with token and no-token outcomes, break-even token odds, a verify / wait / stop decision tree, a small withdrawal rehearsal before the deposit, and an editable quote panel.

## Run it

```sh
node main.ts --input /input/snapshot.json --output /output
```

The program uses the Node 22 standard library only. It writes `board.json`, `data.js`, `dossier.json` and the static dashboard (`dashboard/index.html`, `app.js`, `model.js`, `style.css`) into the output directory. `tools/render.sh <output dir> [snapshot]` builds it and captures the three screenshots.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
