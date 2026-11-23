(function () {
 'use strict';
 const { RadarModel: R, SNAPSHOT: S, TABLES: tables } = window;
 const el = id => document.getElementById(id), app = el('app');
 if (!R || !S || !tables) { app.innerHTML = '<p class=empty>Run main.ts to build the dashboard data.</p>'; return; }

 R.use(tables);
 const radar = R.build(S), { fit, model: M, rows } = radar, { usd, mins } = R;
 const { target_cover: cover, hour_usd: rate, drop_share: share } = M;
 const { round, abs, log, sqrt } = Math;
 const dollars = n => '$' + n.toLocaleString('en-US');
 const FAM = Object.fromEntries(R.FAMILIES);
 const bySlug = Object.create(null); rows.forEach(r => { bySlug[r.p.slug] = r; });
 const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
 const nameFlag = r => (r.flag ? `<small>${esc(r.flag)}</small>` : '') +
  (r.wordMatch ? `<small>Name overlaps ${esc(r.wordMatch)}, whose token may cover it.</small>` : '');
 const pct = (x, d) => (x == null ? 'n/a' : (x > 0 ? '+' : x < 0 ? '−' : '') + abs(x).toFixed(d == null ? 1 : d) + '%');
 const mult = x => '×' + (x >= 10 ? x.toFixed(1) : x >= 1 ? x.toFixed(2) : x.toFixed(3));
 const days = d => (d == null ? '?' : d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd');
 const famChip = f => `<span class="fam f-${f}"><i></i>${esc(FAM[f])}</span>`;
 const verdictTag = v => `<span class="verdict v-${v}">${v}</span>`;
 const note = t => `<p class=note>${t}</p>`;
 const kpi = (v, label) => `<div><small>${label}</small><b>${v}</b></div>`;
 const farmBadge = p => `<b class="mechanism">${esc(p.mechanism)}</b>`;
 const vmax = rows[0].v.implied;
 const isFarm = r => r.plan.verdict === 'farm', net = r => r.plan.net;
 const sum = (rs, f) => rs.reduce((s, r) => s + f(r), 0);
 const href = r => link({ p: r.p.slug });

 const CLEAR = { q: '', fam: '', chain: '', scope: 'all', verdict: '', dep: '' };
 const PORTFOLIO = { ...CLEAR, scope: 'watch', verdict: 'farm-net', dep: '10000', sort: 'plan', dir: 'desc' };
 const DEF = { view: 'board', q: '', fam: '', chain: '', scope: 'all', verdict: '', sort: 'rank', dir: 'asc', p: '', vs: '', dep: '', bud: '25000', hr: String(rate) };
 const DEPOSITS = ['', 1000, 5000, 10000, 25000, 100000, 250000], RATES = [0, 10, rate, 50, 100], BUDGETS = [10000, 25000, 50000, 100000, 250000, 1000000];
 const PLANS = [['', 'Any'], ['farm', 'Farm'], ['marginal', 'Marginal'], ['skip', 'Skip'], ['farm-net', 'Farm + net > $0']];
 const HOURS = 8;
 function readHash() {
  const st = { ...DEF };
  for (const kv of location.hash.slice(1).split('&')) {
   const i = kv.indexOf('='), k = kv.slice(0, i);
   if (i > 0 && Object.hasOwn(DEF, k)) try { st[k] = decodeURIComponent(kv.slice(i + 1)); } catch {}
  }
  const ok = { view: 'board model aside trading'.split(' '), scope: 'all watch early outside stable'.split(' '),
   verdict: PLANS.map(p => p[0]), dir: ['asc', 'desc'], dep: DEPOSITS, hr: RATES, bud: BUDGETS };
  for (const k in ok) if (!ok[k].map(String).includes(st[k])) st[k] = DEF[k];
  if (!Object.hasOwn(KEYS, st.sort)) st.sort = 'rank';
  return st;
 }
 function link(patch) {
  const st = { ...readHash(), ...('p' in patch && { vs: '' }), ...patch };
  return '#' + Object.keys(DEF).filter(k => st[k] !== DEF[k]).map(k => k + '=' + encodeURIComponent(st[k])).join('&');
 }
 function go(patch) { location.hash = link(patch); }

 const KEYS = {
  rank: r => r.rank, name: r => r.p.name.toLowerCase(), tvl: r => r.p.tvl_usd, g: r => r.p.change_7d,
  age: r => r.v.age_used, value: r => r.v.implied, odds: r => r.v.time_factor, apr: r => r.v.apr, plan: r => r.plan.drop / r.plan.all_in
 };
 const families = st => st.fam ? st.fam.split(',') : [];
 const weightedNet = r => r.plan.drop * r.v.time_factor - r.plan.all_in;
 function filtered(st) {
  const q = st.q.trim().toLowerCase(), fams = families(st);
  const out = rows.filter(r =>
   (!q || (r.p.name + ' ' + r.p.slug + ' ' + (r.p.category || '') + ' ' + r.p.chains.join(' ')).toLowerCase().includes(q)) &&
   (!fams.length || fams.includes(r.v.family)) &&
   (!st.chain || r.p.chains.includes(st.chain)) &&
   (st.scope === 'all' || (st.scope === 'watch' ? r.watch : st.scope === 'outside' ? !r.watch : st.scope === 'stable' ? r.stable : r.below)) &&
   (!st.verdict || (st.verdict === 'farm-net' ? isFarm(r) && weightedNet(r) > 0 : r.plan.verdict === st.verdict)));
  const key = KEYS[st.sort], sign = st.dir === 'desc' ? -1 : 1;
  return out.sort((a, b) => { const x = key(a), y = key(b); if (x == null || y == null) return (x == null) - (y == null) || a.rank - b.rank; return (x < y ? -1 : x > y ? 1 : 0) * sign || a.rank - b.rank; });
 }

 const pays = p => p.drop >= cover * p.all_in;
 const sg = x => (x < 0 ? '−' : '+') + usd(abs(x));
 const FIELDS = [['Rank', r => r.rank, -1], ['Protocol', r => r.p.name], ['Family', r => fit.families[r.v.family].label], ['TVL', r => round(r.p.tvl_usd), 0, usd],
  ['7-day change %', r => r.p.change_7d, 0, pct], ['Days tracked', r => r.v.age_used], ['Value if launched', r => round(r.v.fitted), 1, usd],
  ['Token-record score', r => +r.v.time_factor.toFixed(3), 1, x => pc(x)], ['Implied value', r => round(r.v.implied), 1, usd], ['50% band', r => usd(r.v.low) + '–' + usd(r.v.high)], ['Drop APR', r => +r.v.apr.toFixed(4), 1, x => pc(x, 2)], ['Verdict', r => r.plan.verdict], ['Capital', r => r.plan.stake, -1, usd],
  ['Gas & fees', r => +r.plan.cost.toFixed(2), -1, usd], ['Hours', r => +(r.plan.minutes / 60).toFixed(1), -1], ['Modeled drop', r => +r.plan.drop.toFixed(2), 1, usd],
  ['Net if it launches', r => +r.plan.net.toFixed(2), 1, sg], ['Verdict at 3x gas', r => r.plan.fees[1][3]], ['Stress loss', r => +r.plan.stress_usd.toFixed(2), -1, usd],
  ['Capital for x2', r => (pays(r.plan) ? r.plan.stake : r.plan.pay_cap || ''), -1, x => (x ? usd(x) : 'none to $1M')]];
 const csv = shown => 'data:text/csv;charset=utf-8,' + encodeURIComponent([FIELDS.map(f => f[0])].concat(shown.map(r => FIELDS.map(f => { const x = f[1](r); return typeof x === 'string' ? '"' + x.replace(/"/g, '""') + '"' : x; }))).join('\n'));
 function compare(a, b) {
  return `<a class=back href="${link({ vs: '' })}">← Back to ${esc(a.p.name)}</a><section class=intro><h1>${esc(a.p.name)} vs ${esc(b.p.name)}</h1><p>Same model, deposit and hour. Better figures in bold.</p></section>
<div class=tablewrap>${tbl('board cmp', ['', '#' + esc(a.p.name), '#' + esc(b.p.name)], FIELDS.slice(2).map(([l, f, d, F]) => { const x = f(a), y = f(b), w = d && x !== y && x !== '' && y !== '' ? (x - y) * d > 0 : null; F = F || String; return [l, w === true ? `<b>${F(x)}</b>` : F(x), w === false ? `<b>${F(y)}</b>` : F(y)]; }))}</div>`;
 }
 const rOf = v => 1.8 + 6.5 * sqrt(v / vmax);
 function chart(shown, H) {
  const W = 470, L = 40, B = 26, T = 10, RR = 10;
  const on = new Set(shown.map(r => r.p.slug));
  const xmax = sqrt(2400), ylo = Math.log10(0.001), yhi = Math.log10(2);
  const X = d => L + (W - L - RR) * sqrt(Math.min(d, 2400)) / xmax;
  const Y = a => T + (H - T - B) * (1 - (Math.log10(Math.min(2, Math.max(0.001, a))) - ylo) / (yhi - ylo));
  const grid = (x1, x2, y1, y2, x, y, anchor, label) =>
   `<line class=grid x1="${x1}" x2="${x2}" y1="${y1}" y2="${y2}"/><text class=ax x="${x}" y="${y}" text-anchor="${anchor}">${label}</text>`;
  let g = '';
  [[30, '1m'], [180, '6m'], [365, '1y'], [730, '2y'], [1095, '3y'], [1825, '5y']].forEach(([d, l]) => {
   const x = X(d);
   g += grid(x, x, T, H - B, x, H - 8, 'middle', l);
  });
  [[0.001, '0.1%'], [0.01, '1%'], [0.1, '10%'], [1, '100%']].forEach(([a, l]) => {
   const y = Y(a);
   g += grid(L, W - RR, y, y, L - 6, y + 3, 'end', l);
  });
  let dots = '';
  rows.slice().reverse().forEach(r => {
   const rad = rOf(r.v.implied);
   dots += `<a href="${href(r)}"><circle class="dot f-${r.v.family}${on.has(r.p.slug) ? '' : ' off'}" cx="${X(r.v.age_used).toFixed(1)}" cy="${Y(r.v.apr).toFixed(1)}" r="${rad.toFixed(1)}"><title>${esc(r.p.name)} ${usd(r.v.implied)}</title></circle></a>`;
  });
  const pick = [];
  [(a, b) => b.v.implied - a.v.implied, (a, b) => b.v.apr - a.v.apr].forEach(cmp => {
   shown.slice().sort(cmp).slice(0, 3).forEach(r => { if (!pick.includes(r)) pick.push(r); });
  });
  const boxes = [];
  let labels = '';
  pick.forEach(r => {
   const cx = X(r.v.age_used), cy = Y(r.v.apr), w = r.p.name.length * 5.6 + 6, h = 12;
   const tries = [[cx + 8, cy - 6], [cx - 8 - w, cy - 6], [cx - w / 2, cy - 20], [cx - w / 2, cy + 8]];
   const spot = tries.find(([x, y]) => x > L && x + w < W && y > 0 && y + h < H - B &&
    boxes.every(b => x + w < b[0] || b[0] + b[2] < x || y + h < b[1] || b[1] + b[3] < y));
   if (!spot) return;
   boxes.push([spot[0], spot[1], w, h]);
   labels += `<text class=lab x="${(spot[0] + 3).toFixed(1)}" y="${(spot[1] + 9).toFixed(1)}">${esc(r.p.name)}</text>`;
  });
  g += `<text class=ax x="${W - RR}" y="${H - 18}" text-anchor=end>days without a token →</text><text class=ax x="${L + 4}" y="${T + 8}">airdrop APR if it launches ↑</text>`;
  [[1e6, '$1M'], [3e7, '$30M']].forEach(([v, l], i) => { g += `<circle class="dot f-infra" cx="${W - 120 + i * 50}" cy="${T + 12}" r="${rOf(v).toFixed(1)}"/><text class=ax x="${W - 112 + i * 50}" y="${T + 15}">${l}</text>`; });
  return `<svg viewBox="0 0 ${W} ${H}" class=radar>${g}
   ${dots}${labels}</svg>`;
 }

 function head(st) {
  const n = v => (v === 'board' ? rows.length : v === 'model' ? CHECKS.length : v === 'aside' ? radar.products.length : fit.n);
  el('tabs').innerHTML = [['board', 'Pre-token board'], ['model', 'Model & checks'], ['aside', 'Set aside'], ['trading', 'Trading tokens']]
   .map(([v, l]) => `<a href="${link({ view: v, p: '' })}" class="${st.view === v && !st.p ? 'on' : ''}">${l} <b>${n(v)}</b></a>`).join('');
  el('meta').innerHTML = `<span>Snapshot <b>${esc(S.as_of)}</b></span><span>model <b>${esc(M.version)}</b></span>`;
 }

 const O = fit.odds, pc = (x, d = 0) => (x * 100).toFixed(d) + '%';
 const bandTvl = b => `${b.lo ? usd(b.lo) : '$0'}–${b.hi < 1e15 ? usd(b.hi) : '∞'}`;
 const eq = `<p class=eq>value = T × ${mult(fit.base)} × (T ÷ $100M)<sup>${fit.slope.toFixed(2)}</sup> × s × h, where h = ${M.product_haircut} for liquid-staking issuers and versioned pools, 1 otherwise</p>`;
 function formula() {
  const T = fit.tests, x = v => '×' + v.toFixed(2);
  const used = { flat: 'baseline', spot: 'replaced', size: 'fitted', family: fit.k === Infinity ? 'dropped' : 'k=' + fit.k, growth: 'not used', age: 'via score' };
  return `<div class="card model">
<h2>Value model <span>fit on ${fit.n} trading tokens</span></h2>
${eq}
${tbl('mini tests', ['Term · held-out median miss', '#Leave-one-out', '#Walk-fwd', '#Family out', '#Use'],
    T.terms.map(t => [t.label, x(t.loo), x(t.wf), x(t.lofo), used[t.key]]), i => T.terms[i].ok)}
${tbl('mini tests', ['Score s · held-out Brier', '#Walk-fwd', '#Family out'],
    O.terms.map(([label, wf, fam]) => [label, wf.toFixed(3), fam.toFixed(3)]), i => !i)}
<p class=note>Walk-forward: ${T.wf_train} early listings train, ${T.wf_n} since ${T.wf_from}. s: a logistic fit on ${O.n} peers (${O.with_token} record a token): AUC ${O.auc_loo.toFixed(2)} LOO, ${O.auc_wf.toFixed(2)} walk-forward, ${O.auc_fam.toFixed(2)} family-out.</p>
<p class=note><b>Missing ages:</b> ${rows.filter(r => r.ageRange).length} rows use median age. Ranks at 25th and 75th age percentiles: ${rows.filter(r => r.ageRange).map(r => `${esc(r.p.name)} #${r.ageRange[0].rank}–#${r.ageRange[1].rank}`).join(', ')}.</p>
<p class=note><b>s scores token records today.</b> No launch dates in snapshot.</p>
<p class=note>LOO miss by TVL band: ${fit.bands.map(b => `<b>${bandTvl(b)} ×${b.miss.toFixed(1)}</b> (${b.n} tokens; ${rows.filter(r => r.p.tvl_usd >= b.lo && r.p.tvl_usd < b.hi).length} ranked)`).join(' · ')}.</p></div>`;
 }

 const bRows = R.boardRows(radar), dig = R.digest(bRows), B = window.BOARD || {};
 const [flatT, spotT, sizeT, famT] = fit.tests.terms, curve = fit.k === Infinity ? sizeT : famT;
 const nTr = S.protocols.filter(p => p.mcap_usd > 0).length, nAll = rows.length + radar.products.length + nTr + radar.listed_only;
 const watchCov = S.watchlist.filter(s => bySlug[s]).length;
 const CHECKS = [
  [nAll === S.protocols.length, `${nAll}/${S.protocols.length} protocols: ${rows.length} ranked, ${radar.products.length} set aside, ${nTr} trading (${fit.n} in fit), ${radar.listed_only} with a token but no cap`],
  [watchCov === S.watchlist.length, `watchlist ${watchCov}/${S.watchlist.length} covered`],
  [rows.every((r, i) => r.rank === i + 1 && (!i || r.v.implied <= rows[i - 1].v.implied)), `ranks 1–${rows.length}, value never rising`],
  [rows.every(r => r.p.gecko_id == null && r.p.symbol == null && r.p.mcap_usd == null), `${rows.length}/${rows.length} ranked rows have no token record`],
  [bRows.every(b => b.farm_steps.length >= 3 && b.farm_steps.length <= 12 && b.farm_steps.every(t => t.length <= 600 && / Cost: .+ Time: /.test(t))), `${bRows.length} plans, every step costed and timed`],
  [B.digest === dig && B.rows === rows.length, `screen = board.json at Auto deposit, digest ${dig}`],
  [O.auc_loo > 0.5 && O.auc_wf > 0.5 && O.auc_fam > 0.5 && O.brier.loo < O.brier.loo_base && O.brier.wf < O.brier.wf_base && O.brier.fam < O.brier.fam_base, `score beats base rate in 3 held-out tests: AUC ${O.auc_loo.toFixed(2)}/${O.auc_wf.toFixed(2)}/${O.auc_fam.toFixed(2)}`],
  [rows.slice(0, 10).every(r => r.boot >= 0.8), `ranks 1–${rows.findIndex(r => r.boot < 1)} top 20 in all 40 refits`],
  [O.gap < 0.2, `score within ${round(O.gap * 100)} pts of every age cohort`],
  [spotT.ok && sizeT.ok, `value miss ×${flatT.loo.toFixed(2)} flat → ×${sizeT.loo.toFixed(2)} fit, held out 3 ways`]
 ];
 const failed = CHECKS.filter(([ok]) => !ok), passText = `${CHECKS.length - failed.length}/${CHECKS.length} self-checks pass`;

 function portfolio(st, shown) {
  const screened = filtered({ ...st, verdict: '' });
  const best = screened.reduce((a, r) => !a || weightedNet(r) > weightedNet(a) ? r : a, null);
  return `<section class="portfolio" aria-label="Portfolio snapshot">
<p class=tags>${st.scope === 'watch' ? '<span class="tag wlt">Watchlist</span>' : ''}<span class="tag pre">Farm · weighted net &gt; $0</span><span class=tag>${st.dep ? usd(+st.dep) + ' per protocol' : 'Auto deposit'}</span></p>
<div class=pkpis>${kpi(shown.length + ' / ' + screened.length, 'Protocols qualified')}${kpi(usd(sum(shown, r => r.plan.stake)), 'Total capital needed')}${kpi(usd(sum(shown, weightedNet)), 'Score-weighted net')}</div>
<p class=note>Drop × token-record score − gas, fees and time ($${st.hr}/h). The score measures token records today. Carry and stress losses are excluded.</p>
   ${!shown.length && best ? note(`${screened.filter(r => r.plan.net > 0).length} clear costs if rewarded. Best weighted net ${sg(weightedNet(best))} (${esc(best.p.name)}). <a href="${link({ verdict: '' })}">View screened plans →</a>`) : ''}</section>`;
 }

 function board(st) {
  const shown = filtered(st), fams = families(st);
  const port = st.verdict === 'farm-net';
  const audit = R.farmFlips(rows);
  const farms = shown.filter(isFarm);
  const mid = f => rows.map(f).sort((a, b) => a - b)[rows.length >> 1];
  const chains = {}; rows.forEach(r => r.p.chains.forEach(c => { chains[c] = (chains[c] || 0) + 1; }));
  const famCount = {}; rows.forEach(r => { famCount[r.v.family] = (famCount[r.v.family] || 0) + 1; });
  const th = (k, l, cls) => {
   const on = st.sort === k, dir = on && st.dir === 'asc' ? 'desc' : on ? 'asc' : (k === 'rank' || k === 'name' ? 'asc' : 'desc');
   return `<th class="${cls || ''}${on ? ' sorted' : ''}"><a href="${link({ sort: k, dir: dir })}">${l}${on ? (st.dir === 'asc' ? ' ▲' : ' ▼') : ''}</a></th>`;
  };
  const seg = (key, opts) => `<div class=seg>${opts.map(([v, l]) => `<a href="${link({ [key]: v })}" class="${st[key] === v ? 'on' : ''}">${l}</a>`).join('')}</div>`;
  const select = (key, label, vals, fmt) => `<label class=field><span>${label}</span><select id="${key}">${vals.map(v => `<option value="${v}"${String(v) === st[key] ? ' selected' : ''}>${fmt(v)}</option>`).join('')}</select></label>`;
  const famLinks = R.FAMILIES.map(f => {
   const on = fams.includes(f[0]), next = on ? fams.filter(x => x !== f[0]) : fams.concat(f[0]);
   return `<a href="${link({ fam: next.join(',') })}" class="chip f-${f[0]}${on ? ' on' : ''}"><i></i>${esc(f[1])} <b>${famCount[f[0]] || 0}</b></a>`;
  }).join('');
  let cap = 0, hrs = 0;
  const pick = shown.filter(r => r.plan.net > 0).sort((a, b) => b.plan.net / b.plan.stake - a.plan.net / a.plan.stake)
   .filter(r => cap + r.plan.stake <= +st.bud && hrs + r.plan.minutes / 60 <= HOURS && (cap += r.plan.stake, hrs += r.plan.minutes / 60));
  const active = st.q || st.fam || st.chain || st.scope !== 'all' || st.verdict || st.dep;
  const body = shown.map(r => {
   const { p, v, plan: pl } = r, { age } = v;
   const w = Math.max(1.5, 100 * sqrt(v.implied / vmax));
   return `<tr data-slug="${esc(p.slug)}" tabindex=0>
<td class=rank>${r.rank}<small>${r.rlo}–${r.rhi}</small></td>
<td class=proto><a href="${link({ p: p.slug })}">${esc(p.name)}</a>${r.watch ? '<span class=wl title="On the watchlist">WL</span>' : ''}<small>${esc(p.category || 'Uncategorised')} · ${esc(p.chains.slice(0, 2).join(', '))}${p.chains.length > 2 ? ' +' + (p.chains.length - 2) : ''}</small>${nameFlag(r)}</td>
<td>${famChip(v.family)}</td>
<td class=num>${usd(p.tvl_usd)}</td>
<td class="num ${p.change_7d >= 0.05 ? 'up' : p.change_7d <= -0.05 ? 'down' : ''}">${pct(p.change_7d)}</td>
<td class="num${age == null ? ' est' : ''}" title="${age == null ? 'Missing date: median age' : 'Listed ' + esc(p.listed_at)}">${age == null ? '~' : ''}${days(v.age_used)}</td>
<td class="val"><span class=bar><i style="width:${w.toFixed(1)}%"></i></span><b>${usd(v.implied)}</b><small>${usd(v.low)}–${usd(v.high)}</small><small class=factors>${usd(v.fitted)} × s ${pc(v.time_factor)}${v.haircut === 1 ? '' : ` × ${v.haircut}`}</small></td>
<td class=num>${pc(v.time_factor)}</td>
<td class="num apr">${pc(v.apr, 1)}</td>
<td class=plan>${verdictTag(pl.verdict)} <span class=pmult>pays ${mult(pl.drop / pl.all_in)}${pays(pl) ? '' : pl.pay_cap ? ` · ×${cover} at ${usd(pl.pay_cap)}` : ` · no deposit pays ×${cover}`}</span><small>${usd(pl.drop)} drop vs ${usd(pl.all_in)} ${pl.verdict === 'skip' ? 'to deposit · $0 research' : `cost · ${usd(pl.stake)} on ${esc(pl.chain)}`}</small><small class="farmcue">${farmBadge(pl)} ${esc(pl.risk)} · ~${usd(pl.round_trip)} round trip</small>${port ? `<small class=up>${sg(weightedNet(r))} score-weighted net</small>` : ''}</td></tr>`;
  }).join('');
  const ctl = `<div class=ctl><section class=filters>
<label class=search><input id=q type=search value="${esc(st.q)}" placeholder="Name, category, chain" autocomplete="off" aria-label="Search"></label>
<div class=field><span>Scope</span>${seg('scope', [['all', 'All'], ['watch', 'Watchlist'], ['outside', 'Outside it'], ['early', 'Below $50M'], ['stable', 'Top 20, all variants']])}</div>
<div class=field><span>Plan</span>${seg('verdict', PLANS)}</div>
   ${select('dep', 'Deposit', DEPOSITS, d => d ? usd(d) : 'Auto: least that pays')}
   ${select('hr', 'Your hour', RATES, h => `$${h}/h`)}
<label class=field><span>Chain</span><select id=chain><option value="">All chains</option>${Object.keys(chains).sort((a, b) => chains[b] - chains[a] || (a < b ? -1 : 1)).map(c => `<option${c === st.chain ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
<div class=count>Top 20 at $${st.hr}/h: <b>${farmAt(+st.hr, st.dep)}</b> farm (${farmAt(0, st.dep)} at $0/h, ${farmAt(rate, st.dep)} at $${rate}/h) · farm verdicts holding at 3× gas: <b>${farms.filter(r => r.plan.fees[1][3] === 'farm').length}</b>/${farms.length} · <b>${shown.length}</b> of ${rows.length} shown · <span id="drawn"></span> · <a download="launch-radar.csv" href="${csv(shown)}">CSV</a>${active ? ` · <a href="${link(CLEAR)}">clear filters</a>` : ''}</div>
</section>
<section class="filters basket">${select('bud', 'Budget', BUDGETS, usd)}
<span>Basket by net/$, ${shown.length} shown, within ${usd(+st.bud)} and ${HOURS} h: ${pick.map(r => `<a href="${href(r)}">${esc(r.p.name)}</a> ${usd(r.plan.stake)}`).join(' · ') || 'none pays'} → <b>${usd(cap)}</b>, ${hrs.toFixed(1)} h, net if rewarded <b class=up>+${usd(sum(pick, net))}</b></span></section>
<section class=filters><div class=chips role=group aria-label="Family">${famLinks}</div>${port ? '' : `<a class="chip pre" href="${link(PORTFOLIO)}">${usd(+PORTFOLIO.dep)} watchlist portfolio →</a>`}</section></div>`;
  return `<section class=strip>
<div><b>${watchCov}/${S.watchlist.length}</b><span>watchlist covered</span></div>
<div><b>${rows.length}</b><span>ranked, ${rows.filter(r => r.below).length} under $50M</span></div>
<div><b>${radar.products.length} · ${fit.n}</b><span>set aside · trading (fit)</span></div>
<div class=miss><b>held-out miss ×${curve.loo.toFixed(1)} LOO · ×${curve.wf.toFixed(1)} walk-forward</b><span>Median · flat baseline ×${flatT.loo.toFixed(1)} LOO · ×${flatT.wf.toFixed(1)} WF</span></div>
<div><b>${O.auc_loo.toFixed(2)} · ${O.auc_wf.toFixed(2)}</b><span>score AUC: LOO · walk-fwd</span></div>
<div><b>${audit.base}</b><span>Farm · pay ×${cover} their costs</span></div>
<div><b>${usd(mid(r => r.plan.stake))} · ${mins(mid(r => r.plan.minutes))}</b><span>median deposit · hands-on</span></div>
</section>
<section class="hero slim">
<div class=lead>
<h1>${port ? 'Portfolio snapshot' : `${rows.length} pre-token protocols, by implied value`}${st.sort === 'rank' ? '' : `<small> · shown by ${{ g: '7-day change', age: 'days tracked', odds: 'score', apr: 'drop APR', plan: 'farm plan' }[st.sort] || st.sort} ${st.dir === 'asc' ? '▲' : '▼'}</small>`}</h1>
    ${port ? portfolio(st, shown) : ''}
    ${active ? note(`${passText} · <a href="${link(CLEAR)}">unfiltered board</a>`) : `${eq}
<p class="checkline ${failed.length ? 'bad' : 'ok'}"><b>${passText}</b>, on load: ${[5, 1, 6, 0].map(i => CHECKS[i][1]).join(' · ')}${failed.map(c => ' · ✗ ' + c[1]).join('')} · <a href="${link({ view: 'model' })}">all checks →</a></p>`}
${sensitivity(st, audit)}${ctl}
</div>
<div class="card chartcard"><h2>Radar <span>days without a token × airdrop yield</span></h2>${chart(shown, 300)}</div>
</section>
<div class=tablewrap><table class=board>
<thead><tr>${th('rank', 'Rank')}${th('name', 'Protocol')}<th>Family</th>${th('tvl', 'TVL', 'num')}${th('g', '7d', 'num')}${th('age', 'Tracked', 'num')}${th('value', 'Implied value · 50% band', 'val')}${th('odds', 'Score', 'num')}${th('apr', 'Drop APR', 'num')}${th('plan', 'Farm plan · if it launches', 'plan')}</tr></thead>
<tbody>${body || `<tr><td colspan=10 class=empty>${port ? 'No Farm plan has positive score-weighted net in this slice.' : 'No protocol matches these filters.'}</td></tr>`}</tbody></table></div>`;
 }

 function redTeam(r) {
  const v = r.v, b = fit.bands.find(x => r.p.tvl_usd >= x.lo && r.p.tvl_usd < x.hi), alt = Object.entries(r.alt).sort((a, c) => abs(c[1] - r.rank) - abs(a[1] - r.rank))[0];
  return [
   `<b>Value:</b> trading tokens (${bandTvl(b)} TVL) miss market caps by median ×${b.miss.toFixed(1)} held out; launch caps of ${usd(v.fitted * fit.band_low)} or ${usd(v.cap_high)} are within the band.`,
   `<b>Score:</b> ${pc(v.time_factor)} of similar peers record a token today. Days tracked matters most (held-out Brier ${O.terms[0][1].toFixed(3)}, ${O.terms[2][1].toFixed(3)} without it).`,
   `<b>Rank:</b> #${r.rank} now, ${r.rlo}–${r.rhi} across 40 refits${r.flip ? `; ${r.flip < 2 ? Math.ceil((r.flip - 1) * 100) + '% more' : mult(r.flip) + ' the'} TVL, others fixed, would pass #${r.rank - 1}` : ''}, #${alt[1]} ${alt[0]}${v.growth_imputed ? '; its 7-day change is unreported, so 0% was used' : ''}${r.ageRange ? `; median age used. At ${r.ageRange[0].age} days: #${r.ageRange[0].rank}, at ${r.ageRange[1].age} days #${r.ageRange[1].rank}` : ''}.`,
   `<b>Plan:</b> pays ×${cover} with ≥${pc(r.plan.need_share, 1)} goes to depositors (assumed ${share * 100}%), if a token launches.`
  ];
 }
 function detail(st) {
  const r = bySlug[st.p];
  if (!r) return `<p class=empty>No ranked protocol ${esc(st.p)}. <a href="${link({ p: '' })}">Back to the board</a></p>`;
  const { p, v, plan: pl } = r, fam = fit.families[v.family];
  const peers = radar.live.filter(l => l.family === v.family)
   .sort((a, b) => abs(log(a.tvl / p.tvl_usd)) - abs(log(b.tvl / p.tvl_usd))).slice(0, 6);
  const miss = x => log(p.tvl_usd * x.actual / x.tvl / v.fitted);
  const caps = peers.map(x => x.actual), lo = Math.log10(Math.min(v.low, ...caps) / 1.5), hi = Math.log10(Math.max(v.high, ...caps) * 1.5);
  const pos = x => (100 * (Math.log10(x) - lo) / (hi - lo)).toFixed(2) + '%';
  const line = (label, src, val, cls) => `<tr class="${cls || ''}"><td>${label}<small>${src}</small></td><td class=num>${val}</td></tr>`;
  return `<a class=back href="${link({ p: '' })}">← Back to the board</a><label class="field vs"><span>Compare with</span><select id=vs><option value="">another protocol…</option>${rows.filter(x => x !== r).map(x => `<option value="${x.p.slug}">#${x.rank} ${esc(x.p.name)}</option>`).join('')}</select></label>
<section class=dhead>
<div class=rankbig><small>Rank</small><b>${r.rank}</b><small>of ${rows.length}</small></div>
<div><h1>${esc(p.name)}</h1>
<p class=tags>${famChip(v.family)}<span class=tag>${esc(p.category || 'Uncategorised')}</span><span class="tag pre">No token on record</span>${r.watch ? '<span class="tag wlt">On the watchlist</span>' : '<span class=tag>Outside the watchlist</span>'}</p>
<p class=sub>${esc(p.chains.join(' · '))}${p.listed_at ? ` — tracked since ${esc(p.listed_at)}` : ' — no listing date'}</p>${nameFlag(r)}</div>
<div class=dval><small>Implied token value</small><b>${usd(v.implied)}</b><small>50% band ${usd(v.low)} – ${usd(v.high)} · ${mult(v.multiple)} TVL</small><small>Rank ${r.rlo}–${r.rhi} in 80% of 40 refits; top 20 in ${pc(r.boot)}</small><small>Rank #${r.rank}; ${Object.keys(r.alt).map(k => `#${r.alt[k]} ${k}`).join(' · ')}</small></div>
</section>
<div class=dgrid>
<div class=col>
<section class=card><h2>How the value is built <span>model.js value()</span></h2>
<table class=receipt>
      ${line('TVL', 'snapshot tvl_usd', usd(p.tvl_usd))}
      ${line('Momentum ' + pct(v.growth, 2), (v.growth_imputed ? 'no change_7d: 0% assumed' : '7d ' + pct(p.change_7d, 2) + ' carried a week, clipped to ' + M.growth_floor + '…+' + M.growth_cap + '%'), '→ ' + usd(v.tvl_next))}
      ${line('Peer multiple at $100M', (fit.k === Infinity ? 'pooled curve: family fits lost' : 'family pull k=' + fit.k) + ' (' + esc(fam.label) + ' alone ' + mult(fam.raw) + ')', mult(v.fam_multiple))}
      ${line('Size curve', '(TVL ÷ $100M)<sup>' + fit.slope.toFixed(2) + '</sup>, slope fit on ' + fit.n + ' tokens', mult(v.size_mult))}
      ${line('Value if launched', 'value of a trading peer this size', usd(v.fitted), 'sum')}
      ${line('Token-record score s', 'peers with this TVL, ' + (v.age == null ? 'median ' + v.age_used : v.age) + ' days tracked, 7-day change and family recording a token', pc(v.time_factor))}
      ${r.flag ? line('Product haircut', esc(r.flag), '×' + v.haircut.toFixed(2)) : ''}
      ${line('Implied value', 'rank ' + r.rank + ' of ' + rows.length + '', usd(v.implied), 'total')}
</table>
<div class=scale>
<span class=band style="left:${pos(v.low)};width:calc(${pos(v.high)} - ${pos(v.low)})"></span>
      ${peers.map(x => `<span class=peer style="left:${pos(x.actual)}" title="${esc(x.p.name)} ${usd(x.actual)}"></span>`).join('')}
<span class=mid style="left:${pos(v.implied)}"></span>
</div>
<p class=note>50% band: middle half of held-out misses (×${fit.band_low.toFixed(2)}–×${fit.band_high.toFixed(2)}). Held-out coverage ${fit.band_wf[0]}/${fit.band_wf[1]} newest and ${fit.band_fam[0]}/${fit.band_fam[1]} by family. Ticks: peer market caps.</p>
</section>
<section class=card><h2>Nearest trading peers <span>${esc(fam.label)}, closest TVL</span></h2>
  ${tbl('mini', ['Protocol', '#TVL', '#Market cap', '#÷ TVL'], peers.map(x => [`${esc(x.p.name)} <small>${esc(x.p.symbol || '')}</small>`, usd(x.tvl), usd(x.actual), mult(x.actual / x.tvl)]))}${(x => x ? `<p class=note>${esc(x.p.name)}'s ${mult(x.actual / x.tvl)} implies ${usd(p.tvl_usd * x.actual / x.tvl)} here. Curve fits ${usd(v.fitted)} here and misses that peer ${mult(Math.max(x.actual / x.loo, x.loo / x.actual))} held out.</p>` : '')(peers.slice().sort((a, b) => abs(miss(b)) - abs(miss(a)))[0])}</section>
<section class="card risk"><h2>Risks <span>for this protocol</span></h2><ul>${redTeam(r).map(t => `<li>${t}</li>`).join('')}</ul></section>
</div>
<section class="card planc"><h2>Farm plan <span>${pl.days} days on ${esc(pl.chain)}</span></h2>
<div class=pkpis>
 ${kpi(dollars(pl.stake), pl.verdict === 'skip' ? 'Capital if deposited' : 'Capital')}
 ${kpi(usd(pl.cost), 'Gas &amp; fees')}
 ${kpi(mins(pl.minutes), 'Hands-on')}
 ${kpi(usd(pl.drop), 'Drop if it launches')}
<div><small>If it launches</small>${verdictTag(pl.verdict)}</div>
</div>
<p class="farmcue">${farmBadge(pl)} <b>${esc(pl.risk)}</b> · ${usd(pl.round_trip)} modeled round trip in gas and activity fees before claim.<br>Stress case: ${esc(pl.stress)} → <b>${usd(pl.stress_usd)}</b> loss (×${(pl.stress_usd / Math.max(pl.drop, 1e-9)).toFixed(1)} modeled drop).</p>
${sensitivity(st, null, pl)}
<div class=steph><span></span><span>When · what to do</span><span>Cost</span><span>Time</span></div>
<ol class=steps>${pl.steps.map(s => `<li><p><em>${esc(s.when)}</em>${esc(s.act)}.</p><span class=cost>${usd(s.usd)}</span><span class=time>${mins(s.min)}</span></li>`).join('')}</ol>
<div class=math>
<p><b>Drop APR ${pc(v.apr, 2)} if it launches</b> = ${usd(v.fitted)} × ${share * 100}% to depositors ÷ (${usd(v.tvl_next)} TVL × (${Math.min(v.age_used, M.season_days)} + ${M.farm_days}) season days) × 365.</p>
<p>Dollar-days: (${pl.tranches.map(t => `${dollars(t[0])} × ${pl.days - t[1]} d`).join(' + ')}) × ${pc(v.apr, 2)} ÷ 365 = <b>${usd(pl.drop)}</b> vs <b>${usd(pl.all_in)}</b> all-in (${usd(pl.cost)} fees + ${mins(pl.minutes)} at $${pl.hour}/h), net <b class="${pl.net >= 0 ? 'up' : 'down'}">${sg(pl.net)}</b>.</p><p><b>Fees</b> at ${pl.fees.map(([m, cost, net, verdict]) => `${m}× gas ${usd(cost)}, net ${sg(net)} (${verdict})`).join('; ')}.</p><p><b>Carry:</b> ${dollars(pl.stake)} for ${pl.days} days forgoes ${usd(pl.carry)} at ${M.carry_rate * 100}% elsewhere. Net at zero deposit yield ${sg(pl.net - pl.carry)}.</p><p><b>Capital:</b> ${st.dep ? 'your deposit' : pays(pl) ? `least that pays ×${cover} ($500–$25K)` : `$25K cap; no deposit pays ×${cover}`}${pl.cert ? `; break-even certificate: ${dollars(pl.cert[2])} pays ×${pl.cert[3].toFixed(3)}, ${dollars(pl.cert[0])} only ×${pl.cert[1].toFixed(3)}` : ''}.</p>
</div>
</section>
</div>`;
 }

 const numCol = h => h[0] === '#' ? ' class=num' : '';
 const tbl = (cls, heads, rows, pick) => `<table class="${cls}"><thead><tr>${heads.map(h => `<th${numCol(h)}>${h.replace('#', '')}</th>`).join('')}</tr></thead><tbody>${rows.map((c, j) => `<tr${pick && pick(j) ? ' class=pick' : ''}>${c.map((v, i) => `<td${numCol(heads[i])}>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
 function sensitivity(st, audit, pl) {
  const t = window.TABLES, gas = Object.entries(t.gas), d = pl ? pl.shocks : audit.changes;
  const show = pl ? verdictTag : n => n > 0 ? '+' + n : n < 0 ? '−' + -n : '0';
  const loss = n => `${-n}/${audit.base} FARM lost`;
  const data = [['gas', 'Gas per tx', pl ? usd(pl.gas) : `${gas.length} rates + fallback`], ['hour', 'Time value', `$${st.hr}/h`],
   ['share', 'Depositor share', pc(share)], ['costs', 'All-in cost', pl ? usd(pl.all_in) : 'Gas, fees, time']];
  return `<details class="sens"><summary><b>Assumptions &amp; sensitivity</b> · 2× costs: ${pl ? show(d.costs[2]) : loss(d.costs[2])} · ½ share: ${pl ? show(d.share[0]) : loss(d.share[0])}</summary>
<p class=note>${pl ? `Baseline ${pl.verdict} on ${esc(pl.chain)}.` : `All ${rows.length} rows · ${st.dep ? usd(+st.dep) : 'Auto deposit'}${st.chain ? ' · ' + esc(st.chain) + ' if available' : ''}. + gains FARM, − loses FARM.`} One change. Fixed deposit and chain.</p>
  ${tbl('mini', ['Input', 'Baseline', '#−50%', '#+50%', '#2×'], data.map(([k, label, v]) => [label, v, ...d[k].map(show), ...(d[k].length === 2 ? ['—'] : [])]))}
<details><summary>Gas and stress rates</summary><p class=note>Gas per tx: ${gas.map(([c, n]) => `${esc(c)} $${n}`).join(' · ')} · fallback $${tables.gas_default}.</p>
<p class=note>Stress losses by exposure: ${Object.entries(tables.act).map(([k, a]) => `${esc(FAM[k] || (k === 'restake' ? 'Restaking' : 'Prediction markets'))} ${pc(R.stressRate(k), 2)} of ${{ capital: 'capital', side: 'side position' }[a[4][2]] || 'main stake'}`).join(' · ')}.</p></details></details>`;
 }
 const nm = (n, sub) => `<b>${esc(n)}</b><small>${esc(sub)}</small>`;
 function model() {
  return `<section class="hero slim">${formula()}<div class="card checks"><h2>Self-checks <span>run on load</span></h2><ul>${CHECKS.map(([ok, t]) => `<li class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${t}</li>`).join('')}</ul></div></section>`;
 }
 function aside() {
  return `<section class=intro><h1>${radar.products.length} products set aside</h1>
<p>Tokenless bridges, exchanges, Restaked BTC, and wrapped or staked products.</p></section>
<div class=tablewrap>${tbl('board', ['Product', 'Exclusion', '#TVL', '#7d'], radar.products.map(x => [nm(x.p.name, x.p.chains.slice(0, 3).join(', ')), `<span class=tag>${esc(x.kind)}</span>`, usd(x.p.tvl_usd), pct(x.p.change_7d)]))}</div>`;
 }

 function trading() {
  return `<section class=intro><h1>${fit.n} trading tokens in the calibration set</h1>
<p>calibrate() pools token TVL, excludes exchanges and products, and fits ln(mcap ÷ TVL) on ln(TVL). Value grows as TVL<sup>${fit.elasticity.toFixed(2)}</sup>. ${radar.listed_only} more have a token record without a cap.</p></section>
<div class=tablewrap>${tbl('board', ['Protocol', '#TVL', '#Market cap', '#÷ TVL', '#Fit without it', '#÷ market'], radar.live.map(l => [nm(l.p.name, (l.p.symbol || '') + ' · ' + (l.p.category || '')), usd(l.tvl) + (l.members > 1 ? ` <small>${l.members} parts</small>` : ''), usd(l.actual), mult(l.actual / l.tvl), usd(l.loo), `<span class="${l.loo / l.actual > 2 || l.loo / l.actual < 0.5 ? 'down' : 'up'}">${mult(l.loo / l.actual)}</span>`]))}</div>`;
 }

 let planDep = `|${DEF.hr}|`;
 const top20 = rows.slice(0, 20), farmAt = (h, dep) => top20.filter(r => R.farmPlan(r.p, r.v, +dep, h).verdict === 'farm').length;
 function render() {
  const st = readHash();
  head(st);
  app.className = st.p ? 'detail' : st.view;
  const k = [st.dep, st.hr, st.chain].join('|');
  if (k !== planDep) { planDep = k; rows.forEach(r => { r.plan = R.farmPlan(r.p, r.v, +st.dep, +st.hr, st.chain); }); }
  app.innerHTML = st.p ? (bySlug[st.p] && bySlug[st.vs] ? compare(bySlug[st.p], bySlug[st.vs]) : detail(st)) : st.view === 'model' ? model() : st.view === 'aside' ? aside() : st.view === 'trading' ? trading() : board(st);
  const d = el('drawn'), sh = d && filtered(st), trs = [...app.querySelectorAll('tr[data-slug]')];
  if (d) { const ok = trs.length === sh.length && trs.every((t, i) => t.dataset.slug === sh[i].p.slug && t.querySelector('td.val b').textContent === usd(sh[i].v.implied)); d.className = ok ? 'up' : 'down'; d.textContent = ok ? `✓ table drawn = model (${trs.length} rows)` : '✗ table drawn ≠ model'; }
  el('foot').innerHTML = `Source: ${esc(S.source)}. Floor $${(S.floor_usd / 1e6).toFixed(0)}M. Implied value = value if launched × token-record score × product haircut. DefiLlama may omit a protocol's token.`;
  if (st.p) window.scrollTo(0, 0);
 }
 app.addEventListener('input', e => {
  if (e.target.id !== 'q') return;
  const val = e.target.value;
  history.replaceState(null, '', link({ q: val })); render();
  const q = el('q'); q.focus(); q.setSelectionRange(val.length, val.length);
 });
 app.addEventListener('change', e => { if (['chain', 'dep', 'bud', 'hr', 'vs'].includes(e.target.id)) go({ [e.target.id]: e.target.value }); });
 ['click', 'keydown'].forEach(ev => app.addEventListener(ev, e => {
  const tr = e.target.closest('tr[data-slug]');
  if (tr && !e.target.closest('a') && (ev === 'click' || e.key === 'Enter')) go({ p: tr.dataset.slug });
 }));
 document.addEventListener('keydown', e => { if (e.key === 'Escape' && readHash().p) go({ p: '' }); });
 window.addEventListener('hashchange', render);
 render();
})();
