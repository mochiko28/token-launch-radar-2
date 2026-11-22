/* Launch Radar value model, run by main.ts (board.json) and by the page: every number on screen is
 * computed here from the snapshot. No protocol name appears in this file. */
(function (root) {
  'use strict';

  var DAY = 86400000;
  var M = {
    version: 'radar-fit-3',
    ref_tvl: 1e8, // the fit's reference size: $100M of TVL
    ratio_floor: 0.02, // mcap/TVL outliers are clipped before the fit
    ratio_cap: 20,
    growth_floor: -30, // 7-day change used for momentum, clipped (per cent)
    growth_cap: 50,
    odds_days: 365, // launch odds are for a token within this many days
    ev_days: 1095, // each plan also weighs its drop by the odds of a token within this many days
    odds_ridge: 1, // L2 penalty of the odds fit: best-calibrated walk-forward of the leave-one-out ties
    drop_share: 0.10, // assumed share of supply sent to depositors, pro rata to TVL-days
    farm_days: 90, // the plan's holding window
    hour_usd: 25, // the reader's hands-on time, priced into every plan
    target_cover: 2, // deposit sized so the drop covers gas and time this many times
    season_days: 365 // TVL-days older than this count as paid by earlier seasons
  };

  // Data tables (category families, gas per chain, step wording) live in lib/tables.json: main.ts
  // passes them here and writes them into data.js, so the page calls use() with the same tables.
  var FAMILIES = [], FAM_OF = {}, GAS = {}, GAS0 = 0.3, ACT = {};
  function use(t) {
    FAMILIES = api.FAMILIES = t.families; GAS = t.gas; GAS0 = t.gas_default; ACT = t.act; FAM_OF = {};
    FAMILIES.forEach(function (f) { f[2].forEach(function (c) { FAM_OF[c] = f[0]; }); });
  }
  function family(p) { return FAM_OF[p.category] || 'infra'; }
  function gas(chain) { return GAS[chain] != null ? GAS[chain] : GAS0; }

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
  // Plus: a no-token protocol named with the first word of a token-holding one is a likely sibling.
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
    if (words && !hasToken(p) && Object.prototype.hasOwnProperty.call(words, firstWord(p.name))) return 'likely sibling of ' + words[firstWord(p.name)];
    return null;
  }
  function bySlug(a, b) { return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0; }

  // The value curve, fitted on trading tokens: one point per CoinGecko id, its protocols' TVL pooled.
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
    // Category families enter the curve (k = 0) only if they lower the miss in both held-out tests, else
    // one size curve (k = Infinity). Misses: leave-one-out, against the real, unclipped market cap.
    var tests = termTests(pts, snap.as_of), k = tests.terms[2].ok ? 0 : Infinity;
    var miss = pts.map(function (q, i) { return Math.log(q.mcap / predict(fitPoints(pts.filter(function (o, j) { return j !== i; }), k), q)); });
    var full = fitPoints(pts, k);
    pts.forEach(function (q, i) { q.fit = Math.round(predict(full, q)); q.loo = q.mcap / Math.exp(miss[i]); });
    var sorted = miss.slice().sort(function (u, v) { return u - v; });
    var absMiss = miss.map(Math.abs).sort(function (u, v) { return u - v; });
    var inBand = 0, q25 = quantile(sorted, 0.25), q75 = quantile(sorted, 0.75);
    miss.forEach(function (m) { if (m >= q25 && m <= q75) inBand++; });
    return { k: k, slope: full.b, elasticity: 1 + full.b, base: Math.exp(full.all), families: full.fams, n: pts.length, points: pts,
      median_error: Math.exp(quantile(absMiss, 0.5)), band_low: Math.exp(q25), band_high: Math.exp(q75), band_hits: inBand,
      clipped: pts.filter(function (q) { var r = q.mcap / q.tvl; return r < M.ratio_floor || r > M.ratio_cap; }).length,
      tests: tests, odds: launchOdds(snap) };
  }

  /* Launch odds. F(p, a) = fitted share of peers (not exchanges or products) holding a token at age a,
   * given ln TVL, ln age, 7-day change and family (logistic, L2 penalty odds_ridge on all but the
   * intercept); q = (F(a + odds_days) - F(a)) / (1 - F(a)), the hazard. */
  function launchOdds(snap) {
    var peers = snap.protocols.filter(function (p) { return p.tvl_usd > 0 && !productOf(p); });
    var known = peers.map(function (p) { return ageDays(snap.as_of, p.listed_at); }).filter(function (a) { return a != null; }).sort(function (a, b) { return a - b; });
    var mid = known[known.length >> 1], fams = FAMILIES.slice(0, -1);
    var X = function (p, a) {
      return [1, Math.log(p.tvl_usd / M.ref_tvl), Math.log(1 + a / 365), Math.log(1 + clamp(p.change_7d || 0, M.growth_floor, M.growth_cap) / 100)]
        .concat(fams.map(function (f) { return family(p) === f[0] ? 1 : 0; }));
    };
    var pts = peers.map(function (p) { var a = ageDays(snap.as_of, p.listed_at); return { p: p, a: a, x: X(p, a == null ? mid : a), y: p.gecko_id != null || p.symbol != null ? 1 : 0 }; });
    // Newton steps from w0 (zeros, or the full fit's weights for a leave-one-out refit).
    function logit(T, w0, steps) {
      var n = T[0].x.length, w = [], it, i, j, k, t, g, H;
      for (i = 0; i < n; i++) w.push(w0 ? w0[i] : 0);
      for (it = 0; it < (steps || 25); it++) {
        g = w.map(function (v, i) { return i ? -M.odds_ridge * v : 0; });
        H = w.map(function (v, i) { return w.map(function (u, j) { return i === j ? (i ? M.odds_ridge : 1e-6) : 0; }); });
        T.forEach(function (q) { var pr = sig(dot(w, q.x)); for (i = 0; i < n; i++) { g[i] += (q.y - pr) * q.x[i]; for (j = 0; j < n; j++) H[i][j] += pr * (1 - pr) * q.x[i] * q.x[j]; } });
        for (i = 0; i < n; i++) for (k = 0; k < n; k++) if (k !== i) { t = H[k][i] / H[i][i]; for (j = 0; j < n; j++) H[k][j] -= t * H[i][j]; g[k] -= t * g[i]; }
        for (i = 0; i < n; i++) w[i] += g[i] / H[i][i];
      }
      return w;
    }
    function auc(T) {
      var pos = T.filter(function (q) { return q.y; }), neg = T.filter(function (q) { return !q.y; }), c = 0;
      pos.forEach(function (a) { neg.forEach(function (b) { c += a.s > b.s ? 1 : a.s === b.s ? 0.5 : 0; }); });
      return c / (pos.length * neg.length);
    }
    var w = logit(pts), F = function (p, a) { return sig(dot(w, X(p, a))); };
    var loo = pts.map(function (q, i) { return { y: q.y, s: dot(logit(pts.filter(function (o, j) { return j !== i; }), w, 3), q.x) }; });
    var dated = pts.filter(function (q) { return q.a != null; }).sort(function (u, v) { return v.a - u.a || bySlug(u.p, v.p); });
    var cut = Math.floor(dated.length * 0.6), ww = logit(dated.slice(0, cut));
    var wf = dated.slice(cut).map(function (q) { return { y: q.y, s: dot(ww, q.x) }; });
    // Cohort check: each listing-age cohort's share holding a token against the curve's mean prediction.
    var edges = [0, 180, 365, 730, 1095, 1e9], cohorts = edges.slice(0, 5).map(function (lo, c) {
      var m = pts.filter(function (q) { return q.a != null && q.a >= lo && q.a < edges[c + 1]; }), n = m.length || 1;
      return { from: lo, n: m.length, actual: m.reduce(function (t, q) { return t + q.y; }, 0) / n, fitted: m.reduce(function (t, q) { return t + F(q.p, q.a); }, 0) / n };
    });
    // Brier score (mean squared probability error) against the base rate, both held out the same way.
    var S = pts.reduce(function (t, q) { return t + q.y; }, 0), n = pts.length, rate = dated.slice(0, cut).reduce(function (t, q) { return t + q.y; }, 0) / cut;
    var bri = function (T, f) { return T.reduce(function (t, q) { return t + Math.pow(f(q) - q.y, 2); }, 0) / T.length; };
    var brier = { loo: bri(loo, function (q) { return sig(q.s); }), loo_base: bri(pts, function (q) { return (S - q.y) / (n - 1); }),
      wf: bri(wf, function (q) { return sig(q.s); }), wf_base: bri(wf, function () { return rate; }) };
    // A bootstrap refit: the odds curve fitted again on a resample of the peers.
    var boot = function (rnd) { var wb = logit(pts.map(function () { return pts[Math.floor(rnd() * n)]; }), w, 4); return function (p, a) { return sig(dot(wb, X(p, a))); }; };
    return { boot: boot, brier: brier, w: w, cohorts: cohorts, gap: Math.max.apply(null, cohorts.map(function (c) { return Math.abs(c.actual - c.fitted); })), n: pts.length, with_token: pts.filter(function (q) { return q.y; }).length, auc_loo: auc(loo), auc_wf: auc(wf), wf_n: wf.length,
      F: F };
  }
  function sig(z) { return 1 / (1 + Math.exp(-z)); }
  function dot(w, x) { return x.reduce(function (s, v, i) { return s + v * w[i]; }, 0); }

  // Each value term tested on real market caps, leave-one-out and walk-forward (60% listed first fit).
  function termTests(pts, asOf) {
    var ages = pts.map(function (q) { return ageDays(asOf, q.p.listed_at); });
    var mid = ages.filter(function (a) { return a != null; }).sort(function (a, b) { return a - b; });
    pts.forEach(function (q, i) {
      q.g = clamp(q.p.change_7d || 0, M.growth_floor, M.growth_cap) / 100;
      q.age = ages[i] == null ? mid[mid.length >> 1] : ages[i];
    });
    var dated = pts.filter(function (q) { return q.p.listed_at; }).sort(function (a, b) { return a.p.listed_at < b.p.listed_at ? -1 : a.p.listed_at > b.p.listed_at ? 1 : bySlug(a.p, b.p); });
    var cut = Math.floor(dated.length * 0.6);
    function score(make) {
      var err = function (m, q) { return Math.abs(Math.log(q.mcap / q.tvl) - m(q)); };
      var loo = pts.map(function (q, i) { return err(make(pts.filter(function (o, j) { return j !== i; })), q); });
      var m = make(dated.slice(0, cut));
      var wf = dated.slice(cut).map(function (q) { return err(m, q); });
      var med = function (a) { return Math.exp(quantile(a.sort(function (u, v) { return u - v; }), 0.5)); };
      return { loo: med(loo), wf: med(wf), w: make(pts).w };
    }
    var T = [
      ['flat', 'one multiple, no size term', function (q) { return [1]; }],
      ['size', 'size curve, ln TVL', function (q) { return [1, q.x]; }],
      ['family', '+ category family', null],
      ['growth', '+ 7-day change', function (q) { return [1, q.x, Math.log(1 + q.g)]; }],
      ['age', '+ days since listing', function (q) { return [1, q.x, Math.log(1 + q.age / 365)]; }]
    ].map(function (t) {
      var r = score(t[2] ? function (tr) { return ols(tr, t[2]); } : function (tr) { var f = fitPoints(tr, 0); var m = function (q) { return f.fams[q.f].ln + f.b * q.x; }; m.w = []; return m; });
      r.key = t[0]; r.label = t[1];
      return r;
    });
    T.forEach(function (t) { t.ok = t.key === 'flat' ? null : t.loo < T[t.key === 'size' ? 0 : 1].loo && t.wf < T[t.key === 'size' ? 0 : 1].wf; });
    return { terms: T, wf_n: dated.length - cut, wf_train: cut, wf_from: dated[cut].p.listed_at };
  }
  // Least squares by the normal equations; returns the predictor, its weights on .w.
  function ols(pts, feats) {
    var n = feats(pts[0]).length, A = [], v = [], i, j, r, t;
    for (i = 0; i < n; i++) { A.push([]); v.push(0); for (j = 0; j < n; j++) A[i].push(0); }
    pts.forEach(function (q) { var f = feats(q); for (i = 0; i < n; i++) { v[i] += f[i] * q.y; for (j = 0; j < n; j++) A[i][j] += f[i] * f[j]; } });
    for (i = 0; i < n; i++) for (r = 0; r < n; r++) if (r !== i) { t = A[r][i] / A[i][i]; for (j = 0; j < n; j++) A[r][j] -= t * A[i][j]; v[r] -= t * v[i]; }
    var w = v.map(function (x, k) { return x / A[k][k]; });
    var m = function (q) { return feats(q).reduce(function (s, x, k) { return s + x * w[k]; }, 0); };
    m.w = w;
    return m;
  }
  // FNV-1a of each row's slug and value: main.ts writes it to data.js, the cover recomputes and compares.
  function digest(rows) {
    var h = 2166136261;
    rows.forEach(function (r) { var s = [r.rank, r.slug, r.name, r.implied_value_usd].concat(r.farm_steps).join('|'); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } });
    return ('0000000' + h.toString(16)).slice(-8);
  }
  function quantile(a, t) { var i = (a.length - 1) * t, lo = Math.floor(i); return a[lo] + (a[Math.min(lo + 1, a.length - 1)] - a[lo]) * (i - lo); }
  function predict(f, q) { return q.tvl * Math.exp(f.fams[q.f].ln + f.b * q.x); }

  /* Least squares: slope pooled within families, family intercepts pulled to the mean by k pseudo-peers
   * (k = Infinity: one curve for all). */
  function fitPoints(pts, k) {
    var g = {}, one = k === Infinity;
    pts.forEach(function (q) { var f = one ? 'all' : q.f; (g[f] = g[f] || []).push(q); });
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
      var a = pts.filter(function (q) { return q.f === fd[0]; }), s = 0;
      a.forEach(function (q) { s += q.y - b * q.x; });
      var raw = a.length ? s / a.length : all;
      var shrunk = one ? all : (a.length * raw + k * all) / (a.length + k);
      fams[fd[0]] = { key: fd[0], label: fd[1], peers: a.length, raw: Math.exp(raw), multiple: Math.exp(shrunk), ln: shrunk };
    });
    return { b: b, all: all, fams: fams };
  }

  /* Implied value of one protocol, every factor kept for the detail view. */
  function value(p, fit, asOf, ageFallback) {
    var fam = fit.families[family(p)];
    var growth = clamp(p.change_7d == null ? 0 : p.change_7d, M.growth_floor, M.growth_cap);
    var tvlNext = p.tvl_usd * (1 + growth / 100);
    var sizeMult = Math.pow(tvlNext / M.ref_tvl, fit.slope);
    var fitted = tvlNext * fam.multiple * sizeMult;
    var age = ageDays(asOf, p.listed_at), ageUsed = age == null ? ageFallback : age;
    var o = fit.odds, f0 = o.F(p, ageUsed), f1 = o.F(p, ageUsed + M.odds_days), timeF = (f1 - f0) / (1 - f0);
    var q3 = (o.F(p, ageUsed + M.ev_days) - f0) / (1 - f0);
    var implied = Math.max(1, Math.round(fitted * timeF));

    // Airdrop yield if it launches: drop_share of the value if launched, split over every dollar-day of
    // TVL in the current season (since listing, at most season_days) plus the plan's window.
    var apr = fitted * M.drop_share / (tvlNext * (Math.min(ageUsed, M.season_days) + M.farm_days)) * 365;
    return { family: fam.key, growth: growth, growth_imputed: p.change_7d == null,tvl_next: Math.round(tvlNext), fam_multiple: fam.multiple, size_mult: sizeMult,
      fitted: Math.round(fitted), age: age, age_used: ageUsed, time_factor: timeF, q3: q3, f0: f0, f1: f1, implied: implied,
      low: Math.round(implied * fit.band_low), high: Math.round(implied * fit.band_high), cap_high: Math.round(fitted * fit.band_high), multiple: implied / p.tvl_usd, apr: apr };
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


  // The second action's cost: weekly kinds pay [fee share of the amount, transactions] every week of the
  // window; every other kind pays two transactions once.
  var WEEKLY = { dex: [0.0005, 1], deriv: [0.001, 2], predict: [0.01, 2], infra: [0, 2] };

  /* A farm plan from the row's own figures: steps with a dollar cost and a time each, on the cheapest of
   * its three main chains. */
  function farmPlan(p, v, dep) {
    var main = p.chains.slice(0, 3), chain = main[0] || 'its main chain';
    main.forEach(function (c) { if (gas(c) < gas(chain)) chain = c; });
    var kind = p.category === 'Prediction Market' ? 'predict' : v.family;
    var asset = /^(Bitcoin|Lightning)/.test(chain) ? 'BTC' : 'USDC';
    var tx = gas(chain), weeks = Math.round(M.farm_days / 7), perDollar = v.apr * M.farm_days / 365;
    function steps(stake) {
      var side = Math.round(stake / 4), act = ACT[kind];
      var fill = function (t) { return t.replace(/USDC/g, asset).replace(/\{S\}/g, usd(stake)).replace(/\{s\}/g, usd(side)).replace(/\{N\}/g, p.name).replace(/\{C\}/g, chain); };
      return [
        { act: 'Kill test: go on only if ' + p.name + ' shows a live points or rewards page and a deposit-and-withdraw quote on ' + chain + ' totals under ' + usd(0.1 * eligible(stake) * perDollar) + ' (10% of the modeled drop); if either fails, stop with $0 spent', usd: 0, min: 10, when: 'Day 0' },
        { act: 'Withdraw ' + usd(stake + side) + ' of ' + asset + ' from an exchange straight to a fresh wallet on ' + chain + (chain !== main[0] ? ' (cheaper than ' + main[0] + ', where it also runs)' : '') + '; keep only farm funds in it',
          usd: 1 + tx, min: 15, when: 'Day 0' },
        { act: fill(act[0]), usd: 2 * tx, min: v.family === 'rwa' ? 30 : 10, when: v.family === 'rwa' ? 'Days 0-2' : 'Day 0' },
        { act: fill(act[1]), usd: WEEKLY[kind] ? weeks * (side * WEEKLY[kind][0] + WEEKLY[kind][1] * tx) : 2 * tx, min: kind in WEEKLY ? weeks * 10 : 10, when: kind in WEEKLY ? 'Weeks 1-' + weeks : 'Day 1' },
        { act: 'Once a week for ' + weeks + ' weeks, open the points or rewards page, re-check the position and top it up by one transaction', usd: weeks * tx, min: weeks * 5, when: 'Weeks 1-' + weeks },
        { act: 'Unwind: ' + act[2] + '; do it early if TVL falls below ' + usd(p.tvl_usd * 0.75) + ' (25% under today\'s ' + usd(p.tvl_usd) + ') or the team reports an incident', usd: 2 * tx, min: 15, when: 'Day ' + M.farm_days },
        { act: 'At launch claim only through the protocol\'s own app; the model prices it near ' + usd(v.fitted) + ' if launched, so sell the claim if the token opens above ' + usd(v.cap_high) + ' fully diluted (top of its 50% band)', usd: 2 * tx, min: 15, when: 'At launch' }
      ];
    }
    function total(st) { var c = 0, t = 5; st.forEach(function (s) { c += s.usd; t += s.min; }); return { cost: c, min: t, all: c + t / 60 * M.hour_usd }; }
    // Only capital in the protocol earns: the deposit, plus the side deposit for vaults (a second vault).
    function eligible(stake) { return kind === 'vault' ? stake + Math.round(stake / 4) : stake; }
    // The smallest deposit ($500 steps of capital, up to $25,000) whose drop covers costs target_cover times.
    // A reader's deposit (dep, total capital) fixes the stake; otherwise search for the least that pays.
    var stake = dep ? Math.round(dep / 1.25) : 20000;
    for (var k = 400; !dep && k <= 20000; k += 400) {
      if (eligible(k) * perDollar >= M.target_cover * total(steps(k)).all) { stake = k; break; }
    }
    var st = steps(stake), t = total(st), capital = stake + Math.round(stake / 4), drop = eligible(stake) * perDollar;
    var verdict = drop >= M.target_cover * t.all ? 'farm' : drop >= t.all ? 'marginal' : 'skip';
    // Every plan opens with its decision: the numbers, and the drop share at which it pays target_cover.
    var needShare = M.drop_share * M.target_cover * t.all / Math.max(drop, 1e-9);
    st.unshift({ when: 'Before you start', usd: 0, min: 5, act: 'Decide: launch odds are ' + Math.round(v.time_factor * 100) + '% within a year and ' + Math.round(v.q3 * 100) + '% within 3, so the odds-weighted drop is ' + usd(drop * v.q3) + ' (×' + (drop * v.q3 / t.all).toFixed(2) + ' the costs); if it launches, at ' + usd(capital) + ' the modeled drop of ' + usd(drop) + ' covers the plan\'s ' + usd(t.all) +
      ' of gas, fees and time (5 min of it this check) ×' + (drop / t.all).toFixed(2) + '; it pays ×' + M.target_cover + ' if at least ' + (needShare * 100).toFixed(1) +
      '% of the token goes to depositors (the model assumes ' + M.drop_share * 100 + '%; at 5% it pays ×' + (drop / t.all / 2).toFixed(2) + ', at 20% ×' + (drop / t.all * 2).toFixed(2) + '), so ' + (verdict === 'farm' ? 'farm it, and re-check if the team announces a smaller user allocation' : verdict === 'skip' ? 'skip it unless the team announces a larger user allocation' : 'farm it only with funds already on ' + chain) });
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
    // Rank crossing: each row's rank under three declared alternatives, and whether it stays top 20 in all.
    var ALT = { 'without momentum': function (r) { return r.v.fitted * Math.pow(r.p.tvl_usd / r.v.tvl_next, 1 + fit.slope) * r.v.time_factor; },
      'at 2-year odds': function (r) { return r.v.fitted * (fit.odds.F(r.p, r.v.age_used + 730) - r.v.f0) / (1 - r.v.f0); },
      'if launched': function (r) { return r.v.fitted; } };
    Object.keys(ALT).forEach(function (k) { rows.slice().sort(function (a, b) { return ALT[k](b) - ALT[k](a) || bySlug(a.p, b.p); }).forEach(function (r, i) { (r.alt = r.alt || {})[k] = i + 1; }); });
    // Bootstrap: refit the value curve on resampled trading tokens and the launch odds on resampled peers,
    // 40 seeded draws (every run agrees), and count how often each row ranks in the top 20.
    var seed = 7, rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    rows.forEach(function (r) { r.boot = 0; });
    for (var d = 0; d < 40; d++) {
      var bs = fit.points.map(function () { return fit.points[Math.floor(rnd() * fit.points.length)]; }), bf = fitPoints(bs, fit.k), Fb = fit.odds.boot(rnd);
      rows.map(function (r) {
        var a = r.v.age_used, f0 = Fb(r.p, a), qb = (Fb(r.p, a + M.odds_days) - f0) / (1 - f0);
        return { r: r, s: r.v.tvl_next * Math.exp(bf.fams[r.v.family].ln + bf.b * Math.log(r.v.tvl_next / M.ref_tvl)) * qb };
      })
        .sort(function (a, b) { return b.s - a.s || bySlug(a.r.p, b.r.p); }).slice(0, 20).forEach(function (o) { o.r.boot += 1 / 40; });
    }
    rows.forEach(function (r) { r.stable = r.rank <= 20 && Object.keys(r.alt).every(function (k) { return r.alt[k] <= 20; }); });
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
        token_status: 'pre-token', on_watchlist: r.watch, implied_low_usd: r.v.low, implied_high_usd: r.v.high,
        farm: { capital_usd: r.plan.stake, cost_usd: +r.plan.cost.toFixed(2), minutes: r.plan.minutes, drop_usd: +r.plan.drop.toFixed(2), verdict: r.plan.verdict } };
    });
  }

  var api = { use: use, digest: digest, MODEL: M, productOf: productOf, FAMILIES: FAMILIES, family: family, calibrate: calibrate, value: value, farmPlan: farmPlan, stepText: stepText, build: build, boardRows: boardRows, usd: usd, mins: mins, gas: gas };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RadarModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
