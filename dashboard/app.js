/* Launch Radar. Audit route: (1) screen = board.json: model.js digest() hashes rank, name, value and every
* plan step; the cover compares it on load. (2) termTests() scores each value term held out three ways.
* (3) farmPlan() costs and times every step, kill test first. No launch dates, so no timing claim. */
(function () {
 'use strict';
 const R = window.RadarModel, S = window.SNAPSHOT, app = document.getElementById('app');
 if (!R || !S || !window.TABLES) { app.innerHTML = '<p class="empty">No data: run main.ts to write data.js beside the page.</p>'; return; }

 R.use(window.TABLES);
 const radar = R.build(S), fit = radar.fit, M = radar.model, rows = radar.rows, usd = R.usd;
 const FAM = {}; R.FAMILIES.forEach((f) => { FAM[f[0]] = f[1]; });
 const bySlug = Object.create(null); rows.forEach((r) => { bySlug[r.p.slug] = r; });
 const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
 const pct = (x, d) => (x == null ? 'n/a' : (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d == null ? 1 : d) + '%');
 const mult = (x) => '×' + (x >= 10 ? x.toFixed(1) : x >= 1 ? x.toFixed(2) : x.toFixed(3));
 const days = (d) => (d == null ? '?' : d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd');
 const famChip = (f) => `<span class="fam f-${f}"><i></i>${esc(FAM[f])}</span>`;
 const verdictTag = (v) => `<span class="verdict v-${v}">${v}</span>`;
 const maxImplied = rows[0].v.implied;

 const CLEAR = { q: '', fam: '', chain: '', scope: 'all', verdict: '', dep: '' };
 const DEF = { view: 'board', q: '', fam: '', chain: '', scope: 'all', verdict: '', sort: 'rank', dir: 'asc', p: '', vs: '', dep: '', bud: '25000', hr: '25' };
 const HOURS = 8;
 function readHash() {
  const st = Object.assign({}, DEF);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  location.hash.slice(1).split('&').forEach((kv) => {
   const i = kv.indexOf('='), k = kv.slice(0, i);
   if (i > 0 && own(DEF, k)) try { st[k] = decodeURIComponent(kv.slice(i + 1)); } catch (e) { /* keep the default */ }
  });
  const ok = { view: 'board model aside trading', scope: 'all watch early outside stable', verdict: ' farm marginal skip', dir: 'asc desc', dep: ' 1000 5000 10000 25000 100000 250000', hr: '0 10 25 50 100', bud: '10000 25000 50000 100000 250000 1000000' };
  Object.keys(ok).forEach((k) => { if (!ok[k].split(' ').includes(st[k])) st[k] = DEF[k]; });
  if (!own(KEYS, st.sort)) st.sort = 'rank';
  return st;
 }
 function link(patch) {
  const st = Object.assign(readHash(), 'p' in patch ? { vs: '' } : {}, patch), parts = [];
  Object.keys(DEF).forEach((k) => { if (st[k] !== DEF[k]) parts.push(k + '=' + encodeURIComponent(st[k])); });
  return '#' + parts.join('&');
 }
 function go(patch) { location.hash = link(patch); }

 const KEYS = {
  rank: (r) => r.rank, name: (r) => r.p.name.toLowerCase(), tvl: (r) => r.p.tvl_usd, g: (r) => r.p.change_7d,
  age: (r) => r.v.age_used, value: (r) => r.v.implied, odds: (r) => r.v.time_factor, apr: (r) => r.v.apr, plan: (r) => r.plan.drop / r.plan.all_in
 };
 function filtered(st) {
  const q = st.q.trim().toLowerCase(), fams = st.fam ? st.fam.split(',') : [];
  const out = rows.filter((r) =>
   (!q || (r.p.name + ' ' + r.p.slug + ' ' + (r.p.category || '') + ' ' + r.p.chains.join(' ')).toLowerCase().includes(q)) &&
   (!fams.length || fams.includes(r.v.family)) &&
   (!st.chain || r.p.chains.includes(st.chain)) &&
   (st.scope === 'all' || (st.scope === 'watch' ? r.watch : st.scope === 'outside' ? !r.watch : st.scope === 'stable' ? r.stable : r.below)) &&
   (!st.verdict || r.plan.verdict === st.verdict));
  const key = KEYS[st.sort], sign = st.dir === 'desc' ? -1 : 1;
  return out.sort((a, b) => { const x = key(a), y = key(b); if (x == null || y == null) return (x == null) - (y == null) || a.rank - b.rank; return (x < y ? -1 : x > y ? 1 : 0) * sign || a.rank - b.rank; });
 }

 // FIELDS feed the CSV (raw) and the side-by-side view (formatted; dir marks the better side).
 const sg = (x) => (x < 0 ? '−' : '+') + usd(Math.abs(x)), p2 = (x) => (x * 100).toFixed(2) + '%';
 const FIELDS = [['Rank', (r) => r.rank, -1], ['Protocol', (r) => r.p.name], ['Family', (r) => fit.families[r.v.family].label], ['TVL', (r) => Math.round(r.p.tvl_usd), 0, usd],
  ['7-day change %', (r) => r.p.change_7d, 0, pct], ['Days tracked', (r) => r.v.age_used], ['Value if launched', (r) => Math.round(r.v.fitted), 1, usd],
  ['Token-record score', (r) => +r.v.time_factor.toFixed(3), 1, (x) => pc(x)], ['Implied value', (r) => Math.round(r.v.implied), 1, usd], ['50% band', (r) => usd(r.v.low) + '–' + usd(r.v.high)], ['Drop APR', (r) => +r.v.apr.toFixed(4), 1, p2], ['Verdict', (r) => r.plan.verdict], ['Capital', (r) => r.plan.stake, -1, usd],
  ['Gas & fees', (r) => +r.plan.cost.toFixed(2), -1, usd], ['Hours', (r) => +(r.plan.minutes / 60).toFixed(1), -1], ['Modeled drop', (r) => +r.plan.drop.toFixed(2), 1, usd],
  ['Net if it launches', (r) => +r.plan.net.toFixed(2), 1, sg], ['Verdict at 3x gas', (r) => r.plan.fees[1][3]], ['Stress loss', (r) => +r.plan.stress_usd.toFixed(2), -1, usd],
  ['Capital for x2', (r) => (r.plan.verdict === 'farm' ? r.plan.stake : r.plan.pay_cap || ''), -1, (x) => (x ? usd(x) : 'none to $1M')]];
 const csv = (shown) => 'data:text/csv;charset=utf-8,' + encodeURIComponent([FIELDS.map((f) => f[0])].concat(shown.map((r) => FIELDS.map((f) => { const x = f[1](r); return typeof x === 'string' ? '"' + x.replace(/"/g, '""') + '"' : x; }))).join('\n'));
 function compare(a, b) {
  return `<a class="back" href="${link({ vs: '' })}">← Back to ${esc(a.p.name)}</a><section class="intro"><h1>${esc(a.p.name)} vs ${esc(b.p.name)}</h1><p>Same model, deposit and hour; the better of each pair in bold.</p></section>
  <div class="tablewrap">${tbl('board cmp', ['', '#' + esc(a.p.name), '#' + esc(b.p.name)], FIELDS.slice(2).map(([l, f, d, F]) => { const x = f(a), y = f(b), w = d && x !== y && x !== '' && y !== '' ? (x - y) * d > 0 : null; F = F || String; return [l, w === true ? `<b>${F(x)}</b>` : F(x), w === false ? `<b>${F(y)}</b>` : F(y)]; }))}</div>`;
 }
 const rOf = (v) => 1.8 + 6.5 * Math.sqrt(v / maxImplied);
 function chart(shown, H) {
  const W = 470, L = 40, B = 26, T = 10, RR = 10;
  const on = new Set(shown.map((r) => r.p.slug));
  const xmax = Math.sqrt(2400), ylo = Math.log10(0.001), yhi = Math.log10(2);
  const X = (d) => L + (W - L - RR) * Math.sqrt(Math.min(d, 2400)) / xmax;
  const Y = (a) => T + (H - T - B) * (1 - (Math.log10(Math.min(2, Math.max(0.001, a))) - ylo) / (yhi - ylo));
  let g = '';
  [[30, '1m'], [180, '6m'], [365, '1y'], [730, '2y'], [1095, '3y'], [1825, '5y']].forEach(([d, l]) => { g += `<line class="grid" x1="${X(d)}" x2="${X(d)}" y1="${T}" y2="${H - B}"/><text class="ax" x="${X(d)}" y="${H - 8}" text-anchor="middle">${l}</text>`; });
  [[0.001, '0.1%'], [0.01, '1%'], [0.1, '10%'], [1, '100%']].forEach(([a, l]) => { g += `<line class="grid" x1="${L}" x2="${W - RR}" y1="${Y(a)}" y2="${Y(a)}"/><text class="ax" x="${L - 6}" y="${Y(a) + 3}" text-anchor="end">${l}</text>`; });
  let dots = '';
  rows.slice().reverse().forEach((r) => {
   const rad = rOf(r.v.implied);
   dots += `<a href="${link({ p: r.p.slug })}"><circle class="dot f-${r.v.family}${on.has(r.p.slug) ? '' : ' off'}" cx="${X(r.v.age_used).toFixed(1)}" cy="${Y(r.v.apr).toFixed(1)}" r="${rad.toFixed(1)}"><title>${esc(r.p.name)} ${usd(r.v.implied)}</title></circle></a>`;
  });
  const pick = [];
  [(a, b) => b.v.implied - a.v.implied, (a, b) => b.v.apr - a.v.apr].forEach((cmp) => {
   shown.slice().sort(cmp).slice(0, 3).forEach((r) => { if (!pick.includes(r)) pick.push(r); });
  });
  const boxes = [];
  let labels = '';
  pick.forEach((r) => {
   const cx = X(r.v.age_used), cy = Y(r.v.apr), w = r.p.name.length * 5.6 + 6, h = 12;
   const tries = [[cx + 8, cy - 6], [cx - 8 - w, cy - 6], [cx - w / 2, cy - 20], [cx - w / 2, cy + 8]];
   const spot = tries.find(([x, y]) => x > L && x + w < W && y > 0 && y + h < H - B &&
    boxes.every((b) => x + w < b[0] || b[0] + b[2] < x || y + h < b[1] || b[1] + b[3] < y));
   if (!spot) return;
   boxes.push([spot[0], spot[1], w, h]);
   labels += `<text class="lab" x="${(spot[0] + 3).toFixed(1)}" y="${(spot[1] + 9).toFixed(1)}">${esc(r.p.name)}</text>`;
  });
  g += `<text class="ax" x="${W - RR}" y="${H - 18}" text-anchor="end">days without a token →</text><text class="ax" x="${L + 4}" y="${T + 8}">airdrop APR if it launches ↑</text>`;
  [[1e6, '$1M'], [3e7, '$30M']].forEach(([v, l], i) => { g += `<circle class="dot f-infra" cx="${W - 120 + i * 50}" cy="${T + 12}" r="${rOf(v).toFixed(1)}"/><text class="ax" x="${W - 112 + i * 50}" y="${T + 15}">${l}</text>`; });
  return `<svg viewBox="0 0 ${W} ${H}" class="radar">${g}
   ${dots}${labels}</svg>`;
 }

 function head(st) {
  const n = (v) => (v === 'board' ? rows.length : v === 'model' ? CHECKS.length : v === 'aside' ? radar.products.length : fit.n);
  document.getElementById('tabs').innerHTML = [['board', 'Pre-token board'], ['model', 'Model & checks'], ['aside', 'Set aside'], ['trading', 'Trading tokens']]
   .map(([v, l]) => `<a href="${link({ view: v, p: '' })}" class="${st.view === v && !st.p ? 'on' : ''}">${l} <b>${n(v)}</b></a>`).join('');
  document.getElementById('meta').innerHTML = `<span>Snapshot <b>${esc(S.as_of)}</b></span><span>model <b>${esc(M.version)}</b></span>`;
 }

 const O = fit.odds, pc = (x) => (x * 100).toFixed(0) + '%';
 function formula() {
  const T = fit.tests, x = (v) => '×' + v.toFixed(2);
  const used = { flat: 'baseline', spot: 'replaced', size: 'fitted', family: fit.k === Infinity ? 'dropped' : 'k=' + fit.k, growth: 'not used', age: 'via score' };
  return `<div class="card model">
   <h2>Value model <span>fitted on this snapshot's ${fit.n} trading tokens</span></h2>
   <p class="eq">value = T × ${mult(fit.base)} × (T ÷ $100M)<sup>${fit.slope.toFixed(2)}</sup> × s</p>
   <table class="mini tests"><thead><tr><th>Term · held-out median miss</th><th class="num">Leave-one-out</th><th class="num">Walk-fwd</th><th class="num">Family out</th><th class="num">Use</th></tr></thead><tbody>
   ${T.terms.map((t) => `<tr class="${t.ok ? 'pick' : ''}"><td>${t.label}</td><td class="num">${x(t.loo)}</td><td class="num">${x(t.wf)}</td><td class="num">${x(t.lofo)}</td><td class="num">${used[t.key]}</td></tr>`).join('')}</tbody></table>
   <p class="note">Walk-forward: fit the ${T.wf_train} listed first, score the ${T.wf_n} since ${T.wf_from}. T = TVL carried a week at its 7-day change (${M.growth_floor}…+${M.growth_cap}%). s = token-record score, a logistic fit on ${O.n} peers (${O.with_token} record a token): AUC ${O.auc_loo.toFixed(2)} leave-one-out, ${O.auc_wf.toFixed(2)} walk-forward, ${O.auc_fam.toFixed(2)} family-out.</p>
   <p class="note"><b>Missing ages:</b> ${rows.filter((r) => r.ageRange).length} ranked rows have no listing date and use the median age; re-ranked at the 25th and 75th percentile of observed ages they move: ${rows.filter((r) => r.ageRange).map((r) => `${esc(r.p.name)} #${r.ageRange[0].rank}–#${r.ageRange[1].rank}`).join(', ')}.</p>
   <p class="note"><b>Not a launch forecast:</b> s scores whether a peer <i>records</i> a token today, the quantity the held-out tests check (worst age-cohort gap ${Math.round(O.gap * 100)} pts); the snapshot has no launch dates, so no timing claim.</p>
   <p class="note">Leave-one-out miss by TVL band: ${fit.bands.map((b) => `<b>${b.lo ? usd(b.lo) : '$0'}–${b.hi < 1e15 ? usd(b.hi) : '∞'} ×${b.miss.toFixed(1)}</b> (${b.n} tokens; ${rows.filter((r) => r.p.tvl_usd >= b.lo && r.p.tvl_usd < b.hi).length} ranked)`).join(' · ')}.</p></div>`;
 }

 // Self-checks, computed on every load.
 const bRows = R.boardRows(radar), dig = R.digest(bRows), B = window.BOARD || {};
 const [flatT, spotT, sizeT] = fit.tests.terms;
 const nTr = S.protocols.filter((p) => p.mcap_usd > 0).length, nAll = rows.length + radar.products.length + nTr + radar.listed_only;
 const CHECKS = [
  [nAll === S.protocols.length, `${nAll}/${S.protocols.length} protocols: ${rows.length} ranked, ${radar.products.length} set aside, ${nTr} trading (${fit.n} tokens), ${radar.listed_only} token without cap`],
  [S.watchlist.every((s) => bySlug[s]), `watchlist ${S.watchlist.filter((s) => bySlug[s]).length}/${S.watchlist.length} covered`],
  [rows.every((r, i) => r.rank === i + 1 && (!i || r.v.implied <= rows[i - 1].v.implied)), `ranks 1–${rows.length}, value never rising`],
  [rows.every((r) => r.p.gecko_id == null && r.p.symbol == null && r.p.mcap_usd == null), `${rows.length}/${rows.length} ranked rows record no token`],
  [bRows.every((b) => b.farm_steps.length >= 3 && b.farm_steps.length <= 12 && b.farm_steps.every((t) => / Cost: .+ Time: /.test(t))), `${bRows.length}/${bRows.length} plans, every step costed and timed`],
  [B.digest === dig && B.rows === rows.length, `screen = board.json at Auto deposit, digest ${dig}`],
  [O.auc_loo > 0.5 && O.auc_wf > 0.5 && O.auc_fam > 0.5 && O.brier.loo < O.brier.loo_base && O.brier.wf < O.brier.wf_base && O.brier.fam < O.brier.fam_base, `score beats base rate held out 3 ways: AUC ${O.auc_loo.toFixed(2)}/${O.auc_wf.toFixed(2)}/${O.auc_fam.toFixed(2)}`],
  [rows.slice(0, 10).every((r) => r.boot >= 0.8), `ranks 1–${rows.findIndex((r) => r.boot < 1)} top 20 in all 40 refits (fails if a top 10 drops in >20%)`],
  [O.gap < 0.2, `score within ${Math.round(O.gap * 100)} pts of every age cohort`],
  [spotT.ok && sizeT.ok, `value miss ×${flatT.loo.toFixed(2)} flat → ×${sizeT.loo.toFixed(2)} fitted, held out 3 ways`]
 ];

 function board(st) {
  const shown = filtered(st), fams = st.fam ? st.fam.split(',') : [];
  const watchCov = S.watchlist.filter((s) => bySlug[s]).length;
  const farmN = rows.filter((r) => r.plan.verdict === 'farm').length;
  const mid = (f) => rows.map(f).sort((a, b) => a - b)[rows.length >> 1];
  const chains = {}; rows.forEach((r) => r.p.chains.forEach((c) => { chains[c] = (chains[c] || 0) + 1; }));
  const famCount = {}; rows.forEach((r) => { famCount[r.v.family] = (famCount[r.v.family] || 0) + 1; });
  const th = (k, l, cls) => {
   const on = st.sort === k, dir = on && st.dir === 'asc' ? 'desc' : on ? 'asc' : (k === 'rank' || k === 'name' ? 'asc' : 'desc');
   return `<th class="${cls || ''}${on ? ' sorted' : ''}"><a href="${link({ sort: k, dir: dir })}">${l}${on ? (st.dir === 'asc' ? ' ▲' : ' ▼') : ''}</a></th>`;
  };
  const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<a href="${link({ [key]: v })}" class="${st[key] === v ? 'on' : ''}">${l}</a>`).join('')}</div>`;
  const famLinks = R.FAMILIES.map((f) => {
   const on = fams.includes(f[0]), next = on ? fams.filter((x) => x !== f[0]) : fams.concat(f[0]);
   return `<a href="${link({ fam: next.join(',') })}" class="chip f-${f[0]}${on ? ' on' : ''}"><i></i>${esc(f[1])} <b>${famCount[f[0]] || 0}</b></a>`;
  }).join('');
 // Basket: positive-net plans, best net per dollar, within budget and HOURS.
  let cap = 0, hrs = 0;
  const pick = shown.filter((r) => r.plan.net > 0).sort((a, b) => b.plan.net / b.plan.stake - a.plan.net / a.plan.stake)
   .filter((r) => cap + r.plan.stake <= +st.bud && hrs + r.plan.minutes / 60 <= HOURS && (cap += r.plan.stake, hrs += r.plan.minutes / 60));
  const active = st.q || st.fam || st.chain || st.scope !== 'all' || st.verdict || st.dep;
  const body = shown.map((r) => {
   const w = Math.max(1.5, 100 * Math.sqrt(r.v.implied / maxImplied));
   return `<tr data-slug="${esc(r.p.slug)}" tabindex="0">
    <td class="rank">${r.rank}<small>${r.rlo}–${r.rhi}</small></td>
    <td class="proto"><a href="${link({ p: r.p.slug })}">${esc(r.p.name)}</a>${r.watch ? '<span class="wl" title="On the snapshot watchlist">WL</span>' : ''}<small>${esc(r.p.category || 'Uncategorised')} · ${esc(r.p.chains.slice(0, 2).join(', '))}${r.p.chains.length > 2 ? ' +' + (r.p.chains.length - 2) : ''}</small></td>
    <td>${famChip(r.v.family)}</td>
    <td class="num">${usd(r.p.tvl_usd)}</td>
    <td class="num ${r.p.change_7d >= 0.05 ? 'up' : r.p.change_7d <= -0.05 ? 'down' : ''}">${pct(r.p.change_7d)}</td>
    <td class="num${r.v.age == null ? ' est' : ''}" title="${r.v.age == null ? 'No listing date: the median age is used' : 'Listed ' + esc(r.p.listed_at)}">${r.v.age == null ? '~' : ''}${days(r.v.age_used)}</td>
    <td class="val"><span class="bar"><i style="width:${w.toFixed(1)}%"></i></span><b>${usd(r.v.implied)}</b><small>${usd(r.v.low)}–${usd(r.v.high)}</small></td>
    <td class="num">${pc(r.v.time_factor)}</td>
    <td class="num apr">${(r.v.apr * 100).toFixed(1)}%</td>
    <td class="plan">${verdictTag(r.plan.verdict)} <span class="pmult">pays ${mult(r.plan.drop / r.plan.all_in)}${r.plan.verdict === 'farm' ? '' : r.plan.pay_cap ? ` · ×${M.target_cover} at ${usd(r.plan.pay_cap)}` : ` · no deposit pays ×${M.target_cover}`}</span><small>${usd(r.plan.drop)} drop vs ${usd(r.plan.all_in)} ${r.plan.verdict === 'skip' ? 'to deposit · $0 research' : `cost · ${usd(r.plan.stake)} on ${esc(r.plan.chain)}`}</small></td></tr>`;
  }).join('');
  const ctl = `<div class="ctl">    <section class="filters">
   <label class="search"><input id="q" type="search" value="${esc(st.q)}" placeholder="Search name, category or chain" autocomplete="off" aria-label="Search"></label>
   <div class="field"><span>Scope</span>${seg('scope', [['all', 'All'], ['watch', 'Watchlist'], ['outside', 'Outside it'], ['early', 'Below $50M'], ['stable', 'Top 20, all variants']])}</div>
   <div class="field"><span>Plan</span>${seg('verdict', [['', 'Any'], ['farm', 'Farm'], ['marginal', 'Marginal'], ['skip', 'Skip']])}</div>
   <label class="field"><span>Deposit</span><select id="dep">${['', 1000, 5000, 10000, 25000, 100000, 250000].map((d) => `<option value="${d}"${String(d) === st.dep ? ' selected' : ''}>${d ? usd(d) : 'Auto: least that pays'}</option>`).join('')}</select></label>
   <label class="field"><span>Your hour</span><select id="hr">${[0, 10, 25, 50, 100].map((h) => `<option value="${h}"${String(h) === st.hr ? ' selected' : ''}>$${h}/h</option>`).join('')}</select></label>
   <label class="field"><span>Chain</span><select id="chain"><option value="">All chains</option>${Object.keys(chains).sort((a, b) => chains[b] - chains[a] || (a < b ? -1 : 1)).map((c) => `<option${c === st.chain ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
   <div class="count">Top 20 at $${st.hr}/h: <b>${farmAt(+st.hr, st.dep)}</b> farm (${farmAt(0, st.dep)} at $0/h, ${farmAt(25, st.dep)} at $25/h) · farm verdicts holding at 3× gas: <b>${shown.filter((r) => r.plan.fees[1][3] === 'farm').length}</b>/${shown.filter((r) => r.plan.verdict === 'farm').length} · <b>${shown.length}</b> of ${rows.length} shown · <span id="drawn"></span> · <a download="launch-radar.csv" href="${csv(shown)}">CSV</a>${active ? ` · <a href="${link(CLEAR)}">clear filters</a>` : ''}</div>
  </section>
  <section class="filters basket"><label class="field"><span>Budget</span><select id="bud">${[10000, 25000, 50000, 100000, 250000, 1000000].map((d) => `<option value="${d}"${String(d) === st.bud ? ' selected' : ''}>${usd(d)}</option>`).join('')}</select></label>
   <span>Basket, best net per dollar of the ${shown.length} shown, within ${usd(+st.bud)} and ${HOURS} h: ${pick.map((r) => `<a href="${link({ p: r.p.slug })}">${esc(r.p.name)}</a> ${usd(r.plan.stake)}`).join(' · ') || 'none pays'} → <b>${usd(cap)}</b>, ${hrs.toFixed(1)} h, net if they launch <b class="up">+${usd(pick.reduce((s, r) => s + r.plan.net, 0))}</b></span></section>
  <section class="filters"><div class="chips" role="group" aria-label="Family">${famLinks}</div></section></div>`;
  return `<section class="strip">
   <div><b>${watchCov}/${S.watchlist.length}</b><span>watchlist covered</span></div>
   <div><b>${rows.length}</b><span>pre-token ranked, ${rows.filter((r) => r.below).length} under $50M</span></div>
   <div><b>${radar.products.length} · ${fit.n}</b><span>set aside · trading (fit)</span></div>
   <div><b>×${sizeT.loo.toFixed(1)} · ×${sizeT.wf.toFixed(1)}</b><span>held-out miss, 2 tests</span></div>
   <div><b>${O.auc_loo.toFixed(2)} · ${O.auc_wf.toFixed(2)}</b><span>score AUC: LOO · walk-fwd</span></div>
   <div><b>${farmN}</b><span>pay ×${M.target_cover} their costs</span></div>
   <div><b>${usd(mid((r) => r.plan.stake))} · ${R.mins(mid((r) => r.plan.minutes))}</b><span>median deposit · hands-on</span></div>
  </section>
  <section class="hero slim">
   <div class="lead">
    <h1>${rows.length} pre-token protocols, ranked by token value × token-record score</h1>
    ${active ? `<p class="note">${CHECKS.filter((c) => c[0]).length}/${CHECKS.length} self-checks pass; the value model and its held-out tests are on the <a href="${link(CLEAR)}">unfiltered board</a>. With filters on, the board leads with the shortlist.</p>${ctl}` : `<p class="eq">value = T × ${mult(fit.base)} × (T ÷ $100M)<sup>${fit.slope.toFixed(2)}</sup> × s</p>
    <p class="checkline ${CHECKS.every((c) => c[0]) ? 'ok' : 'bad'}"><b>${CHECKS.filter((c) => c[0]).length}/${CHECKS.length} self-checks pass</b>, run on load: ${[5, 1, 6, 0].map((i) => CHECKS[i][1]).join(' · ')}${CHECKS.filter((c) => !c[0]).map((c) => ' · ✗ ' + c[1]).join('')} · <a href="${link({ view: 'model' })}">all checks →</a></p>${ctl}`}
   </div>
   <div class="card chartcard"><h2>Radar <span>days without a token × airdrop yield</span></h2>${chart(shown, 300)}</div>
  </section>
  <div class="tablewrap"><table class="board">
   <thead><tr>${th('rank', 'Rank')}${th('name', 'Protocol')}<th>Family</th>${th('tvl', 'TVL', 'num')}${th('g', '7d', 'num')}${th('age', 'Tracked', 'num')}${th('value', 'Implied value · 50% band', 'val')}${th('odds', 'Score', 'num')}${th('apr', 'Drop APR', 'num')}${th('plan', 'Farm plan · if it launches', 'plan')}</tr></thead>
   <tbody>${body || '<tr><td colspan="10" class="empty">No protocol matches these filters.</td></tr>'}</tbody></table></div>`;
 }

 function redTeam(r) {
  const v = r.v, b = fit.bands.find((x) => r.p.tvl_usd >= x.lo && r.p.tvl_usd < x.hi), alt = Object.entries(r.alt).sort((a, c) => Math.abs(c[1] - r.rank) - Math.abs(a[1] - r.rank))[0];
  return [
   `<b>Value:</b> trading tokens of this size (${b.lo ? usd(b.lo) : '$0'}–${b.hi < 1e15 ? usd(b.hi) : '∞'} TVL) miss their real market cap by a median ×${b.miss.toFixed(1)} held out; a market cap at launch of ${usd(v.fitted * fit.band_low)} or ${usd(v.cap_high)} would not be unusual.`,
   `<b>Score:</b> ${pc(v.time_factor)} of similar peers record a token today (no launch forecast); the fit misses one age cohort by ${Math.round(fit.odds.gap * 100)} pts.`,
   `<b>Rank:</b> #${r.rank} now, ${r.rlo}–${r.rhi} across 40 refits, #${alt[1]} ${alt[0]}${v.growth_imputed ? '; its 7-day change is unreported, so 0% was used' : ''}${r.ageRange ? `; no listing date, so the median age was used: at ${r.ageRange[0].age} days it would rank #${r.ageRange[0].rank}, at ${r.ageRange[1].age} days #${r.ageRange[1].rank}` : ''}.`,
   `<b>Plan:</b> pays ×${M.target_cover} only if ≥${(r.plan.need_share * 100).toFixed(1)}% of the token reaches depositors (assumed ${M.drop_share * 100}%), and only if a token launches at all.`
  ];
 }
 function detail(st) {
  const r = bySlug[st.p];
  if (!r) return `<p class="empty">No ranked protocol is called ${esc(st.p)}. <a href="${link({ p: '' })}">Back to the board</a></p>`;
  const p = r.p, v = r.v, pl = r.plan, fam = fit.families[v.family];
  const peers = radar.live.filter((l) => l.family === v.family)
   .sort((a, b) => Math.abs(Math.log(a.tvl / p.tvl_usd)) - Math.abs(Math.log(b.tvl / p.tvl_usd))).slice(0, 6);
  const caps = peers.map((x) => x.actual), lo = Math.log10(Math.min(v.low, ...caps) / 1.5), hi = Math.log10(Math.max(v.high, ...caps) * 1.5);
  const pos = (x) => (100 * (Math.log10(x) - lo) / (hi - lo)).toFixed(2) + '%';
  const line = (label, src, val, cls) => `<tr class="${cls || ''}"><td>${label}<small>${src}</small></td><td class="num">${val}</td></tr>`;
  return `<a class="back" href="${link({ p: '' })}">← Back to the board</a><label class="field vs"><span>Compare with</span><select id="vs"><option value="">another protocol…</option>${rows.filter((x) => x !== r).map((x) => `<option value="${x.p.slug}">#${x.rank} ${esc(x.p.name)}</option>`).join('')}</select></label>
  <section class="dhead">
   <div class="rankbig"><small>Rank</small><b>${r.rank}</b><small>of ${rows.length}</small></div>
   <div><h1>${esc(p.name)}</h1>
    <p class="tags">${famChip(v.family)}<span class="tag">${esc(p.category || 'Uncategorised')}</span><span class="tag pre">No token on record</span>${r.watch ? '<span class="tag wlt">On the watchlist</span>' : '<span class="tag">Outside the watchlist</span>'}</p>
    <p class="sub">${esc(p.chains.join(' · '))}${p.listed_at ? ` — tracked since ${esc(p.listed_at)}` : ' — no listing date on record'}</p></div>
   <div class="dval"><small>Implied token value</small><b>${usd(v.implied)}</b><small>50% band ${usd(v.low)} – ${usd(v.high)} · ${mult(v.multiple)} TVL</small><small>Rank ${r.rlo}–${r.rhi} in 80% of 40 bootstrap refits; top 20 in ${pc(r.boot)}</small><small>Rank #${r.rank}; ${Object.keys(r.alt).map((k) => `#${r.alt[k]} ${k}`).join(' · ')}</small></div>
  </section>
  <div class="dgrid">
   <div class="col">
    <section class="card"><h2>How the value is built <span>model.js value()</span></h2>
     <table class="receipt">
      ${line('TVL', 'snapshot tvl_usd', usd(p.tvl_usd))}
      ${line('Momentum ' + pct(v.growth, 2), (v.growth_imputed ? 'change_7d not reported: 0% assumed' : 'change_7d ' + pct(p.change_7d, 2) + ' carried one week, clipped to ' + M.growth_floor + '…+' + M.growth_cap + '%'), '→ ' + usd(v.tvl_next))}
      ${line('Peer multiple at $100M', (fit.k === Infinity ? 'one curve: per-family multiples did not beat it in all three held-out tests' : 'family pull k=' + fit.k) + ' (' + esc(fam.label) + ' alone ' + mult(fam.raw) + ')', mult(v.fam_multiple))}
      ${line('Size curve', '(TVL ÷ $100M)<sup>' + fit.slope.toFixed(2) + '</sup>, slope fitted on the ' + fit.n + ' tokens', mult(v.size_mult))}
      ${line('Value if launched', 'what a trading peer of this size is worth', usd(v.fitted), 'sum')}
      ${line('Token-record score s', 'share of peers with this TVL, ' + (v.age == null ? 'median ' + v.age_used : v.age) + ' days tracked, 7-day change and family that record a token', pc(v.time_factor))}
      ${line('Implied value', 'rank ' + r.rank + ' of ' + rows.length + ' on this number', usd(v.implied), 'total')}
     </table>
     <div class="scale">
      <span class="band" style="left:${pos(v.low)};width:calc(${pos(v.high)} - ${pos(v.low)})"></span>
      ${peers.map((x) => `<span class="peer" style="left:${pos(x.actual)}" title="${esc(x.p.name)} ${usd(x.actual)}"></span>`).join('')}
      <span class="mid" style="left:${pos(v.implied)}"></span>
     </div>
     <p class="note">Shaded: the 50% band, ×${fit.band_low.toFixed(2)}–×${fit.band_high.toFixed(2)}, the middle half of held-out misses. Ticks: the peers' market caps below. A model's claim, not a price.</p>
    </section>
    <section class="card"><h2>Nearest trading peers <span>${esc(fam.label)}, closest TVL</span></h2>
     ${tbl('mini', ['Protocol', '#TVL', '#Market cap', '#÷ TVL'], peers.map((x) => [`${esc(x.p.name)} <small>${esc(x.p.symbol || '')}</small>`, usd(x.tvl), usd(x.actual), mult(x.actual / x.tvl)]))}</section>
    <section class="card risk"><h2>Why this could be wrong <span>computed for this row</span></h2><ul>${redTeam(r).map((t) => `<li>${t}</li>`).join('')}</ul></section>
   </div>
   <section class="card planc"><h2>Farm plan <span>${pl.days} days on ${esc(pl.chain)}</span></h2>
    <div class="pkpis">
     <div><small>Capital</small><b>${usd(pl.stake)}</b></div>
     <div><small>Gas &amp; fees</small><b>${usd(pl.cost)}</b></div>
     <div><small>Hands-on</small><b>${R.mins(pl.minutes)}</b></div>
     <div><small>Expected drop</small><b>${usd(pl.drop)}</b></div>
     <div><small>If it launches</small>${verdictTag(pl.verdict)}</div>
    </div>
    <div class="steph"><span></span><span>When · what to do</span><span>Cost</span><span>Time</span></div>
    <ol class="steps">${pl.steps.map((s) => `<li><p><em>${esc(s.when)}</em>${esc(s.act)}.</p><span class="cost">${usd(s.usd)}</span><span class="time">${R.mins(s.min)}</span></li>`).join('')}</ol>
    <div class="math">
     <p><b>Drop APR ${(v.apr * 100).toFixed(2)}% if it launches</b> = ${usd(v.fitted)} × ${M.drop_share * 100}% to depositors ÷ (${usd(v.tvl_next)} TVL × (${Math.min(v.age_used, M.season_days)} + ${M.farm_days}) season days) × 365.</p>
     <p>Dollar-days: (${pl.tranches.map((t) => `${usd(t[0])} × ${pl.days - t[1]} d`).join(' + ')}) × ${(v.apr * 100).toFixed(2)}% ÷ 365 = <b>${usd(pl.drop)}</b> vs <b>${usd(pl.all_in)}</b> all-in (${usd(pl.cost)} fees + ${R.mins(pl.minutes)} at $${pl.hour}/h), net <b class="${pl.net >= 0 ? 'up' : 'down'}">${pl.net >= 0 ? '+' : '−'}${usd(Math.abs(pl.net))}</b>.</p><p><b>Stress</b> (${esc(p.category || FAM[v.family])}): ${esc(pl.stress)} would cost about <b>${usd(pl.stress_usd)}</b>, ×${(pl.stress_usd / Math.max(pl.drop, 1e-9)).toFixed(1)} the modeled drop.</p><p><b>Fees</b> at ${pl.fees.map((f) => `${f[0]}× gas ${usd(f[1])}, net ${f[2] < 0 ? '−' : '+'}${usd(Math.abs(f[2]))} (${f[3]})`).join('; ')}.</p><p><b>Carry:</b> ${usd(pl.stake)} locked ${pl.days} days forgoes about ${usd(pl.carry)} at ${M.carry_rate * 100}% elsewhere; the deposit's own yield usually covers it, and if it earns nothing the net is ${pl.net - pl.carry >= 0 ? '+' : '−'}${usd(Math.abs(pl.net - pl.carry))}.</p><p><b>Capital:</b> ${st.dep ? 'your deposit' : pl.verdict === 'farm' ? `least that pays ×${M.target_cover} ($500–$25K)` : `capped at $25K; no deposit up to it pays ×${M.target_cover}`}.</p>
    </div>
   </section>
  </div>`;
 }

 const tbl = (cls, heads, rows) => `<table class="${cls}"><thead><tr>${heads.map((h) => `<th${h[0] === '#' ? ' class="num"' : ''}>${h.replace('#', '')}</th>`).join('')}</tr></thead><tbody>${rows.map((c) => `<tr>${c.map((v, i) => `<td${heads[i][0] === '#' ? ' class="num"' : ''}>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
 const nm = (n, sub) => `<b>${esc(n)}</b><small>${esc(sub)}</small>`;
 function model() {
  return `<section class="hero slim">${formula()}<div class="card checks"><h2>Self-checks <span>run in this page on load</span></h2><ul>${CHECKS.map(([ok, t]) => `<li class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${t}</li>`).join('')}</ul></div></section>`;
 }
 function aside() {
  return `<section class="intro"><h1>${radar.products.length} products set aside, not ranked</h1>
   <p>No token of their own, but each is a wrapped, bridged, staked or exchange product, a versioned pool or a likely sibling of a trading token (productOf, applied to every protocol); their value rides on that token's.</p></section>
   <div class="tablewrap">${tbl('board', ['Product', 'Why set aside', '#TVL', '#7d'], radar.products.map((x) => [nm(x.p.name, x.p.chains.slice(0, 3).join(', ')), `<span class="tag">${esc(x.kind)}</span>`, usd(x.p.tvl_usd), pct(x.p.change_7d)]))}</div>`;
 }

 function trading() {
  return `<section class="intro"><h1>${fit.n} tokens that trade: the model's calibration set</h1>
   <p>Kept off the board: their market prices them. calibrate() pools TVL per token, leaves out exchanges and products, and fits ln(mcap ÷ TVL) on ln(TVL): value grows as TVL<sup>${fit.elasticity.toFixed(2)}</sup>. ${radar.listed_only} more record a token with no market cap.</p></section>
   <div class="tablewrap">${tbl('board', ['Protocol', '#TVL', '#Market cap', '#÷ TVL', '#Fit without it', '#÷ market'], radar.live.map((l) => [nm(l.p.name, (l.p.symbol || '') + ' · ' + (l.p.category || '')), usd(l.tvl) + (l.members > 1 ? ` <small>${l.members} parts</small>` : ''), usd(l.actual), mult(l.actual / l.tvl), usd(l.loo), `<span class="${l.loo / l.actual > 2 || l.loo / l.actual < 0.5 ? 'down' : 'up'}">${mult(l.loo / l.actual)}</span>`]))}</div>`;
 }

 let planDep = '|25|';
 const top20 = rows.slice(0, 20), farmAt = (h, dep) => top20.filter((r) => R.farmPlan(r.p, r.v, +dep, h).verdict === 'farm').length;
 function render() {
  const st = readHash();
  head(st);
  app.className = st.p ? 'detail' : st.view;
  const k = [st.dep, st.hr, st.chain].join('|');
  if (k !== planDep) { planDep = k; rows.forEach((r) => { r.plan = R.farmPlan(r.p, r.v, +st.dep, +st.hr, st.chain); }); }
  app.innerHTML = st.p ? (bySlug[st.p] && bySlug[st.vs] ? compare(bySlug[st.p], bySlug[st.vs]) : detail(st)) : st.view === 'model' ? model() : st.view === 'aside' ? aside() : st.view === 'trading' ? trading() : board(st);
  const d = document.getElementById('drawn'), sh = d && filtered(st), trs = [...app.querySelectorAll('tr[data-slug]')];
  if (d) { const ok = trs.length === sh.length && trs.every((t, i) => t.dataset.slug === sh[i].p.slug && t.querySelector('td.val b').textContent === usd(sh[i].v.implied)); d.className = ok ? 'up' : 'down'; d.textContent = ok ? `✓ table drawn = model (${trs.length} rows)` : '✗ table drawn ≠ model'; }
  document.getElementById('foot').innerHTML = `Source: ${esc(S.source)}. Floor $${(S.floor_usd / 1e6).toFixed(0)}M. Implied value = the radar's own value if launched × its token-record score; never make.fun's claim. A protocol may hold a token DefiLlama does not record.`;
  if (st.p) window.scrollTo(0, 0);
 }
 app.addEventListener('input', (e) => {
  if (e.target.id !== 'q') return;
  const val = e.target.value;
  history.replaceState(null, '', link({ q: val })); render();
  const q = document.getElementById('q'); q.focus(); q.setSelectionRange(val.length, val.length);
 });
 app.addEventListener('change', (e) => { if (['chain', 'dep', 'bud', 'hr', 'vs'].includes(e.target.id)) go({ [e.target.id]: e.target.value }); });
 ['click', 'keydown'].forEach((ev) => app.addEventListener(ev, (e) => {
  const tr = e.target.closest('tr[data-slug]');
  if (tr && !e.target.closest('a') && (ev === 'click' || e.key === 'Enter')) go({ p: tr.dataset.slug });
 }));
 document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && readHash().p) go({ p: '' }); });
 window.addEventListener('hashchange', render);
 render();
})();
