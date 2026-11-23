(function (root) {
'use strict';

var DAY = 86400000;
var { abs, exp, floor, imul, log, max, min, pow, round, sqrt } = Math;
var M = {
 version: 'radar-fit-3',
 ref_tvl: 1e8,
 ratio_floor: 0.02,
 ratio_cap: 20,
 growth_floor: -30,
 growth_cap: 50,
 odds_ridge: 1,
 farm_days: 90,
 carry_rate: 0.04,
 target_cover: 2,
 season_days: 365,
 product_haircut: 0.65
};

var FAMILIES = [], FAM_OF = {}, GAS = {}, GAS0 = 0.3, ACT = {};
function use(t) {
 FAMILIES = api.FAMILIES = t.families; GAS = t.gas; GAS0 = t.gas_default; ACT = t.act; FAM_OF = {};
 M.hour_usd = t.hour_usd; M.drop_share = t.drop_share;
 FAMILIES.forEach(([key, , cats]) => cats.forEach(c => { FAM_OF[c] = key; }));
}
function family(p) { return FAM_OF[p.category] || 'infra'; }
function gas(chain) { return GAS[chain] ?? GAS0; }

var asc = (a, b) => a - b;
function clamp(x, lo, hi) { return max(lo, min(hi, x)); }
var growthOf = p => clamp(p.change_7d ?? 0, M.growth_floor, M.growth_cap);
function hasToken(p) { return p.gecko_id != null || p.symbol != null || p.mcap_usd != null; }
function trades(p) { return p.mcap_usd != null && p.mcap_usd > 0; }
function ageDays(asOf, listed) {
 if (!listed) return null;
 var d = floor((Date.parse(asOf + 'T00:00:00Z') - Date.parse(listed + 'T00:00:00Z'))/DAY);
 return isFinite(d) ? max(0, d) : null;
}
var LIQUID = /^Liquid (Staking|Restaking)$/;
var VERSIONED = /\s([Vv]\d+(\.\d+)?|\d+\.\d+)$/;
var WRAPPED = /\b(wrapped|staked|staking)\b/i;
var EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
function firstWord(n) { return n.toLowerCase().split(/[\s.-]+/)[0]; }
function tokenWords(snap) {
 var w = Object.create(null);
 snap.protocols.forEach(p => {if (hasToken(p) && firstWord(p.name).length >= 3) w[firstWord(p.name)] = p.name;});
 return w;
}
function productOf(p, forBoard) {
 if (p.category === 'CEX') return 'exchange';
 if (p.category === 'Restaked BTC' || /bridge/i.test(p.category || '') || (!forBoard && LIQUID.test(p.category))) return p.category.toLowerCase();
 if (!forBoard && VERSIONED.test(p.name)) return 'versioned pool';
 if (WRAPPED.test(p.name)) return 'wrapped or staked';
 if (EXCHANGE.test(p.name)) return 'exchange product';
 return null;
}
function productFlag(p) {
 if (LIQUID.test(p.category)) return 'liquid-staking issuer: its receipt token is not a governance token; a drop is less certain';
 var base = p.name.replace(VERSIONED, '');
 return base !== p.name ? 'a version of ' + base + ': may share its token' : '';
}
function bySlug(a, b) { return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0; }

function byDate({ p: a }, { p: b }) {
 return a.listed_at < b.listed_at ? -1 : a.listed_at > b.listed_at ? 1 : bySlug(a, b);
}

function calibrate(snap) {
 var tok = {}, order = [];
 snap.protocols.forEach(p => {
  if (!trades(p) || p.tvl_usd <= 0 || productOf(p)) return;
  var k = p.gecko_id || p.symbol || p.slug;
  if (!tok[k]) { tok[k] = { p, tvl: 0, mcap: 0, members: 0 }; order.push(k); }
  var t = tok[k];
  t.tvl += p.tvl_usd; t.members++;
  t.mcap = max(t.mcap, p.mcap_usd);
  if (p.tvl_usd > t.p.tvl_usd) t.p = p;
 });
 var pts = order.map(k => {
  var t = tok[k];
  var tc = t.tvl*(1 + growthOf(t.p)/100);
  return {p: t.p,tvl: t.tvl,tc,mcap: t.mcap,members: t.members,f: family(t.p),x: log(tc/M.ref_tvl),y: log(clamp(t.mcap/tc,M.ratio_floor,M.ratio_cap)),
   sx: log(t.tvl/M.ref_tvl), sy: log(clamp(t.mcap/t.tvl, M.ratio_floor, M.ratio_cap)) };
 });
 var tests = termTests(pts, snap.as_of), k = tests.terms[3].ok ? 0 : Infinity;
 var miss = pts.map((q, i) => log(q.mcap/predict(fitCurve(pts.filter((o, j) => j !== i), k), q)));
 var full = fitCurve(pts, k);
 pts.forEach((q, i) => { q.fit = round(predict(full, q)); q.loo = q.mcap/exp(miss[i]); q.err = abs(miss[i]); });
 var sorted = miss.slice().sort(asc);
 var hold = (cal,te) => {cal = cal.slice().sort(asc); var a = quantile(cal,0.25),b = quantile(cal,0.75); return [te.filter(m => m >= a && m <= b).length,te.length];};
 var di = pts.map((q,i) => i).filter(i => pts[i].p.listed_at).sort((i,j) => byDate(pts[i],pts[j])),dc = floor(di.length*0.6);
 var bandWf = hold(di.slice(0, dc).map(i => miss[i]), di.slice(dc).map(i => miss[i]));
 var bandFam = FAMILIES.reduce((s,f) => {var r = hold(miss.filter((m,i) => pts[i].f !== f[0]),miss.filter((m,i) => pts[i].f === f[0])); return [s[0] + r[0],s[1] + r[1]];},[0,0]);
 var q25 = quantile(sorted, 0.25), q75 = quantile(sorted, 0.75);
 var cuts = [0, 1e7, 3e7, 1e8, 1e15], bands = cuts.slice(0, -1).map((lo, b) => {
  var hi = cuts[b + 1], peers = pts.filter(q => q.tvl >= lo && q.tvl < hi);
  var m = peers.map(q => q.err).sort(asc);
  var ratios = peers.map(q => q.mcap/q.tvl).sort(asc);
  return { lo, hi, n: m.length, miss: exp(quantile(m, 0.5)), p95: ratios.length ? quantile(ratios, 0.95) : null };
 });
 return {bands,k,slope: full.b,elasticity: 1 + full.b,base: exp(full.all),families: full.fams,n: pts.length,points: pts,
  band_low: exp(q25), band_high: exp(q75), band_wf: bandWf, band_fam: bandFam,
  tests, odds: launchOdds(snap) };
}

// Diagonalize the fit's normal equations in place.
function solve(A, v) {
 var n = v.length;
 for (var i = 0; i < n; i++) for (var r = 0; r < n; r++) if (r !== i) {
  var t = A[r][i]/A[i][i];
  for (var j = 0; j < n; j++) A[r][j] -= t*A[i][j];
  v[r] -= t*v[i];
 }
 return v.map((x, i) => x/A[i][i]);
}
function launchOdds(snap) {
 var peers = snap.protocols.filter(p => p.tvl_usd > 0 && !productOf(p));
 var known = peers.map(p => ageDays(snap.as_of, p.listed_at)).filter(a => a != null).sort(asc);
 var mid = known[known.length >> 1], fams = FAMILIES.slice(0, -1);
 var X = (p, a) => {
  return [1, log(p.tvl_usd/M.ref_tvl), log(1 + a/365), log(1 + growthOf(p)/100)]
   .concat(fams.map(f => family(p) === f[0] ? 1 : 0));
 };
 var pts = peers.map(p => {var a = ageDays(snap.as_of,p.listed_at); return {p,a,x: X(p,a ?? mid),y: hasToken(p) ? 1 : 0};});
 function logit(T, w0, steps) {
  var n = T[0].x.length, w = [], it, i, j, g, H;
  for (i = 0; i < n; i++) w.push(w0 ? w0[i] : 0);
  for (it = 0; it < (steps || 25); it++) {
   g = w.map((v, i) => i ? -M.odds_ridge*v : 0);
   H = w.map((v, i) => w.map((u, j) => i === j ? (i ? M.odds_ridge : 1e-6) : 0));
   T.forEach(q => {var pr = sig(dot(w,q.x)); for (i = 0; i < n; i++) {g[i] += (q.y - pr)*q.x[i]; for (j = 0; j < n; j++) H[i][j] += pr*(1 - pr)*q.x[i]*q.x[j];}});
   solve(H, g).forEach((x, i) => { w[i] += x; });
  }
  return w;
 }
 function auc(T) {
  var pos = T.filter(q => q.y), neg = T.filter(q => !q.y), c = 0;
  pos.forEach(a => { neg.forEach(b => { c += a.s > b.s ? 1 : a.s === b.s ? 0.5 : 0; }); });
  return c/(pos.length*neg.length);
 }
 var w = logit(pts), F = (p, a) => sig(dot(w, X(p, a)));
 var loo = pts.map((q, i) => ({ y: q.y, s: dot(logit(pts.filter((o, j) => j !== i), w, 3), q.x) }));
 var dated = pts.filter(q => q.a != null).sort((u, v) => v.a - u.a || bySlug(u.p, v.p));
 var cut = floor(dated.length*0.6);
 function held(cols) {
  var z = q => ({y: q.y,x: q.x.map((v,i) => cols.indexOf(i) < 0 ? v : 0)}),wd = logit(dated.slice(0,cut).map(z)),fw = {};
  return { wf: dated.slice(cut).map(q => ({ y: q.y, s: dot(wd, z(q).x) })),
   fam: pts.map(q => {var f = family(q.p); fw[f] = fw[f] || logit(pts.filter(o => family(o.p) !== f).map(z),w,4); return {y: q.y,s: dot(fw[f],z(q).x)};})};
 }
 var h0 = held([]), wf = h0.wf, lofo = h0.fam, ss = q => sig(q.s);
 var edges = [0, 180, 365, 730, 1095, 1e9], cohorts = edges.slice(0, 5).map((lo, c) => {
  var m = pts.filter(q => q.a != null && q.a >= lo && q.a < edges[c + 1]), n = m.length || 1;
  return {from: lo,n: m.length,actual: m.reduce((t,q) => t + q.y,0)/n,fitted: m.reduce((t,q) => t + F(q.p,q.a),0)/n};
 });
 var S = pts.reduce((t,q) => t + q.y,0),n = pts.length,rate = dated.slice(0,cut).reduce((t,q) => t + q.y,0)/cut;
 var bri = (T, f) => T.reduce((t, q) => t + pow(f(q) - q.y, 2), 0)/T.length;
 var brier = { loo: bri(loo, ss), loo_base: bri(pts, q => (S - q.y)/(n - 1)),
  wf: bri(wf, ss), wf_base: bri(wf, () => rate) };
 var boot = rnd => {var wb = logit(pts.map(() => pts[floor(rnd()*n)]),w,4); return (p,a) => sig(dot(wb,X(p,a)));};
 brier.fam = bri(lofo, ss);
 brier.fam_base = bri(pts,q => {var o = pts.filter(z => family(z.p) !== family(q.p)); return o.reduce((t,z) => t + z.y,0)/o.length;});
 var terms = [['all inputs',[]],['without TVL',[1]],['without days tracked',[2]],['without 7-day change',[3]],['without family',fams.map((f,i) => 4 + i)]]
  .map(t => { var h = t[1].length ? held(t[1]) : h0; return [t[0], bri(h.wf, ss), bri(h.fam, ss)]; });
 return {terms,mid,auc_fam: auc(lofo),boot,brier,w,gap: max(...cohorts.map(c => abs(c.actual - c.fitted))),n: pts.length,with_token: pts.filter(q => q.y).length,auc_loo: auc(loo),auc_wf: auc(wf),wf_n: wf.length,
  F };
}
function sig(z) { return 1/(1 + exp(-z)); }
function dot(w, x) { return x.reduce((s, v, i) => s + v*w[i], 0); }

function termTests(pts, asOf) {
 var ages = pts.map(q => ageDays(asOf, q.p.listed_at));
 var mid = ages.filter(a => a != null).sort(asc);
 pts.forEach((q, i) => {
  q.g = growthOf(q.p)/100;
  q.age = ages[i] ?? mid[mid.length >> 1];
 });
 var dated = pts.filter(q => q.p.listed_at).sort(byDate);
 var cut = floor(dated.length*0.6);
 function score(make, spot) {
  var err = (m, q) => abs(log(q.mcap/(spot ? q.tvl : q.tc)) - m(q));
  var med = a => exp(quantile(a.sort(asc), 0.5));
  var loo = pts.map((q, i) => err(make(pts.filter((o, j) => j !== i)), q));
  var m = make(dated.slice(0, cut)), wf = dated.slice(cut).map(q => err(m, q));
  var lofo = pts.map(q => err(make(pts.filter(o => o.f !== q.f)), q));
  return { loo: med(loo), wf: med(wf), lofo: med(lofo) };
 }
 var T = [
  ['flat', 'one multiple, spot TVL', q => [1], 1],
  ['spot', 'size curve, spot TVL', q => [1, q.sx], 1],
  ['size', 'size curve, TVL carried a week', q => [1, q.x]],
  ['family', '+ category family', null],
  ['growth', '+ 7-day change, own weight', q => [1, q.x, log(1 + q.g)]],
  ['age', '+ days since listing', q => [1, q.x, log(1 + q.age/365)]]
 ].map(t => {
  var r = score(t[2] ? tr => ols(tr,t[2],t[3] ? 'sy' : 'y') : tr => {var f = fitCurve(tr,0); return q => (f.fams[q.f].peers ? f.fams[q.f].ln : f.all) + f.b*q.x;},t[3]);
  r.key = t[0]; r.label = t[1];
  return r;
 });
 T.forEach((t,i) => {var b = T[i < 3 ? i - 1 : 2]; t.ok = i ? t.loo < b.loo && t.wf < b.wf && t.lofo < b.lofo : null;});
 return { terms: T, wf_n: dated.length - cut, wf_train: cut, wf_from: dated[cut].p.listed_at };
}
function ols(pts, feats, yk) {
 var n = feats(pts[0]).length, A = [], v = [], i, j;
 for (i = 0; i < n; i++) { A.push([]); v.push(0); for (j = 0; j < n; j++) A[i].push(0); }
 pts.forEach(q => {var f = feats(q); for (i = 0; i < n; i++) {v[i] += f[i]*q[yk || 'y']; for (j = 0; j < n; j++) A[i][j] += f[i]*f[j];}});
 var w = solve(A, v);
 return q => dot(w, feats(q));
}
// FNV-1a board digest.
function digest(rows) {
 var h = 2166136261;
 rows.forEach(r => {var s = [r.rank,r.slug,r.name,r.implied_value_usd,JSON.stringify(r.farm)].concat(r.farm_steps).join('|'); for (var i = 0; i < s.length; i++) {h ^= s.charCodeAt(i); h = imul(h,16777619) >>> 0;}});
 return h.toString(16).padStart(8, '0');
}
function quantile(a,t) {var i = (a.length - 1)*t,lo = floor(i); return a[lo] + (a[min(lo + 1,a.length - 1)] - a[lo])*(i - lo);}
function predict(f, q) { return q.tc*exp(f.fams[q.f].ln + f.b*q.x); }

// Pooled slope, k pseudo-peers per family.
function fitCurve(pts, k) {
 var g = {}, one = k === Infinity;
 pts.forEach(q => { var f = one ? 'all' : q.f; (g[f] = g[f] || []).push(q); });
 var sxy = 0, sxx = 0;
 Object.keys(g).forEach(f => {
  var a = g[f], mx = 0, my = 0;
  a.forEach(q => { mx += q.x; my += q.y; });
  mx /= a.length; my /= a.length;
  a.forEach(q => { sxy += (q.x - mx)*(q.y - my); sxx += (q.x - mx)*(q.x - mx); });
 });
 var b = clamp(sxx > 0 ? sxy/sxx : 0, -0.9, 0.2);
 var all = 0;
 pts.forEach(q => { all += q.y - b*q.x; });
 all /= pts.length;
 var fams = {};
 FAMILIES.forEach(fd => {
  var a = pts.filter(q => q.f === fd[0]), s = 0;
  a.forEach(q => { s += q.y - b*q.x; });
  var raw = a.length ? s/a.length : all;
  var shrunk = one ? all : (a.length*raw + k*all)/(a.length + k);
  fams[fd[0]] = { key: fd[0], label: fd[1], peers: a.length, raw: exp(raw), multiple: exp(shrunk), ln: shrunk };
 });
 return { b, all, fams };
}

function value(p, fit, asOf, medianAge, haircut) {
 var fam = fit.families[family(p)];
 var growth = growthOf(p);
 var drift = 1 + growth/100, tvl = p.tvl_usd*drift;
 var size = pow(tvl/M.ref_tvl, fit.slope);
 var fitted = tvl*fam.multiple*size;
 var age = ageDays(asOf, p.listed_at), ageUsed = age ?? medianAge;
 var score = fit.odds.F(p, ageUsed);
 var implied = max(1, round(fitted*score*haircut));

 var apr = fitted*M.drop_share/(tvl*(min(ageUsed, M.season_days) + M.farm_days))*365;
 return {slope: fit.slope,family: fam.key,growth,drift,growth_imputed: p.change_7d == null,tvl_next: round(tvl),fam_multiple: fam.multiple,size_mult: size,
  fitted: round(fitted), age, age_used: ageUsed, time_factor: score, f0: score, implied, haircut,
  low: round(implied*fit.band_low),high: round(implied*fit.band_high),cap_high: round(fitted*fit.band_high),multiple: implied/p.tvl_usd,apr};
}

function usd(n) {
 var a = abs(n);
 if (a >= 1e9) return '$' + (n/1e9).toFixed(2) + 'B';
 if (a >= 1e6) return '$' + (n/1e6).toFixed(1) + 'M';
 if (a >= 1e4) return '$' + round(n/1e3) + 'K';
 if (a >= 100) return '$' + round(n).toLocaleString('en-US');
 return '$' + n.toFixed(2);
}
function mins(m) { return m < 60 ? m + ' min' : (m/60).toFixed(m % 60 ? 1 : 0) + ' h'; }


var WEEKLY = { dex: [0.0005, 1], deriv: [0.001, 2], predict: [0.01, 2], infra: [0, 2] };
var MECH = {
 vault: ['VAULT', 'Bad debt / exit haircut'], lend: ['LEND', 'Liquidation'], dex: ['LP', 'Impermanent loss'],
 deriv: ['DERIV', 'Funding / liquidation'], predict: ['PREDICT', 'Adverse outcome'], stable: ['MINT', 'Depeg'],
 rwa: ['RWA','Redemption delay'],stake: ['STAKE','Slashing / exit discount'],restake: ['RESTAKE','Operator slashing'],
 infra: ['ROUTE', 'Route interruption']
};

function stressRate(kind) {
 var rate = ACT[kind][4][1];
 if (kind === 'dex') return 1 - 2*sqrt(1 + rate)/(2 + rate);
 return kind === 'deriv' ? rate*M.farm_days : rate;
}
function farmPlan(p, v, dep, hour, on) {
 var hr = hour ?? M.hour_usd, {target_cover: target,farm_days: days,drop_share: share} = M;
 var { name, category, chains, tvl_usd: tvl } = p, { apr, caution, time_factor: score } = v;
 var main = chains[0], chain = main || 'its main chain';
 chains.slice(0, 3).forEach(c => { if (gas(c) < gas(chain)) chain = c; });
 if (on && chains.includes(on)) chain = on;
 var kind = category === 'Prediction Market' ? 'predict' : /^(Liquid )?Restaking$/.test(category) ? 'restake' : v.family;
 var [tag, risk] = MECH[kind], act = ACT[kind];
 var mechanism = category === 'Derivatives' ? 'PERP' : /bridge/i.test(category) ? 'BRIDGE' : tag;
 var preflight = act[3] + (mechanism === 'PERP' ? ' and the market is perpetual' : '');
 var asset = /^(Bitcoin|Lightning)/.test(chain) ? 'BTC' : 'USDC';
 var amt = x => '$' + x.toLocaleString('en-US'), tx0 = gas(chain), weeks = round(days/7);
 var day0 = 'Day 0', week = 'Weeks 1-' + weeks, w = WEEKLY[kind], rwa = v.family === 'rwa';
 var fill = (t,n,side) => t.replace(/USDC/g,asset).replace(/\{S\}/g,amt(n)).replace(/\{s\}/g,amt(side)).replace(/\{N\}/g,name).replace(/\{C\}/g,chain);
 function steps(stake, gm) {
  var tx = tx0*(gm || 1), side = round(stake/4);
  return [
   {act: `Kill test. Confirm ${fill(preflight,stake,side)}. Quote entry, upkeep and exit below ${usd(0.1*earn(stake))} (10% of the modeled drop). If any check fails, stop with $0 spent`,usd: 0,min: 15,when: day0},
   {act: `Withdraw ${amt(stake+side)} of ${asset} from an exchange straight to a fresh wallet on ${chain}${tx0 < gas(main)?` (cheaper than ${main}, where it also runs)` : ''}; keep only farm funds in it`,
    usd: 1 + tx, min: 15, when: day0 },
   { act: fill(act[0], stake, side), usd: 2*tx, min: rwa ? 30 : 10, when: rwa ? 'Days 0-2' : day0 },
   {act: fill(act[1],stake,side),usd: w ? weeks*(side*w[0] + w[1]*tx) : kind === 'restake' ? 0 : 2*tx,min: w ? weeks*10 : 10,when: w ? week : 'Day 1'},
   {act: `Once a week for ${weeks} weeks, open the points or rewards page, re-check the position and re-deposit any claimed rewards in one transaction (no new principal)`,usd: weeks*tx,min: weeks*5,when: week},
   {act: `Unwind: ${act[2]}; do it early if TVL falls below ${usd(tvl*0.75)} (25% under today's ${usd(tvl)}) or the team reports an incident`,usd: 2*tx,min: 15,when: 'Day ' + days},
   {act: `At launch claim only through the protocol's own app; the model prices it near ${usd(v.fitted)} if launched, so sell the claim if its market cap opens above ${usd(v.cap_high)} (top of its 50% band; the model fits market cap, not FDV)`,usd: 2*tx,min: 15,when: 'At launch'}
  ];
 }
 function total(st) {
  var cost = 0, min = 5;
  st.forEach(s => { cost += s.usd; min += s.min; });
  return { cost, min, all: cost + min/60*hr };
 }
 // Tranches: [amount, entry day].
 function tranches(stake) {return kind === 'vault' ? [[stake,0],[round(stake/4),1]] : [[stake,kind === 'rwa' ? 2 : 0]];}
 function earn(stake) { return tranches(stake).reduce((a, [n, d]) => a + n*(days - d), 0)*apr/365; }
 // Bracket the first passing stake.
 var cov = k => earn(k)/total(steps(k)).all, cap = k => k + round(k/4), cert = null;
 var stake = dep ? round(dep/1.25) : 20000;
 for (var k = 400; !dep && k <= 20000; k += 400) if (cov(k) >= target) {stake = k; if (k > 400) cert = [cap(k - 400),cov(k - 400),cap(k),cov(k)]; break;}
 var st = steps(stake),{cost,min: minutes,all} = total(st),side = round(stake/4),capital = stake + side,drop = earn(stake);
 var trip = cost - st.at(-1).usd;
 var verdictAt = (c, d = drop) => !caution && d >= target*c ? 'farm' : d >= c ? 'marginal' : 'skip';
 var verdict = verdictAt(all), ratio = drop/all;
 var need = share*target*all/max(drop, 1e-9);
 var pay = 0, at = c => cov(round(c/1.25));
 for (var c = 25000, lo = 0; !pay && c <= 1000000; lo = c, c = round(c*1.25)) if (at(c) >= target) {
  for (pay = floor(lo/1000)*1000 + 1000; at(pay) < target;) pay += 1000;
  cert = cert || [pay - 1000, at(pay - 1000), pay, at(pay)];
 }
 var extra = pay ? `it would pay ×${target} at ${amt(pay)} of capital` : `no deposit up to $1M pays ×${target} because its fees grow with the deposit`;
 var beforeTime = caution || verdict === 'farm' ? '' : `; before your time it nets ${drop >= cost?'+' : '−'}${usd(abs(drop-cost))}, and ${extra}`;
 var next = caution ? 'verify depositor eligibility before committing' : verdict === 'farm' ? 'farm it, and re-check if the team announces a smaller user allocation' : verdict === 'skip' ? 'skip it unless a larger user allocation is announced' : 'farm it only with funds already on ' + chain;
 st.unshift({when: 'Before you start',usd: 0,min: 5,act: `Decide: ${caution?`${verdict} — ${caution}. ` : ''}${round(score*100)}% of peers like it record a token, so the score-weighted drop is ${usd(drop*score)} (×${(drop*score/all).toFixed(2)} the costs); if it launches, at ${amt(capital)} the modeled drop of ${usd(drop)} covers the plan's ${usd(all)}` +
  ` of gas, fees and time ×${ratio.toFixed(2)}; with no reward it loses ${usd(all)}${beforeTime}; it pays ×${target} if at least ${(need*100).toFixed(1)}% of the token goes to depositors (assumed ${share*100}%; at ${share*50}% it pays ×${(ratio/2).toFixed(2)}, at ${share*200}% ×${(ratio*2).toFixed(2)}), so ${next}`});
 if (verdict === 'skip') {
  st = [st[0],
   {when: day0,usd: 0,min: 15,act: `Research only, no deposit: check whether ${fill(preflight,stake,side)}`},
   {when: day0,usd: 0,min: 15,act: `Read ${name}'s docs and announcements for a stated user or depositor allocation; note the share, if any`},
   {when: day0,usd: 0,min: 5,act: `Write down the trigger that flips this plan: an announced allocation of at least ${(need*100).toFixed(0)}% to depositors, ${pay?`capital of ${amt(pay)} to commit, ` : ''}or TVL below ${usd(tvl*pow(target*all/drop,1/v.slope))} (a deposit's drop grows as TVL^${v.slope.toFixed(2)}, other figures fixed)`},
   {when: 'Day 30',usd: 0,min: 10,act: `Look again on a new snapshot; if the plan now pays ×${target}${caution?' and rewards are confirmed' : ''}, follow the full plan (${usd(capital)} capital, about ${usd(cost)} in fees, ${mins(round(minutes))} hands-on)`}];
 }
 var carry = capital*M.carry_rate*days/365, [stress, , base] = act[4];
 var fees = [0.5,3].map(m => {var a = total(steps(stake,m)); return [m,a.cost,drop - a.all,verdictAt(a.all)];});
 var shocks = { gas: [fees[0][3], verdictAt(total(steps(stake, 1.5)).all)],
  hour: [0.5, 1.5].map(m => verdictAt(cost + minutes/60*(hr*m))),
  share: [verdictAt(all, drop/2), verdictAt(all, drop*1.5)],
  costs: [0.5, 1.5, 2].map(m => verdictAt(all*m)) };
 var tr = tranches(stake);
 var loss = { capital, side, stake }[base || 'stake']*stressRate(kind);
 var net = drop - all;
 return {mechanism,risk,round_trip: trip,stress,stress_usd: loss,carry,hour: hr,chain,gas: tx0,fees,shocks,stake: capital,eligible: tr.reduce((a,t) => a + t[0],0),tranches: tr,asset,steps: st,cost,minutes,all_in: all,
  days, drop, net, net_apr: net/capital*(365/days), need_share: need, pay_cap: pay, cert, verdict };
}
// Shocks move FARM counts one way.
function farmFlips(rows) {
 var base = rows.filter(r => r.plan.verdict === 'farm').length, changes = {};
 Object.entries(rows[0].plan.shocks).forEach(([k, a]) => {
  changes[k] = a.map((_, i) => rows.filter(r => r.plan.shocks[k][i] === 'farm').length - base);
 });
 return { base, changes };
}
function stepText(s) {
 // Keep the cost and time suffix.
 var tail = `. Cost: about ${usd(s.usd)}. Time: ${mins(s.min)}.`, head = s.when + ': ' + s.act;
 var room = 600 - tail.length;
 return (head.length > room ? head.slice(0, room - 3) + '...' : head) + tail;
}

function build(snap) {
 var fit = calibrate(snap);
 var watch = new Set(snap.watchlist);
 var noToken = snap.protocols.filter(p => !hasToken(p) && p.tvl_usd > 0);
 var words = tokenWords(snap);
 var pre = noToken.filter(p => watch.has(p.slug) || !productOf(p, true));
 var products = noToken.map(p => ({ p, kind: productOf(p, true) })).filter(x => x.kind && !watch.has(x.p.slug))
  .sort((a, b) => b.p.tvl_usd - a.p.tvl_usd || bySlug(a.p, b.p));
 var ages = pre.filter(p => watch.has(p.slug) || !productOf(p)).map(p => ageDays(snap.as_of,p.listed_at)).filter(a => a != null).sort(asc);
 var medianAge = ages.length ? ages[ages.length >> 1] : 365;
 var rows = pre.map(p => {
  var flag = productFlag(p),wordMatch = words[firstWord(p.name)],v = value(p,fit,snap.as_of,medianAge,flag ? M.product_haircut : 1);
  if (wordMatch || flag) v.caution = wordMatch ? wordMatch + "'s token may already cover it" : LIQUID.test(p.category) ? 'liquid-staking drop is uncertain' : flag;
  return {p,v,plan: farmPlan(p,v),watch: watch.has(p.slug),below: p.tvl_usd < snap.floor_usd,wordMatch,flag};
 });
 rows.sort((a, b) => b.v.implied - a.v.implied || bySlug(a.p, b.p));
 rows.forEach((r, i) => { r.rank = i + 1; });
 rows.forEach((r, i) => {
  var up = i && rows[i - 1].v.implied,at = f => value({...r.p,tvl_usd: r.p.tvl_usd*f},fit,snap.as_of,medianAge,r.v.haircut).implied,lo = 1,hi = 2,k;
  if (!up) return;
  for (k = 0; k < 12 && at(hi) <= up; k++) { lo = hi; hi *= 2; }
  if (at(hi) <= up) return;
  for (k = 0; k < 30; k++) { var m = sqrt(lo*hi); if (at(m) > up) hi = m; else lo = m; }
  r.flip = hi;
 });
 var { F, mid, boot } = fit.odds;
 var ALT = {'without momentum': r => r.v.fitted*pow(r.p.tvl_usd/r.v.tvl_next,1 + fit.slope)*F({...r.p,change_7d: 0},r.v.age_used)*r.v.haircut,
  'score without age': r => r.v.fitted*F(r.p, mid)*r.v.haircut,
  'if launched': r => r.v.fitted };
 for (var [k, score] of Object.entries(ALT)) {
  rows.slice().sort((a, b) => score(b) - score(a) || bySlug(a.p, b.p))
   .forEach((r, i) => { (r.alt ||= {})[k] = i + 1; });
 }
 var seed = 7, rnd = () => { seed = (seed*16807) % 2147483647; return seed/2147483647; };
 rows.forEach(r => { r.boot = 0; r.draws = []; });
 for (var d = 0; d < 40; d++) {
  var bs = fit.points.map(() => fit.points[floor(rnd()*fit.points.length)]),bf = fitCurve(bs,fit.k),Fb = boot(rnd);
  rows.map(r => {
   var qb = Fb(r.p, r.v.age_used);
   return {r,s: r.v.tvl_next*exp(bf.fams[r.v.family].ln + bf.b*log(r.v.tvl_next/M.ref_tvl))*qb*r.v.haircut};
  })
   .sort((a,b) => b.s - a.s || bySlug(a.r.p,b.r.p)).forEach((o,i) => {o.r.draws.push(i + 1); if (i < 20) o.r.boot += 1/40;});
 }
 rows.forEach(r => { var d = r.draws.sort(asc); r.rlo = d[4]; r.rhi = d[35]; delete r.draws; });
 var q = t => ages[floor((ages.length - 1)*t)];
 rows.filter(r => r.v.age == null).forEach(r => {
  r.ageRange = [q(0.25), q(0.75)].map(a => {
   var val = r.v.fitted*F(r.p, a)*r.v.haircut;
   return { age: a, rank: 1 + rows.filter(o => o !== r && o.v.implied > val).length };
  });
 });
 rows.forEach(r => { r.stable = r.rank <= 20 && Object.keys(r.alt).every(k => r.alt[k] <= 20); });
 var live = fit.points.map(q => ({p: q.p,tvl: q.tvl,members: q.members,family: q.f,fit: q.fit,loo: round(q.loo),actual: q.mcap}))
  .sort((a, b) => b.actual - a.actual || bySlug(a.p, b.p));
 var listed = snap.protocols.filter(p => hasToken(p) && !trades(p)).length;
 var audit = rows.slice(0, 20).map(r => {
  var { p, v } = r, band = fit.bands.find(b => p.tvl_usd >= b.lo && p.tvl_usd < b.hi);
  var exclusion = hasToken(p) ? 'Token recorded' : productOf(p, true);
  var flag = LIQUID.test(p.category) ? 'Liquid-staking issuer: verify token status and rewards' : r.flag;
  var review = r.wordMatch ? 'Possible link to ' + r.wordMatch : flag || (!r.watch && !r.below ? 'Above watchlist floor' : '');
  return { r, exclusion, review, ratio: v.fitted/p.tvl_usd, p95: band?.p95 ?? null };
 });
 return { model: M, fit, rows, live, products, listed_only: listed, families: FAMILIES, audit };
}

function boardRows(radar) {
 var cents = n => +n.toFixed(2);
 return radar.rows.map(({ rank, p, v, plan: pl, watch }) => {
  var { mechanism, risk, minutes, stress, verdict } = pl;
  return { rank, slug: p.slug, name: p.name, implied_value_usd: v.implied,
   farm_steps: pl.steps.map(stepText),
   token_status: 'pre-token', on_watchlist: watch, implied_low_usd: v.low, implied_high_usd: v.high,
   farm: { mechanism, risk, round_trip_usd: cents(pl.round_trip), capital_usd: pl.stake,
    cost_usd: cents(pl.cost),minutes,drop_usd: cents(pl.drop),net_usd: cents(pl.net),net_apr_if_launched: pl.net_apr,days: pl.days,stress,stress_usd: cents(pl.stress_usd),verdict}};
 });
}

var api = { use, digest, FAMILIES, farmPlan, farmFlips, stressRate, build, boardRows, usd, mins };
if (typeof module === 'object' && module.exports) module.exports = api; else root.RadarModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
