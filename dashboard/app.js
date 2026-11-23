"use strict";
{
const api=globalThis.LaunchRadar,
	{snapshot,boardDigest}=globalThis.LaunchRadarData,
	model=api.buildModel(snapshot),
	$=selector=>document.querySelector(selector),
	$$=selector=>[...document.querySelectorAll(selector)];
const html=(items,draw)=>items.map(draw).join(""),
	view=$("#view"),check=$("#checks"),
	checks=fromEntries(api.selfChecks(model,snapshot,boardDigest).map(({name,pass})=>[name,pass])),
	passed=count(values(checks),Boolean),total=keys(checks).length,
	allPass=passed===total,selfCount=`${passed}/${total}`,
	number=options=>new Intl.NumberFormat("en-US",options).format;
const currency={style:"currency",currency:"USD"},
	money=number(currency),
	shortUsd=number({...currency,notation:"compact",maximumFractionDigits:2}),
	usd=whole;
const pct=percent,
	hit=n=>n==null?"—":pct(n,0),
	hits=({hits:[two,three]})=>`3× ${hit(three)} · 2× ${hit(two)}`,
	multiple=(n,places=2)=>n==null?"—":n.toFixed(places)+"×",
	sign=n=>n>0?"+":"",
	change=n=>n==null?"—":sign(n)+n.toFixed(2)+"%",
	net=n=>sign(n)+money(n);
const tone=n=>n>0?"positive":n<0?"negative":"";
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({
	"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
})[c]);
const {rows,counts,verdicts,stress,portfolio,value,odds,assumptions,board:{rows:board}}=model,
	hash=api.digest(board),sameDigest=hash===boardDigest,
	{parameters:{horizons,tvlReference,riskFreeRate,hourlyUsd}}=assumptions,auc=odds.validation,
	{loo,walk}=auc,
	showAuc=sample=>sample.auc?.toFixed(3)??"—";
const timingNote=`${assumptions.timing} F walk-forward AUC ${showAuc(walk)} (n=${walk.n}).`,
	valueTests=[["loo","Leave-one-out"],["walk","Walk-forward"],["family","Family hold-out"]],
	oddsTests=valueTests.slice(0,2),
	{baseline,selected,trials,evidence,search}=value.validation,
	groups=[["traded"],["recorded","token without cap"],["setAside","set aside"],["ranked"]],
	families=unique(rows.map(p=>p.family)).sort(),chains=unique(rows.flatMap(p=>p.chains)).sort();
const ratings=keys(verdicts),
	scenarios=[["doubleCost","2× cost"],["halfShare","½ share"]],
	oddsLabel="Token status odds";
const columns={
	rank:["Rank","rank","asc"],name:["Protocol","name","asc"],
	value:["Implied value","score"],odds:[oddsLabel,"tokenOdds"],tvl:["TVL","tvl_usd"],
	growth:["7d TVL","change_7d"],days:["Days listed","ageDays"],
	verdict:["Verdict",p=>ratings.indexOf(p.plan.verdict),"asc"],net:["Expected net",p=>p.plan.net]
};
const direction=key=>columns[key][2]||"desc",flip=dir=>dir==="asc"?"desc":"asc";
const filters=[
	["Scope","scope",["all","watchlist"],"All ranked","Watchlist"],
	["Family","family",["",...families],"All families"],
	["Verdict","verdict",["",...ratings],"All verdicts"],
	["Chain","chain",["",...chains],"All chains"],
	["Min TVL","tvl",["",1e7,5e7,1e8,5e8].map(String),"Any TVL"],
	["Issuer","flag",["","flagged","clear"],"Any issuer","Flagged","No flags"]
];
const defaults={q:"",sort:"rank",...fromEntries(filters.map(([,k,[first]])=>[k,first]))},
	titles={board:"Rankings",calibration:"Calibration",audit:"Top-20 audit",detail:"Protocol"},
	bySlug=new Map(rows.map(p=>[p.slug,p]));

function readRoute(){
	const [path,query]=location.hash.slice(1).split("?"),[route,slug]=path.split("/"),
		params=new URLSearchParams(query),sort=params.get("sort"),dir=params.get("dir"),
		state={route:hasOwn(titles,route)?route:"board",slug,q:params.get("q")||"",sort:hasOwn(columns,sort)?sort:"rank",
		compare:unique(params.getAll("compare")).filter(s=>bySlug.has(s)).slice(0,3)};
	state.dir=["asc","desc"].includes(dir)?dir:direction(state.sort);
	for(const [,key,options] of filters) state[key]=options.find(x=>x===params.get(key))??options[0];
	return state;
}

function link(route,state,slug=""){
	const params=new URLSearchParams();
	for(const key in defaults) if(state[key]!==defaults[key]) params.set(key,state[key]);
	for(const slug of state.compare) params.append("compare",slug);
	if(state.dir!==direction(state.sort)) params.set("dir",state.dir);
	return "#"+route+(slug?"/"+slug:"")+(params.size?"?"+params:"");
}
const badge=v=>`<span class="badge ${v.toLowerCase()}">${v}</span>`,
	href=(route,state,slug)=>esc(link(route,state,slug)),
	taggedLink=(p,state)=>`<a class=protocol href="${href("detail",state,encodeURIComponent(p.slug))}">${esc(p.name)}</a>`,
	days=row=>row.ageDays==null?"—":integer(row.ageDays);

const intro=(title,description="",lead="",label="")=>`<header class=intro><div>${label}<h1>${title}</h1>${lead}<p>${description}</div><div class=snapshot>DefiLlama<br><time>${esc(snapshot.as_of)} UTC</time></div></header>`,
	missTitle="Median held-out miss vs flat ratio",
	panel=(kind,title,body)=>`<section class="panel ${kind}">${title?`<h2>${title}</h2>`:""}${body}</section>`,
	card=(title,body)=>panel("kpi",title,body),inset=(title,body)=>panel("inset",title,body);

function valueSummary(){
	const [intercept,slope]=value.fit.coefficients;
	return`<div class="readings misses">${html(valueTests,([key,label]) =>
		`<div><span>${label}</span><strong>${multiple(selected[key].miss,3)}</strong> / ${multiple(baseline[key].miss)}<small>${hits(selected[key])}</small></div>`)}</div>
<p class=curve>${shortUsd(exp(intercept))} × (carried TVL / ${shortUsd(tvlReference)})<sup>${slope.toFixed(3)}</sup> · n=${counts.valueFit}`;
}

const kpis=()=>`<section class=kpis aria-label=Validation>
${card("Snapshot coverage",`<strong>${counts.total}</strong>
<div class=groups>${html(groups,([k,label=k])=>`<span><b>${counts[k]}</b> ${label}</span>`)}</div>`)}
${card(missTitle,valueSummary())}
${card(`${oddsLabel} · held-out AUC`,`<div class=readings>${html(oddsTests,([k,label])=>
	`<div><strong>${showAuc(auc[k])}</strong><span>${label}</span></div>`)}</div><p>TVL + age`)}
${card("Watchlist coverage",`<strong>${counts.watchlistCovered}<small> / ${counts.watchlistTotal}</small></strong>
<p>TVL floor ${shortUsd(snapshot.floor_usd)}`)}</section>`;

const filter=([label,key,options,...titles],state)=>`<label>${label}<select id=filter-${key} name=${key}>${html(options,(option,i)=>
	`<option value="${esc(option)}"${option===state[key]?" selected":""}>${esc(titles[i]??(key==="tvl"?shortUsd(option)+"+":option))}`
)}</select></label>`;

function portfolioStrip(state){
	const {positions,capital,cost,net:gain,unallocated,eligible,budget}=portfolio;
	return`<section class=portfolio>
<div><h2>${shortUsd(budget)} watchlist portfolio</h2>
<p>${positions.length}/${eligible} FARM · Shared upkeep
<p>${unallocated?usd(unallocated)+" unallocated":"Score-weighted surplus"}</div>
<div class=positions>${html(positions,p=>`<div>${taggedLink(p,state)}
<small>${usd(p.capital)} capital</small><small>${money(p.cost)} cost · ${net(p.net)} net</small></div>`)}</div>
	${metrics([["Capital",usd(capital)],["Cost",money(cost)],["Expected net",net(gain),tone(gain)]],"totals")}</section>`;
}

const bestFarms=rows.filter(({plan:p})=>p.pStar!==null&&p.q>=p.pStar)
	.sort((a,b)=>b.plan.net-a.plan.net).slice(0,5);

function farmPanel(state){
	return`<section class="panel inset best-plans"><p>${ratings.map(v=>`${verdicts[v]} ${v}`).join(" · ")} · FARM at q ≥ 2p* with clear flags. MARGINAL from p*.
<h2>Best plans that clear break-even</h2>${html(bestFarms,p=>{
		const {chain,capital,horizon,q,pStar,net:gain,cost,handsOnMinutes,verdict}=p.plan;
		return`<div><b class=positive>${net(gain)} net</b>${taggedLink(p,state)} ${badge(verdict)}
<small>${esc(chain.name)} · ${usd(capital)} · ${horizon} d · ${money(cost)} cost<br>q ${pct(q)} vs p* ${pct(pStar)} · ${handsOnMinutes} min hands-on</small></div>`;
	})||"No plans clear break-even."}</section>`;
}

const boardShell=state=>`${intro("Pre-token rankings","Farm horizons · 30–365 days")}
<div class=integrity role=group aria-label=Integrity></div>
	${kpis()}${state.scope==="watchlist"?portfolioStrip(state):""}
<div class=board><section class=panel>
<div class=toolbar><h2>Ranked protocols</h2><small id=shown role=status></small></div>
<div class=filters><label>Search<input id=search type=search value="${esc(state.q)}" autocomplete=off></label>
	${html(filters,spec=>filter(spec,state))}</div>
<div id=comparison></div><div id=results></div>
</section><aside class=rail>
	${farmPanel(state)}
${inset("Expected yield by age",`<div id=yield-chart></div>
<div class=legend>${html(ratings,v=>`<span class=${v.toLowerCase()}-dot>${v}</span>`)}</div>`)}
</aside></div>
<details class="panel inset" id=checks-info><summary>Integrity</summary><ul>
<li>Export rows and digest
<li>Groups, watchlist, order, plan cost and time
<li>Value vs flat and AUC vs 0.500
</ul></details>`;

function matchingRows(state){
	const {scope,family,chain,verdict,flag,tvl}=state,
		query=state.q.trim().toLowerCase();
	return rows.filter(p=>(!query||`${p.name} ${p.slug}`.toLowerCase().includes(query))
		&&(scope!=="watchlist"||p.watchlist)&&(!family||p.family===family)
		&&(!chain||p.chains.includes(chain))&&(!verdict||p.plan.verdict===verdict)
		&&p.tvl_usd>=Number(tvl)&&(!flag||!!p.flags.length===(flag==="flagged"))
	).sort((a,b)=>compareRows(a,b,state));
}

function compareRows(a,b,{sort,dir}){
	const field=columns[sort][1],
		read=typeof field==="function"?field:p=>p[field],
		x=read(a),y=read(b);
	if(x==null||y==null) return Number(x==null)-Number(y==null)||a.rank-b.rank;
	return(typeof x==="string"?x.localeCompare(y):x-y)*(dir==="asc"?1:-1)||a.rank-b.rank;
}

const showOdds=n=>pct(n,1),
	factorText=(value,odds,issuer)=>`${shortUsd(value)} × ${showOdds(odds)} × ${issuer}`;

function tableRow(row,state){
	const {slug,score,launchValue,tokenOdds,haircut,rank,plan,category,family,watchlist,tvl_usd,change_7d}=row,
		picked=state.compare.includes(slug),key=esc(slug);
	return`<tr data-slug="${key}" data-factors=${[score,launchValue,tokenOdds,haircut]}>
<td class=rank>${rank}
<th scope=row>${taggedLink(row,state)}${row.flags.length?" <span title='Issuer flag'>!</span>":""}
<small>${esc(category||family)}${watchlist?" <span class=watch title=Watchlist aria-label=Watchlist>◆</span>":""}
<td title="${usd(score)}"><b>${shortUsd(score)}</b>
<small>${factorText(launchValue,tokenOdds,haircut)}</small>
<td>${showOdds(tokenOdds)}<td>${shortUsd(tvl_usd)}
<td class="${tone(change_7d)}">${change(change_7d)}
<td>${days(row)}
<td>${badge(plan.verdict)}<td>${net(plan.net)}<small>${plan.horizon} d${plan.verdict==="SKIP"?` · needs ${api.oddsFactor(plan.pay.targets[0].oddsRatio)} odds`:""}</small>
<td><input type=checkbox data-compare="${key}" id=pick-${rank} aria-label="Compare ${esc(row.name)}"${picked?" checked":state.compare.length===3?" disabled":""}>`;
}

function comparison(state){
	const picks=state.compare.map(slug=>bySlug.get(slug));
	if(!picks.length) return '<p class=hint>Compare up to 3 protocols.';
	const update=(compare,label,title=label)=>`<a class=button href="${href("board",{...state,compare})}" title="${esc(title)}">${label}</a>`,
		headers=picks.map(p=>taggedLink(p,state)+" "+update(state.compare.filter(s=>s!==p.slug),"×",`Remove ${p.name}`));
	const metrics=[["Value",p=>shortUsd(p.score)],[oddsLabel,p=>pct(p.tokenOdds)],["TVL",p=>shortUsd(p.tvl_usd)],
		["7d TVL",p=>change(p.change_7d)],["Days listed",days],["Verdict",p=>badge(p.plan.verdict)],
		["Capital",p=>usd(p.plan.capital)],["Expected net",p=>net(p.plan.net)]];
	return`<section class=compare><div class=toolbar><h2>Compare</h2>${update([],"Clear")}</div>
		${facts(["Metric",...headers],metrics.map(([label,read])=>[label,...picks.map(read)]))}</section>`;
}

function verifyRows(rows,state){
	const rendered=$$("#results tbody tr"),
		sorted=rendered.length===rows.length&&(!rows.length||$(`[aria-sort=${ariaSort(state)}] #sort-${state.sort}`))
			&&rendered.every((tr,i)=>tr.dataset.slug===rows[i].slug);
	const matched=count(rendered,tr=>{
		const [rank,,value,odds]=tr.cells,p=board[rank?.textContent-1];
		if(!p||p.slug!==tr.dataset.slug) return false;
		const {implied_value_usd:score,launch_value_usd:base,token_odds:s,issuer_factor:factor}=p;
		return tr.dataset.factors===[score,base,s,factor].join()&&value?.title===usd(score)
			&&value.firstElementChild?.textContent===shortUsd(score)&&odds?.textContent===showOdds(s)
			&&value.lastElementChild?.textContent===factorText(base,s,factor);
	});
	renderIntegrity(matched,rows.length,sorted&&matched===rows.length);
}

function renderIntegrity(matched,total,rowsPass){
	const {ranked,watchlistCovered,watchlistTotal}=counts,
		ordered=api.orderedRows(board),costed=count(board,p=>api.validSteps(p.farm_steps)),
		miss=(key,label)=>{
			const sample=selected[key],b=baseline[key];
			return[sample.n&&sample.miss<b.miss,`${label} ${multiple(sample.miss)} · ${hits(sample)}`];
		};
	$(".integrity").innerHTML=html([
		[rowsPass&&sameDigest,`Rows match board.json ${matched}/${total}`],
		[sameDigest,`Hash ${hash}`],
		[checks["group counts"],`${counts.total}=${groups.map(([k])=>counts[k]).join("+")}`],
		[checks.coverage,`Watchlist ${watchlistCovered}/${watchlistTotal}`],
		[checks.sorted_by_value&&ordered===ranked,`Sorted ${ordered}`],
		miss("loo","Value LOO"),miss("walk","Walk"),
		[loo.auc>.5&&walk.auc>.5,`AUC ${showAuc(loo)}/${showAuc(walk)}`],
		[checks.farm_steps&&costed===ranked,`Plans ${costed}`],
		[allPass,`Checks ${selfCount}`]
	],([ok,label])=>`<button class=chip data-pass=${ok}>${ok?"✓":"✗"} ${label}</button>`);
}

const ariaSort=state=>state.dir==="asc"?"ascending":"descending";

function renderBoard(state){
	const rows=matchingRows(state);
	$("#shown").textContent=`${rows.length} of ${state.scope==="watchlist"?counts.watchlistCovered:counts.ranked} shown`;
	const headers=html(entries(columns),([key,[label]])=>{
		const active=key===state.sort,
			dir=active?flip(state.dir):direction(key);
			return`<th scope=col${active?` aria-sort=${ariaSort(state)}`:""}>
<a id=sort-${key} href="${href("board",{...state,sort:key,dir})}">${label}${active?` <span aria-hidden=true>${dir==="desc"?"↑":"↓"}</span>`:""}</a>`;
	})+"<th scope=col>Compare";
	$("#results").innerHTML=rows.length?table("ranks",headers,html(rows,row=>tableRow(row,state))," role=region aria-label=Rankings")
		:"<p class=empty>No matching protocols.";
	verifyRows(rows,state);
	$("#yield-chart").innerHTML=yieldChart(rows);
	$("#comparison").innerHTML=comparison(state);
}

function yieldChart(rows){
	const points=rows.filter(row=>row.ageDays!=null&&Number.isFinite(row.plan.expectedYield));
	if(!points.length) return '<p>No listing dates.';
	const maxDays=ceil(max(...points.map(p=>p.ageDays))/100)*100,
		yields=points.map(p=>p.plan.expectedYield*100),
		low=floor(min(0,...yields)),high=ceil(max(1,...yields)),
		x=days=>36+239*days/maxDays,
		y=rate=>130-120*(rate*100-low)/(high-low);
	return`<svg viewBox="0 0 288 170" role=img aria-label="Age vs expected yield">
	${html(["start","middle","middle","end"],(anchor,i)=>{
		const days=i*maxDays/3,at=x(days),y=130-i*40,rate=+(low+i*(high-low)/3).toFixed(1);
		return`<path d="M36,${y}H275M${at},10V130"/><text x=29 y=${y+4} text-anchor=end>${rate}%</text>
<text x=${at} y=148 text-anchor=${anchor}>${integer(days)}</text>`;
	})}
	${html(points.reverse(),({plan,ageDays,name})=>`<circle class=${plan.verdict.toLowerCase()}-dot cx=${x(ageDays)} cy=${y(plan.expectedYield)} r=3.1>
<title>${esc(name)} · ${ageDays} days · ${pct(plan.expectedYield)}</title></circle>`)}
<text x=156 y=167 text-anchor=middle>Days without a recorded token</text>
</svg><p>${points.length} plotted${rows.length>points.length?` · ${rows.length-points.length} undated`:""}`;
}

const metrics=(items,kind="")=>`<dl class="${kind}">${html(items,([label,reading,style=""])=>
	`<div><dt>${label}<dd class="${style}">${reading}</div>`)}</dl>`,
	table=(kind,headers,body,attrs="")=>`<div class=scroll tabindex=0${attrs}><table class=${kind}><thead><tr>${headers}<tbody>${body}</table></div>`,
	facts=(headers,rows)=>table("facts",html(headers,title=>`<th scope=col>${title}`),
		html(rows,([first,...cells])=>`<tr><th scope=row>${first}${html(cells,cell=>`<td>${cell}`)}`));

function valueAttribution(row){
	const {rank,name,score}=model.reference,
		labels=["TVL size","7d carry","Age on odds","Issuer","Family","Rounding"],
		show=n=>n.toFixed(3)+"×",
		factors=values(row.attribution).map(show);
	return`<div class=attribution><p><b>${show(row.score/score)}</b> vs median #${rank} ${esc(name)} (${usd(score)})
	${metrics(labels.map((label,i)=>[label,factors[i]]).filter(([,value],i)=>i<4||value!=="1.000×"))}</div>`;
}

const quoteFields=[
	["entryGas","Entry gas $",1e6],["exitGas","Exit gas $",1e6],["slippage","Slippage %",100],
	["delay","Exit delay (d)",36500],["lockup","Lockup days",36500]
];
const reachable=(n,format)=>n===null?"Unreachable":format(n);
function payLine({pay,horizon,capped}){
	const [marginal,farm]=pay.targets.map(t=>`q ${reachable(t.odds,pct)} (${api.oddsFactor(t.oddsRatio)}) or drop ${reachable(t.drop,money)} (${multiple(t.dropRatio)})`);
	return`<p class=pay><b>What would make it pay</b> · Base ${horizon} d${capped?" · Clear flags for FARM":""}
<br>MARGINAL ${marginal} · all-in base cost ≤ ${reachable(pay.maxCost,money)}<br>FARM ${farm}`;
}

function quoteResult(plan,quote=plan.quote,result=plan){
	const {horizon,q,capital,noToken,withToken,pStar,gas,fees,timeCost,holding,capitalCharge,drop,claimSell,verdict,net:gain}=result,
		half=api.evaluateFarm(plan,capital,{quote,horizon,q:q/2});
	return`<div class=outcomes>
<div><h3>No token <b>${money(noToken)}</b></h3><p>Gas ${money(gas)} · fees ${money(fees)}
<p>Time ${money(timeCost)} at ${usd(hourlyUsd)}/h
<p>Capital ${money(capitalCharge)} · ${holding}d at ${pct(riskFreeRate,0)}/yr
</div><div><h3>Token <b>${net(withToken)}</b></h3><p>Drop ${money(drop)} − claim &amp; sell ${money(claimSell)}
<p>Less ${money(-noToken)} cost
<p>Net APR ${pct(result.conditionalApr)}</div>
</div>
	${metrics([["Capital",usd(capital)],[`Launch within ${horizon} d (q)`,pct(q)],["Break-even p*",reachable(pStar,pct)],
		["Expected net",net(gain),tone(gain)],["Quote verdict",badge(verdict)]],"metrics")}
<p class=half-q>Half q (${pct(q/2)}) gives ${net(half.net)} and ${badge(half.verdict)}.`;
}

const quotePanel=({plan,slug})=>inset("Cash flows &amp; quotes",`<div class=quote>
<div id=quote-result aria-live=polite>${quoteResult(plan)}</div>
	${payLine(plan)}
<p>${timingNote}
<form id=quote data-slug="${esc(slug)}" class=quotes>
<label>Horizon<select name=horizon><option value=0>Auto${html(horizons,h=>`<option value=${h}>${h} days`)}</select></label>
${html(quoteFields,([key,label,max])=>`<label>${label}
<input name=${key} type=number step=any min=0 max=${max} placeholder=${plan.quote[key]}>
<small>Default</small></label>`)}
</form>
</div>`);

function decisionTree(steps){
	const labels=["1 Verify","2a Wait","2b Stop","2c Withdrawal rehearsal","3a Stop","3b Decide on entry","4 Monitor","5 Withdraw","6 Claim &amp; sell","7 Revisit"],
		step=(label,body,terms,follow)=>`<li><div><h3>${label}</h3><p>${esc(body)}${follow?` <span>${esc(follow)}</span>`:""}</div><small>${esc(terms)}</small>`;
	return`<ol class=steps>${html(steps,([body,terms,follow,fallback,extra],i)=>
		step(labels[i],body,terms,follow)+
		(fallback?step("3c Wait",fallback,extra):""))}</ol>`;
}

function detail(row,state){
	const back=`<a class=back href="${href("board",state)}">← Back to rankings</a>`;
	if(!row) return back+intro("Protocol unavailable");
	const {plan,flags,band}=row,
		age=row.ageDays==null?"Undated":days(row)+" days listed",
		summary=`${esc(row.category||row.family)} · ${shortUsd(row.tvl_usd)} TVL · ${change(row.change_7d)} 7d · ${age}`,
		label=`<p class=rank-note>Rank ${row.rank}/${counts.ranked}${row.watchlist?" · ◆ Watchlist":""}</p>`,
		lead=`<p class=verdict>${badge(plan.verdict)} · ${esc(plan.ticket)} on ${esc(plan.chain.name)} · Launch within ${plan.horizon} d: ${pct(plan.q)} (q) vs p* ${reachable(plan.pStar,pct)} · ${net(plan.net)} expected`;
	const stressRows=[[null,"Base"],...scenarios].map(([key,label])=>{
		const p=plan.stress[key]??plan,
			{all,farm}=stress[key]??{},
			counts=key?ratings.map(v=>`${all[v]} (${farm[v]})`):values(verdicts);
		return[label,usd(p.capital),badge(p.verdict),net(p.net),counts.join(" / ")];
	});
	const range=(low,high)=>shortUsd(low)+"–"+shortUsd(high),
		factors=[[usd(row.launchValue),"Value if launched"],[pct(row.tokenOdds),oddsLabel],[row.haircut.toFixed(2),"Issuer factor"]];
	return`${back}${intro(esc(row.name),summary,lead,label)}
<div class=detail><div>
	${inset("Farm decision tree",`<p>${row.family} on ${esc(plan.chain.name)}${decisionTree(plan.steps)}`)}
	${inset(`Stress · ${plan.horizon} d · re-sized capital`,facts(["Scenario","Capital","Verdict","Expected net","Board F / M / S"],stressRows)+"<small>Base FARM in parentheses.</small>")}
</div><div>
	${quotePanel(row)}
<section class="panel valuation">
<h2>Implied token value</h2><div class=amount>${usd(row.score)}</div>
<div class=equation>${factors.map(([n,label])=>`<div><b>${n}</b><small>${label}</small></div>`).join("×")}</div>
	${valueAttribution(row)}
	${metrics([["Launch value · p10–p90",range(band.low,band.high)],
		["Odds-weighted band",range(band.weightedLow,band.weightedHigh)]],"band")}
<p>${flags.length?flags.map(esc).join(" · ")+" · MARGINAL cap":"No flags"}
</section>
	${inset("Nearest traded peers",facts(["Protocol","TVL","Market cap"],
		row.peers.map(p=>[esc(p.name),shortUsd(p.tvl_usd),shortUsd(p.mcap_usd)])))}
</div></div>`;
}

function calibration(){
	const reading=(sample,places)=>sample?.n?`${multiple(sample.miss,places)} / ${hit(sample.hits[1])}`:"—",
		terms=[...evidence,...odds.evidence,{term:"Flat cap / TVL ratio",withTerm:selected,without:baseline,verdict:"Baseline"},...search],
		ablation=facts(["Term",...["LOO","Walk-forward","Family"].flatMap(s=>[s+" with",s+" without"]),"Verdict"],
			terms.map(({term,withTerm,without,verdict})=>[term,
				...valueTests.flatMap(([k])=>[withTerm,without].map(t=>reading(t[k],withTerm.family?3:2))),verdict]));
	return`${intro("Trading-token calibration")}
${inset("Launch probability q",`<p>${timingNote}<p class=odds-misses>Odds median miss · LOO / walk · ${multiple(loo.miss)} / ${multiple(walk.miss)}`)}
${inset("Term keep/drop · median miss / within 3×",`<p>Fit per fold. Odds miss = 1 / P(observed status). Keep if LOO and walk improve with family miss up ≤ 0.10×.<div id=term-tests>${ablation}</div>`)}
<div class=research>
${inset(`${counts.valueFit} screened trading tokens`,facts(["Protocol","Family","Carried TVL","Market cap","Fit"],
	model.calibration.toSorted((a,b)=>b.mcap_usd-a.mcap_usd)
		.map(p=>[esc(p.name),p.family,shortUsd(p.carriedTvl),shortUsd(p.mcap_usd),shortUsd(p.launchValue)])))}
${inset(missTitle,`${valueSummary()}<p>Flat uses median cap / carried TVL per fold.`+
	facts(["Terms after TVL",...valueTests.map(([k,label])=>`${label} (n=${selected[k].n})`)],[baseline,...trials,...(selected.candidate?[selected]:[])].map(t=>[
		(t.candidate||t.terms?.join(" + ")||(t===baseline?"Flat ratio":"None"))+(t===selected?" · selected":""),
		...valueTests.map(([k])=>multiple(t[k].miss,3))
	])))}
</div>`;
}

function audit(state){
	const peerRange=model.peerRatios.map(n=>multiple(n)).join("–");
	return`${intro("Top-20 audit","By implied value")}${inset("",
facts(["Rank","Protocol","Raw 7d","Carried 7d","Growth treatment","Value / TVL","Peer range","Issuer flags"],
	model.audit.map(row=>[row.rank,taggedLink(row,state),change(row.change_7d),change(row.growth),
		row.change_7d==null?"Imputed":row.change_7d!==row.growth?"<b>Clipped</b>":"As reported",
		multiple(row.ratio),peerRange+(row.outlier?" · outlier":""),row.flags.map(esc).join(" · ")||"—"])))}`;
}

function assumptionsDrawer(){
	const label=k=>k.replace(/^[a-z]|[A-Z]/g,(c,i)=>i?" "+c.toLowerCase():c.toUpperCase()),
		display=v=>[v].flat().map(n=>Number.isInteger(n)?integer(n):esc(n)).join(" · "),
		{parameters,chainQuotes,fallbackChain,mechanisms,families,notes}=assumptions;
	const blocks=[
		["Parameters",["Parameter","Value"],entries(parameters).map(([k,v])=>[label(k),display(v)])],
		["Chain quotes",["Chain","Gas/action","Funding","Time"],
			[...entries(chainQuotes),["Other chains",fallbackChain]].map(([chain,[gas,fund,min]]) =>
				[chain,money(gas),money(fund),min+" min"])],
		["Mechanisms",["Family","Actions","Fees","Time","Deposit"],entries(mechanisms)
			.map(([family,[actions,bps,min,,guidance]])=>[family,actions,bps+" bps",min+" min",guidance])],
		["Families",["Family","Categories"],entries(families).map(([f,cats])=>[f,cats.replaceAll("|",", ")])]
	];
	return`<ul>${html(notes,note=>`<li>${esc(note)}`)}</ul>${html(blocks,([title,headers,rows])=>
		`<h3>${title}</h3>${facts(headers,rows)}`)}`;
}

let activeRoute;

function render(){
	const state=readRoute(),
		focus=document.activeElement?.id,
		{route,slug}=state,detailPage=route==="detail",
		row=detailPage&&rows.find(p=>encodeURIComponent(p.slug)===slug);
	renderNavigation(state);
	document.title=`${row?.name??titles[route]} · Launch Radar`;
	view.innerHTML=detailPage?detail(row,state):{board:boardShell,audit,calibration}[route](state);
	if(route==="board") renderBoard(state);
	const saved=board[row?.rank-1],match=sameDigest&&saved&&saved.slug===row.slug
		&&$(".amount").textContent===usd(saved.implied_value_usd);
	check.hidden=route==="board";
	check.textContent=`${selfCount} self-checks pass${allPass?"":"ed"}`;
	if(detailPage) check.append(` · ${+!!match}/1 rows match`);
	check.dataset.pass=allPass&&(!detailPage||!!match);
	document.getElementById(focus)?.focus();
	if(activeRoute!==route) window.scrollTo(0,0);
	activeRoute=route;
}

$("footer").textContent=`Board digest ${boardDigest}`;
check.title=entries(checks).map(([name,ok])=>`${name}: ${ok?"pass":"fail"}`).join("\n");
$(".drawer").innerHTML=assumptionsDrawer();
$("#open").onclick=()=>$("#assumptions").showModal();
view.onclick=({target})=>{
	if(!target.matches(".chip")) return;
	const help=$("#checks-info");
	help.open=true;
	help.firstElementChild.focus();
};

view.oninput=({target})=>{
	if(target.id==="search") updateBoard({...readRoute(),q:target.value});
	const form=target.form;
	if(form?.id!=="quote") return;
	const {plan}=bySlug.get(form.dataset.slug),
		quote={...plan.quote};
	for(const input of form.querySelectorAll("input")){
		const observed=input.validity.valid&&input.value;
		input.nextElementSibling.textContent=observed?"Quoted":"Default";
		if(observed) quote[input.name]=input.valueAsNumber;
	}
	$("#quote-result").innerHTML=quoteResult(plan,quote,api.chooseFarm(plan,quote,+form.elements.horizon.value));
};

function renderNavigation(state){
	$(".brand").href=link("board",state);
	for(const a of $$("nav a")){
		const {route}=a.dataset;
		a.href=link(route,state);
		a.ariaCurrent=route===(state.route==="detail"?"board":state.route)?"page":"false";
	}
}

function updateBoard(state){
	history.replaceState(null,"",link("board",state));
	renderNavigation(state);
	renderBoard(state);
}

view.onchange=({target})=>{
	const {compare:slug}=target.dataset,
		state=readRoute();
	if(slug){
		state.compare=target.checked?[...state.compare,slug].slice(0,3):state.compare.filter(p=>p!==slug);
		const scroll=$("#results .scroll").scrollTop;
		updateBoard(state);
		$("#results .scroll").scrollTop=scroll;
		$("#"+target.id)?.focus({preventScroll:true});
	} else if(target.matches(".filters select")){
		location.hash=link("board",{...state,[target.name]:target.value});
	}
};
window.onhashchange=render;
render();
}
