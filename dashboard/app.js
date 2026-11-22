/* Launch Radar page. It reads the snapshot's figures (data.js), runs RadarModel.build from model.js,
 * the same code main.ts runs for board.json, and draws three views: the ranked pre-token board, the
 * products set aside, and the trading tokens the value model was fitted on. All state lives in the
 * URL hash (#view, q, fam, chain, scope, verdict, sort, dir, p), so every view can be linked. */
(function () {
  'use strict';
  const R = window.RadarModel, S = window.SNAPSHOT, app = document.getElementById('app');
  if (!R || !S) { app.innerHTML = '<p class="empty">No data: run main.ts to write data.js beside the page.</p>'; return; }

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

  /* ---------- state in the hash ---------- */
  const DEF = { view: 'board', q: '', fam: '', chain: '', scope: 'all', verdict: '', sort: 'rank', dir: 'asc', p: '' };
  function readHash() {
    const st = Object.assign({}, DEF);
    location.hash.replace(/^#/, '').split('&').forEach((kv) => {
      const i = kv.indexOf('=');
      const k = kv.slice(0, i);
      if (i > 0 && Object.prototype.hasOwnProperty.call(DEF, k)) { try { st[k] = decodeURIComponent(kv.slice(i + 1)); } catch (e) { /* a broken escape keeps the default */ } }
    });
    // Unknown values fall back to the defaults, so a hand-typed link never breaks the page.
    if (!['board', 'aside', 'trading'].includes(st.view)) st.view = 'board';
    if (!['all', 'watch', 'early', 'outside'].includes(st.scope)) st.scope = 'all';
    if (!['', 'farm', 'marginal', 'skip'].includes(st.verdict)) st.verdict = '';
    if (!Object.prototype.hasOwnProperty.call(KEYS, st.sort)) st.sort = 'rank';
    if (st.dir !== 'desc') st.dir = 'asc';
    return st;
  }
  function link(patch) {
    const st = Object.assign(readHash(), patch), parts = [];
    Object.keys(DEF).forEach((k) => { if (st[k] !== DEF[k]) parts.push(k + '=' + encodeURIComponent(st[k])); });
    return '#' + parts.join('&');
  }
  function go(patch) { location.hash = link(patch); }

  /* ---------- filtering and sorting ---------- */
  const KEYS = {
    rank: (r) => r.rank, name: (r) => r.p.name.toLowerCase(), tvl: (r) => r.p.tvl_usd, g: (r) => r.p.change_7d,
    age: (r) => r.v.age_used, value: (r) => r.v.implied, multiple: (r) => r.v.multiple, apr: (r) => r.v.apr, plan: (r) => r.plan.drop / r.plan.all_in
  };
  function filtered(st) {
    const q = st.q.trim().toLowerCase(), fams = st.fam ? st.fam.split(',') : [];
    const out = rows.filter((r) =>
      (!q || (r.p.name + ' ' + r.p.slug + ' ' + (r.p.category || '') + ' ' + r.p.chains.join(' ')).toLowerCase().includes(q)) &&
      (!fams.length || fams.includes(r.v.family)) &&
      (!st.chain || r.p.chains.includes(st.chain)) &&
      (st.scope === 'all' || (st.scope === 'watch' ? r.watch : st.scope === 'outside' ? !r.watch : r.below)) &&
      (!st.verdict || r.plan.verdict === st.verdict));
    const key = KEYS[st.sort], sign = st.dir === 'desc' ? -1 : 1;
    // Missing figures (an unreported 7-day change) sort last in either direction.
    return out.sort((a, b) => { const x = key(a), y = key(b); if (x == null || y == null) return (x == null) - (y == null) || a.rank - b.rank; return (x < y ? -1 : x > y ? 1 : 0) * sign || a.rank - b.rank; });
  }

  /* ---------- the radar chart: days without a token against airdrop yield ---------- */
  function chart(shown) {
    const W = 470, H = 214, L = 40, B = 26, T = 10, RR = 10;
    const on = new Set(shown.map((r) => r.p.slug));
    const xmax = Math.sqrt(2400), ylo = Math.log10(0.001), yhi = Math.log10(2);
    const X = (d) => L + (W - L - RR) * Math.sqrt(Math.min(d, 2400)) / xmax;
    const Y = (a) => T + (H - T - B) * (1 - (Math.log10(Math.min(2, Math.max(0.001, a))) - ylo) / (yhi - ylo));
    let g = '';
    [[30, '1m'], [180, '6m'], [365, '1y'], [730, '2y'], [1095, '3y'], [1825, '5y']].forEach(([d, l]) => { g += `<line class="grid" x1="${X(d)}" x2="${X(d)}" y1="${T}" y2="${H - B}"/><text class="ax" x="${X(d)}" y="${H - 8}" text-anchor="middle">${l}</text>`; });
    [[0.001, '0.1%'], [0.01, '1%'], [0.1, '10%'], [1, '100%']].forEach(([a, l]) => { g += `<line class="grid" x1="${L}" x2="${W - RR}" y1="${Y(a)}" y2="${Y(a)}"/><text class="ax" x="${L - 6}" y="${Y(a) + 3}" text-anchor="end">${l}</text>`; });
    let dots = '';
    rows.slice().reverse().forEach((r) => {
      const rad = 2.2 + 9 * Math.sqrt(r.v.implied / maxImplied);
      dots += `<a href="${link({ p: r.p.slug })}"><circle class="dot f-${r.v.family}${on.has(r.p.slug) ? '' : ' off'}" cx="${X(r.v.age_used).toFixed(1)}" cy="${Y(r.v.apr).toFixed(1)}" r="${rad.toFixed(1)}"><title>${esc(r.p.name)}: ${usd(r.v.implied)}, ${(r.v.apr * 100).toFixed(1)}% drop APR, ${days(r.v.age)} without a token</title></circle></a>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="radar" role="img" aria-label="Days without a token against airdrop yield, one dot per protocol">${g}
      <text class="zone" x="${L + 8}" y="${T + 14}">early, rich drop</text><text class="zone" x="${W - RR - 6}" y="${H - B - 8}" text-anchor="end">old, diluted</text>${dots}
      <text class="ax" x="${W - RR}" y="${T + 8}" text-anchor="end">dot size = implied value</text></svg>`;
  }

  /* ---------- views ---------- */
  function head(st) {
    const n = (v) => (v === 'board' ? rows.length : v === 'aside' ? radar.products.length : fit.n);
    document.getElementById('tabs').innerHTML = [['board', 'Pre-token board'], ['aside', 'Set aside'], ['trading', 'Trading tokens']]
      .map(([v, l]) => `<a href="${link({ view: v, p: '' })}" class="${st.view === v && !st.p ? 'on' : ''}">${l} <b>${n(v)}</b></a>`).join('');
    document.getElementById('meta').innerHTML = `<span>Snapshot <b>${esc(S.as_of)}</b></span><span>DefiLlama protocols</span><span>model <b>${esc(M.version)}</b></span>`;
  }

  function formula() {
    return `<div class="card model">
      <h2>Value model <span>fitted on this snapshot</span></h2>
      <p class="eq">value = T × m<sub>fam</sub> × (T ÷ $100M)<sup>${fit.slope.toFixed(2)}</sup> × t<sub>age</sub></p>
      <dl>
        <dt>Fit on</dt><dd>${fit.n} trading tokens in this snapshot (mcap ÷ TVL)</dd>
        <dt>Size</dt><dd>value grows as TVL<sup>${fit.elasticity.toFixed(2)}</sup>: bigger pools earn lower multiples</dd>
        <dt>T</dt><dd>TVL carried one week at its own 7-day change (${M.growth_floor}% to +${M.growth_cap}%)</dd>
        <dt>m<sub>fam</sub></dt><dd>family's fitted mcap ÷ TVL at $100M, ×${Math.min(...Object.values(fit.families).map((f) => f.multiple)).toFixed(2)} to ×${Math.max(...Object.values(fit.families).map((f) => f.multiple)).toFixed(2)}</dd>
        <dt>t<sub>age</sub></dt><dd>×${M.age_low} at day 0 to ×${M.age_high} at ${M.age_full}+ days with no token</dd>
        <dt>Error</dt><dd>out-of-sample median miss ×${fit.median_error.toFixed(1)}; band holds ${fit.band_hits}/${fit.n} tokens</dd>
      </dl></div>`;
  }

  function board(st) {
    const shown = filtered(st), fams = st.fam ? st.fam.split(',') : [];
    const watchCov = S.watchlist.filter((s) => bySlug[s]).length;
    const total = rows.reduce((s, r) => s + r.v.implied, 0);
    const farmN = rows.filter((r) => r.plan.verdict === 'farm').length;
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
    const active = st.q || st.fam || st.chain || st.scope !== 'all' || st.verdict;
    const body = shown.map((r) => {
      const w = Math.max(1.5, 100 * Math.sqrt(r.v.implied / maxImplied));
      return `<tr data-slug="${esc(r.p.slug)}" tabindex="0">
        <td class="rank">${r.rank}</td>
        <td class="proto"><a href="${link({ p: r.p.slug })}">${esc(r.p.name)}</a>${r.watch ? '<span class="wl" title="On the snapshot watchlist">WL</span>' : ''}<small>${esc(r.p.category || 'Uncategorised')} · ${esc(r.p.chains.slice(0, 2).join(', '))}${r.p.chains.length > 2 ? ' +' + (r.p.chains.length - 2) : ''}</small></td>
        <td>${famChip(r.v.family)}</td>
        <td class="num">${usd(r.p.tvl_usd)}</td>
        <td class="num ${r.p.change_7d > 0 ? 'up' : r.p.change_7d < 0 ? 'down' : ''}">${pct(r.p.change_7d)}</td>
        <td class="num${r.v.age == null ? ' est' : ''}" title="${r.v.age == null ? 'No listing date: the median age is used' : 'Listed ' + esc(r.p.listed_at)}">${r.v.age == null ? '~' : ''}${days(r.v.age_used)}</td>
        <td class="val"><span class="bar"><i style="width:${w.toFixed(1)}%"></i></span><b>${usd(r.v.implied)}</b><small>${usd(r.v.low)}–${usd(r.v.high)}</small></td>
        <td class="num">${mult(r.v.multiple)}</td>
        <td class="num apr">${(r.v.apr * 100).toFixed(1)}%</td>
        <td class="plan">${verdictTag(r.plan.verdict)}<small>${usd(r.plan.drop)} drop vs ${usd(r.plan.all_in)} cost · ${usd(r.plan.stake)} on ${esc(r.plan.chain)}</small></td></tr>`;
    }).join('');
    return `<section class="hero">
      <div class="lead">
        <h1>${rows.length} pre-token protocols, ranked by what their token would be worth today</h1>
        <p>Each value is computed in this page from the snapshot's TVL, 7-day change and days without a token, on a curve fitted to the ${fit.n} tokens in it that already trade. ${radar.products.length} wrapped, bridged and staked products are set aside.</p>
        <div class="kpis">
          <div><b>${watchCov}/${S.watchlist.length}</b><span>watchlist covered</span></div>
          <div><b>${rows.length - watchCov}</b><span>early rows beyond it</span></div>
          <div><b>${usd(total)}</b><span>implied, all rows</span></div>
          <div><b>${farmN}</b><span>plans that cover costs ×${M.target_cover}</span></div>
        </div>
      </div>
      ${formula()}
      <div class="card chartcard"><h2>Radar <span>days without a token × airdrop yield</span></h2>${chart(shown)}</div>
    </section>
    <section class="filters">
      <label class="search"><input id="q" type="search" value="${esc(st.q)}" placeholder="Search name, category or chain" autocomplete="off" aria-label="Search"></label>
      <div class="field"><span>Scope</span>${seg('scope', [['all', 'All'], ['watch', 'Watchlist'], ['outside', 'Outside it'], ['early', 'Below $50M']])}</div>
      <div class="field"><span>Plan</span>${seg('verdict', [['', 'Any'], ['farm', 'Farm'], ['marginal', 'Marginal'], ['skip', 'Skip']])}</div>
      <label class="field"><span>Chain</span><select id="chain"><option value="">All chains</option>${Object.keys(chains).sort((a, b) => chains[b] - chains[a] || (a < b ? -1 : 1)).map((c) => `<option${c === st.chain ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <div class="count"><b>${shown.length}</b> of ${rows.length} shown${active ? ` · <a href="${link({ q: '', fam: '', chain: '', scope: 'all', verdict: '' })}">clear filters</a>` : ''}</div>
    </section>
    <section class="filters"><div class="chips" role="group" aria-label="Family">${famLinks}</div></section>
    <div class="tablewrap"><table class="board">
      <thead><tr>${th('rank', 'Rank')}${th('name', 'Protocol')}<th>Family</th>${th('tvl', 'TVL', 'num')}${th('g', '7d', 'num')}${th('age', 'No token', 'num')}${th('value', 'Implied value · 50% band', 'val')}${th('multiple', '÷ TVL', 'num')}${th('apr', 'Drop APR', 'num')}${th('plan', 'Farm plan · 90 days', 'plan')}</tr></thead>
      <tbody>${body || '<tr><td colspan="10" class="empty">No protocol matches these filters.</td></tr>'}</tbody></table></div>`;
  }

  function detail(st) {
    const r = bySlug[st.p];
    if (!r) return `<p class="empty">No ranked protocol is called ${esc(st.p)}. <a href="${link({ p: '' })}">Back to the board</a></p>`;
    const p = r.p, v = r.v, pl = r.plan, fam = fit.families[v.family];
    const peers = radar.live.filter((l) => l.family === v.family)
      .sort((a, b) => Math.abs(Math.log(a.tvl / p.tvl_usd)) - Math.abs(Math.log(b.tvl / p.tvl_usd))).slice(0, 6);
    const lo = Math.log10(Math.min(v.low, ...peers.map((x) => x.actual)) / 1.5), hi = Math.log10(Math.max(v.high, ...peers.map((x) => x.actual)) * 1.5);
    const pos = (x) => (100 * (Math.log10(x) - lo) / (hi - lo)).toFixed(2) + '%';
    const line = (label, src, val, cls) => `<tr class="${cls || ''}"><td>${label}<small>${src}</small></td><td class="num">${val}</td></tr>`;
    const back = link({ p: '' });
    return `<a class="back" href="${back}">← Back to the board</a>
    <section class="dhead">
      <div class="rankbig"><small>Rank</small><b>${r.rank}</b><small>of ${rows.length}</small></div>
      <div><h1>${esc(p.name)}</h1>
        <p class="tags">${famChip(v.family)}<span class="tag">${esc(p.category || 'Uncategorised')}</span><span class="tag pre">No token on record</span>${r.watch ? '<span class="tag wlt">On the watchlist</span>' : '<span class="tag">Outside the watchlist</span>'}</p>
        <p class="sub">${esc(p.chains.join(' · '))}${p.listed_at ? ` — tracked since ${esc(p.listed_at)}` : ' — no listing date on record'}</p></div>
      <div class="dval"><small>Implied token value</small><b>${usd(v.implied)}</b><small>50% band ${usd(v.low)} – ${usd(v.high)} · ${mult(v.multiple)} TVL</small></div>
    </section>
    <div class="dgrid">
      <div class="col">
        <section class="card"><h2>How the value is built <span>model.js value()</span></h2>
          <table class="receipt">
            ${line('TVL', 'snapshot tvl_usd', usd(p.tvl_usd))}
            ${line('Momentum ' + pct(v.growth, 2), (v.growth_imputed ? 'change_7d not reported: 0% assumed' : 'change_7d ' + pct(p.change_7d, 2) + ' carried one week, clipped to ' + M.growth_floor + '…+' + M.growth_cap + '%'), '→ ' + usd(v.tvl_next))}
            ${line('Family multiple', esc(fam.label) + ': ' + fam.peers + ' trading peers, raw ' + mult(fam.raw) + ' shrunk to the all-family ' + mult(fit.base), mult(v.fam_multiple))}
            ${line('Size curve', '(TVL ÷ $100M)<sup>' + fit.slope.toFixed(2) + '</sup>, slope fitted within families', mult(v.size_mult))}
            ${line('Fitted token value', 'what a trading peer of this size and family is worth', usd(v.fitted), 'sum')}
            ${line('Time without a token', (v.age == null ? 'no listing date: median ' + v.age_used + ' days used' : v.age + ' days since listing') + '; ×' + M.age_low + '→×' + M.age_high + ' over ' + M.age_full + ' days', mult(v.time_factor))}
            ${line('Implied value', 'rank ' + r.rank + ' of ' + rows.length + ' on this number', usd(v.implied), 'total')}
          </table>
          <div class="scale" aria-label="Implied value against trading peers' market caps">
            <span class="band" style="left:${pos(v.low)};width:calc(${pos(v.high)} - ${pos(v.low)})"></span>
            ${peers.map((x) => `<span class="peer" style="left:${pos(x.actual)}" title="${esc(x.p.name)} ${usd(x.actual)}"></span>`).join('')}
            <span class="mid" style="left:${pos(v.implied)}"></span>
          </div>
          <p class="note">Shaded: the 50% band (×${fit.band_low.toFixed(2)} to ×${fit.band_high.toFixed(2)} of the value): the middle half of the model's out-of-sample misses on trading tokens. Ticks: market caps of the peers below. This is the model's claim, not a price.</p>
        </section>
        <section class="card"><h2>Nearest trading peers <span>${esc(fam.label)}, closest TVL</span></h2>
          <table class="mini"><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">÷ TVL</th><th class="num">Model fit</th></tr></thead><tbody>
          ${peers.map((x) => `<tr><td>${esc(x.p.name)} <small>${esc(x.p.symbol || '')}</small></td><td class="num">${usd(x.tvl)}</td><td class="num">${usd(x.actual)}</td><td class="num">${mult(x.actual / x.tvl)}</td><td class="num">${usd(x.fit)}</td></tr>`).join('') || '<tr><td colspan="5">No trading peer in this family: the all-family multiple is used.</td></tr>'}
          </tbody></table></section>
      </div>
      <section class="card planc"><h2>Farm plan <span>${pl.days} days on ${esc(pl.chain)}</span></h2>
        <div class="pkpis">
          <div><small>Capital</small><b>${usd(pl.stake)}</b></div>
          <div><small>Gas &amp; fees</small><b>${usd(pl.cost)}</b></div>
          <div><small>Hands-on</small><b>${R.mins(pl.minutes)}</b></div>
          <div><small>Expected drop</small><b>${usd(pl.drop)}</b></div>
          <div><small>Verdict</small>${verdictTag(pl.verdict)}</div>
        </div>
        <div class="steph"><span></span><span>When · what to do</span><span>Cost</span><span>Time</span></div>
        <ol class="steps">${pl.steps.map((s) => `<li><p><em>${esc(s.when)}</em>${esc(s.act)}.</p><span class="cost">${usd(s.usd)}</span><span class="time">${R.mins(s.min)}</span></li>`).join('')}</ol>
        <div class="math">
          <p><b>Drop APR ${(v.apr * 100).toFixed(2)}%</b> = implied ${usd(v.implied)} × ${M.drop_share * 100}% to depositors ÷ (${usd(v.tvl_next)} TVL × (${Math.min(v.age_used, M.season_days)} + ${M.farm_days}) season days) × 365.</p>
          <p>${usd(pl.eligible)} of the ${usd(pl.stake)} sits in ${esc(p.name)} and earns; for ${pl.days} days that is about <b>${usd(pl.drop)}</b> against <b>${usd(pl.all_in)}</b> all-in (${usd(pl.cost)} gas and fees + ${R.mins(pl.minutes)} at $${M.hour_usd}/h): net <b class="${pl.net >= 0 ? 'up' : 'down'}">${pl.net >= 0 ? '+' : '−'}${usd(Math.abs(pl.net))}</b>. Capital is the smallest that covers costs ×${M.target_cover} (from $500 to $25K${pl.drop < M.target_cover * pl.all_in ? ', capped here' : ''}); at a ${M.drop_share * 50}% drop the figure halves.</p>
        </div>
      </section>
    </div>`;
  }

  function aside() {
    const body = radar.products.map((x) => `<tr><td class="proto"><span class="nm">${esc(x.p.name)}</span><small>${esc(x.p.chains.slice(0, 3).join(', '))}</small></td><td><span class="tag">${esc(x.kind)}</span></td><td>${esc(x.p.category || 'Uncategorised')}</td><td class="num">${usd(x.p.tvl_usd)}</td><td class="num">${pct(x.p.change_7d)}</td></tr>`).join('');
    return `<section class="intro"><h1>${radar.products.length} products set aside, not ranked</h1>
      <p>They record no token of their own, but each is a wrapped, bridged, staked or exchange-run product, or a versioned pool, of something whose token already trades: the snapshot's own watchlist rule (model.js productOf) applied to every protocol, not only those over the floor. Their value is the underlying token's, so the board gives them no implied value of their own.</p></section>
      <div class="tablewrap"><table class="board"><thead><tr><th>Product</th><th>Why set aside</th><th>Category</th><th class="num">TVL</th><th class="num">7d</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function trading() {
    const famRows = R.FAMILIES.map((f) => { const x = fit.families[f[0]]; return `<tr><td>${famChip(f[0])}</td><td class="num">${x.peers}</td><td class="num">${x.peers ? mult(x.raw) : '—'}</td><td class="num"><b>${mult(x.multiple)}</b></td></tr>`; }).join('');
    const body = radar.live.map((l) => { const e = l.loo / l.actual; return `<tr><td class="proto"><span class="nm">${esc(l.p.name)}</span><small>${esc(l.p.symbol || '')} · ${esc(l.p.category || '')}</small></td><td>${famChip(l.family)}</td><td class="num">${usd(l.tvl)}${l.members > 1 ? ` <small>${l.members} parts</small>` : ''}</td><td class="num">${usd(l.actual)}</td><td class="num">${mult(l.actual / l.tvl)}</td><td class="num">${usd(l.fit)}</td><td class="num">${usd(l.loo)}</td><td class="num ${e > 2 || e < 0.5 ? 'down' : 'up'}">${mult(e)}</td></tr>`; }).join('');
    return `<section class="intro"><h1>${fit.n} tokens that trade: the model's calibration set</h1>
      <p>Kept apart from the board: their market already prices them. model.js calibrate() pools the TVL of protocols sharing one token, leaves out exchanges and wrapped, bridged or versioned products, and fits ln(mcap ÷ TVL) on ln(TVL) within each family (slope ${fit.slope.toFixed(3)}, so value grows as TVL<sup>${fit.elasticity.toFixed(2)}</sup>), then shrinks each family's multiple toward the all-family ${mult(fit.base)} with ${M.shrink_k} pseudo-peers. ${radar.listed_only} more protocols record a token with no market cap and sit on neither list.</p></section>
      <div class="split"><div class="card"><h2>Family multiples at $100M TVL</h2><table class="mini"><thead><tr><th>Family</th><th class="num">Peers</th><th class="num">Raw</th><th class="num">Used</th></tr></thead><tbody>${famRows}</tbody></table>
      <p class="note">Out of sample (each token predicted by a fit without it, against its real market cap): median miss ×${fit.median_error.toFixed(2)}; the 50% band ×${fit.band_low.toFixed(2)}–×${fit.band_high.toFixed(2)} holds ${fit.band_hits} of ${fit.n}. ${fit.clipped} extreme ratios are clipped to ×${M.ratio_floor}–×${M.ratio_cap} inside the fit only.</p></div>
      <div class="tablewrap"><table class="board"><thead><tr><th>Protocol</th><th>Family</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">÷ TVL</th><th class="num">Model fit</th><th class="num">Left-out fit</th><th class="num">÷ market</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
  }

  /* ---------- render and events ---------- */
  function render() {
    const st = readHash();
    head(st);
    app.className = st.p ? 'detail' : st.view;
    app.innerHTML = st.p ? detail(st) : st.view === 'aside' ? aside() : st.view === 'trading' ? trading() : board(st);
    document.getElementById('foot').innerHTML = `Source: ${esc(S.source)}. Floor $${(S.floor_usd / 1e6).toFixed(0)}M. Implied values are this radar's own estimate of a token's worth if the record stayed as it is: no forecast that a token will launch, and never make.fun's claim. A protocol that records no token may still have one DefiLlama does not carry.`;
    if (st.p) window.scrollTo(0, 0);
    if (typing) { clearTimeout(typing); typing = null; }
  }
  let typing = null;
  app.addEventListener('input', (e) => {
    if (e.target.id === 'q') {
      clearTimeout(typing);
      const val = e.target.value;
      typing = setTimeout(() => { typing = null; history.replaceState(null, '', link({ q: val })); render(); const q = document.getElementById('q'); if (q) { q.focus(); q.setSelectionRange(val.length, val.length); } }, 160);
    }
  });
  app.addEventListener('change', (e) => { if (e.target.id === 'chain') go({ chain: e.target.value }); });
  app.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (tr && !e.target.closest('a')) go({ p: tr.dataset.slug });
  });
  app.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (tr && e.key === 'Enter') go({ p: tr.dataset.slug });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && readHash().p) go({ p: '' }); });
  window.addEventListener('hashchange', render);
  render();
})();
