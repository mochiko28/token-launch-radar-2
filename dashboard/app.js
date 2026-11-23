"use strict";

const api=globalThis.LaunchRadar,
	{snapshot,boardDigest}=globalThis.LaunchRadarData,
	model=api.buildModel(snapshot),
	$=selector=> document.querySelector(selector),
	$$=selector=> [...document.querySelectorAll(selector)];
const html=(items,draw)=>items.map(draw).join(""),
	view=$("#view"),
	checks=api.selfChecks(model,snapshot,boardDigest),
	passed=checks.filter(check=>check.pass).length,
	number=options=> new Intl.NumberFormat("en-US",options).format;
const integer=number({maximumFractionDigits:0}),
	currency={style:"currency",currency:"USD"},
	money=number(currency),
	shortUsd=number({...currency,notation:"compact",maximumFractionDigits:2}),
	usd=n=> "$" + integer(n);
const pct=(n,places = 2)=> (n * 100).toFixed(places) + "%",
	multiple=n=> n == null ? "—" : n.toFixed(2) + "×",
	sign=n=> n > 0 ? "+" : "",
	change=n=> n == null ? "—" : sign(n) + n.toFixed(2) + "%",
	net=n=> sign(n) + money(n);
const tone=n=> n > 0 ? "positive" : n < 0 ? "negative" : "";
const esc=value=> String(value ?? "").replace(/[&<>"']/g,c=> ({
	"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
})[c]);

const {rows,counts,verdicts,stress,portfolio,value,odds,assumptions}=model,
	{horizons}=assumptions.parameters,
	walk=odds.validation.walk,
	showAuc=sample=> sample.auc?.toFixed(3) ?? "—";
const timingNote=`${assumptions.timing} F walk-forward AUC ${showAuc(walk)} (n=${walk.n}).`,
	{baseline,selected,trials}=value.validation,
	valueTests=[["loo","Leave-one-out"],["walk","Walk-forward"],["family","Family hold-out"]],
	unique=items=> [...new Set(items)].sort(),
	families=unique(rows.map(p=>p.family)),chains=unique(rows.flatMap(p=>p.chains));
const ratings=["FARM","MARGINAL","SKIP"],
	farmRule="FARM at q ≥ 2p* with clear flags. MARGINAL from p*.",
	scenarios=[["doubleCost","2× cost"],["halfShare","½ share"]],
	oddsLabel="Token odds (snapshot status)";
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
const defaults={q:"",sort:"rank",...Object.fromEntries(filters.map(([,k,[first]])=>[k,first]))},
	titles={board:"Rankings",calibration:"Calibration",audit:"Top-20 audit",detail:"Protocol"},
	bySlug=new Map(rows.map(p=>[p.slug,p]));

function readRoute() {
	const [path,query]=location.hash.slice(1).split("?"),
		[route,slug]=path.split("/"),
		params=new URLSearchParams(query),
		sort=Object.hasOwn(columns,params.get("sort")) ? params.get("sort") : "rank",
		dir=params.get("dir");
	const state={route:Object.hasOwn(titles,route) ? route : "board",slug,sort,q:params.get("q") || "",
		dir:["asc","desc"].includes(dir) ? dir : direction(sort),
		compare:[...new Set(params.getAll("compare"))].filter(s=>bySlug.has(s)).slice(0,3)};
	for (const [,k,options] of filters) state[k] = options.includes(params.get(k)) ? params.get(k) : options[0];
	return state;
}

function link(route,state,slug="") {
	const params=new URLSearchParams();
	for (const key in defaults) if (state[key] !== defaults[key]) params.set(key,state[key]);
	for (const slug of state.compare) params.append("compare",slug);
	if (state.dir !== direction(state.sort)) params.set("dir",state.dir);
	return "#" + route + (slug ? "/" + slug : "") + (params.size ? "?" + params : "");
}

const badge=v=> `<span class="badge ${v.toLowerCase()}">${v}</span>`,
	href=(route,state,slug)=>esc(link(route,state,slug)),
	taggedLink=(p,state)=> `<a class=protocol href="${href("detail",state,encodeURIComponent(p.slug))}">${esc(p.name)}</a>`,
	days=row=> row.ageDays == null ? "—" : integer(row.ageDays);

const heading=(title,description="",label="",lead="")=> `<header class=heading><div>${label}<h1>${title}</h1>${lead}<p>${description}</div><div class=snapshot>DefiLlama<br><time>${esc(snapshot.as_of)} UTC</time></div></header>`;

function valueSummary() {
	const [intercept,slope]=value.fit.coefficients,
		unit=shortUsd(assumptions.parameters.tvlReference);
	return `<div class="readings misses">${html(valueTests,([key,label]) =>
		`<div><strong>${multiple(selected[key].miss)}</strong><small> / ${multiple(baseline[key].miss)}</small><span>${label}</span></div>`)}</div>
	<p class=curve>${shortUsd(Math.exp(intercept))} × (carried TVL / ${unit})<sup>${slope.toFixed(3)}</sup> · n=${counts.valueFit}`;
}

function kpis() {
	const groups=[["traded"],["recorded","token without cap"],["setAside","set aside"],["ranked"]],
		card=(title,body)=> `<div class="panel kpi"><h2>${title}</h2>${body}</div>`;
	return `<section class=kpis aria-label=Validation>
	${card("Snapshot coverage",`<strong>${counts.total}</strong>
	<div class=groups>${html(groups,([k,label=k])=>`<span><b>${counts[k]}</b> ${label}</span>`)}</div>`)}
	${card("Median held-out miss vs flat ratio",valueSummary())}
	${card(`${oddsLabel} · held-out AUC`,`<div class=readings>
	${html(valueTests.slice(0,2),([k,label])=>`<div><strong>${showAuc(odds.validation[k])}</strong><span>${label}</span></div>`)}</div><p>F uses TVL and age`)}
	${card("Watchlist coverage",`<strong>${counts.watchlistCovered}<small> / ${counts.watchlistTotal}</small></strong>
	<p>TVL floor ${shortUsd(snapshot.floor_usd)}`)}</section>`;
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

const bestFarms=rows.filter(({plan:p})=>p.pStar !== null && p.q >= p.pStar)
	.sort((a,b)=>b.plan.net - a.plan.net).slice(0,5);

function farmPanel(state) {
	return `<section class="panel inset best-farms"><p>${ratings.map(v=>`${verdicts[v]} ${v}`).join(" · ")} · ${farmRule}
	<h2>Best available farms</h2>${html(bestFarms,p=>{
		const {chain,capital,horizon,q,pStar,net:gain,cost,handsOnMinutes}=p.plan;
		return `<div><b class=positive>${net(gain)} net</b>${taggedLink(p,state)}
		<small>${esc(chain.name)} · ${usd(capital)} · ${horizon} d · ${money(cost)} cost<br>q ${pct(q)} vs p* ${pct(pStar)} · ${handsOnMinutes} min hands-on</small></div>`;
	}) || "No plans clear break-even."}</section>`;
}

function boardShell(state) {
	return `${heading("Pre-token rankings","Farm horizons · 30–365 days")}
	${kpis()}${state.scope === "watchlist" ? portfolioStrip(state) : ""}
	<div class=board-grid><section class=panel>
	<div class=section-head><h2>Ranked protocols</h2><div class=board-status role=status><span id=row-count></span><span id=row-check></span></div></div>
	<div class=filters><label>Search<input id=filter-q type=search value="${esc(state.q)}" autocomplete=off></label>
	${html(filters,spec=>filter(spec,state))}</div>
	<div id=comparison></div><div id=results></div>
	</section><aside class=board-aside>
	${farmPanel(state)}
	<section class="panel inset"><h2>Expected yield by age</h2>
	<div id=yield-chart></div>
	<div class=chart-key>${html(ratings,v=>`<span class=${v.toLowerCase()}-dot>${v}</span>`)}</div>
	</section></aside></div>`;
}

function matchingRows(state) {
	const {scope,family,chain,verdict,flag,tvl}=state,
		query=state.q.trim().toLowerCase();
	return rows.filter(p=>(!query || `${p.name} ${p.slug}`.toLowerCase().includes(query))
		&& (scope !== "watchlist" || p.watchlist) && (!family || p.family === family)
		&& (!chain || p.chains.includes(chain)) && (!verdict || p.plan.verdict === verdict)
		&& p.tvl_usd >= Number(tvl) && (!flag || !!p.flags.length === (flag === "flagged"))
	).sort((a,b)=> compareRows(a,b,state));
}

function compareRows(a,b,state) {
	const field=columns[state.sort][1],
		read=typeof field === "function" ? field : p=>p[field],
		x=read(a),y=read(b);
	if (x == null || y == null) return Number(x == null) - Number(y == null) || a.rank - b.rank;
	return (typeof x === "string" ? x.localeCompare(y) : x - y) * (state.dir === "asc" ? 1 : -1) || a.rank - b.rank;
}

const factorText=(value, odds, issuer)=> `${shortUsd(value)} × ${pct(odds, 1)} × ${issuer}`;

function tableRow(row,state) {
	const {slug,score,launchValue,tokenOdds,haircut,rank,plan,category,family,watchlist,tvl_usd,change_7d}=row,
		picked=state.compare.includes(slug),key=esc(slug);
	return `<tr data-slug="${key}" data-value=${score} data-launch=${launchValue} data-odds=${tokenOdds} data-issuer=${haircut}>
	<td class=rank>${rank}
	<th scope=row>${taggedLink(row,state)}${row.flags.length ? " <span title='Issuer flag'>!</span>" : ""}
	<small>${esc(category || family)}${watchlist ? " <span class=watch-label title=Watchlist aria-label=Watchlist>◆</span>" : ""}
	<td title="${usd(score)}"><b>${shortUsd(score)}</b>
	<small>${factorText(launchValue,tokenOdds,haircut)}</small>
	<td>${pct(tokenOdds,1)}<td>${shortUsd(tvl_usd)}
	<td class="${tone(change_7d)}">${change(change_7d)}
	<td>${days(row)}
	<td>${badge(plan.verdict)}<td>${net(plan.net)}<small>${plan.horizon} d${plan.verdict === "SKIP" ? ` · needs ${api.oddsFactor(plan.pay.targets[0].oddsRatio)} odds` : ""}</small>
	<td><input type=checkbox data-compare="${key}" id=pick-${rank} aria-label="Compare ${esc(row.name)}"${picked ? " checked" : state.compare.length === 3 ? " disabled" : ""}>`;
}

function comparison(state) {
	const picks=state.compare.map(slug=>bySlug.get(slug));
	if (!picks.length) return '<p class=compare-hint>Compare up to 3 protocols.';
	const update=(compare,label,title=label)=> `<a class=button href="${href("board",{...state,compare})}" title="${esc(title)}">${label}</a>`,
		headers=picks.map(p=>taggedLink(p,state) + " " + update(state.compare.filter(s=>s !== p.slug),"×",`Remove ${p.name}`));
	const metrics=[
		["Value",p=>shortUsd(p.score)],[oddsLabel,p=>pct(p.tokenOdds)],["TVL",p=>shortUsd(p.tvl_usd)],
		["7d TVL",p=>change(p.change_7d)],["Days listed",days],["Verdict",p=>badge(p.plan.verdict)],
		["Capital",p=>usd(p.plan.capital)],["Expected net",p=>net(p.plan.net)]
	];
	return `<section class=compare-panel><div class=section-head><h2>Compare</h2>${update([],"Clear")}</div>
		${facts(["Metric",...headers],metrics.map(([label,read])=>[label,...picks.map(read)]))}</section>`;
}

function verifyRows(rows,state) {
	const rendered=$$("#results tbody tr"),
		board=model.board.rows,digest=api.digest(board);
	let sorted=rendered.length === rows.length && (!rows.length || !!$(`[aria-sort=${ariaSort(state)}] #sort-${state.sort}`));
	const fields=["rank","implied_value_usd","launch_value_usd","token_odds","issuer_factor"];
	const matched=rendered.filter((tr,i)=>{
		const {slug,value,launch,odds,issuer}=tr.dataset,
			row=bySlug.get(slug),saved=board[row?.rank - 1];
		sorted &&= row === rows[i] && (!i || compareRows(rows[i - 1],row,state) <= 0);
		if (saved?.slug !== slug) return false;
		const {score,launchValue:base,tokenOdds:s,haircut:factor}=row,
			[rankCell,,cell,oddsCell]=tr.cells;
		return [+rankCell?.textContent,+value,+launch,+odds,+issuer].every((v,j)=> v === saved[fields[j]])
			&& cell?.title === usd(score) && cell.querySelector("b")?.textContent === shortUsd(score)
			&& cell.querySelector("small")?.textContent === factorText(base,s,factor) && oddsCell?.textContent === pct(s,1);
	}).length;
	const check=$("#row-check"),
		sameDigest=digest === boardDigest;
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
			const active=key === state.sort,
				dir=active ? state.dir === "asc" ? "desc" : "asc" : direction(key);
			return `<th scope=col${active ? ` aria-sort=${ariaSort(state)}` : ""}>
	<a id=sort-${key} href="${href("board",{...state,sort:key,dir})}">${label}${active ? ` <span aria-hidden=true>${dir === "desc" ? "↑" : "↓"}</span>` : ""}</a>`;
		})}<th scope=col>Compare<tbody>${html(rows,row=>tableRow(row,state))}</table></div>`
		: '<p class=empty>No matching protocols.';
	verifyRows(rows,state);
	$("#yield-chart").innerHTML = yieldChart(rows);
	$("#comparison").innerHTML = comparison(state);
}

function yieldChart(rows) {
	const points=rows.filter(row=>row.ageDays != null && Number.isFinite(row.plan.expectedYield));
	if (!points.length) return '<p class=chart-note>No listing dates.';
	const maxDays=Math.ceil(Math.max(...points.map(p=>p.ageDays)) / 100) * 100,
		yields=points.map(p=>p.plan.expectedYield * 100),
		low=Math.floor(Math.min(0,...yields)),high=Math.ceil(Math.max(1,...yields)),
		x=days=> 36 + 239 * days / maxDays,
		y=rate=> 130 - 120 * (rate * 100 - low) / (high - low);
	return `<svg viewBox="0 0 288 170" role=img aria-label="Age vs expected yield">
	${html([0,1,2,3],i=>`<path d="M36,${130 - i * 40}H275"/><text x=29 y=${134 - i * 40} text-anchor=end>${+(low + i * (high - low) / 3).toFixed(1)}%</text>`)}
	${html(["start","middle","middle","end"],(anchor,i)=>{
		const days=i * maxDays / 3,at=x(days);
		return `<path d="M${at},10V130"/><text x=${at} y=148 text-anchor=${anchor}>${integer(days)}</text>`;
	})}
	${html(points.reverse(),({plan,ageDays,name})=>`<circle class=${plan.verdict.toLowerCase()}-dot cx=${x(ageDays)} cy=${y(plan.expectedYield)} r=3.1>
	<title>${esc(name)} · ${ageDays} days · ${pct(plan.expectedYield)}</title></circle>`)}
	<text x=156 y=167 text-anchor=middle>Days without a recorded token</text>
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
	const ref=model.reference,
		labels=["TVL size","7d carry","Age on odds","Issuer","Family","Rounding"],
		show=n=> n.toFixed(3) + "×",
		factors=Object.values(row.attribution).map(show);
	return `<div class=attribution><p><b>${show(row.score / ref.score)}</b> vs median #${ref.rank} ${esc(ref.name)} (${usd(ref.score)})
	<dl>${html(labels,(label,i)=>i < 4 || factors[i] !== "1.000×" ? metric(label,factors[i]) : "")}</dl></div>`;
}

const quoteFields=[
	["entryGas","Entry gas $",1e6],["exitGas","Exit gas $",1e6],["slippage","Slippage %",100],
	["delay","Exit delay (d)",36500],["lockup","Lockup days",36500]
];
const reachable=(n,format)=> n === null ? "Unreachable" : format(n);
function payLine({pay,horizon,capped}) {
	const [marginal,farm]=pay.targets.map(t=>`q ${reachable(t.odds,pct)} (${api.oddsFactor(t.oddsRatio)}) or drop ${reachable(t.drop,money)} (${multiple(t.dropRatio)})`);
	return `<p class=pay><b>What would make it pay</b> · Base ${horizon} d${capped ? " · Clear flags for FARM" : ""}
	<br>MARGINAL ${marginal} · all-in base cost ≤ ${reachable(pay.maxCost,money)}<br>FARM ${farm}`;
}

function quoteResult(plan,quote=plan.quote,result=plan) {
	const {horizon,q,capital,noToken,withToken,pStar,gas,fees,timeCost,holding,capitalCharge,drop,claimSell,verdict}=result,
		half=api.evaluateFarm(plan,capital,{quote,horizon,q:q / 2}),
		{riskFreeRate,hourlyUsd}=assumptions.parameters;
	return `<div class=outcomes>
	<div><h3>No token <b>${money(noToken)}</b></h3><p>Gas ${money(gas)} · fees ${money(fees)}
	<p>Time ${money(timeCost)} at ${usd(hourlyUsd)}/h
	<p>Capital ${money(capitalCharge)} · ${holding}d at ${pct(riskFreeRate,0)}/yr
	</div><div><h3>Token <b>${net(withToken)}</b></h3><p>Drop ${money(drop)} − claim &amp; sell ${money(claimSell)}
	<p>Less ${money(-noToken)} cost
	<p>Net APR ${pct(result.conditionalApr)}</div>
	</div>
	<dl class=metrics>${metric("Capital",usd(capital))}
	${metric(`Launch within ${horizon} d (q)`,pct(q))}
	${metric("Break-even p*",reachable(pStar,pct))}
	${metric("Expected net",net(result.net),tone(result.net))}
	${metric("Quote verdict",badge(verdict))}</dl>
	<p class=half-odds>Half q (${pct(q / 2)}) gives ${net(half.net)} and ${badge(half.verdict)}.`;
}

function quotePanel({plan,slug}) {
	return inset("Cash flows &amp; quotes",`<div class=quote>
	<div id=quote-result aria-live=polite>${quoteResult(plan)}</div>
	${payLine(plan)}
	<p>${timingNote}
	<form id=quote data-slug="${esc(slug)}" class=quote-fields>
	<label>Horizon<select name=horizon><option value=0>Auto${html(horizons,h=>`<option value=${h}>${h} days`)}</select></label>
		${html(quoteFields,([key,label,max])=>`<label>${label}
	<input name=${key} type=number step=any min=0 max=${max} placeholder=${plan.quote[key]}>
	<small>Default</small></label>`)}
	</form>
	</div>`);
}

function decisionTree(steps) {
	const labels=["1 Verify","2a Wait","2b Stop","2c Withdrawal rehearsal","3a Stop","3b Decide on entry","4 Monitor","5 Withdraw","6 Claim &amp; sell","7 Revisit"],
		step=(label,body,terms,follow)=>`<li><div><h3>${label}</h3><p>${esc(body)}${follow ? ` <span>${esc(follow)}</span>` : ""}</div><small>${esc(terms)}</small>`;
	return `<ol class=plan-steps>${html(steps,([body,terms,follow,fallback,extra],i)=>
		step(labels[i],body,terms,follow) +
		(fallback ? step("3c Wait",fallback,extra) : ""))}</ol>`;
}

function detail(row,state) {
	const back=`<a class=back-link href="${href("board",state)}">← Back to rankings</a>`;
	if (!row) return back + heading("Protocol unavailable");
	const plan=row.plan,
		age=row.ageDays == null ? "Undated" : days(row) + " days listed",
		summary=`${esc(row.category || row.family)} · ${shortUsd(row.tvl_usd)} TVL · ${change(row.change_7d)} 7d · ${age}`,
		label=`<p class=detail-label>Rank ${row.rank}/${counts.ranked}${row.watchlist ? " · ◆ Watchlist" : ""}</p>`,
		lead=`<p class=verdict-summary>${badge(plan.verdict)} · ${esc(plan.ticket)} on ${esc(plan.chain.name)} · Launch within ${plan.horizon} d: ${pct(plan.q)} (q) vs p* ${reachable(plan.pStar,pct)} · ${net(plan.net)} expected`;
	const stressRows=[[null,"Base"],...scenarios].map(([key,label])=>{
		const p=plan.stress[key] ?? plan,
			counts=key ? ratings.map(v=>`${stress[key].all[v]} (${stress[key].farm[v]})`) : Object.values(verdicts);
		return [label,usd(p.capital),badge(p.verdict),net(p.net),counts.join(" / ")];
	});
	const range=(low,high)=> shortUsd(low) + "–" + shortUsd(high),
		factors=[[usd(row.launchValue),"Value if launched"],[pct(row.tokenOdds),oddsLabel],[row.haircut.toFixed(2),"Issuer factor"]];
	return `${back}${heading(esc(row.name),summary,label,lead)}
	<div class=detail-grid><div class=detail-aside>
	${inset("Farm decision tree",`<p>${row.family} on ${esc(plan.chain.name)}${decisionTree(plan.steps)}`)}
	${inset(`Stress · ${plan.horizon} d · re-sized capital`,facts(["Scenario","Capital","Verdict","Expected net","Board F / M / S"],stressRows) + "<small>Base FARM in parentheses.</small>")}
	</div><div class=detail-aside>
	${quotePanel(row)}
	<section class="panel valuation">
	<h2>Implied token value</h2><div class=large-value>${usd(row.score)}</div>
	<div class=equation>${factors.map(([n,label])=>`<div><b>${n}</b><small>${label}</small></div>`).join("×")}</div>
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
	const label=k=> k.replace(/^[a-z]|[A-Z]/g,(c,i)=>i ? " " + c.toLowerCase() : c.toUpperCase()),
		display=v=> [v].flat().map(n=>Number.isInteger(n) ? integer(n) : esc(n)).join(" · "),
		{parameters,chainQuotes,fallbackChain,mechanisms,families,notes}=assumptions;
	const blocks=[
		["Parameters",["Parameter","Value"],Object.entries(parameters).map(([k,v])=>[label(k),display(v)])],
		["Chain quotes",["Chain","Gas / action","Funding trip","Elapsed"],
			[...Object.entries(chainQuotes),["Other chains",fallbackChain]].map(([chain,[gas,fund,min]]) =>
				[chain,money(gas),money(fund),min + " min"])],
		["Mechanisms",["Family","Actions","Fees","Time","Deposit"],Object.entries(mechanisms)
			.map(([family,[actions,bps,min,,guidance]])=>[family,actions,bps + " bps",min + " min",guidance])],
		["Families",["Family","Categories"],Object.entries(families).map(([f,cats])=>[f,cats.replaceAll("|",", ")])]
	];
	return `<ul>${html(notes,note=>`<li>${esc(note)}`)}</ul>
		${html(blocks,([title,headers,rows])=>`<h3>${title}</h3>${facts(headers,rows)}`)}`;
}

let activeRoute;

function render() {
	const state=readRoute(),
		focus=document.activeElement?.id,
		{route,slug}=state,
		row=route === "detail" && rows.find(p=>encodeURIComponent(p.slug) === slug);
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
	const {plan}=bySlug.get(form.dataset.slug),
		quote={...plan.quote};
	for (const input of form.querySelectorAll("input")) {
		const observed=input.validity.valid && Number.isFinite(input.valueAsNumber);
		input.nextElementSibling.textContent = observed ? "Quoted" : "Default";
		if (observed) quote[input.name] = input.valueAsNumber;
	}
	$("#quote-result").innerHTML = quoteResult(plan,quote,api.chooseFarm(plan,quote,+form.elements.horizon.value));
});

function renderNavigation(state) {
	$("#home-link").href = link("board",state);
	for (const a of $$("#nav a")) {
		const {route}=a.dataset;
		a.href = link(route,state);
		a.ariaCurrent = route === (state.route === "detail" ? "board" : state.route) ? "page" : "false";
	}
}

view.addEventListener("change",({target})=> {
	const {compare:slug}=target.dataset,
		state=readRoute();
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
