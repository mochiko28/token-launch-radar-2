(function () {
'use strict';
const {RadarModel:R,SNAPSHOT:S,TABLES:tables,BOARD:B = {}} = window;
const el = id => document.getElementById(id), app = el('app');
if (!R || !S || !tables) {app.innerHTML = '<p class=empty>Run main.ts to build the dashboard data.</p>'; return;}

R.use(tables);
const {protocols:ps,watchlist:wl,as_of:date} = S;
const radar = R.build(S), {fit,model:M,rows,audit:top,products,live} = radar;
const {usd,mins,cashFlow,digest,boardRows,farmFlips,FAMILIES:FAMS,farmPlan:plan} = R;
const {target_cover:cover,hour_usd:rate,drop_share:share} = M;
const {round,abs,log,log10,sqrt,min,max,ceil} = Math;
const dollars = (n, options) => '$' + n.toLocaleString('en-US', options);
const FAM = Object.fromEntries(FAMS);
const bySlug = Object.create(null); rows.forEach(r => {bySlug[r.p.slug] = r;});
const esc = s => String(s).replace(/[&<>"']/g,c => ({'&': '&amp;','<': '&lt;','>': '&gt;','"': '&quot;',"'": '&#39;'})[c]);
const nameFlag = ({flag,wordMatch:w}) => map([flag,w && `Possible shared token: ${w}`].filter(Boolean),s => `<small>${esc(s)}</small>`);
const pct = (x,d = 1) => x == null?'n/a' : (x>0?'+':x<0?'−':'')+abs(x).toFixed(d)+'%';
const mult = x => '×' + (x >= 10 ? x.toFixed(1) : x >= 1 ? dec(x) : x.toFixed(3));
const days = d => (d == null ? '?' : d >= 365 ? (d/365).toFixed(1) + 'y' : d + 'd');
const chip = f => `<span class="fam f-${f}"><i></i>${esc(FAM[f])}</span>`;
const tag = v => `<span class="verdict v-${v}">${v}</span>`;
const note = t => `<p class=note>${t}</p>`, bold = t => `<b>${t}</b>`;
const kpi = (v, label) => `<div><small>${label}</small><b>${v}</b></div>`;
const h2 = (t,s) => `<h2>${t} <span>${s}</span></h2>`;
const details = (t,b,c = '') => `<details${c}><summary>${t}</summary>${b}</details>`;
const intro = (t,b) => `<section class=intro><h1>${t}</h1>${b}</section>`;
const badge = p => `<b class=mechanism>${esc(p.mechanism)}</b>`;
const vmax = rows[0].v.implied;
const isFarm = r => r.plan.verdict === 'farm', net = r => r.plan.net, stake = r => r.plan.stake;
const map = (xs, f) => xs.map(f).join('');
const sum = (rs, f) => rs.reduce((s, r) => s + f(r), 0);
const count = (xs, f) => xs.filter(f).length;
const href = r => link({p:r.p.slug});
const anchor = (url, text) => `<a href="${url}">${text}</a>`;
const proto = r => anchor(href(r), esc(r.p.name));
const cat = p => esc(p.category || 'Uncategorised');
const option = (v,l,on) => `<option value="${esc(v)}"${on?' selected' : ''}>${l}</option>`;

const CLEAR = {q:'',fam:'',chain:'',scope:'all',verdict:'',dep:''};
const PORT = {...CLEAR,scope:'watch',verdict:'farm-net',dep:'10000',sort:'plan',dir:'desc'};
const DEF = {view:'board',...CLEAR,sort:'rank',dir:'asc',p:'',vs:'',bud:'25000',hr:String(rate),prob:'50'};
const PROBS = [10,25,50,75,90];
const DEPS = ['',1000,5000,10000,25000,100000,250000], RATES = [0,10,rate,50,100], BUDS = [1e4,25e3,5e4,1e5,25e4,1e6];
const PLANS = [['','Any'],['farm','Farm'],['marginal','Marginal'],['skip','Skip'],['farm-net','Farm + net > $0']];
const HOURS = 8;
function state() {
 const st = {...DEF};
 for (const [,k,v] of location.hash.slice(1).matchAll(/(?:^|&)([^&=]+)=([^&]*)/g)) {
  if (Object.hasOwn(DEF,k)) try { st[k] = decodeURIComponent(v); } catch {}
 }
 for (const k in VALID) if (!VALID[k].includes(st[k])) st[k] = DEF[k];
 return st;
}
function link(p) {
 const st = {...state(),...('p' in p && {vs:''}),...p};
 return '#'+Object.keys(DEF).filter(k => st[k] !== DEF[k]).map(k => k+'='+encodeURIComponent(st[k])).join('&');
}
function go(patch) { location.hash = link(patch); }

const KEYS = {
 rank: r => r.rank, name: r => r.p.name.toLowerCase(), tvl: r => r.p.tvl_usd, g: r => r.p.change_7d,
 age: r => r.v.age_used,value: r => r.v.implied,odds: r => r.v.time_factor,apr: r => r.v.apr,plan: r => r.plan.drop/r.plan.all_in
};
const SCOPES = [['all','All'],['watch','Watchlist'],['outside','Outside it'],['early','Below $50M'],['stable','Top 20, all variants']];
const famKeys = st => st.fam ? st.fam.split(',') : [];
const weighted = r => r.plan.drop*r.v.time_factor - r.plan.all_in;
function filter(st) {
 const {chain,scope,verdict} = st, q = st.q.trim().toLowerCase(), fams = famKeys(st);
 const out = rows.filter(r => {
  const {p,v,watch,stable,below} = r;
  return (!q || [p.name,p.slug,p.category,...p.chains].join(' ').toLowerCase().includes(q)) &&
   (!fams.length || fams.includes(v.family)) && (!chain || p.chains.includes(chain)) &&
   {all:true,watch,outside:!watch,stable,early:below}[scope] &&
   (!verdict || (verdict === 'farm-net' ? isFarm(r) && weighted(r)>0 : r.plan.verdict === verdict));
 });
 const key = KEYS[st.sort], sign = st.dir === 'desc' ? -1 : 1;
 return out.sort((a,b) => {
  const x = key(a), y = key(b);
  return (x == null || y == null ? (x == null)-(y == null) : ((x>y)-(x<y))*sign) || a.rank-b.rank;
 });
}

const dec = n => n.toFixed(2);
const pays = p => p.drop >= cover*p.all_in;
const sg = (x,fmt = usd) => (x<0?'−':'+')+fmt(abs(x));
const signed = (x,fmt) => `<b class=${x<0?'down':'up'}>${sg(x,fmt)}</b>`;
const money = new Intl.NumberFormat('en-US', {style: 'currency',currency: 'USD'}).format;
const pc = (x,d = 0) => (x*100).toFixed(d)+'%', p2 = n => pc(n,2);
const threshold = x => x <= 1 ? p2(x) : 'unreachable';
const select = (st,k,l,vals,fmt) => `<label class=field><span>${l}</span><select id=${k}>${map(vals,v => option(v,fmt(v),String(v) === st[k]))}</select></label>`;
const oddsInput = st => select(st,'prob','Assumed launch odds',PROBS,n => n+'%');
const FIELDS = [
 ['Rank'],['Protocol'],['Family'],['TVL',0,usd],['7-day change %',0,pct],['Days tracked'],
 ['Value if launched',1,usd],['Token-record score',1,pc],['Implied value',1,usd],['50% band'],
 ['Drop APR',1,p2],['Verdict'],['Capital',-1,usd],['Gas & fees',-1,usd],['Hours',-1],
 ['Modeled drop',1,usd],['Net if it launches',1,sg],['Est. net APR if it launches',1,p2],
 ['Verdict at 3x gas'],['Stress loss',-1,usd],['Capital for x2',-1,x => x?usd(x) : 'none to $1M']
];
function values({rank,p,v,plan:a}) {
 return [rank,p.name,FAM[v.family],round(p.tvl_usd),p.change_7d,v.age_used,round(v.fitted),+v.time_factor.toFixed(3),
  round(v.implied),usd(v.low)+'–'+usd(v.high),+v.apr.toFixed(4),a.verdict,a.stake,+dec(a.cost),+(a.minutes/60).toFixed(1),
  +dec(a.drop),+dec(a.net),+a.net_apr.toFixed(4),a.fees[1][3],+dec(a.stress_usd),pays(a)?a.stake : a.pay_cap || ''];
}
const cell = x => typeof x === 'string' ? '"' + x.replace(/"/g, '""') + '"' : x;
const csv = rs => 'data:text/csv;charset=utf-8,'+encodeURIComponent([FIELDS.map(([l]) => l),...rs.map(r => values(r).map(cell))].join('\n'));
function compare(a, b) {
 const av = values(a), bv = values(b), an = esc(a.p.name), bn = esc(b.p.name);
 const data = FIELDS.slice(2).map(([l,d,f = String],i) => {
  const x = av[i+2], y = bv[i+2], w = d && x !== '' && y !== '' && (x-y)*d;
  return [l,w > 0?bold(f(x)) : f(x),w < 0?bold(f(y)) : f(y)];
 });
 return `<a class=back href="${link({vs: ''})}">← Back to ${an}</a>${intro(an+' vs '+bn,'<p>Same inputs. Better figures in bold.</p>')}
${table('board cmp',['','#'+an,'#'+bn],data)}`;
}
const one = x => x.toFixed(1), rOf = v => one(1.8+6.5*sqrt(v/vmax));
function chart(shown, H) {
 const W = 470, L = 40, B = 26, T = 10, RR = 10;
 const on = new Set(shown.map(r => r.p.slug));
 const xmax = sqrt(2400), ylo = log10(0.001), yhi = log10(2);
 const X = d => L+(W-L-RR)*sqrt(min(d,2400))/xmax;
 const Y = a => T+(H-T-B)*(1-(log10(min(2,max(.001,a)))-ylo)/(yhi-ylo));
 const text = (x,y,l,a = 'start') => `<text class=ax x=${x} y=${y} text-anchor=${a}>${l}</text>`;
 const axis = (x1,x2,y1,y2) => `<line class=grid x1=${x1} x2=${x2} y1=${y1} y2="${y2}"/>`;
 let g = map([[30,'1m'],[180,'6m'],[365,'1y'],[730,'2y'],[1095,'3y'],[1825,'5y']],([d,l]) => {
  const x = X(d); return axis(x,x,T,H-B)+text(x,H-8,l,'middle');
 }) + map([.001,.01,.1,1],a => {
  const y = Y(a); return axis(L,W-RR,y,y)+text(L-6,y+3,pc(a,a < .01 ? 1 : 0),'end');
 });
 const dots = map(rows.slice().reverse(),({p,v}) =>
  anchor(link({p:p.slug}),`<circle class="dot f-${v.family}${on.has(p.slug)?'' : ' off'}" cx=${one(X(v.age_used))} cy=${one(Y(v.apr))} r=${rOf(v.implied)}><title>${esc(p.name)} ${usd(v.implied)}</title></circle>`));
 const pick = new Set(['implied','apr'].flatMap(k => shown.slice().sort((a,b) => b.v[k]-a.v[k]).slice(0,3)));
 const boxes = [], labels = map([...pick],({p,v}) => {
  const x = X(v.age_used), y = Y(v.apr), w = p.name.length*5.6+6, h = 12;
  const tries = [[x+8,y-6],[x-8-w,y-6],[x-w/2,y-20],[x-w/2,y+8]];
  const spot = tries.find(([a,b]) => a>L && a+w<W && b>0 && b+h<H-B &&
   boxes.every(([i,j,u,v]) => a+w<i || i+u<a || b+h<j || j+v<b));
  if (!spot) return '';
  const [a,b] = spot;
  boxes.push([a,b,w,h]);
  return `<text class=lab x=${one(a+3)} y=${one(b+9)}>${esc(p.name)}</text>`;
 });
 g += text(W-RR,H-18,'days without a token →','end')+text(L+4,T+8,'airdrop APR if it launches ↑');
 g += map([[1e6,'$1M'],[3e7,'$30M']],([v,l],i) => `<circle class="dot f-infra" cx=${W-120+i*50} cy=${T+12} r="${rOf(v)}"/>`+text(W-112+i*50,T+15,l));
 return `<svg viewBox="0 0 ${W} ${H}" class=radar>${g}
${dots}${labels}</svg>`;
}

function head(st) {
 const tabs = [['board','Pre-token board',N],['model','Model & checks',checks.length],
  ['audit','Rank audit',A],['aside','Set aside',nSet],['trading','Trading tokens',fit.n]];
 el('tabs').innerHTML = map(tabs,([v,l,n]) => `<a href="${link({view: v,p: ''})}" class="${st.view === v && !st.p?'on' : ''}">${l} <b>${n}</b></a>`);
 el('meta').innerHTML = `<span>Snapshot <b>${esc(date)}</b></span><span>model <b>${esc(M.version)}</b></span>`;
}

const O = fit.odds, T = fit.tests;
const inside = (b, n) => n >= b.lo && n < b.hi;
const tvlBand = ({lo,hi}) => `${lo?usd(lo) : '$0'}–${hi < 1e15?usd(hi) : '∞'}`;
const eq = `<p class=eq>value = T × ${mult(fit.base)} × (T ÷ $100M)<sup>${dec(fit.slope)}</sup> × s × h. h = ${M.product_haircut} for liquid staking and versioned pools, 1 otherwise.`;
function formula() {
 const x = n => '×' + dec(n);
 const used = ['baseline','replaced','fitted',fit.k === Infinity?'dropped' : 'k='+fit.k,'not used','via score'];
 return `<div class="card model">
${h2('Value model',`fit on ${fit.n} trading tokens`)}
${eq}
${tbl('mini tests',['Term · held-out median miss','#Leave-one-out','#Walk-fwd','#Family out','#Use'],
   T.terms.map((t,i) => [t.label,x(t.loo),x(t.wf),x(t.lofo),used[i]]),i => T.terms[i].ok)}
${tbl('mini tests',['Score s · held-out Brier','#Walk-fwd','#Family out'],
   O.terms.map(([label,wf,fam]) => [label,wf.toFixed(3),fam.toFixed(3)]),i => !i)}
${note(`Walk-forward trains on ${T.wf_train}, tests ${T.wf_n} since ${T.wf_from}. Logistic s on ${O.n} peers (${O.with_token} with tokens). AUC ${dec(O.auc_loo)} LOO, ${dec(O.auc_wf)} walk-forward, ${dec(O.auc_fam)} family-out.`)}
${note(`<b>Missing ages:</b> ${count(rows,r => r.ageRange)} use median age. Ranks at 25th and 75th percentiles: ${rows.filter(r => r.ageRange).map(({p,ageRange:[a,b]}) => `${esc(p.name)} #${a.rank}–#${b.rank}`).join(', ')}.`)}
${note('<b>s scores token records.</b> No launch dates in snapshot. Readers set launch odds.')}
${note(`LOO miss by TVL: ${fit.bands.map(b => `<b>${tvlBand(b)} ×${b.miss.toFixed(1)}</b> (${b.n} tokens, ${count(rows,r => inside(b,r.p.tvl_usd))} ranked)`).join(' · ')}.`)}</div>`;
}

const clipped = ({ p, v }) => p.change_7d != null && p.change_7d !== v.growth;
const above95 = a => a.p95 != null && a.ratio > a.p95;
const bRows = boardRows(radar), dig = digest(bRows);
const [flatT, spotT, sizeT, famT] = T.terms, curve = fit.k === Infinity ? sizeT : famT;
const N = rows.length, A = top.length, nSet = products.length, listed = radar.listed_only;
const nTr = count(ps,p => p.mcap_usd > 0), nAll = N+nSet+nTr+listed;
const watchCov = count(wl,s => bySlug[s]);
const checks = [
 [nAll === ps.length,`${nAll}/${ps.length}: ${N} ranked, ${nSet} set aside, ${nTr} trading (${fit.n} in fit), ${listed} token records without cap`],
 [watchCov === wl.length,`watchlist ${watchCov}/${wl.length} covered`],
 [rows.every((r,i) => r.rank === i+1 && (!i || r.v.implied <= rows[i-1].v.implied)),`ranks 1–${N}, value never rising`],
 [rows.every(({p}) => [p.gecko_id,p.symbol,p.mcap_usd].every(x => x == null)),`${N}/${N} ranked rows have no token record`],
 [bRows.every(({farm_steps:s}) => s.length >= 3 && s.length <= 12 && s.every(t => t.length >= 20 && t.length <= 600 && / Cost: .+ Time: /.test(t))),`${N} plans, every step costed and timed`],
 [B.digest === dig && B.rows === N, `screen = board.json at Auto deposit, digest ${dig}`],
 [['loo','wf','fam'].every(k => O['auc_'+k]>.5 && O.brier[k]<O.brier[k+'_base']),`score beats base rate in 3 held-out tests: AUC ${dec(O.auc_loo)}/${dec(O.auc_wf)}/${dec(O.auc_fam)}`],
 [rows.slice(0,10).every(r => r.boot>=.8),`ranks 1–${rows.findIndex(r => r.boot<1)} top 20 in all 40 refits`],
 [O.gap < 0.2, `score within ${round(O.gap*100)} pts of every age cohort`],
 [spotT.ok && sizeT.ok, `value miss ×${dec(flatT.loo)} flat → ×${dec(sizeT.loo)} fit, held out 3 ways`],
 [rows.every(({plan:p}) => abs(cashFlow(p,1).net-p.net)<1e-8 && cashFlow(p,0,true).net === -p.base.all-p.carry),'cash-flow endpoints reconcile']
];
const failed = checks.filter(([ok]) => !ok),pass = `${checks.length-failed.length}/${checks.length} self-checks pass`;

function portfolio(st, shown) {
 const screened = filter({ ...st, verdict: '' });
 const best = screened.reduce((a, r) => !a || weighted(r) > weighted(a) ? r : a, null);
 return `<section class=portfolio aria-label="Portfolio snapshot">
<p class=tags>${st.scope === 'watch'?'<span class="tag wlt">Watchlist</span>' : ''}<span class="tag pre">Farm · weighted net &gt; $0</span><span class=tag>${st.dep?usd(+st.dep)+' per protocol' : 'Auto deposit'}</span>
<div class=pkpis>${kpi(shown.length+' / '+screened.length,'Protocols qualified')}${kpi(usd(sum(shown,stake)),'Total capital needed')}${kpi(usd(sum(shown,weighted)),'Score-weighted net')}</div>
<p class=note>Drop × token-record score − fees, gas and time ($${st.hr}/h), before carry and stress.
${!shown.length && best?note(`${count(screened,r => net(r)>0)} clear costs if rewarded. Best weighted net ${sg(weighted(best))} (${esc(best.p.name)}). ${anchor(link({verdict:''}),'View screened plans →')}`) : ''}</section>`;
}

function board(st) {
 const shown = filter(st), fams = famKeys(st);
 const port = st.verdict === 'farm-net';
 const audit = farmFlips(rows);
 const farms = shown.filter(isFarm);
 const mid = f => rows.map(f).sort((a, b) => a - b)[N >> 1];
 const tally = xs => xs.reduce((a,x) => (a[x] = (a[x] || 0)+1,a),Object.create(null));
 const chains = tally(rows.flatMap(r => r.p.chains)), famCount = tally(rows.map(r => r.v.family));
 const th = (k,l,c = '') => {
  const on = st.sort === k, asc = on ? st.dir === 'desc' : k === 'rank' || k === 'name';
  return `<th class="${c}${on?' sorted' : ''}">${anchor(link({sort:k,dir:asc?'asc':'desc'}),l+(on?(asc?' ▼':' ▲'):''))}`;
 };
 const seg = (key,opts) => `<div class=seg>${map(opts,([v,l]) => `<a href="${link({[key]: v})}" class="${st[key] === v?'on' : ''}">${l}</a>`)}</div>`;
 const famLinks = map(FAMS,([f,l]) => {
  const on = fams.includes(f), next = on ? fams.filter(x => x !== f) : [...fams,f];
  return `<a href="${link({fam: next.join(',')})}" class="chip f-${f}${on?' on' : ''}"><i></i>${esc(l)} <b>${famCount[f] || 0}</b></a>`;
 });
 let cap = 0, hrs = 0;
 const pick = shown.filter(r => net(r) > 0).sort((a, b) => net(b)/stake(b) - net(a)/stake(a))
  .filter(r => cap + stake(r) <= +st.bud && hrs + r.plan.minutes/60 <= HOURS && (cap += stake(r),hrs += r.plan.minutes/60));
 const active = st.q || st.fam || st.chain || st.scope !== 'all' || st.verdict || st.dep;
 const {prob,dep,hr,bud} = st, flow = (r,c) => cashFlow(r.plan,prob/100,c);
 const flips = (r,c) => net(r) > 0 && flow(r,c).net < 0;
 const carryFlip = r => flips(r,true);
 const best = shown.find(r => isFarm(r) && carryFlip(r)) || shown.find(carryFlip);
 const leading = top.map(a => a.r);
 const outcomes = `<section class="card cash"><h2>Launch cash flows</h2>${oddsInput(st)}
<p class=note>Top ${A}: ${count(leading,r => net(r)>0)} profit at 100% before carry. At ${prob}%, ${count(leading,r => flips(r))} turn negative before carry, ${count(leading,carryFlip)} with ${pc(M.carry_rate)} annual carry.
${best?`${proto(best)}: ${signed(net(best))} at 100% before carry → ${signed(flow(best,true).net)} at ${prob}% with carry.` : ''}</section>`;
 const body = map(shown,r => {
  const {p,v,plan: pl,rank,rlo,rhi,watch} = r, {age,implied,fitted,time_factor: s,haircut: h} = v;
  const {drop,all_in: all,verdict,net_apr: apr,stake,pay_cap: pay,risk,round_trip: trip,chain} = pl;
 const w = max(1.5,100*sqrt(implied/vmax)), cf = flow(r,true);
  return `<tr data-slug="${esc(p.slug)}" tabindex=0>
<td class=rank>${rank}<small>${rlo}–${rhi}</small>
<td class=proto>${proto(r)}${watch?'<span class=wl title="On the watchlist">WL</span>' : ''}<small>${cat(p)} · ${esc(p.chains.slice(0,2).join(', '))}${p.chains.length > 2?' +'+(p.chains.length-2) : ''}</small>${nameFlag(r)}
<td>${chip(v.family)}
<td class=num>${usd(p.tvl_usd)}
<td class="num ${p.change_7d >= .05?'up' : p.change_7d <= -.05?'down' : ''}">${pct(p.change_7d)}
<td class="num${age == null?' est' : ''}" title="${age == null?'Missing date: median age' : 'Listed '+esc(p.listed_at)}">${age == null?'~' : ''}${days(v.age_used)}
<td class=val><span class=bar><i style="width:${one(w)}%"></i></span><b>${usd(implied)}</b><small>${usd(v.low)}–${usd(v.high)}</small><small class=factors>${usd(fitted)} × s ${pc(s)}${h === 1?'' : ' × '+h}</small>
<td class=num>${pc(s)}
<td class="num apr">${pc(v.apr,1)}
<td class=plan>${tag(verdict)} <span class=pmult>pays ${mult(drop/all)}${pays(pl)?'' : pay?` · ×${cover} at ${usd(pay)}` : ` · no deposit pays ×${cover}`}</span>
<small>${signed(pl.net)} net · <span class=num>${p2(apr)} est. net APR</span></small>
<small>${usd(drop)} drop vs ${usd(all)} ${verdict === 'skip'?'to deposit · $0 research' : `cost · ${usd(stake)} on ${esc(chain)}`}</small>
<small class=farmcue>${badge(pl)} ${esc(risk)} · ~${usd(trip)} round trip</small>
${port?`<small class=up>${sg(weighted(r))} score-weighted net</small>` : ''}<small>${signed(cf.net)} at ${prob}% with carry · break-even ${threshold(cf.threshold)}</small></tr>`;
 });
 const ctl = `<div class=ctl><section class=filters>
<label class=search><input id=q type=search value="${esc(st.q)}" placeholder="Name, category, chain" autocomplete=off aria-label=Search></label>
<div class=field><span>Scope</span>${seg('scope',SCOPES)}</div>
<div class=field><span>Plan</span>${seg('verdict',PLANS)}</div>
${select(st,'dep','Deposit',DEPS,d => d?usd(d) : 'Auto: least that pays')}
${select(st,'hr','Your hour',RATES,h => `$${h}/h`)}
${select(st,'chain','Chain',['',...Object.keys(chains).sort((a,b) => chains[b]-chains[a] || (a < b?-1 : 1))],c => c?esc(c) : 'All chains')}
<div class=count>Top 20: <b>${farmAt(+hr,dep)}</b> farm at $${hr}/h (${farmAt(0,dep)} at $0/h, ${farmAt(rate,dep)} at $${rate}/h) · farm at 3× gas: <b>${count(farms,r => r.plan.fees[1][3] === 'farm')}</b>/${farms.length} · <b>${shown.length}</b> of ${N} shown · <span id=drawn></span> · <a download=launch-radar.csv href="${csv(shown)}">CSV</a>${active?' · '+anchor(link(CLEAR),'clear filters') : ''}</div>
</section>
<section class="filters basket">${select(st,'bud','Budget',BUDS,usd)}
<span>Basket by net/$, ${shown.length} shown, within ${usd(+bud)} and ${HOURS} h: ${pick.map(r => proto(r)+' '+usd(stake(r))).join(' · ') || 'none pays'} → <b>${usd(cap)}</b>, ${one(hrs)} h, ${signed(sum(pick,net))} if rewarded before carry</span></section>
<section class=filters><div class=chips role=group aria-label=Family>${famLinks}</div>${port?'' : `<a class="chip pre" href="${link(PORT)}">${usd(+PORT.dep)} watchlist portfolio →</a>`}</section></div>`;
 return `<section class=strip>
<div><b>${watchCov}/${wl.length}</b><span>watchlist covered</span></div>
<div><b>${N}</b><span>ranked, ${count(rows,r => r.below)} under $50M</span></div>
<div><b>${nSet} · ${fit.n}</b><span>set aside · trading (fit)</span></div>
<div class=miss><b>held-out miss ×${one(curve.loo)} LOO · ×${one(curve.wf)} walk-forward</b><span>Median · flat baseline ×${one(flatT.loo)} LOO · ×${one(flatT.wf)} WF</span></div>
<div><b>${dec(O.auc_loo)} · ${dec(O.auc_wf)}</b><span>score AUC: LOO · walk-fwd</span></div>
<div><b>${audit.base}</b><span>Farm · pay ×${cover} their costs</span></div>
<div><b>${usd(mid(stake))} · ${mins(mid(r => r.plan.minutes))}</b><span>median deposit · hands-on</span></div>
</section>
<section class="hero slim">
<div class=lead>
<h1>${port?'Portfolio snapshot' : `${N} pre-token protocols, by implied value`}${st.sort === 'rank'?'' : `<small> · shown by ${{g: '7-day change',age: 'days tracked',odds: 'score',apr: 'drop APR',plan: 'farm plan'}[st.sort] || st.sort} ${st.dir === 'asc'?'▲' : '▼'}</small>`}</h1>
${port?portfolio(st,shown) : ''}
${active?note(`${pass} · ${anchor(link(CLEAR),'unfiltered board')}`) : `${eq}
<p class="checkline ${failed.length?'bad' : 'ok'}"><b>${pass}</b> · ${[5,1,6,0].map(i => checks[i][1]).join(' · ')}${map(failed,c => ' · ✗ '+c[1])} · ${anchor(link({view:'model'}),'all checks →')}</p>
${note(`${anchor(link({view:'audit'}),`Top ${A} audit →`)} · ${count(top,a => a.exclusion)} token records or product exclusions · ${count(top,a => !a.exclusion && a.review)} to review · ${count(top,a => clipped(a.r))} growth clips · ${count(top,above95)} above peer P95`)}`}
${sens(st,audit)}${ctl}${outcomes}
</div>
<div class="card chartcard">${h2('Radar','days without a token × airdrop yield')}${chart(shown,300)}</div>
</section>
<div class=tablewrap><table class=board>
<thead><tr>${th('rank','Rank')}${th('name','Protocol')}<th>Family${th('tvl','TVL','num')}${th('g','7d','num')}${th('age','Tracked','num')}${th('value','Implied value · 50% band','val')}${th('odds','Score','num')}${th('apr','Drop APR','num')}${th('plan','Farm plan · if it launches','plan')}</tr></thead>
<tbody>${body || `<tr><td colspan=10 class=empty>${port?'No positive score-weighted Farm plans.' : 'No matching protocols.'}`}</tbody></table></div>`;
}

function risks(r) {
 const {p,v,rank,alt: ranks,ageRange: ages} = r,b = fit.bands.find(x => inside(x,p.tvl_usd)),alt = Object.entries(ranks).sort((a,c) => abs(c[1] - rank) - abs(a[1] - rank))[0];
 return [
  `<b>Value</b> · ${tvlBand(b)} TVL held-out median miss ×${b.miss.toFixed(1)}. Launch cap band ${usd(v.fitted*fit.band_low)}–${usd(v.cap_high)}.`,
  `<b>Score</b> · ${pc(v.time_factor)} of similar peers record a token. Days tracked matters most (held-out Brier ${O.terms[0][1].toFixed(3)} vs ${O.terms[2][1].toFixed(3)} without age).`,
  `<b>Rank</b> · #${rank}, ${r.rlo}–${r.rhi} in 40 refits${r.flip?`. Pass #${rank-1} with ${r.flip < 2?ceil((r.flip-1)*100)+'% more' : mult(r.flip)+' the'} TVL, others fixed` : ''}. #${alt[1]} ${alt[0]}${v.growth_imputed?'. Missing 7-day change uses 0%' : ''}${ages?`. Median age used. ${ages.map(a => `${a.age} days → #${a.rank}`).join(', ')}` : ''}.`,
  `<b>Plan</b> · If launched, ×${cover} needs ≥${pc(r.plan.need_share,1)} depositor share (assumed ${pc(share)}).`
 ];
}
function valueEq(p, v) {
 const terms = [[dollars(p.tvl_usd, { maximumFractionDigits: 20 }), 'Snapshot TVL'], [v.drift, '7d drift'],
  [v.fam_multiple,'Peer multiple'],[v.size_mult,'Size curve'],[v.time_factor,'Token-record score'],[v.haircut,'Haircut']];
 return `<p class=value-eq>max($1, round( ${terms.map(([n,l]) => `<span>${n}<small>${l}</small></span>`).join(' × ')} )) = <span><b>${dollars(v.implied)}</b><small>Implied value</small></span></p>`;
}
function cashReceipt(st,p) {
 const fees = ({cost,min}) => `${money(cost)} fees + ${min} min`;
 const odds = st.prob/100, flows = (n,f) => [false,true].map(c => f(cashFlow(p,n,c)));
 return `<section class="math cash"><h2>Cash flows if deposited</h2>${oddsInput(st)}
<p>Farm and exit in ${p.days} days (${fees(p.base)}). Eligible claim ${money(p.drop)} less ${fees(p.claim)}. Time $${p.hour}/h.
<p>${money(p.carry)} carry at ${pc(M.carry_rate)}/yr on ${dollars(p.stake)}. Assumes full recovery, zero yield, post-exit eligibility, undiscounted claim.
${tbl('mini',['Launch odds','#No carry','#With carry'],[
 ...[['0% · no launch',0],[st.prob+'% · expected',odds],['100% · eligible payout',1]].map(([l,n]) => [l,...flows(n,x => signed(x.net,money))]),
 ['Break-even',...flows(odds,x => threshold(x.threshold))]
])}</section>`;
}
const HOLD = 'Hold · complete the paper quote.';
function unwind(p) {
 const fields = ['Have deposit asset?','Exit to wallet works?','Entry cost ($)','Exit cost ($)','Lockup + exit (days)','Max wait (days)','Principal back ($)'];
 return `<section id=unwind><h3>Rehearse the unwind</h3>
<p>Quote ${dollars(p.eligible)} principal on ${esc(p.chain)}. Include gas, fees and slippage. Report gross principal back.
<div>${map(fields,(l,i) => `<label>${l}${i < 2?'<select><option value="">Unverified<option>Yes<option>No</select>' : `<input type=number min=0 step=${i < 4 || i === 6?'.01' : 'any'}>`}</label>`)}</div>
<p>Fee ceiling <b>${money(p.quoteCap)}</b> · 10% of modeled drop<p role=status>${HOLD}</section>`;
}
function checkUnwind(box,p) {
 const [fund,exit,entry,out,wait,limit,back] = [...box.querySelectorAll('select,input')].map(e =>
  e.validity.valid && e.value !== '' ? e.type === 'number' ? +e.value : e.value : null);
 const fee = [entry,out].includes(null)?null : +dec(entry+out);
 const why = fund === 'No'?'Funding unavailable.'
  : exit === 'No'?'Wallet cannot receive exit funds.'
  : wait != null && limit != null && wait>limit?'Wait exceeds limit.'
  : back != null && back<p.eligible?'Principal comes back short.'
  : fee != null && fee>p.quoteCap?`Round trip ${money(fee)} exceeds ceiling.` : '';
 const hold = [fund,exit,fee,wait,limit,back].includes(null), status = box.querySelector('[role=status]');
 status.className = why ? 'down' : hold ? '' : 'up';
 status.textContent = why?'Stop · '+why : hold?HOLD : 'Paper check passes · '+(p.verdict === 'skip'?'plan still says skip.' : 'confirm rewards and route terms.');
}
function farmTree(p) {
 const [verify,stop,wait,eligible,...route] = p.steps;
 const row = ({when,act,usd:c,min:t},extra = '') =>
  `<li><p><em>${esc(when)}</em>${esc(act)}.</p><span class=cost>${usd(c)}</span><span class=time>${mins(t)}</span>${extra}</li>`;
 const paid = details('Paid steps and exit · cost breakdown',`<ol class=steps>${map(route,s => row(s))}</ol>`);
 return `<div class=steph><span>After Verify, follow one branch</span><span>Cost</span><span>Time</span></div>
<ul class="steps tree">${row(verify,unwind(p))}</ul><ul class="steps tree branches">${row(stop)}${row(wait)}${row(eligible,paid)}</ul>`;
}
function detail(st) {
 const r = bySlug[st.p];
 if (!r) return `<p class=empty>No ranked protocol ${esc(st.p)}. <a href="${link({p: ''})}">Back to the board</a></p>`;
 const {p,v,plan:pl,rank} = r, fam = fit.families[v.family], tvl = p.tvl_usd;
 const near = x => abs(log(x.tvl/tvl));
 const peers = live.filter(l => l.family === v.family).sort((a,b) => near(a)-near(b)).slice(0,6);
 const price = x => tvl*x.actual/x.tvl, miss = x => abs(log(price(x)/v.fitted));
 const peer = peers.slice().sort((a,b) => miss(b)-miss(a))[0];
 const caps = peers.map(x => x.actual),lo = log10(min(v.low,...caps)/1.5),hi = log10(max(v.high,...caps)*1.5);
 const pos = x => (100*(log10(x) - lo)/(hi - lo)).toFixed(2) + '%';
 const line = (l,s,v,c = '') => `<tr class="${c}"><td>${l}<small>${s}</small></td><td class=num>${v}</td></tr>`;
 const votes = Object.entries(r.alt).map(([k,n]) => `#${n} ${k}`).join(' · ');
 return `<a class=back href="${link({p: ''})}">← Back to the board</a><label class="field vs"><span>Compare with</span><select id=vs>${option('','another protocol…')}${map(rows.filter(x => x !== r),x => option(x.p.slug,`#${x.rank} ${esc(x.p.name)}`))}</select></label>
<section class=dhead>
<div class=rankbig><small>Rank</small><b>${rank}</b><small>of ${N}</small></div>
<div><h1>${esc(p.name)}</h1>
<p class=tags>${chip(v.family)}<span class=tag>${cat(p)}</span><span class="tag pre">No token on record</span>${r.watch?'<span class="tag wlt">On the watchlist</span>' : '<span class=tag>Outside the watchlist</span>'}</p>
<p class=sub>${esc(p.chains.join(' · '))} · ${p.listed_at?'tracked since '+esc(p.listed_at):'no listing date'}</p>${nameFlag(r)}</div>
<div class=dval><small>Implied token value</small><b>${usd(v.implied)}</b><small>50% band ${usd(v.low)} – ${usd(v.high)} · ${mult(v.multiple)} TVL</small><small>Rank ${r.rlo}–${r.rhi} in 80% of 40 refits; top 20 in ${pc(r.boot)}</small><small>Rank #${rank} · ${votes}</small></div>
</section>
${valueEq(p,v)}
<div class=dgrid>
<div class=col>
<section class=card>${h2('How the value is built','model.js value()')}
<table class=receipt>
${line('TVL','snapshot tvl_usd',usd(p.tvl_usd))}
${line('Momentum '+pct(v.growth,2),v.growth_imputed?'missing change_7d uses 0%' : `7d ${pct(p.change_7d,2)} over one week, clipped ${M.growth_floor}…+${M.growth_cap}%`,'→ '+usd(v.tvl_next))}
${line('Peer multiple at $100M',`${fit.k === Infinity?'pooled curve won' : 'family pull k='+fit.k} (${esc(fam.label)} alone ${mult(fam.raw)})`,mult(v.fam_multiple))}
${line('Size curve',`(TVL ÷ $100M)<sup>${dec(fit.slope)}</sup>, fit on ${fit.n} tokens`,mult(v.size_mult))}
${line('Value if launched','trading peer at this size',usd(v.fitted),'sum')}
${line('Token-record score s',`peer token records by TVL, ${v.age == null?'median '+v.age_used : v.age} days tracked, 7-day change and family`,pc(v.time_factor))}
${r.flag?line('Product haircut',esc(r.flag),'×'+dec(v.haircut)) : ''}
${line('Implied value','rank '+rank+' of '+N,usd(v.implied),'total')}
</table>
<div class=scale>
<span class=band style="left:${pos(v.low)};width:calc(${pos(v.high)} - ${pos(v.low)})"></span>
${map(peers,x => `<span class=peer style="left:${pos(x.actual)}" title="${esc(x.p.name)} ${usd(x.actual)}"></span>`)}
<span class=mid style="left:${pos(v.implied)}"></span>
</div>
<p class=note>50% band (×${dec(fit.band_low)}–×${dec(fit.band_high)}) spans the middle half of held-out misses. Covers ${fit.band_wf.join('/')} newest, ${fit.band_fam.join('/')} family-out. Ticks mark peer caps.
</section>
<section class=card>${h2('Nearest trading peers',esc(fam.label)+', closest TVL')}
${tbl('mini',peerHeads,peers.map(x => peerCells(x,x.p.symbol || '')))}
${peer?note(`${esc(peer.p.name)}'s ${mult(peer.actual/peer.tvl)} implies ${usd(price(peer))}. Curve: ${usd(v.fitted)}, peer held-out miss ${mult(max(peer.actual/peer.loo,peer.loo/peer.actual))}.`):''}</section>
<section class="card risk">${h2('Risks','for this protocol')}<ul>${map(risks(r),t => `<li>${t}</li>`)}</ul></section>
</div>
<section class="card planc">${h2('Farm decision tree',`${pl.days} days on ${esc(pl.chain)} · live status unverified`)}
<div class=pkpis>
${kpi(dollars(pl.stake),pl.verdict === 'skip'?'Capital if deposited' : 'Capital')}
${kpi(usd(pl.cost),'Gas &amp; fees')}
${kpi(mins(pl.minutes),'Hands-on')}
${kpi(usd(pl.drop),'Drop if it launches')}
<div><small>Net if rewarded</small>${signed(pl.net)} · <b>${p2(pl.net_apr)}</b><small>Est. net APR</small></div>
<div><small>Modeled verdict</small>${tag(pl.verdict)}</div>
</div>
<p class=farmcue>${badge(pl)} <b>${esc(pl.risk)}</b> · ${usd(pl.round_trip)} round-trip gas and fees before claim.<br>Stress: ${esc(pl.stress)} → <b>${usd(pl.stress_usd)}</b> loss (×${one(pl.stress_usd/max(pl.drop,1e-9))} drop).</p>
${sens(st,null,pl)}${cashReceipt(st,pl)}${farmTree(pl)}${farmMath(st,v,pl)}
</section>
</div>`;
}
function farmMath(st,v,p) {
 const {drop:d,all_in:all,days,cost,cert} = p, apr = p2(v.apr), ratio = d/all, w = d*v.time_factor;
 return `<div class=math>
<p><b>Drop APR ${apr} if launched</b> = ${usd(v.fitted)} × ${pc(share)} depositor share ÷ (${usd(v.tvl_next)} TVL × (${min(v.age_used,M.season_days)} + ${days}) season days) × 365.
<p><b>Reward sensitivity</b> · ${share*50}% pays ×${dec(ratio/2)}, ${share*200}% pays ×${dec(ratio*2)}. Score-weighted drop ${usd(w)} (×${dec(w/all)}). Net before time ${sg(d-cost)}. Full-route loss at zero payout ${usd(all)}.
<p>Dollar-days (${p.tranches.map(([s,t]) => `${dollars(s)} × ${days-t} d`).join(' + ')}) × ${apr} ÷ 365 = ${bold(usd(d))} vs ${bold(usd(all))} all-in (${usd(cost)} fees + ${mins(p.minutes)} at $${p.hour}/h), net ${signed(p.net)}. Net APR = net ÷ capital incl. reserve × 365 ÷ ${days} days.
<p><b>Fees</b> · ${p.fees.map(([m,c,n,v]) => `${m}× gas ${usd(c)}, net ${sg(n)} (${v})`).join(' · ')}.
<p><b>Carry</b> · ${dollars(p.stake)} for ${days} days costs ${usd(p.carry)} at ${pc(M.carry_rate)}. Net at zero yield ${sg(p.net-p.carry)}.
<p><b>Capital</b> · ${st.dep?'your deposit' : pays(p)?`least paying ×${cover} ($500–$25K)` : `$25K cap, no deposit pays ×${cover}`}${cert?`. Break-even certificate: ${dollars(cert[2])} at ×${cert[3].toFixed(3)}, ${dollars(cert[0])} at ×${cert[1].toFixed(3)}` : ''}.</div>`;
}

const num = h => h[0] === '#' ? ' class=num' : '';
const tbl = (cls,hs,rs,pick) => `<table class="${cls}"><thead><tr>${map(hs,h => `<th${num(h)}>${h.replace('#','')}`)}</thead><tbody>${map(rs,(r,j) => `<tr${pick?.(j)?' class=pick' : ''}>${map(r,(v,i) => `<td${num(hs[i])}>${v}`)}`)}</tbody></table>`;
const table = (...x) => `<div class=tablewrap>${tbl(...x)}</div>`;
function sens(st, audit, pl) {
 const gas = Object.entries(tables.gas), d = pl?.shocks ?? audit.changes;
 const show = pl ? tag : n => n ? (n < 0 ? '−' : '+') + abs(n) : '0';
 const loss = n => `${-n}/${audit.base} FARM lost`, impact = pl ? show : loss;
 const data = [['gas','Gas per tx',pl?usd(pl.gas):`${gas.length} rates + fallback`],['hour','Time value',`$${st.hr}/h`],
  ['share','Depositor share',pc(share)],['costs','All-in cost',pl?usd(pl.all_in):'Gas, fees, time']];
 const summary = `<b>Assumptions &amp; sensitivity</b> · 2× costs: ${impact(d.costs[2])} · ½ share: ${impact(d.share[0])}`;
 return details(summary,`<p class=note>${pl?`Baseline ${pl.verdict} on ${esc(pl.chain)}.` : `All ${N} · ${st.dep?usd(+st.dep):'Auto deposit'}${st.chain?' · '+esc(st.chain)+' if available':''}. + gains FARM, − loses FARM.`} One change, fixed deposit and chain.
${tbl('mini',['Input','Baseline','#−50%','#+50%','#2×'],data.map(([k,label,v]) => [label,v,...d[k].map(show),...(d[k].length === 2?['—'] : [])]))}
${details('Gas and stress rates',note(`Gas per tx: ${gas.map(([c,n]) => `${esc(c)} $${n}`).join(' · ')} · fallback $${tables.gas_default}.`)+
 note(`Stress losses: ${Object.entries(tables.act).map(([k,a]) => `${esc(FAM[k] || (k === 'restake'?'Restaking' : 'Prediction markets'))} ${p2(R.stressRate(k))} of ${{capital:'capital',side:'side position'}[a[4][2]] || 'main stake'}`).join(' · ')}.`))}`,' class=sens');
}
const nm = (n, sub) => `<b>${esc(n)}</b><small>${esc(sub)}</small>`;
const peerHeads = ['Protocol','#TVL','#Market cap','#÷ TVL'];
const peerCells = (x,sub,tvl = usd(x.tvl)) => [nm(x.p.name,sub),tvl,usd(x.actual),mult(x.actual/x.tvl)];
function model() {
 return `<section class="hero slim">${formula()}<div class="card checks">${h2('Self-checks','run on load')}<ul>${map(checks,([ok,t]) => `<li class=${ok?'ok' : 'bad'}>${ok?'✓' : '✗'} ${t}</li>`)}</ul></div></section>`;
}
function audit() {
 return `${intro(`Top ${A} rank audit`,`<p>Snapshot token fields, product rules, watchlist. Parent links absent. Flags possible token or product links and above-floor off-list rows.
<p>7d TVL change clips at ${pct(M.growth_floor,0)} and ${pct(M.growth_cap,0)} (${count(rows,clipped)} total). Missing uses 0%. Peer P95 is the band's 95th percentile of trading cap ÷ TVL.`)}
${table('board',['#Rank','Protocol','Snapshot status','#TVL','#7d raw → used','#Value if launched','#Record score','#Implied value','#Full/TVL · peer P95'],top.map(a =>{
  const{rank,p,v,watch}= a.r;
  return [rank,`${anchor(link({view:'board',p:p.slug}),esc(p.name))}<small>${cat(p)}</small>`,
   a.exclusion?`<b class=down>${esc(a.exclusion)}</b>` : (watch?'Watchlist' : 'Off watchlist')+(a.review?`<small class=down>${esc(a.review)}</small>` : ''),
   usd(p.tvl_usd),`<span class="${clipped(a.r)?'down' : ''}">${pct(p.change_7d,2)} → ${pct(v.growth,2)}</span>`,
   usd(v.fitted),pc(v.time_factor),usd(v.implied),`<span class="${above95(a)?'down' : ''}">${mult(a.ratio)}</span> · ${a.p95 == null?'n/a' : mult(a.p95)}`];
 }))}`;
}
function aside() {
 return intro(`${nSet} products set aside`,'<p>No token recorded: bridges, exchanges, Restaked BTC, wrapped or staked products.')+
 table('board',['Product','Exclusion','#TVL','#7d'],products.map(({p,kind}) => [nm(p.name,p.chains.slice(0,3).join(', ')),`<span class=tag>${esc(kind)}</span>`,usd(p.tvl_usd),pct(p.change_7d)]));
}

function trading() {
 const data = live.map(l => {
  const tvl = usd(l.tvl)+(l.members > 1?` <small>${l.members} parts</small>` : ''), r = l.loo/l.actual;
  return [...peerCells(l,(l.p.symbol || '')+' · '+(l.p.category || ''),tvl),usd(l.loo),`<span class=${r > 2 || r < .5?'down' : 'up'}>${mult(r)}</span>`];
 });
 return intro(`${fit.n} trading tokens in the calibration set`,
 `<p>calibrate() pools token TVL, omits exchanges/products, fits ln(mcap ÷ TVL) on ln(TVL). Value scales as TVL<sup>${dec(fit.elasticity)}</sup>. ${listed} token records lack caps.`)+
 table('board',[...peerHeads,'#Fit without it','#÷ market'],data);
}

let planDep = `|${DEF.hr}|`;
const farmAt = (h,dep) => count(top,({r}) => plan(r.p,r.v,+dep,h).verdict === 'farm');
const views = {board,model,audit,aside,trading};
const VALID = {view:Object.keys(views), sort:Object.keys(KEYS), scope:SCOPES.map(([k]) => k),
 verdict:PLANS.map(([k]) => k), dir:['asc','desc'], dep:DEPS.map(String), hr:RATES.map(String),
 bud:BUDS.map(String), prob:PROBS.map(String)};
function render() {
 const st = state();
 head(st);
 app.className = st.p ? 'detail' : st.view;
 const k = [st.dep, st.hr, st.chain].join('|');
 if (k !== planDep) {planDep = k; rows.forEach(r => {r.plan = plan(r.p,r.v,+st.dep,+st.hr,st.chain);});}
 const a = bySlug[st.p], b = bySlug[st.vs];
 app.innerHTML = st.p ? a && b ? compare(a, b) : detail(st) : views[st.view](st);
 const d = el('drawn');
 if (d) {
  const rs = filter(st), tr = [...app.querySelectorAll('tr[data-slug]')];
  const ok = tr.length === rs.length && tr.every((t,i) =>
   t.dataset.slug === rs[i].p.slug && t.querySelector('td.val b').textContent === usd(rs[i].v.implied));
  d.className = ok?'up' : 'down';
  d.textContent = ok?`✓ table drawn = model (${tr.length} rows)` : '✗ table drawn ≠ model';
 }
 el('foot').innerHTML = `${esc(S.source)}. Floor $${(S.floor_usd/1e6).toFixed(0)}M. Implied = launched value × record score × haircut. DefiLlama may omit tokens.`;
 if (st.p) window.scrollTo(0, 0);
}
function quote(t) {
 const box = t.closest('#unwind');
 if (box) checkUnwind(box,bySlug[state().p].plan);
}
app.addEventListener('input', ({target:t}) => {
 quote(t);
 if (t.id !== 'q') return;
 const val = t.value;
 history.replaceState(null,'',link({q:val})); render();
 const q = el('q'); q.focus(); q.setSelectionRange(val.length, val.length);
});
app.addEventListener('change',({target:t}) => {
 quote(t);
 if (['chain','dep','bud','hr','vs','prob'].includes(t.id)) go({[t.id]:t.value});
});
['click', 'keydown'].forEach(ev => app.addEventListener(ev, e => {
 const tr = e.target.closest('tr[data-slug]');
 if (tr && !e.target.closest('a') && (ev === 'click' || e.key === 'Enter')) go({ p: tr.dataset.slug });
}));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && state().p) go({ p: '' }); });
window.addEventListener('hashchange', render);
render();
})();
