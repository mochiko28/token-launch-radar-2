(function () {
'use strict';

var DAY = 86400000;
var { abs, exp, floor, imul, log, max, min, pow, round, sqrt } = Math;
var REF = 1e8, RIDGE = 1, LO = .02, HI = 20;
var M = {version: 'radar-fit-3',ref_tvl: REF,ratio_floor: LO,ratio_cap: HI,odds_ridge: RIDGE,
 growth_floor: -30,growth_cap: 50,farm_days: 90,
 carry_rate: .04,target_cover: 2,season_days: 365,product_haircut: .65};

var FAMILIES = [], FAM_OF = {}, GAS = {}, GAS0 = 0.3, ACT = {};
function use(t) {
 ({families:FAMILIES,gas:GAS,gas_default:GAS0,act:ACT,hour_usd:M.hour_usd,drop_share:M.drop_share} = t);
 api.FAMILIES = FAMILIES;
 FAM_OF = Object.fromEntries(FAMILIES.flatMap(([k,,cs]) => cs.map(c => [c,k])));
}
var family = p => FAM_OF[p.category] || 'infra', gas = c => GAS[c] ?? GAS0;
var asc = (a,b) => a-b, known = n => n != null;
var clamp = (x,lo,hi) => max(lo,min(hi,x));
var growthOf = p => clamp(p.change_7d ?? 0,M.growth_floor,M.growth_cap);
var ratioLog = (cap,tvl) => log(clamp(cap/tvl,LO,HI));
var sum = (a,f) => a.reduce((s,x) => s+f(x),0);
var without = (a,i) => a.filter((_,j) => i !== j);
var median = a => a[a.length >> 1];
var hasToken = p => known(p.gecko_id) || known(p.symbol) || known(p.mcap_usd);
var trades = p => p.mcap_usd > 0;
function ageDays(asOf, listed) {
 if (!listed) return null;
 var d = floor((Date.parse(asOf + 'T00:00:00Z') - Date.parse(listed + 'T00:00:00Z'))/DAY);
 return isFinite(d) ? max(0, d) : null;
}
var LIQUID = /^Liquid (Staking|Restaking)$/;
var VERSIONED = /\s([Vv]\d+(\.\d+)?|\d+\.\d+)$/;
var WRAPPED = /\b(wrapped|staked|staking)\b/i;
var EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
var firstWord = n => n.toLowerCase().split(/[\s.-]+/)[0];
function tokenWords(ps) {
 var w = Object.create(null);
 ps.filter(hasToken).forEach(({name}) => {var k = firstWord(name); if (k.length >= 3) w[k] = name;});
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
 if (LIQUID.test(p.category)) return 'liquid-staking issuer: receipt and governance tokens differ; drop uncertain';
 var base = p.name.replace(VERSIONED, '');
 return base !== p.name ? 'a version of ' + base + ': may share its token' : '';
}
var cmp = (a,b) => (a>b)-(a<b);
var bySlug = (a,b) => cmp(a.slug,b.slug);
var byDate = ({p:a},{p:b}) => cmp(a.listed_at,b.listed_at) || bySlug(a,b);

function calibrate(snap) {
 var tok = new Map();
 snap.protocols.forEach(p => {
  if (!trades(p) || p.tvl_usd <= 0 || productOf(p)) return;
  var k = p.gecko_id || p.symbol || p.slug;
  if (!tok.has(k)) tok.set(k,{p,tvl:0,mcap:0,members:0});
  var t = tok.get(k);
  t.tvl += p.tvl_usd; t.members++;
  t.mcap = max(t.mcap, p.mcap_usd);
  if (p.tvl_usd > t.p.tvl_usd) t.p = p;
 });
 var pts = [...tok.values()].map(({p,tvl,mcap,members}) => {
  var tc = tvl*(1+growthOf(p)/100);
  return {p,tvl,tc,mcap,members,f: family(p),x: log(tc/REF),y: ratioLog(mcap,tc),sx: log(tvl/REF),sy: ratioLog(mcap,tvl)};
 });
 var tests = termTests(pts, snap.as_of), k = tests.terms[3].ok ? 0 : Infinity;
 var miss = pts.map((q,i) => log(q.mcap/predict(fitCurve(without(pts,i),k),q)));
 var full = fitCurve(pts, k);
 pts.forEach((q, i) => { q.fit = round(predict(full, q)); q.loo = q.mcap/exp(miss[i]); q.err = abs(miss[i]); });
 var band = a => [.25,.75].map(q => quantile(a.slice().sort(asc),q));
 var hold = (cal,te) => {var [a,b] = band(cal); return [te.filter(m => m >= a && m <= b).length,te.length];};
 var dated = pts.filter(q => q.p.listed_at).sort(byDate).map(q => miss[pts.indexOf(q)]), cut = floor(dated.length*.6);
 var bandWf = hold(dated.slice(0,cut),dated.slice(cut));
 var bandFam = FAMILIES.reduce(([n,t],[f]) => {
  var [a,b] = hold(miss.filter((_,i) => pts[i].f !== f),miss.filter((_,i) => pts[i].f === f));
  return [n+a,t+b];
 },[0,0]);
 var [q25,q75] = band(miss);
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

function solve(A, v) {
 var n = v.length;
 for (var i=0;i<n;i++) for (var r=0;r<n;r++) if (r !== i) {
  var t = A[r][i]/A[i][i];
  for (var j=0;j<n;j++) A[r][j] -= t*A[i][j];
  v[r] -= t*v[i];
 }
 return v.map((x, i) => x/A[i][i]);
}
function launchOdds(snap) {
 var peers = snap.protocols.filter(p => p.tvl_usd > 0 && !productOf(p));
 var age = p => ageDays(snap.as_of,p.listed_at);
 var mid = median(peers.map(age).filter(known).sort(asc)), fams = FAMILIES.slice(0,-1);
 var X = (p,a) => [1,log(p.tvl_usd/REF),log(1+a/365),log(1+growthOf(p)/100),...fams.map(([f]) => +(family(p) === f))];
 var pts = peers.map(p => {var a = age(p); return {p,a,x: X(p,a ?? mid),y: +hasToken(p)};});
 function logit(T, w0, steps) {
  var n = T[0].x.length, w = w0 ? w0.slice() : Array(n).fill(0);
  for (var it = 0; it < (steps || 25); it++) {
   var g = w.map((v,i) => i ? -RIDGE*v : 0);
   var H = w.map((_,i) => w.map((_,j) => i === j ? (i ? RIDGE : 1e-6) : 0));
   for (var {x,y} of T) {
    var pr = sig(dot(w,x));
    for (var i = 0; i < n; i++) {
     g[i] += (y-pr)*x[i];
     for (var j = 0; j < n; j++) H[i][j] += pr*(1-pr)*x[i]*x[j];
    }
   }
   solve(H, g).forEach((x, i) => { w[i] += x; });
  }
  return w;
 }
 function auc(T) {
  var pos = T.filter(q => q.y), neg = T.filter(q => !q.y), c = 0;
  pos.forEach(a => { neg.forEach(b => { c += a.s > b.s ? 1 : a.s === b.s ? 0.5 : 0; }); });
  return c/(pos.length*neg.length);
 }
 var w = logit(pts), F = (p,a) => sig(dot(w,X(p,a)));
 var loo = pts.map((q,i) => ({y: q.y,s: dot(logit(without(pts,i),w,3),q.x)}));
 var dated = pts.filter(q => known(q.a)).sort((u,v) => v.a-u.a || bySlug(u.p,v.p));
 var cut = floor(dated.length*0.6);
 function held(cols) {
  var z = q => ({y: q.y,x: q.x.map((v,i) => cols.indexOf(i) < 0 ? v : 0)}),wd = logit(dated.slice(0,cut).map(z)),fw = {};
  return { wf: dated.slice(cut).map(q => ({ y: q.y, s: dot(wd, z(q).x) })),
   fam: pts.map(q => {var f = family(q.p); fw[f] = fw[f] || logit(pts.filter(o => family(o.p) !== f).map(z),w,4); return {y: q.y,s: dot(fw[f],z(q).x)};})};
 }
 var h0 = held([]), {wf,fam:lofo} = h0, ss = q => sig(q.s);
 var y = q => q.y, edges = [0,180,365,730,1095,1e9], gaps = edges.slice(0,-1).map((lo,i) => {
  var m = pts.filter(q => known(q.a) && q.a >= lo && q.a < edges[i+1]), n = m.length || 1;
  return abs(sum(m,y)/n-sum(m,q => F(q.p,q.a))/n);
 });
 var S = sum(pts,y),n = pts.length,rate = sum(dated.slice(0,cut),y)/cut;
 var bri = (T,f) => sum(T,q => pow(f(q)-q.y,2))/T.length;
 var brier = { loo: bri(loo, ss), loo_base: bri(pts, q => (S - q.y)/(n - 1)),
  wf: bri(wf, ss), wf_base: bri(wf, () => rate) };
 var boot = rnd => {var wb = logit(pts.map(() => pts[floor(rnd()*n)]),w,4); return (p,a) => sig(dot(wb,X(p,a)));};
 brier.fam = bri(lofo, ss);
 brier.fam_base = bri(pts,q => {var o = pts.filter(z => family(z.p) !== family(q.p)); return sum(o,y)/o.length;});
 var terms = [['all inputs',[]],['without TVL',[1]],['without days tracked',[2]],['without 7-day change',[3]],['without family',fams.map((_,i) => 4+i)]]
  .map(([l,c]) => {var h = c.length ? held(c) : h0; return [l,bri(h.wf,ss),bri(h.fam,ss)];});
 return {terms,mid,boot,brier,w,F,n,with_token:S,auc_loo:auc(loo),auc_wf:auc(wf),auc_fam:auc(lofo),wf_n:wf.length,gap:max(...gaps)};
}
var sig = z => 1/(1+exp(-z)), dot = (w,x) => x.reduce((s,v,i) => s+v*w[i],0);

function termTests(pts, asOf) {
 var ages = pts.map(q => ageDays(asOf, q.p.listed_at));
 var mid = median(ages.filter(known).sort(asc));
 pts.forEach((q, i) => {
  q.g = growthOf(q.p)/100;
  q.age = ages[i] ?? mid;
 });
 var dated = pts.filter(q => q.p.listed_at).sort(byDate);
 var cut = floor(dated.length*0.6);
 function score(make, spot) {
  var err = (m, q) => abs(log(q.mcap/(spot ? q.tvl : q.tc)) - m(q));
  var med = a => exp(quantile(a.sort(asc), 0.5));
  var loo = pts.map((q,i) => err(make(without(pts,i)),q));
  var m = make(dated.slice(0, cut)), wf = dated.slice(cut).map(q => err(m, q));
  var lofo = pts.map(q => err(make(pts.filter(o => o.f !== q.f)), q));
  return { loo: med(loo), wf: med(wf), lofo: med(lofo) };
 }
 var terms = [
  ['flat', 'one multiple, spot TVL', q => [1], 1],
  ['spot', 'size curve, spot TVL', q => [1, q.sx], 1],
  ['size', 'size curve, TVL carried a week', q => [1, q.x]],
  ['family', '+ category family', null],
  ['growth', '+ 7-day change, own weight', q => [1, q.x, log(1 + q.g)]],
  ['age', '+ days since listing', q => [1, q.x, log(1 + q.age/365)]]
 ].map(([key,label,x,spot]) => {
  var make = x ? tr => ols(tr,x,spot?'sy' : 'y') : tr => {
   var {fams,all,b} = fitCurve(tr,0);
   return q => (fams[q.f].peers ? fams[q.f].ln : all) + b*q.x;
  };
  return {...score(make,spot),key,label};
 });
 terms.forEach((t,i) => {var b = terms[min(i-1,2)]; t.ok = i ? ['loo','wf','lofo'].every(k => t[k] < b[k]) : null;});
 return {terms,wf_n: dated.length-cut,wf_train: cut,wf_from: dated[cut].p.listed_at};
}
function ols(pts, feats, yk) {
 var n = feats(pts[0]).length, v = Array(n).fill(0), A = v.map(() => v.slice());
 pts.forEach(q => feats(q).forEach((x,i,f) => {
  v[i] += x*q[yk];
  for (var j = 0; j < n; j++) A[i][j] += x*f[j];
 }));
 var w = solve(A, v);
 return q => dot(w, feats(q));
}
// FNV-1a
function digest(rows) {
 var h = 2166136261;
 rows.forEach(r => {var s = [r.rank,r.slug,r.name,r.implied_value_usd,JSON.stringify(r.farm)].concat(r.farm_steps).join('|'); for (var i = 0; i < s.length; i++) {h ^= s.charCodeAt(i); h = imul(h,16777619) >>> 0;}});
 return h.toString(16).padStart(8, '0');
}
function quantile(a,t) {var i = (a.length - 1)*t,lo = floor(i); return a[lo] + (a[min(lo + 1,a.length - 1)] - a[lo])*(i - lo);}
var predict = (f,q) => q.tc*exp(f.fams[q.f].ln+f.b*q.x);

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
 FAMILIES.forEach(([key,label]) => {
  var a = pts.filter(q => q.f === key), peers = a.length;
  var raw = peers ? sum(a,q => q.y-b*q.x)/peers : all;
  var ln = one ? all : (peers*raw + k*all)/(peers + k);
  fams[key] = {key,label,peers,raw: exp(raw),multiple: exp(ln),ln};
 });
 return { b, all, fams };
}

function value(p, fit, asOf, medianAge, haircut) {
 var fam = fit.families[family(p)];
 var growth = growthOf(p);
 var drift = 1 + growth/100, tvl = p.tvl_usd*drift;
 var size = pow(tvl/REF,fit.slope);
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
function cashFlow(p, odds, carry = false) {
 var fixed = p.base.all + (carry ? p.carry : 0), gain = p.drop - p.claim.all;
 return {net: odds*gain - fixed, threshold: gain > 0 ? fixed/gain : Infinity};
}
function farmPlan(p, v, dep, hour, on) {
 var hr = hour ?? M.hour_usd, {target_cover: target,farm_days: days,drop_share: share} = M;
 var { name, category, chains, tvl_usd: tvl } = p, { apr, caution } = v;
 var main = chains[0], chain = main || 'its main chain';
 chains.slice(0, 3).forEach(c => { if (gas(c) < gas(chain)) chain = c; });
 if (on && chains.includes(on)) chain = on;
 var kind = category === 'Prediction Market' ? 'predict' : /^(Liquid )?Restaking$/.test(category) ? 'restake' : v.family;
 var [tag, risk] = MECH[kind], act = ACT[kind];
 var mechanism = category === 'Derivatives' ? 'PERP' : /bridge/i.test(category) ? 'BRIDGE' : tag;
 var preflight = act[3] + (mechanism === 'PERP' ? ' and the market is perpetual' : '');
 var asset = /^(Bitcoin|Lightning)/.test(chain) ? 'BTC' : 'USDC';
 var amt = x => '$'+x.toLocaleString('en-US'), tx0 = gas(chain), weeks = round(days/7);
 var day0 = 'Day 0', week = 'Weeks 1-'+weeks, w = WEEKLY[kind], rwa = v.family === 'rwa', verify = 20;
 var fill = (t,n,s) => t.replace(/USDC|\{[SsNC]\}/g,k => ({
  USDC:asset,'{S}':amt(n),'{s}':amt(s),'{N}':name,'{C}':chain
 })[k]);
 var step = (when,act,min,usd = 0) => ({when,act,min,usd});
 function steps(stake, gm = 1) {
  var tx = tx0*gm, side = round(stake/4), put = i => fill(act[i],stake,side);
  return [
   step(day0,`Withdraw ${amt(stake+side)} ${asset} from an exchange to a fresh farm-only wallet on ${chain}${tx0 < gas(main)?` (cheaper than ${main}, also supported)` : ''}`,15,1+tx),
   step(rwa?'Days 0-2' : day0,put(0),rwa?30 : 10,2*tx),
   step(w?week : 'Day 1',put(1),w?weeks*10 : 10,w?weeks*(side*w[0]+w[1]*tx) : kind === 'restake'?0 : 2*tx),
   step(week,`Weekly for ${weeks} weeks, check rewards and position. Re-deposit claimed rewards in one transaction without adding principal`,weeks*5,weeks*tx),
   step('Day '+days,`Unwind: ${put(2)}. Exit early below ${usd(tvl*.75)} TVL (25% below ${usd(tvl)}) or on an incident report`,15,2*tx),
   step('If claim opens',`If eligible, claim via the official app. Sell above ${usd(v.cap_high)} opening market cap (top of the 50% band around ${usd(v.fitted)}). Use market cap rather than FDV`,15,2*tx)
  ];
 }
 function total(st, min = verify) {
  var cost = 0;
  st.forEach(s => { cost += s.usd; min += s.min; });
  return { cost, min, all: cost + min/60*hr };
 }
 // [Amount, entry day]
 var tranches = k => kind === 'vault' ? [[k,0],[round(k/4),1]] : [[k,rwa ? 2 : 0]];
 var earn = k => sum(tranches(k),([n,d]) => n*(days-d))*apr/365;
 // Bracket first passing stake.
 var cov = k => earn(k)/total(steps(k)).all, cap = k => k + round(k/4), cert = null;
 var stake = dep ? round(dep/1.25) : 20000;
 for (var k = 400; !dep && k <= 20000; k += 400) if (cov(k) >= target) {stake = k; if (k > 400) cert = [cap(k - 400),cov(k - 400),cap(k),cov(k)]; break;}
 var st = steps(stake), {cost,min:minutes,all} = total(st), side = round(stake/4), capital = cap(stake), drop = earn(stake);
 var base = total(st.slice(0,-1)), claim = total(st.slice(-1),0);
 var carry = capital*M.carry_rate*days/365, quoteCap = floor(drop*10)/100;
 var verdictAt = (c,d = drop) => !caution && d >= target*c ? 'farm' : d >= c ? 'marginal' : 'skip';
 var verdict = verdictAt(all), need = share*target*all/max(drop,1e-9);
 var pay = 0, at = c => cov(round(c/1.25));
 for (var c = 25000, lo = 0; !pay && c <= 1000000; lo = c, c = round(c*1.25)) if (at(c) >= target) {
  for (pay = floor(lo/1000)*1000 + 1000; at(pay) < target;) pay += 1000;
  cert = cert || [pay - 1000, at(pay - 1000), pay, at(pay)];
 }
 var flip = tvl*pow(target*all/drop,1/v.slope);
 var odds = cashFlow({base,claim,carry,drop},0,true).threshold;
 st.unshift(
  step('Verify · Day 0',`Check official reward rules, dates and share. Confirm ${fill(preflight,stake,side)}. Rehearse the unwind: ${fill(act[2],stake,side)}. Check funds, recovery and wait. Quote both legs ≤$${quoteCap.toFixed(2)} (10% of modeled drop)`,verify),
  step('Stop','Closed, excluded or cannot exit? Keep funds unmoved. Verify after official changes',0),
  step('Wait · by Day 30',`${verdict === 'skip'?'Research only. ' : ''}Missing evidence or poor quote/reward? Keep funds unmoved. Recheck on official news or by Day 30. Need ${(100*need).toFixed(1)}% to depositors${need > 1?' (above 100%)' : ''}${pay?` or reprice at ${amt(pay)}` : ''}${v.slope < 0 && isFinite(flip)?`. Recheck below ${usd(flip)} TVL (drop ∝ TVL^${v.slope.toFixed(2)})` : ''}. Reprice if funded on ${chain}`,10),
  step('Eligible action · route total',`Fund if eligible, open and able to exit. Entry, upkeep and exit under ${usd(.1*drop)} (10% of revised drop). Require drop ≥${target}× fees and time at $${hr}/h. Fees sunk, capital exposed until exit. No claim loses ${usd(base.all)} before carry. With ${usd(carry)} carry, break-even odds ${odds <= 1?(odds*100).toFixed(1)+'%' : 'unreachable'}`,minutes-verify,cost)
 );
 var [stress, , exposure] = act[4];
 var price = m => total(steps(stake,m));
 var fees = [.5,3].map(m => {var {cost,all} = price(m); return [m,cost,drop-all,verdictAt(all)];});
 var shifts = [.5,1.5], shocks = {
  gas: [fees[0][3],verdictAt(price(1.5).all)],
  hour: shifts.map(m => verdictAt(cost+minutes/60*(hr*m))),
  share: shifts.map(m => verdictAt(all,drop*m)),
  costs: [...shifts,2].map(m => verdictAt(all*m))
 };
 var tr = tranches(stake);
 var loss = { capital, side, stake }[exposure || 'stake']*stressRate(kind);
 var net = drop - all;
 return {mechanism,risk,round_trip: cost-claim.cost,stress,stress_usd: loss,base,claim,carry,quoteCap,hour: hr,chain,gas: tx0,fees,shocks,stake: capital,eligible: tr.reduce((a,t) => a + t[0],0),tranches: tr,asset,steps: st,cost,minutes,all_in: all,
  days, drop, net, net_apr: net/capital*(365/days), need_share: need, pay_cap: pay, cert, verdict };
}
function farmFlips(rows) {
 var base = rows.filter(r => r.plan.verdict === 'farm').length;
 var changes = Object.fromEntries(Object.entries(rows[0].plan.shocks).map(([k,a]) =>
  [k,a.map((_,i) => rows.filter(r => r.plan.shocks[k][i] === 'farm').length-base)]));
 return { base, changes };
}
function stepText({usd:c,min:t,when,act},i) {
 // Reserve the cost/time tail.
 var tail = `. Cost: about ${usd(c)}. Time: ${mins(t)}.`;
 var head = (i >= 4?'Eligible route · ' : '')+when+': '+act;
 var room = 600 - tail.length;
 return (head.length > room ? head.slice(0, room - 3) + '...' : head) + tail;
}

function build(snap) {
 var fit = calibrate(snap), {protocols: ps,as_of: date,floor_usd: floorTvl} = snap;
 var wl = new Set(snap.watchlist), watched = p => wl.has(p.slug), words = tokenWords(ps);
 var noToken = ps.filter(p => !hasToken(p) && p.tvl_usd > 0);
 var pre = noToken.filter(p => watched(p) || !productOf(p,true));
 var products = noToken.map(p => ({p,kind: productOf(p,true)})).filter(x => x.kind && !watched(x.p))
  .sort((a, b) => b.p.tvl_usd - a.p.tvl_usd || bySlug(a.p, b.p));
 var ages = pre.filter(p => watched(p) || !productOf(p)).map(p => ageDays(date,p.listed_at)).filter(known).sort(asc);
 var midAge = median(ages) ?? 365, val = (p,h) => value(p,fit,date,midAge,h);
 var rows = pre.map(p => {
  var flag = productFlag(p),wordMatch = words[firstWord(p.name)],v = val(p,flag ? M.product_haircut : 1);
  if (wordMatch || flag) v.caution = wordMatch ? wordMatch + "'s token may already cover it" : LIQUID.test(p.category) ? 'liquid-staking drop is uncertain' : flag;
  return {p,v,plan: farmPlan(p,v),watch: watched(p),below: p.tvl_usd < floorTvl,wordMatch,flag};
 });
 rows.sort((a, b) => b.v.implied - a.v.implied || bySlug(a.p, b.p));
 rows.forEach((r, i) => { r.rank = i + 1; });
 rows.forEach((r,i) => {
  var {p,v} = r, up = i && rows[i-1].v.implied;
  var at = f => val({...p,tvl_usd:p.tvl_usd*f},v.haircut).implied, lo = 1, hi = 2, k;
  if (!up) return;
  for (k = 0; k < 12 && at(hi) <= up; k++) { lo = hi; hi *= 2; }
  if (at(hi) <= up) return;
  for (k = 0; k < 30; k++) { var m = sqrt(lo*hi); if (at(m) > up) hi = m; else lo = m; }
  r.flip = hi;
 });
 var { F, mid, boot } = fit.odds;
 var ALT = {'without momentum': ({p,v}) => v.fitted*pow(p.tvl_usd/v.tvl_next,1+fit.slope)*F({...p,change_7d:0},v.age_used)*v.haircut,
  'score without age': ({p,v}) => v.fitted*F(p,mid)*v.haircut,
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
   var {tvl_next: t,family: f,age_used: a,haircut: h} = r.v;
   return {r,s: t*exp(bf.fams[f].ln + bf.b*log(t/REF))*Fb(r.p,a)*h};
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
 rows.forEach(r => {r.stable = r.rank <= 20 && Object.values(r.alt).every(n => n <= 20);});
 var live = fit.points.map(q => ({p: q.p,tvl: q.tvl,members: q.members,family: q.f,fit: q.fit,loo: round(q.loo),actual: q.mcap}))
  .sort((a, b) => b.actual - a.actual || bySlug(a.p, b.p));
 var listed = ps.filter(p => hasToken(p) && !trades(p)).length;
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

var api = { use, digest, FAMILIES, farmPlan, cashFlow, farmFlips, stressRate, build, boardRows, usd, mins };
if (typeof module === 'object' && module.exports) module.exports = api;
else globalThis.RadarModel = api;
})();
