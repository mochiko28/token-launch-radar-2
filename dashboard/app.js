"use strict";

const api=globalThis.LaunchRadar;
const {snapshot,boardDigest}=globalThis.LaunchRadarData;
const model=api.buildModel(snapshot);
const $=selector=> document.querySelector(selector);
const $$=selector=> [...document.querySelectorAll(selector)];
const html=(items,draw)=>items.map(draw).join("");
const view=$("#view");
const checks=api.selfChecks(model,snapshot,boardDigest);
const passed=checks.filter(check=>check.pass).length;
const number=options=> new Intl.NumberFormat("en-US",options).format;
const integer=number({maximumFractionDigits:0});
const currency={style:"currency",currency:"USD"};
const money=number(currency);
const shortUsd=number({...currency,notation:"compact",maximumFractionDigits:2});
const usd=n=> "$" + integer(n);
const pct=(n,places = 2)=> (n * 100).toFixed(places) + "%";
const multiple=n=> n == null ? "—" : n.toFixed(2) + "×";
const sign=n=> n > 0 ? "+" : "";
const change=n=> n == null ? "—" : sign(n) + n.toFixed(2) + "%";
const net=n=> sign(n) + money(n);
const tone=n=> n > 0 ? "positive" : n < 0 ? "negative" : "";
const esc=value=> String(value ?? "").replace(/[&<>"']/g,c=> ({
	"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
})[c]);

const {counts,verdicts,stress,portfolio,value,odds,assumptions}=model;
const {horizons}=assumptions.parameters;
const walk=odds.validation.walk;
const timingNote=`${assumptions.timing} F walk-forward AUC ${walk.auc?.toFixed(3) ?? "—"} (n=${walk.n}), training on older listings, testing newer token status.`;
const {baseline,selected,trials}=value.validation;
const valueTests=[["loo","Leave-one-out"],["walk","Walk-forward"],["family","Family hold-out"]];
const families=[...new Set(model.rows.map(row=>row.family))].sort();
const chains=[...new Set(model.rows.flatMap(row=>row.chains))].sort();
const ratings=["FARM","MARGINAL","SKIP"];
const scenarios=[["doubleCost","2× cost"],["halfShare","½ share"]];
const oddsLabel="Token odds (snapshot status)";
const columns={
	rank:["Rank","rank","asc"],name:["Protocol","name","asc"],
	value:["Implied value","score"],odds:[oddsLabel,"tokenOdds"],tvl:["TVL","tvl_usd"],
	growth:["7d TVL","change_7d"],days:["Days listed","ageDays"],
	verdict:["Verdict",p=>ratings.indexOf(p.plan.verdict),"asc"],net:["Expected net",p=>p.plan.net]
};
const direction=key=> columns[key][2] || "desc";
const filters=[
	["Scope","scope",["all","watchlist"],"All ranked","Watchlist"],
	["Family","family",["",...families],"All families"],
	["Verdict","verdict",["",...ratings],"All verdicts"],
	["Chain","chain",["",...chains],"All chains"],
	["Min TVL","tvl",["","10000000","50000000","100000000","500000000"],"Any TVL"],
	["Issuer","flag",["","flagged","clear"],"Any issuer","Flagged","No flags"]
];
const defaults={q:"",sort:"rank",...Object.fromEntries(filters.map(([,k,[first]])=>[k,first]))};
const titles={board:"Rankings",calibration:"Calibration",audit:"Top-20 audit",detail:"Protocol"};
const bySlug=new Map(model.rows.map(row=>[row.slug,row]));

function readRoute() {
	const [path,query]=location.hash.slice(1).split("?");
	const [route,slug]=path.split("/");
	const params=new URLSearchParams(query);
	const state={...defaults,route:Object.hasOwn(titles,route) ? route : "board",slug,q:params.get("q") || ""};
	for (const [,key,options] of filters) {
		const choice=params.get(key);
		if (options.includes(choice)) state[key] = choice;
	}
	const sort=params.get("sort"),dir=params.get("dir");
	if (Object.hasOwn(columns,sort)) state.sort = sort;
	state.dir = ["asc","desc"].includes(dir) ? dir : direction(state.sort);
	state.compare = [...new Set(params.getAll("compare"))].filter(slug=>bySlug.has(slug)).slice(0,3);
	return state;
}

function link(route,state,slug="") {
	const params=new URLSearchParams();
	for (const [key,normal] of Object.entries(defaults)) {
		if (state[key] !== normal) params.set(key,state[key]);
	}
	for (const slug of state.compare) params.append("compare",slug);
	if (state.dir !== direction(state.sort)) params.set("dir",state.dir);
	return "#" + route + (slug ? "/" + slug : "") + (params.size ? "?" + params : "");
}

const badge=v=> `<span class="badge ${v.toLowerCase()}">${v}</span>`;
const taggedLink=(p,state)=> `<a class=protocol href="${esc(link("detail",state,encodeURIComponent(p.slug)))}">${esc(p.name)}</a>`;
const days=row=> row.ageDays == null ? "—" : integer(row.ageDays);

const heading=(title,description="",label="",lead="")=> `<header class=heading><div>${label}<h1>${title}</h1>${lead}<p>${description}</div>
	<div class=snapshot>DefiLlama<br><time>${esc(snapshot.as_of)} UTC</time></div></header>`;

function valueSummary() {
	const [intercept,slope]=value.fit.coefficients;
	const unit=shortUsd(assumptions.parameters.tvlReference);
	return `<div class="readings misses">${html(valueTests,([key,label]) =>
		`<div><strong>${multiple(selected[key].miss)}</strong><small> / ${multiple(baseline[key].miss)}</small><span>${label}</span></div>`)}</div>
	<p class=curve>${shortUsd(Math.exp(intercept))} × (carried TVL / ${unit})<sup>${slope.toFixed(3)}</sup> · n=${counts.valueFit}`;
}

function kpis() {
	const groups=[[counts.traded,"traded"],[counts.recorded,"token without cap"],[counts.setAside,"set aside"],[counts.ranked,"ranked"]];
	return `<section class=kpis aria-label=Validation>
	<div class=kpi><h2>Snapshot coverage</h2><strong>${counts.total}</strong>
	<div class=group-bar aria-hidden=true>${html(groups,([n])=>`<span style=flex:${n}></span>`)}</div>
	<div class=groups>${html(groups,([n,label])=>`<span><b>${n}</b> ${label}</span>`)}</div></div>
	<div class=kpi><h2>Median held-out miss vs flat ratio</h2>${valueSummary()}</div>
	<div class=kpi><h2>${oddsLabel} · held-out AUC</h2><div class=readings>
	${html(valueTests.slice(0,2),([key,label])=>`<div><strong>${odds.validation[key].auc?.toFixed(3) ?? "—"}</strong><span>${label}</span></div>`)}</div>
	<p>F uses TVL and age</div>
	<div class="kpi coverage"><h2>Watchlist coverage</h2><strong>${counts.watchlistCovered}<small> / ${counts.watchlistTotal}</small></strong>
	<p>TVL floor ${shortUsd(snapshot.floor_usd)}</div></section>`;
}

function filter([label,key,options,...titles],state) {
	return `<label>${label}<select id=filter-${key} name=${key}>${html(options,(option,i) =>
		`<option value="${esc(option)}"${option === state[key] ? " selected" : ""}>${esc(titles[i] ?? (key === "tvl" ? shortUsd(option) + "+" : option))}`
	)}</select></label>`;
}

function portfolioStrip(state) {
	const {positions,capital,cost,net:gain,unallocated,eligible,budget}=portfolio;
	return `<section class=portfolio>
	<div><h2>${shortUsd(budget)} watchlist portfolio</h2>
	<p>${positions.length}/${eligible} FARM · Shared upkeep
	<p>${unallocated ? usd(unallocated) + " unallocated" : "Score-weighted surplus"}</div>
	<div class=positions>${html(positions,p=>`<div>${taggedLink(p,state)}
	<small>${usd(p.capital)} capital</small><small>${money(p.cost)} cost · ${net(p.net)} net</small></div>`)}</div>
	<dl class=totals>${metric("Capital",usd(capital))}${metric("Cost",money(cost))}
		${metric("Expected net",net(gain),tone(gain))}</dl></section>`;
}

function boardShell(state) {
	return `${heading("Pre-token rankings","Farm horizons · 30–365 days")}
		${kpis()}
		${state.scope === "watchlist" ? portfolioStrip(state) : ""}
	<div class=board-grid><section class=panel>
	<div class=section-head><h2>Ranked protocols</h2><div class=board-status role=status><span id=row-count></span><span id=row-check></span></div></div>
	<div class=filters><label>Search<input id=filter-q type=search value="${esc(state.q)}" autocomplete=off></label>
			${html(filters,spec=>filter(spec,state))}</div>
	<div id=comparison></div><div id=results></div>
	</section><aside class=board-aside>
	<section class="panel yield-panel"><h2>Expected yield by age</h2>
	<div id=yield-chart></div>
	<div class=chart-key>${html(ratings,v=>`<span class=${v.toLowerCase()}-dot>${v}</span>`)}</div>
	</section>
	<section class=stress-panel><h2>Farm sensitivity</h2><p>Capital re-sized
		${facts(["Scenario",...ratings],[
			["Base",...Object.values(verdicts)],...scenarios.map(([key,label]) =>
				[label, ...ratings.map(v=>`${stress[key].all[v]} <small>(${stress[key].farm[v]})</small>`)])
		])}<p>Base FARM in parentheses.</section>
	</aside></div>`;
}

function matchingRows(state) {
	const {scope,family,chain,verdict,flag,tvl}=state;
	const query=state.q.trim().toLowerCase();
	return model.rows.filter(row=>(!query || `${row.name} ${row.slug}`.toLowerCase().includes(query))
		&& (scope !== "watchlist" || row.watchlist)
		&& (!family || row.family === family) && (!chain || row.chains.includes(chain))
		&& (!verdict || row.plan.verdict === verdict) && row.tvl_usd >= Number(tvl)
		&& (!flag || Boolean(row.flags.length) === (flag === "flagged"))
	).sort((a,b)=> compareRows(a,b,state));
}

function compareRows(a,b,state) {
	const field=columns[state.sort][1];
	const read=typeof field === "function" ? field : p=>p[field];
	const x=read(a),y=read(b);
	if (x == null || y == null) return Number(x == null) - Number(y == null) || a.rank - b.rank;
	return (typeof x === "string" ? x.localeCompare(y) : x - y) * (state.dir === "asc" ? 1 : -1) || a.rank - b.rank;
}

const factorText=(value, odds, issuer)=> `${shortUsd(value)} × ${pct(odds, 1)} × ${issuer}`;

function tableRow(row,state) {
	const {slug,score,launchValue,tokenOdds,haircut,rank,plan}=row;
	const picked=state.compare.includes(slug);
	return `<tr data-slug="${esc(slug)}" data-value=${score} data-launch=${launchValue} data-odds=${tokenOdds} data-issuer=${haircut}>
	<td class=rank>${rank}
	<th scope=row>${taggedLink(row,state)}${row.flags.length ? " <span title='Issuer flag'>!</span>" : ""}
	<small>${esc(row.category || row.family)}${row.watchlist ? " <span class=watch-label title=Watchlist aria-label=Watchlist>◆</span>" : ""}
	<td class=value title="${usd(score)}"><b>${shortUsd(score)}</b>
	<small>${factorText(launchValue,tokenOdds,haircut)}</small>
	<td>${pct(tokenOdds,1)}<td>${shortUsd(row.tvl_usd)}
	<td class="${tone(row.change_7d)}">${change(row.change_7d)}
	<td>${days(row)}
	<td>${badge(plan.verdict)}<td class="${tone(plan.net)}">${net(plan.net)}<small>${plan.horizon} d</small>
	<td><input type=checkbox data-compare="${esc(slug)}" id=pick-${rank} aria-label="Compare ${esc(row.name)}"${picked ? " checked" : state.compare.length === 3 ? " disabled" : ""}>
	</tr>`;
}

function comparison(state) {
	const picks=state.compare.map(slug=>bySlug.get(slug));
	if (!picks.length) return '<p class=compare-hint>Compare up to 3 protocols.';
	const update=(compare,label)=> `<a class=button href="${esc(link("board",{...state,compare}))}">${label}</a>`;
	const headers=picks.map(p=>taggedLink(p,state) + " " + update(state.compare.filter(s=>s !== p.slug),
		`<span title="Remove ${esc(p.name)}">×</span>`));
	const metrics=[
		["Value",p=>shortUsd(p.score)],[oddsLabel,p=>pct(p.tokenOdds)],["TVL",p=>shortUsd(p.tvl_usd)],
		["7d TVL",p=>change(p.change_7d)],["Days listed",days],["Verdict",p=>badge(p.plan.verdict)],
		["Capital",p=>usd(p.plan.capital)],["Expected net",p=>net(p.plan.net)]
	];
	return `<section class=compare-panel><div class=section-head><h2>Compare</h2>${update([],"Clear")}</div>
		${facts(["Metric",...headers],metrics.map(([label,read])=>[label,...picks.map(read)]))}</section>`;
}

function verifyRows(rows,state) {
	const rendered=$$("#results tbody tr");
	const board=model.board.rows,digest=api.digest(board);
	let sorted=rendered.length === rows.length && (!rows.length || !!$(
		`[aria-sort=${ariaSort(state)}] #sort-${state.sort}`));
	const matched=rendered.filter((tr,i)=>{
		const {slug,value,launch,odds,issuer}=tr.dataset;
		const row=bySlug.get(slug),saved=board[row?.rank - 1];
		sorted &&= row === rows[i] && (!i || compareRows(rows[i - 1],row,state) <= 0);
		if (saved?.slug !== slug) return false;
		const {rank,implied_value_usd:score,launch_value_usd:base,token_odds:s,issuer_factor:factor}=saved;
		const [rankCell,,valueCell,oddsCell]=tr.cells;
		return +rankCell?.textContent === rank && +value === score && +launch === base && +odds === s && +issuer === factor
			&& valueCell?.title === usd(score) && valueCell.querySelector("b")?.textContent === shortUsd(score)
			&& valueCell.querySelector("small")?.textContent === factorText(base,s,factor) && oddsCell?.textContent === pct(s,1);
	}).length;
	const check=$("#row-check");
	const sameDigest=digest === boardDigest;
	check.dataset.pass = String(sameDigest && sorted && matched === rendered.length);
	check.textContent = `${matched}/${rows.length} rows match board.json · digest ${sameDigest ? digest : "mismatch"}${sorted ? "" : " · sort mismatch"}`;
}

const ariaSort=state=> state.dir === "asc" ? "ascending" : "descending";

function renderBoard(state) {
	const rows=matchingRows(state);
	$("#row-count").textContent = `${rows.length} of ${state.scope === "watchlist" ? counts.watchlistCovered : counts.ranked} shown`;
	$("#results").innerHTML = rows.length ? `
	<div class=scroll tabindex=0 role=region aria-label="Rankings"><table class=rankings>
	<thead><tr>${html(Object.entries(columns),([key,[label]])=>{
			const active=key === state.sort;
			const dir=active ? state.dir === "asc" ? "desc" : "asc" : direction(key);
			const next=esc(link("board",{...state,sort:key,dir}));
			return `<th scope=col${active ? ` aria-sort=${ariaSort(state)}` : ""}>
	<a id=sort-${key} href="${next}">${label}${active ? ` <span aria-hidden=true>${state.dir === "asc" ? "↑" : "↓"}</span>` : ""}</a>`;
		})}<th scope=col>Compare<tbody>${html(rows,row=>tableRow(row,state))}</table></div>`
		: '<p class=empty>No matching protocols.';
	verifyRows(rows,state);
	$("#yield-chart").innerHTML = yieldChart(rows);
	$("#comparison").innerHTML = comparison(state);
}

function yieldChart(rows) {
	const points=rows.filter(row=>row.ageDays != null && Number.isFinite(row.plan.expectedYield));
	if (!points.length) return '<p class=chart-note>No listing dates to plot.';
	const left=36,right=275,top=10,bottom=130;
	const maxDays=Math.ceil(Math.max(...points.map(p=>p.ageDays)) / 100) * 100;
	const yields=points.map(p=>p.plan.expectedYield);
	const maxYield=Math.ceil(Math.max(.01,...yields) * 100) / 100;
	const minYield=Math.floor(Math.min(0,...yields) * 100) / 100;
	const x=days=> left + (right - left) * days / maxDays;
	const y=rate=> bottom - (bottom - top) * (rate - minYield) / (maxYield - minYield);
	const interval=Math.ceil((maxYield - minYield) * 100 / 6) / 100;
	const ticks=Array.from({length:1 + Math.floor((maxYield - minYield + 1e-9) / interval)},(_,i)=>minYield + i * interval);
	return `<svg viewBox="0 0 288 170" role=img aria-label="Age vs expected yield">
		${html(ticks,rate=>`<path d="M${left},${y(rate)}H${right}"/><text x=${left - 7} y=${y(rate) + 4} text-anchor=end>${pct(rate,0)}</text>`)}
		${html([0,1,2,3],i=>{
			const days=i * maxDays / 3;
			return `<path d="M${x(days)},${top}V${bottom}"/><text x=${x(days)} y=148 text-anchor="${["start", "middle", "middle", "end"][i]}">${integer(days)}</text>`;
		})}
		${html(points.reverse(),row=>`<circle class=${row.plan.verdict.toLowerCase()}-dot cx=${x(row.ageDays)} cy=${y(row.plan.expectedYield)} r=3.1>
	<title>${esc(row.name)} · ${row.ageDays} days · ${pct(row.plan.expectedYield)}</title></circle>`)}
	<text x=${(left + right) / 2} y=167 text-anchor=middle>Days without a recorded token</text>
	</svg><p class=chart-note>${points.length} plotted${rows.length > points.length ? ` · ${rows.length - points.length} undated` : ""}`;
}

const metric=(label,reading,style = "")=> `<div><dt>${label}<dd class="${style}">${reading}</div>`;

function facts(headers,rows) {
	return `<div class=scroll tabindex=0><table class=facts>
	<thead><tr>${html(headers,title=>`<th scope=col>${title}`)}
	<tbody>${html(rows,([first,...cells])=>`<tr><th scope=row>${first}${html(cells,cell=>`<td>${cell}`)}`)}
	</table></div>`;
}

const inset=(title,content)=> `<section class="panel inset"><h2>${title}</h2>${content}</section>`;

function valueAttribution(row) {
	const ref=model.reference,show=n=> n.toFixed(3) + "×";
	const labels=["TVL size","7d carry","Age on odds","Issuer","Family","Rounding"];
	const factors=Object.values(row.attribution).map(show);
	return `<div class=attribution><p><b>${show(row.score / ref.score)}</b> vs median #${ref.rank} ${esc(ref.name)} (${usd(ref.score)})
	<dl>${html(labels,(label,i)=>i < 4 || factors[i] !== "1.000×" ? metric(label,factors[i]) : "")}</dl>
	</div>`;
}

const quoteFields=[
	["entryGas","Entry gas $",1e6],["exitGas","Exit gas $",1e6],["slippage","Slippage %",100],
	["delay","Exit delay (d)",36500],["lockup","Lockup days",36500]
];
const breakEven=n=> n === null ? "Unreachable" : pct(n);
function quoteResult(plan,quote=plan.quote,result=plan) {
	const {horizon,q,capital,noToken,withToken,pStar,gas,fees,timeCost,holding,capitalCharge,drop,claimSell,verdict}=result;
	const half=api.evaluateFarm(plan,capital,{quote,horizon,q:q / 2});
	const {riskFreeRate,hourlyUsd}=assumptions.parameters;
	return `<div class=outcomes>
	<div><h3>No token <b>${money(noToken)}</b></h3><p>Gas ${money(gas)} · fees ${money(fees)}
	<p>Time ${money(timeCost)} at ${usd(hourlyUsd)}/h
	<p>Capital cost ${money(capitalCharge)} · ${holding}d at ${pct(riskFreeRate,0)}/yr
	</div><div><h3>Token <b>${net(withToken)}</b></h3><p>Drop ${money(drop)} − claim &amp; sell ${money(claimSell)}
	<p>Less base loss of ${money(-noToken)}
	<p>${pct(result.conditionalApr)} net APR if launched</div>
	</div>
	<dl class=metrics>${metric("Capital",usd(capital))}
	${metric(`Launch within ${horizon} d (q)`,pct(q))}
	${metric("Break-even p*",breakEven(pStar))}
	${metric("Expected net",net(result.net),tone(result.net))}
	${metric("Quote verdict",badge(verdict))}</dl>
	<p class=half-odds>Half q (${pct(q / 2)}) gives ${net(half.net)} and ${badge(half.verdict)}.`;
}

function quotePanel({plan,slug}) {
	return `<section class="panel inset quote"><h2>Cash flows &amp; quotes</h2>
	<div id=quote-result aria-live=polite>${quoteResult(plan)}</div>
	<p>${timingNote}
	<form id=quote data-slug="${esc(slug)}" class=quote-fields>
	<label>Horizon<select name=horizon><option value=0>Auto${html(horizons,h=>`<option value=${h}>${h} days`)}</select></label>
		${html(quoteFields,([key,label,max])=>`<label>${label}
	<input name=${key} type=number step=any min=0 max=${max} placeholder=${plan.quote[key]}>
	<small>Default</small></label>`)}
	</form>
	<p>FARM at q ≥ 2p* with clear flags. MARGINAL from p*.
	</section>`;
}

function decisionTree(steps) {
	const labels=["1 Verify","2a Wait","2b Stop","2c Withdrawal rehearsal","3a Stop","3b Decide on entry","4 Monitor","5 Withdraw","6 Claim &amp; sell"];
	const step=(label,body,terms,follow)=>`<li><div><h3>${label}</h3><p>${esc(body)}${follow ? ` <span>${esc(follow)}</span>` : ""}</div><small>${esc(terms)}</small>`;
	return `<ol class=plan-steps>${html(steps,([body,terms,follow,fallback,extra],i)=>
		step(labels[i],body,terms,follow) +
		(fallback ? step("3c Wait",fallback,extra) : ""))}</ol>`;
}

function detail(row,state) {
	const back=`<a class=back-link href="${esc(link("board", state))}">← Back to rankings</a>`;
	if (!row) return back + heading("Protocol unavailable");
	const plan=row.plan;
	const age=row.ageDays == null ? "Undated" : days(row) + " tokenless days listed";
	const summary=`${esc(row.category || row.family)} · ${shortUsd(row.tvl_usd)} TVL · ${change(row.change_7d)} 7d · ${age}`;
	const label=`<p class=detail-label>Rank ${row.rank}/${counts.ranked}${row.watchlist ? " · ◆ Watchlist" : ""}</p>`;
	const lead=`<p class=verdict-summary>${badge(plan.verdict)} · ${esc(plan.ticket)} on ${esc(plan.chain.name)} · Launch within ${plan.horizon} d: ${pct(plan.q)} (q) vs p* ${breakEven(plan.pStar)} · ${net(plan.net)} expected`;
	const stressRows=[["Base",plan],...scenarios.map(([key,label])=>[label,plan.stress[key]])]
		.map(([label,p])=>[label,usd(p.capital),badge(p.verdict),net(p.net)]);
	const range=(low,high)=> shortUsd(low) + "–" + shortUsd(high);
	const factors=[[usd(row.launchValue),"Value if launched"],[pct(row.tokenOdds),oddsLabel],[row.haircut.toFixed(2),"Issuer factor"]];
	return `${back}${heading(esc(row.name),summary,label,lead)}
	<div class=detail-grid><div class=detail-aside><section class="panel inset plan-panel">
	<h2>Farm decision tree</h2><p>${row.family} on ${esc(plan.chain.name)} · Defaults</p>
		${decisionTree(plan.steps)}
	</section>
	${inset(`Stress · ${plan.horizon} d · re-sized capital`,facts(["Scenario","Capital","Verdict","Expected net"],stressRows))}
	</div><div class=detail-aside>
		${quotePanel(row)}
	<section class="panel valuation">
	<h2>Implied token value</h2><div class=large-value>${usd(row.score)}</div>
	<div class=equation>${factors.map(([n,label])=>`<div><b>${n}</b><small>${label}</small></div>`).join("<span>×</span>")}</div>
			${valueAttribution(row)}
	<dl class=band>${metric("Launch value · p10–p90",range(row.band.low,row.band.high))}
			${metric("Odds-weighted band",range(row.band.weightedLow,row.band.weightedHigh))}</dl>
	<p>${row.flags.length ? row.flags.map(esc).join(" · ") + " · MARGINAL cap" : "No flags"}
	</section>
		${inset("Nearest traded peers",facts(["Protocol","TVL","Market cap"],
			row.peers.map(p=>[esc(p.name),shortUsd(p.tvl_usd),shortUsd(p.mcap_usd)])))}
	</div></div>`;
}

function calibration() {
	return `${heading("Trading-token calibration")}
		${inset("Launch probability q",`<p>${timingNote}`)}
	<div class=research-grid>
		${inset(counts.valueFit + " screened trading tokens",facts(["Protocol","Family","Carried TVL","Market cap","Fit"],
			[...model.calibration].sort((a,b)=> b.mcap_usd - a.mcap_usd)
				.map(p=>[esc(p.name),p.family,shortUsd(p.carriedTvl),shortUsd(p.mcap_usd),shortUsd(p.launchValue)])))}
		${inset("Median held-out miss vs flat ratio",valueSummary() +
			`<p class=section-note>Flat uses median cap / carried TVL per fold.` +
			facts(["Terms after TVL",...valueTests.map(([key,label])=>`${label} (n=${selected[key].n})`)], [baseline,...trials].map(trial=>[
				(trial.terms?.join(" + ") || (trial === baseline ? "Flat ratio" : "None")) + (trial === selected ? " · selected" : ""),
				...valueTests.map(([key])=>multiple(trial[key].miss))
			])))}
	</div>`;
}

function audit(state) {
	const peerRange=model.peerRatios.map(multiple).join("–");
	return `${heading("Top-20 audit", "Highest implied values")}
	<section class="panel inset">
			${facts(["Rank","Protocol","Raw 7d","Carried 7d","Growth treatment","Value / TVL","Peer range","Issuer flags"],
				model.audit.map(row=>[
					row.rank,taggedLink(row,state),change(row.change_7d),change(row.growth),
					row.change_7d == null ? "Imputed" : row.change_7d !== row.growth ? "<b>Clipped</b>" : "As reported",
					multiple(row.ratio),peerRange + (row.outlier ? " · outlier" : ""),
					row.flags.length ? row.flags.map(esc).join(" · ") : "—"
				]))}
	</section>`;
}

function assumptionsDrawer() {
	const label=k=> k.replace(/^[a-z]|[A-Z]/g,(c,i)=>i ? " " + c.toLowerCase() : c.toUpperCase());
	const display=v=> [v].flat().map(n=>Number.isInteger(n) ? integer(n) : esc(n)).join(" · ");
	const {parameters,chainQuotes,fallbackChain,mechanisms,families,notes}=assumptions;
	const blocks=[
		["Parameters",["Parameter","Value"],Object.entries(parameters).map(([k,v])=>[label(k),display(v)])],
		["Chain quotes",["Chain","Gas / action","Funding trip","Elapsed"],
			[...Object.entries(chainQuotes),["Other chains",fallbackChain]].map(([chain,[gas,fund,min]]) =>
				[chain,money(gas),money(fund),min + " min"])],
		["Mechanisms",["Family","Actions","Fees","Enter","Deposit"],Object.entries(mechanisms)
			.map(([family,[actions,bps,min,,guidance]])=>[family,actions,bps + " bps",min + " min",guidance])],
		["Category families",["Family","Categories"],Object.entries(families).map(([f,cats])=>[f,cats.replaceAll("|",", ")])]
	];
	return `<ul>${html(notes,note=>`<li>${esc(note)}`)}</ul>
		${html(blocks,([title,headers,rows])=>`<h3>${title}</h3>${facts(headers,rows)}`)}`;
}

let activeRoute;

function render() {
	const state=readRoute();
	const focus=document.activeElement?.id;
	const {route,slug}=state;
	const row=route === "detail" && model.rows.find(p=>encodeURIComponent(p.slug) === slug);
	renderNavigation(state);
	document.title = `${row?.name ?? titles[route]} · Launch Radar`;
	view.innerHTML = route === "detail" ? detail(row,state) : {board:boardShell,audit,calibration}[route](state);
	if (route === "board") renderBoard(state);
	if (focus) document.getElementById(focus)?.focus();
	if (activeRoute !== route) window.scrollTo(0,0);
	activeRoute = route;
}

$("#source").textContent = `Board digest ${boardDigest}`;
$("#checks").textContent = `${passed}/${checks.length} self-checks pass`;
$("#checks").dataset.pass = String(passed === checks.length);
$("#checks").title = checks.map(check=>`${check.name}: ${check.pass ? "pass" : "fail"}`).join("\n");
$("#assumption-content").innerHTML = assumptionsDrawer();
$("#open-assumptions").addEventListener("click",()=> $("#assumptions").showModal());

function updateBoard(state) {
	history.replaceState(null,"",link("board",state));
	renderNavigation(state);
	renderBoard(state);
}

view.addEventListener("input",({target})=> {
	if (target.id === "filter-q") updateBoard({...readRoute(),q:target.value});
	const form=target.form;
	if (form?.id !== "quote") return;
	const {plan}=bySlug.get(form.dataset.slug);
	const quote={...plan.quote};
	for (const input of form.querySelectorAll("input")) {
		const observed=input.validity.valid && Number.isFinite(input.valueAsNumber);
		input.nextElementSibling.textContent = observed ? "Quoted" : "Default";
		if (observed) quote[input.name] = input.valueAsNumber;
	}
	$("#quote-result").innerHTML = quoteResult(plan,quote,api.chooseFarm(plan,quote,+form.elements.horizon.value));
});

function renderNavigation(state) {
	$("#home-link").href = link("board",state);
	const active=state.route === "detail" ? "board" : state.route;
	$$("#nav a").forEach(a=> {
		a.href = link(a.dataset.route,state);
		a.setAttribute("aria-current",a.dataset.route === active ? "page" : "false");
	});
}

view.addEventListener("change",({target})=> {
	const {compare:slug}=target.dataset;
	const state=readRoute();
	if (slug) {
		state.compare = target.checked ? [...state.compare,slug].slice(0,3) : state.compare.filter(p=>p !== slug);
		const scroll=$("#results .scroll").scrollTop;
		updateBoard(state);
		$("#results .scroll").scrollTop = scroll;
		$("#" + target.id)?.focus({preventScroll:true});
	} else if (target.matches(".filters select")) {
		location.hash = link("board",{...state,[target.name]: target.value});
	}
});
window.addEventListener("hashchange",render);
render();
