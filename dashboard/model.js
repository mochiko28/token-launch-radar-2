/* Launch Radar value model. One file, run twice: by main.ts (Node, to write board.json) and by this
 * page (to draw it), so every number on screen is computed here from the snapshot, never typed in.
 *
 *   1. calibrate()  fits value on the snapshot's own protocols whose token already trades:
 *                   ln(mcap/TVL) = a[family] + b * ln(TVL / $100M), b pooled within families,
 *                   a[family] shrunk toward the all-family mean when a family has few peers.
 *   2. score()      applies the fit to every pre-token protocol, with two pre-token adjustments:
 *                   momentum (TVL carried one week forward at its own 7-day change) and
 *                   time without a token (TVL that stayed without a token is worth more).
 *   3. farmPlan()   turns the same figures into steps with a dollar cost and a time each.
 * No protocol name appears in this file: rows differ only by their snapshot figures. */
(function (root) {
  'use strict';

  var DAY = 86400000;
  var M = {
    version: 'radar-fit-2',
    ref_tvl: 1e8,            // the fit's reference size: $100M of TVL
    ratio_floor: 0.02,       // mcap/TVL outliers are clipped before the fit
    ratio_cap: 20,
    shrink_k: 4,             // pseudo-peers pulling a thin family toward the all-family mean
    growth_floor: -30,       // 7-day change used for momentum, clipped (per cent)
    growth_cap: 50,
    age_full: 730,           // days without a token for the full +25% staying-power premium
    age_low: 0.75,           // time factor at day 0
    age_high: 1.25,          // time factor at age_full and beyond
    drop_share: 0.10,        // assumed share of supply sent to depositors, pro rata to TVL-days
    farm_days: 90,           // the plan's holding window
    hour_usd: 25,            // the reader's hands-on time, priced into every plan
    target_cover: 2,         // the stake is sized so the expected drop covers gas and time this many times
    season_days: 365         // TVL-days older than this are taken as already paid by earlier seasons
  };

  // DefiLlama categories grouped into families, so each family has enough trading peers to fit.
  var FAMILIES = [
    ['vault', 'Vaults & curators', ['Risk Curators', 'Onchain Capital Allocator', 'Yield Aggregator', 'Yield', 'Liquidity Manager', 'Leveraged Farming', 'Farm', 'Indexes', 'Options Vault']],
    ['lend', 'Lending & CDP', ['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Collateral Markets', 'Collateral Management']],
    ['dex', 'DEX & markets', ['Dexs', 'Launchpad', 'OTC Marketplace', 'NFT Marketplace', 'Token Locker']],
    ['deriv', 'Derivatives', ['Derivatives', 'Options', 'Synthetics', 'Prediction Market', 'Interest Rate Derivatives']],
    ['stable', 'Stables & basis', ['Basis Trading', 'Stablecoin Wrapper', 'Dual-Token Stablecoin', 'Algo-Stables', 'Stablecoin Issuer', 'Reserve Currency', 'CeDeFi', 'DOR']],
    ['rwa', 'Real-world assets', ['RWA']],
    ['stake', 'Staking & restaking', ['Liquid Staking', 'Liquid Restaking', 'Restaking', 'Staking Pool', 'Restaked BTC', 'Anchor BTC', 'Decentralized BTC']],
    ['infra', 'Chains, bridges & infra', []]
  ];
  var FAM_OF = {};
  FAMILIES.forEach(function (f) { f[2].forEach(function (c) { FAM_OF[c] = f[0]; }); });
  function family(p) { return FAM_OF[p.category] || 'infra'; }

  // Typical cost of one transaction in USD, by chain; anything unlisted is costed at $0.30.
  var GAS = { Ethereum: 3, Bitcoin: 2.5, Tron: 1.2, Binance: 0.08, BSC: 0.08, Arbitrum: 0.05, Base: 0.03, Optimism: 0.04,
    Polygon: 0.02, Solana: 0.01, Avalanche: 0.06, Sui: 0.01, Aptos: 0.01, Hyperliquid: 0.02, 'Hyperliquid L1': 0.02, Sonic: 0.02,
    Linea: 0.05, Scroll: 0.05, Blast: 0.04, Mantle: 0.03, Unichain: 0.02, Ink: 0.02, Katana: 0.02, Plasma: 0.01, Monad: 0.01,
    Berachain: 0.02, Stellar: 0.01, Near: 0.01, TON: 0.03, Starknet: 0.05, Zksync: 0.05, 'zkSync Era': 0.05, Gnosis: 0.01, Corn: 0.02 };
  function gas(chain) { return GAS[chain] != null ? GAS[chain] : 0.3; }

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function hasToken(p) { return p.gecko_id != null || p.symbol != null || p.mcap_usd != null; }
  function trades(p) { return p.mcap_usd != null && p.mcap_usd > 0; }
  function ageDays(asOf, listed) {
    if (!listed) return null;
    var d = Math.floor((Date.parse(asOf + 'T00:00:00Z') - Date.parse(listed + 'T00:00:00Z')) / DAY);
    return isFinite(d) ? Math.max(0, d) : null;
  }
  // The snapshot's own watchlist rule for a product of a token that already trades (wrapped, staked,
  // bridged, exchange-run or a versioned pool): applied to every protocol, so the set is never typed in.
  var PRODUCT_CATS = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];
  var VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  var WRAPPED = /\b(wrapped|staked|staking)\b/i;
  var EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
  // One more test on top of the house rule: a no-token protocol whose name starts with the first word
  // of a protocol that records a token (a chain port or product line of that token) is a sibling.
  function firstWord(n) { return n.toLowerCase().split(/[\s.-]+/)[0]; }
  function tokenWords(snap) {
    var w = {};
    snap.protocols.forEach(function (p) { if (hasToken(p) && firstWord(p.name).length >= 3) w[firstWord(p.name)] = p.name; });
    return w;
  }
  function productOf(p, words) {
    if (p.category === 'CEX') return 'exchange';
    if (PRODUCT_CATS.indexOf(p.category) >= 0 || /bridge/i.test(p.category || '')) return p.category.toLowerCase();
    if (VERSIONED.test(p.name)) return 'versioned pool';
    if (WRAPPED.test(p.name)) return 'wrapped or staked';
    if (EXCHANGE.test(p.name)) return 'exchange product';
    if (words && !hasToken(p) && Object.prototype.hasOwnProperty.call(words, firstWord(p.name))) return 'sibling of ' + words[firstWord(p.name)];
    return null;
  }
  function bySlug(a, b) { return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0; }

  /* Fit the value curve on protocols whose token trades. One token is one point: protocols sharing a
   * CoinGecko id (a v2 and v3, a lending arm and a DEX) pool their TVL, since DefiLlama hangs the
   * whole token's market cap on each. Products and exchanges are left out by the same productOf rule
   * that sets them aside on the board. Returns the slope, each family's multiple and the fit's error. */
  function calibrate(snap) {
    var tok = {}, order = [];
    snap.protocols.forEach(function (p) {
      if (!trades(p) || p.tvl_usd <= 0 || productOf(p)) return;
      var k = p.gecko_id || p.symbol || p.slug;
      if (!tok[k]) { tok[k] = { p: p, tvl: 0, mcap: 0, members: 0 }; order.push(k); }
      var t = tok[k];
      t.tvl += p.tvl_usd; t.members++;
      t.mcap = Math.max(t.mcap, p.mcap_usd);
      if (p.tvl_usd > t.p.tvl_usd) t.p = p;
    });
    var pts = order.map(function (k) {
      var t = tok[k];
      return { p: t.p, tvl: t.tvl, mcap: t.mcap, members: t.members, f: family(t.p), x: Math.log(t.tvl / M.ref_tvl), y: Math.log(clamp(t.mcap / t.tvl, M.ratio_floor, M.ratio_cap)) };
    });
    var full = fitPoints(pts);
    // Error is measured out of sample and against the real market cap: each token is predicted by a
    // fit that leaves it out (leave-one-out), and its miss is ln(actual mcap / prediction), unclipped.
    var miss = pts.map(function (q, i) {
      q.fit = Math.round(predict(full, q));
      q.loo = predict(fitPoints(pts.filter(function (o, j) { return j !== i; })), q);
      return Math.log(q.mcap / q.loo);
    });
    var sorted = miss.slice().sort(function (u, v) { return u - v; });
    var absMiss = miss.map(Math.abs).sort(function (u, v) { return u - v; });
    var inBand = 0, q25 = quantile(sorted, 0.25), q75 = quantile(sorted, 0.75);
    miss.forEach(function (m) { if (m >= q25 && m <= q75) inBand++; });
    return { slope: full.b, elasticity: 1 + full.b, base: Math.exp(full.all), families: full.fams, n: pts.length, points: pts,
      median_error: Math.exp(quantile(absMiss, 0.5)), band_low: Math.exp(q25), band_high: Math.exp(q75), band_hits: inBand,
      clipped: pts.filter(function (q) { var r = q.mcap / q.tvl; return r < M.ratio_floor || r > M.ratio_cap; }).length };
  }
  function quantile(a, t) { var i = (a.length - 1) * t, lo = Math.floor(i); return a[lo] + (a[Math.min(lo + 1, a.length - 1)] - a[lo]) * (i - lo); }
  function predict(f, q) { return q.tvl * Math.exp(f.fams[q.f].ln + f.b * q.x); }

  /* The least-squares core: a slope pooled within families, then family intercepts shrunk toward the
   * all-family mean with shrink_k pseudo-peers. */
  function fitPoints(pts) {
    var g = {};
    pts.forEach(function (q) { (g[q.f] = g[q.f] || []).push(q); });
    var sxy = 0, sxx = 0;
    Object.keys(g).forEach(function (f) {
      var a = g[f], mx = 0, my = 0;
      a.forEach(function (q) { mx += q.x; my += q.y; });
      mx /= a.length; my /= a.length;
      a.forEach(function (q) { sxy += (q.x - mx) * (q.y - my); sxx += (q.x - mx) * (q.x - mx); });
    });
    var b = clamp(sxx > 0 ? sxy / sxx : 0, -0.9, 0.2);
    var all = 0;
    pts.forEach(function (q) { all += q.y - b * q.x; });
    all /= pts.length;
    var fams = {};
    FAMILIES.forEach(function (fd) {
      var a = g[fd[0]] || [], s = 0;
      a.forEach(function (q) { s += q.y - b * q.x; });
      var raw = a.length ? s / a.length : all;
      var shrunk = (a.length * raw + M.shrink_k * all) / (a.length + M.shrink_k);
      fams[fd[0]] = { key: fd[0], label: fd[1], peers: a.length, raw: Math.exp(raw), multiple: Math.exp(shrunk), ln: shrunk };
    });
    return { b: b, all: all, fams: fams };
  }

  /* The implied value of one protocol under the fit, with each factor kept for the detail view. */
  function value(p, fit, asOf, ageFallback) {
    var fam = fit.families[family(p)];
    var growth = clamp(p.change_7d == null ? 0 : p.change_7d, M.growth_floor, M.growth_cap);
    var tvlNext = p.tvl_usd * (1 + growth / 100);
    var sizeMult = Math.pow(tvlNext / M.ref_tvl, fit.slope);
    var fitted = tvlNext * fam.multiple * sizeMult;
    var age = ageDays(asOf, p.listed_at), ageUsed = age == null ? ageFallback : age;
    var timeF = M.age_low + (M.age_high - M.age_low) * Math.min(ageUsed, M.age_full) / M.age_full;
    var implied = Math.max(1, Math.round(fitted * timeF));

    // Airdrop yield: a drop of drop_share of the implied value, split over every dollar-day of TVL in
    // the current season (since listing, at most season_days) plus the plan's window.
    var apr = implied * M.drop_share / (tvlNext * (Math.min(ageUsed, M.season_days) + M.farm_days)) * 365;
    return { family: fam.key, growth: growth, growth_imputed: p.change_7d == null, age_imputed: age == null, tvl_next: Math.round(tvlNext), fam_multiple: fam.multiple, size_mult: sizeMult,
      fitted: Math.round(fitted), age: age, age_used: ageUsed, time_factor: timeF, implied: implied,
      low: Math.round(implied * fit.band_low), high: Math.round(implied * fit.band_high), multiple: implied / p.tvl_usd, apr: apr };
  }

  function usd(n) {
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e4) return '$' + Math.round(n / 1e3) + 'K';
    if (a >= 100) return '$' + Math.round(n).toLocaleString('en-US');
    return '$' + n.toFixed(2);
  }
  function mins(m) { return m < 60 ? m + ' min' : (m / 60).toFixed(m % 60 ? 1 : 0) + ' h'; }

  // Each family's two actions: the main position and a second one that widens the wallet's footprint.
  var ACT = {
    vault: ['Deposit {S} of USDC into the largest USDC vault {N} curates on {C}, straight from the vault page', 'Put a second, smaller deposit of {s} into another {N} vault (an ETH or BTC one) so the wallet holds two curated positions'],
    lend: ['Supply {S} of USDC to {N} on {C} and turn it on as collateral', 'Borrow {s} of a stablecoin against it and keep the health factor above 2.0: borrowing is the activity lenders usually reward most'],
    dex: ['Add {S} to a stablecoin or ETH pair on {N} on {C}, with a wide range if the pool is concentrated', 'Make one swap of about {s} a week through {N} so the wallet logs volume as well as liquidity'],
    deriv: ['Deposit {S} of USDC as margin on {N} on {C}', 'Each week open and close a small hedged trade of about {s} notional (long and short at 1-2x), fees near 0.05% a side'],
    predict: ['Deposit {S} of USDC on {N} on {C} and hold it as the account balance', 'Each week buy and later sell about {s} of shares across two or three liquid markets, so the wallet logs trading volume'],
    stable: ['Mint or deposit {S} into {N}\'s yield-bearing dollar on {C}', 'Deposit {s} of the receipt into a pool or money market that lists it, which many points programs count twice'],
    rwa: ['Complete {N}\'s onboarding (KYC where it asks; review often takes 1-2 days) and subscribe {S} to its tokenized yield product on {C}', 'Hold the token in the wallet the issuer whitelisted; use {s} of it as collateral where a market accepts it'],
    stake: ['Stake {S} worth of the native asset through {N} on {C} and keep the liquid receipt', 'Deposit {s} of the receipt into a DeFi pool that accepts it, so the stake counts in two places'],
    infra: ['Move {S} onto {C} through {N} (bridge, deposit or channel, whichever it offers) and keep it there', 'Use {s} of it in two other apps on {C} each week, so the wallet looks like a user, not a one-off deposit']
  };

  // What the second action costs: one-off ones two transactions, weekly ones every week of the window.
  var WEEKLY = { dex: 1, deriv: 1, predict: 1, infra: 1 };
  var ACT2 = {
    dex: function (s, tx, w) { return w * (s * 0.0005 + tx); },
    deriv: function (s, tx, w) { return w * (s * 0.001 + 2 * tx); },
    predict: function (s, tx, w) { return w * (s * 0.01 + 2 * tx); },
    infra: function (s, tx, w) { return w * 2 * tx; },
    lend: function (s, tx) { return 2 * tx; }, vault: function (s, tx) { return 2 * tx; }, stable: function (s, tx) { return 2 * tx; },
    rwa: function (s, tx) { return 2 * tx; }, stake: function (s, tx) { return 2 * tx; }
  };

  /* A farm plan: each step is an action, a dollar cost and a time, from the row's own figures. The
   * chain is the cheapest of the protocol's three main chains; the stake is the smallest position
   * whose expected drop covers the plan's costs three times, between $500 and $25,000. */
  function farmPlan(p, v) {
    var main = p.chains.slice(0, 3), chain = main[0] || 'its main chain';
    main.forEach(function (c) { if (gas(c) < gas(chain)) chain = c; });
    var kind = p.category === 'Prediction Market' ? 'predict' : v.family;
    var asset = /^(Bitcoin|Lightning)/.test(chain) ? 'BTC' : 'USDC';
    var tx = gas(chain), weeks = Math.round(M.farm_days / 7), perDollar = v.apr * M.farm_days / 365;
    function steps(stake) {
      var side = Math.round(stake / 4), act = ACT[kind];
      var fill = function (t) { return t.replace(/USDC/g, asset).replace(/\{S\}/g, usd(stake)).replace(/\{s\}/g, usd(side)).replace(/\{N\}/g, p.name).replace(/\{C\}/g, chain); };
      return [
        { act: 'Withdraw ' + usd(stake + side) + ' of ' + asset + ' from an exchange straight to a fresh wallet on ' + chain + (chain !== main[0] ? ' (cheaper than ' + main[0] + ', where it also runs)' : '') + '; keep only farm funds in it',
          usd: 1 + tx, min: 15, when: 'Day 0' },
        { act: fill(act[0]), usd: 2 * tx, min: v.family === 'rwa' ? 30 : 10, when: v.family === 'rwa' ? 'Days 0-2' : 'Day 0' },
        { act: fill(act[1]), usd: ACT2[kind](side, tx, weeks), min: kind in WEEKLY ? weeks * 10 : 10, when: kind in WEEKLY ? 'Weeks 1-' + weeks : 'Day 1' },
        { act: 'Once a week for ' + weeks + ' weeks, open the points or rewards page, re-check the position and top it up by one transaction', usd: weeks * tx, min: weeks * 5, when: 'Weeks 1-' + weeks },
        { act: 'Exit if TVL falls below ' + usd(p.tvl_usd * 0.75) + ' (25% under today\'s ' + usd(p.tvl_usd) + ') or the team reports an incident; otherwise hold the full ' + M.farm_days + ' days', usd: 2 * tx, min: 10, when: 'Day ' + M.farm_days },
        { act: 'At launch claim only through the protocol\'s own app; the model prices the token near ' + usd(v.implied) + ' (band ' + usd(v.low) + '-' + usd(v.high) + '), so sell the claim if it opens above ' + usd(v.high), usd: 2 * tx, min: 15, when: 'At launch' }
      ];
    }
    function total(st) { var c = 0, t = 0; st.forEach(function (s) { c += s.usd; t += s.min; }); return { cost: c, min: t, all: c + t / 60 * M.hour_usd }; }
    // Only capital that sits in the protocol earns: the main deposit, plus the side deposit for vaults
    // (a second vault); borrowed, re-used or traded side amounts are activity, not extra capital.
    function eligible(stake) { return kind === 'vault' ? stake + Math.round(stake / 4) : stake; }
    // The smallest stake, in $400 steps of main deposit ($500 of capital), whose drop covers the plan's
    // actual costs target_cover times; total capital never passes $25,000.
    var stake = 20000;
    for (var k = 400; k <= 20000; k += 400) {
      if (eligible(k) * perDollar >= M.target_cover * total(steps(k)).all) { stake = k; break; }
    }
    var st = steps(stake), t = total(st), capital = stake + Math.round(stake / 4), drop = eligible(stake) * perDollar;
    var verdict = drop >= M.target_cover * t.all ? 'farm' : drop >= t.all ? 'marginal' : 'skip';
    // A plan that does not clear the target says so first, with the drop share that would make it pay.
    var needShare = M.drop_share * M.target_cover * t.all / Math.max(drop, 1e-9);
    if (verdict !== 'farm') {
      st.unshift({ when: 'Before you start', usd: 0, min: 5, act: 'Decide: at ' + usd(capital) + ' the expected drop of ' + usd(drop) + ' covers the plan\'s ' + usd(t.all) +
        ' of gas, fees and time ×' + (drop / t.all).toFixed(2) + '; it pays ×' + M.target_cover + ' only if about ' + (needShare * 100).toFixed(needShare < 0.1 ? 1 : 0) +
        '% of the token goes to depositors (the model assumes ' + M.drop_share * 100 + '%), so ' + (verdict === 'skip' ? 'skip it unless the team announces a larger user allocation' : 'farm it only with funds already on ' + chain) });
    }
    return { chain: chain, gas: tx, stake: capital, eligible: eligible(stake), asset: asset, steps: st, cost: t.cost, minutes: t.min, time_usd: t.min / 60 * M.hour_usd, all_in: t.all,
      days: M.farm_days, drop: drop, net: drop - t.all, need_share: needShare, verdict: verdict };
  }
  function stepText(s) {
    var t = s.when + ': ' + s.act + '. Cost: about ' + usd(s.usd) + '. Time: ' + mins(s.min) + '.';
    return t.length > 600 ? t.slice(0, 597) + '...' : t;
  }

  /* The whole radar: the fit, the ranked pre-token board, and the trading set kept apart. */
  function build(snap) {
    var fit = calibrate(snap);
    var watch = {};
    snap.watchlist.forEach(function (s) { watch[s] = true; });
    var noToken = snap.protocols.filter(function (p) { return !hasToken(p) && p.tvl_usd > 0; });
    var words = tokenWords(snap);
    var pre = noToken.filter(function (p) { return watch[p.slug] || !productOf(p, words); });
    var products = noToken.filter(function (p) { return !watch[p.slug] && productOf(p, words); }).map(function (p) { return { p: p, kind: productOf(p, words) }; })
      .sort(function (a, b) { return b.p.tvl_usd - a.p.tvl_usd || bySlug(a.p, b.p); });
    var ages = pre.map(function (p) { return ageDays(snap.as_of, p.listed_at); }).filter(function (a) { return a != null; }).sort(function (a, b) { return a - b; });
    var ageFallback = ages.length ? ages[ages.length >> 1] : 365;
    var rows = pre.map(function (p) {
      var v = value(p, fit, snap.as_of, ageFallback);
      return { p: p, v: v, plan: farmPlan(p, v), watch: !!watch[p.slug], below: p.tvl_usd < snap.floor_usd };
    });
    rows.sort(function (a, b) { return b.v.implied - a.v.implied || bySlug(a.p, b.p); });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    var live = fit.points.map(function (q) { return { p: q.p, tvl: q.tvl, members: q.members, family: q.f, fit: q.fit, loo: Math.round(q.loo), actual: q.mcap }; })
      .sort(function (a, b) { return b.actual - a.actual || bySlug(a.p, b.p); });
    var listedOnly = snap.protocols.filter(function (p) { return hasToken(p) && !trades(p); }).length;
    return { model: M, fit: fit, rows: rows, live: live, products: products, listed_only: listedOnly, age_fallback: ageFallback, families: FAMILIES };
  }

  /* board.json's rows: the gate's five fields plus the figures behind them. */
  function boardRows(radar) {
    return radar.rows.map(function (r) {
      return { rank: r.rank, slug: r.p.slug, name: r.p.name, implied_value_usd: r.v.implied,
        farm_steps: r.plan.steps.map(stepText),
        token_status: 'pre-token', on_watchlist: r.watch, category: r.p.category, family: r.v.family, chains: r.p.chains,
        tvl_usd: r.p.tvl_usd, change_7d: r.p.change_7d, days_without_token: r.v.age, implied_low_usd: r.v.low, implied_high_usd: r.v.high,
        factors: { family_multiple: +r.v.fam_multiple.toFixed(4), size: +r.v.size_mult.toFixed(4), momentum_tvl: r.v.tvl_next, time: +r.v.time_factor.toFixed(4) },
        airdrop_apr: +r.v.apr.toFixed(4), farm: { chain: r.plan.chain, capital_usd: r.plan.stake, cost_usd: +r.plan.cost.toFixed(2), minutes: r.plan.minutes, expected_drop_usd: +r.plan.drop.toFixed(2), drop_share_for_target: +r.plan.need_share.toFixed(4), verdict: r.plan.verdict } };
    });
  }

  var api = { MODEL: M, productOf: productOf, FAMILIES: FAMILIES, family: family, calibrate: calibrate, value: value, farmPlan: farmPlan, stepText: stepText, build: build, boardRows: boardRows, usd: usd, mins: mins, gas: gas };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RadarModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
