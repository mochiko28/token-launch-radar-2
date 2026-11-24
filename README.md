# token-launch-radar-2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mochiko28/token-launch-radar-2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mochiko28/token-launch-radar-2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar ranks DeFi protocols for which the snapshot records no token. It compares four ways to combine listing age with a cap curve on TVL and seven-day growth clipped to ±30%. Walk-forward and family holdouts refit each form inside training. The shrunk token-likeness form tunes its weight on inner folds from 0.125, 0.25, 0.5, 0.75 and 1. The family-pooled cap form uses a shared age slope with regularized family deviations and the shared slope for unseen families. Deployment uses the lowest median absolute log miss pooled across outer predictions among forms that beat the flat ratio on both tests. These outer comparisons inform the choice.

On this snapshot, the deployed value multiplies the growth-adjusted cap by `1 − 0.75 × (1 − token-likeness)` and the issuer factor. The export includes the fitted multiplier in `token_likeness_factor`. Farm plans use the conditional cap with the issuer factor and derive horizon-specific launch chances from the token-likeness curve. The Calibration tab shows candidate scores, term ablations and range coverage on held-out families.

## Run it

```sh
node main.ts --input /input/snapshot.json --output /output
```

The program uses the Node 22 standard library only. It writes `board.json`, `data.js`, `dossier.json` and the static dashboard (`dashboard/index.html`, `app.js`, `model.js`, `style.css`) into the output directory. `tools/render.sh <output dir> [snapshot]` builds it and captures the three screenshots.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
