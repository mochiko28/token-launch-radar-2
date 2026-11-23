"use strict";
{
const {snapshot:snap,boardDigest}=LaunchRadarData,model=buildModel(snap),
	$=sel=>document.querySelector(sel),$$=sel=>[...document.querySelectorAll(sel)]
const html=(items,draw)=>items.map(draw).join(""),view=$("#view"),check=$("#checks"),
	results=selfChecks(model,snap,boardDigest),checks=fromEntries(results.map(({name,pass})=>[name,pass])),
	passed=count(results,c=>c.pass),allPass=passed===results.length,selfCount=`${passed}/${results.length}`,
	number=opts=>new Intl.NumberFormat("en-US",opts).format
const currency={style:"currency",currency:"USD"},money=number(currency),usd=whole,
	short=number({...currency,notation:"compact",maximumFractionDigits:2})
const dash="—",hit=n=>n==null?dash:pct(n,0),
	mult=(n,dp=2)=>n==null?dash:n.toFixed(dp)+"×",
	sign=n=>n>0?"+":"",
	chg=n=>n==null?dash:sign(n)+n.toFixed(2)+"%",
	net=n=>sign(n)+money(n),
	tone=n=>n>0?"pos":n<0?"neg":"",
	esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c])
const {rows:rs,counts:ns,verdicts,stress,portfolio,value,odds,assumptions:setup,board:{rows:board}}=model,
	hash=digest(board),sameHash=hash===boardDigest,
	{parameters:{horizons,tvlReference,riskFreeRate,hourlyUsd}}=setup,auc=odds.validation,
	{loo,walk}=auc,
	showAuc=fold=>fold.auc?.toFixed(3)??dash
const timing=`${setup.timing} F walk-forward AUC ${showAuc(walk)} (n=${walk.n}).`,
	valTests=[["loo","Leave-one-out"],["walk","Walk-forward"],["family","Family hold-out"]],
	oddsTests=valTests.slice(0,2),
	{baseline,selected,trials,evidence,search}=value.validation,
	{ranges:{heldOut,n:rangeN},nested}=value,
	groups=[["traded"],["recorded","token without cap"],["setAside","set aside"],["ranked"]],
	families=unique(rs.map(p=>p.family)).sort(),chains=unique(rs.flatMap(p=>p.chains)).sort()
const grades=keys(verdicts),
	scenarios=[["doubleCost","2× cost"],["halfShare","½ share"]],
	oddsLabel="Token status odds",
	cols={
	rank:["Rank","rank","asc"],name:["Protocol","name","asc"],
	value:["Implied value","score"],odds:["Token&nbsp;status odds","tokenOdds"],tvl:["TVL","tvl_usd"],
	growth:["7d TVL","change_7d"],days:["Days listed","ageDays"],
	verdict:["Verdict",p=>grades.indexOf(p.plan.verdict),"asc"],net:["Expected net",p=>p.plan.net]
}
const order=k=>cols[k][2]||"desc",filters=[
	["Scope","scope",["all","watchlist"],"All ranked","Watchlist"],
	["Family","family",["",...families],"All families"],
	["Verdict","verdict",["",...grades],"All verdicts"],
	["Chain","chain",["",...chains],"All chains"],
	["Min TVL","tvl",["",1e7,5e7,1e8,5e8].map(String),"Any TVL"],
	["Issuer","flag",["","flagged","clear"],"Any issuer","Flagged","No flags"]
]
const ariaSort=st=>st.dir==="asc"?"ascending":"descending",defaults={q:"",sort:"rank",...fromEntries(filters.map(([,k,[first]])=>[k,first]))},
	titles={board:"Rankings",calibration:"Calibration",audit:"Top-20 audit",detail:"Protocol"},
	bySlug=new Map(rs.map(p=>[p.slug,p]))
function readRoute(){
	const [path,query]=location.hash.slice(1).split("?"),[route,slug]=path.split("/"),qs=new URLSearchParams(query),
		key=qs.get("sort"),dir=qs.get("dir"),sort=hasOwn(cols,key)?key:"rank",
		st={route:hasOwn(titles,route)?route:"board",slug,q:qs.get("q")??"",sort,
		compare:unique(qs.getAll("compare")).filter(s=>bySlug.has(s)).slice(0,3)}
	st.dir=dir==="asc"||dir==="desc"?dir:order(sort)
	for(const [,k,opts] of filters) st[k]=opts.find(v=>v===qs.get(k))??opts[0]
	return st
}
function link(route,st,slug=""){
	const qs=new URLSearchParams()
	for(const k in defaults) if(st[k]!==defaults[k]) qs.set(k,st[k])
	for(const slug of st.compare) qs.append("compare",slug)
	if(st.dir!==order(st.sort)) qs.set("dir",st.dir)
	return "#"+route+(slug&&"/"+slug)+(qs.size?"?"+qs:"")
}
const badge=v=>`<span class="badge ${v.toLowerCase()}">${v}</span>`,
	href=(route,st,slug)=>esc(link(route,st,slug)),
	pLink=(p,st)=>`<a class=protocol href="${href("detail",st,encodeURIComponent(p.slug))}">${esc(p.name)}</a>`,
	days=r=>r.ageDays==null?dash:integer(r.ageDays)
const intro=(title,description="",lead="",lbl="")=>`<header class=intro><div>${lbl}<h1>${title}</h1>${lead}<p>${description}</div><small>DefiLlama<br>${esc(snap.as_of)} UTC</small></header>`,
	missTitle="Held-out median miss vs flat ratio",
	panel=(kind,title,body)=>`<section class="panel ${kind}">${title?`<h2>${title}</h2>`:""}${body}</section>`,
	card=(title,body)=>panel("kpi",title,body),inset=(title,body)=>panel("inset",title,body)

const [intercept,slope]=value.fit.coefficients,
	valueStats=`<div class="readings misses">${html(valTests,([k,lbl])=>{
		const {miss,hits:[two,three]}=selected[k]
		return`<div><span>${lbl}</span><strong>${mult(miss,3)}</strong> / ${mult(baseline[k].miss)}<small>3× ${hit(three)} · 2× ${hit(two)}</small></div>`
	})}</div>
<p class=curve>${short(exp(intercept))} × (carried TVL / ${short(tvlReference)})<sup>${slope.toFixed(3)}</sup> · n=${ns.valueFit}
<p class=nested>Nested walk-forward ${mult(nested.miss)} · reselect terms · shrinkage ${nested.shrinkage}/${nested.folds} folds
<p class=coverage>Walk-forward coverage (n=${rangeN}) · 80% range ${hit(heldOut[80])} · 50% range ${hit(heldOut[50])}`
const kpis=`<section class=kpis aria-label=Validation>
${card("Snapshot coverage",`<strong>${ns.total}</strong>
<div class=groups>${html(groups,([k,lbl=k])=>`<span><b>${ns[k]}</b> ${lbl}</span>`)}</div>`)}
${card(missTitle,valueStats)}
${card(`${oddsLabel} · held-out AUC`,`<div class=readings>${html(oddsTests,([k,lbl])=>
	`<div><strong>${showAuc(auc[k])}</strong><span>${lbl}</span></div>`)}</div><p>TVL + age`)}
${card("Watchlist coverage",`<strong>${ns.watchlistCovered}<small> / ${ns.watchlistTotal}</small></strong>
<p>Floor ${short(snap.floor_usd)}`)}</section>`
const option=(v,lbl,selected)=>`<option value="${esc(v)}"${selected?" selected":""}>${esc(lbl)}`,
	filter=([lbl,k,opts,...names],st)=>`<label>${lbl}<select id=filter-${k} name=${k}>${html(opts,(v,i)=>
		option(v,names[i]??(k==="tvl"?short(v)+"+":v),v===st[k]))}</select></label>`

const {positions,capital,cost,net:gain,unallocated,eligible,budget}=portfolio,
	holdings=st=>`<section class=portfolio>
<div><h2>${short(budget)} watchlist portfolio</h2>
<p>${positions.length}/${eligible} FARM · Shared checks
<p>${unallocated?usd(unallocated)+" unallocated":"Score-weighted remainder"}</div>
<div class=positions>${html(positions,p=>`<div>${pLink(p,st)}
<small>${usd(p.capital)} capital</small><small>${money(p.cost)} cost · ${net(p.net)} net</small></div>`)}</div>
${stats([["Capital",usd(capital)],["Cost",money(cost)],["Expected net",net(gain),tone(gain)]],"totals")}</section>`
const best=rs.filter(({plan:p})=>p.pStar!==null&&p.q>=p.pStar).sort((a,b)=>b.plan.net-a.plan.net).slice(0,5),
	plans=st=>panel("inset plans","Best plans that clear break-even",`<p>${grades.map(v=>verdicts[v]+" "+v).join(" · ")} · FARM ≥ 2p* with clear flags · MARGINAL ≥ p*
${html(best,p=>{
	const f=p.plan
	return`<div><b class=pos>${net(f.net)} net</b>${pLink(p,st)} ${badge(f.verdict)}
<small>${esc(f.chain.name)} · ${usd(f.capital)} · ${f.horizon} d · ${money(f.cost)} cost<br>q ${pct(f.q)} vs p* ${pct(f.pStar)} · ${f.handsOnMinutes} min hands-on</small></div>`
})||"No break-even plans."}`)
const boardShell=st=>`${intro("Pre-token rankings","Farm horizons 30–365 d")}
<div class=integrity role=group aria-label=Integrity></div>
${kpis}${st.scope==="watchlist"?holdings(st):""}
<div class=board><section class=panel>
<div class=bar><h2>Ranked protocols</h2><small id=shown role=status></small></div>
<div class=filters><label>Search<input id=search type=search value="${esc(st.q)}" autocomplete=off></label>
${html(filters,spec=>filter(spec,st))}</div>
<div id=compare></div><div id=results></div>
</section><aside class=rail>
${plans(st)}
${inset("Expected yield by age",`<div id=yield></div>
<div class=legend>${html(grades,v=>`<span class=${v.toLowerCase()}>${v}</span>`)}</div>`)}
</aside></div>
<details class="panel inset" id=check-help><summary>Integrity</summary><ul>
<li>Export, hash, groups, watchlist, order, costs, miss, AUC
<li>LOO: log-cap residuals. Walk-forward: prior rows.
<li>Nested selection: midpoint split.
</ul></details>`
function filtered({scope,family,chain,verdict,flag,tvl,q,sort,dir}){
	const query=q.trim().toLowerCase(),field=cols[sort][1],read=typeof field==="function"?field:p=>p[field]
	return rs.filter(p=>(!query||`${p.name} ${p.slug}`.toLowerCase().includes(query))
		&&(scope!=="watchlist"||p.watchlist)&&(!family||p.family===family)
		&&(!chain||p.chains.includes(chain))&&(!verdict||p.plan.verdict===verdict)
		&&p.tvl_usd>=+tvl&&(!flag||!!p.flags.length===(flag==="flagged"))).sort((a,b)=>{
		const x=read(a),y=read(b),cmp=x==null||y==null?+(x==null)-+(y==null)
			:(typeof x==="string"?x.localeCompare(y):x-y)*(dir==="asc"?1:-1)
		return cmp||a.rank-b.rank
	})
}
const formula=(value,odds,issuer)=>`${short(value)} × ${pct(odds,1)} × ${issuer}`,
	range=([low,high])=>`${short(low)}–${short(high)}`,
	valueRange=r=>`80% ${range(r[80])} · 50% ${range(r[50])}`
function tableRow(r,st){
	const {slug,score,launchValue,tokenOdds,haircut,rank,plan:fp,category,family,watchlist,tvl_usd,change_7d}=r,k=esc(slug)
	return`<tr data-slug="${k}" data-factors=${[score,launchValue,tokenOdds,haircut]}>
<td class=rank>${rank}
<th scope=row>${pLink(r,st)}${r.flags.length?" <span title='Issuer flag'>!</span>":""}
<small>${esc(category||family)}${watchlist?" <span class=watch title=Watchlist>◆</span>":""}
<td title="${usd(score)}"><b>${short(score)}</b><small title="80% range">${range(r.ranges[80])}</small><small>${formula(launchValue,tokenOdds,haircut)}</small>
<td>${pct(tokenOdds,1)}<td>${short(tvl_usd)}
<td class="${tone(change_7d)}">${chg(change_7d)}
<td>${days(r)}
<td>${badge(fp.verdict)}<td>${net(fp.net)}<small>${fp.horizon} d${fp.verdict==="SKIP"?` · needs ${oddsFactor(fp.pay.targets[0].oddsRatio)} odds`:""}</small>
<td><input type=checkbox data-compare="${k}" id=pick-${rank} aria-label="Compare ${esc(r.name)}"${st.compare.includes(slug)?" checked":st.compare.length===3?" disabled":""}>`
}
function compare(st){
	const picks=st.compare.map(slug=>bySlug.get(slug))
	if(!picks.length) return "<p class=hint>Compare up to 3."
	const update=(compare,lbl,title=lbl)=>`<a class=btn href="${href("board",{...st,compare})}" title="${esc(title)}">${lbl}</a>`,
		heads=picks.map(p=>pLink(p,st)+" "+update(st.compare.filter(s=>s!==p.slug),"×",`Remove ${p.name}`)),
		stats=[["Value",p=>short(p.score)],[oddsLabel,p=>pct(p.tokenOdds)],["TVL",p=>short(p.tvl_usd)],
		["7d TVL",p=>chg(p.change_7d)],["Days listed",days],["Verdict",p=>badge(p.plan.verdict)],
		["Capital",p=>usd(p.plan.capital)],["Expected net",p=>net(p.plan.net)]]
	return`<section class=compare><div class=bar><h2>Compare</h2>${update([],"Clear")}</div>
${facts(["Metric",...heads],stats.map(([lbl,read])=>[lbl,...picks.map(read)]))}</section>`
}
function verifyRows(rs,st){
	const trs=$$("#results tbody tr"),
		sorted=trs.length===rs.length&&(!rs.length||$(`[aria-sort=${ariaSort(st)}] #sort-${st.sort}`))
			&&trs.every((tr,i)=>tr.dataset.slug===rs[i].slug)
	const matched=count(trs,tr=>{
		const [rank,,value,odds]=tr.cells,p=board[rank.textContent-1]
		if(p?.slug!==tr.dataset.slug) return false
		const {implied_value_usd:score,launch_value_usd:base,token_odds:s,issuer_factor:factor,implied_value_ranges_usd:ranges}=p
		return tr.dataset.factors===[score,base,s,factor].join()&&value.title===usd(score)&&odds.textContent===pct(s,1)
			&&[short(score),range(ranges[80]),formula(base,s,factor)].every((x,i)=>value.children[i]?.textContent===x)
	})
	integrity(matched,rs.length,sorted&&matched===rs.length)
}
function integrity(matched,total,rowsPass){
	const miss=(k,lbl,f=selected[k])=>[f.n&&f.miss<baseline[k].miss,`${lbl} ${mult(f.miss)}`]
	$(".integrity").innerHTML=html([
		[rowsPass&&sameHash,`Rows match board.json ${matched}/${total}`],
		[sameHash,`Hash ${hash}`],
		[checks["group counts"],`${ns.total}=${groups.map(([k])=>ns[k]).join("+")}`],
		[checks.coverage,`Watchlist ${ns.watchlistCovered}/${ns.watchlistTotal}`],
		[checks.sorted_by_value,`Sorted ${board.length}`],
		miss("loo","Value LOO"),miss("walk","Walk"),
		[checks["80% LOO coverage"],`80% range covers ${hit(heldOut[80])} held-out`],
		[!!nested.folds,`nested WF ${mult(nested.miss)}`],
		[loo.auc>.5&&walk.auc>.5,`AUC ${showAuc(loo)}/${showAuc(walk)}`],
		[checks.farm_steps,`Plans ${board.length}`],
		[allPass,`Checks ${selfCount}`]
	],([ok,lbl])=>`<button class=chip data-pass=${ok}>${ok?"✓":"✗"} ${lbl}</button>`)
}
function drawBoard(st){
	const rows=filtered(st)
	$("#shown").textContent=`${rows.length} of ${st.scope==="watchlist"?ns.watchlistCovered:ns.ranked} shown`
	const heads=html(entries(cols),([k,[lbl]])=>{
		const active=k===st.sort,dir=active?(st.dir==="asc"?"desc":"asc"):order(k)
			return`<th${active?` aria-sort=${ariaSort(st)}`:""}>
<a id=sort-${k} href="${href("board",{...st,sort:k,dir})}">${lbl}${active?` <span aria-hidden=true>${dir==="desc"?"↑":"↓"}</span>`:""}</a>`
	})+"<th>Compare"
	$("#results").innerHTML=rows.length?table("ranks",heads,html(rows,r=>tableRow(r,st))," role=region aria-label=Rankings")
		:"<p class=empty>No matches."
	verifyRows(rows,st)
	$("#yield").innerHTML=yieldChart(rows)
	$("#compare").innerHTML=compare(st)
}
function yieldChart(rs){
	const points=rs.filter(p=>p.ageDays!=null&&isFinite(p.plan.expectedYield)).reverse()
	if(!points.length) return "<p>No listing dates."
	const days=ceil(max(...points.map(p=>p.ageDays))/100)*100,rates=points.map(p=>100*p.plan.expectedYield),
		low=floor(min(0,...rates)),span=ceil(max(1,...rates))-low
	return`<svg viewBox="0 0 288 170" role=img aria-label="Age vs expected yield">
${html(["start","middle","middle","end"],(anchor,i)=>{
	const x=36+239*i/3,y=130-40*i
	return`<path d="M36,${y}H275M${x},10V130"/><text x=29 y=${y+4} text-anchor=end>${+(low+span*i/3).toFixed(1)}%</text>
<text x=${x} y=148 text-anchor=${anchor}>${integer(days*i/3)}</text>`
})}
${html(points,({plan,ageDays,name},i)=>`<circle class=${plan.verdict.toLowerCase()} cx=${36+239*ageDays/days} cy=${130-120*(rates[i]-low)/span} r=3.1>
<title>${esc(name)} · ${ageDays} days · ${pct(plan.expectedYield)}</title></circle>`)}
<text x=156 y=167 text-anchor=middle>Days without a recorded token</text>
</svg><p>${points.length} plotted${rs.length>points.length?` · ${rs.length-points.length} undated`:""}`
}

const stats=(items,kind="")=>`<dl class="${kind}">${html(items,([label,value,style=""])=>
	`<div><dt>${label}<dd class="${style}">${value}</div>`)}</dl>`,
	table=(kind,heads,body,attrs="")=>`<div class=scroll tabindex=0${attrs}><table class=${kind}><thead><tr>${heads}<tbody>${body}</table></div>`,
	facts=(heads,rs)=>table("facts","<th>"+heads.join("<th>"),
		html(rs,([first,...cells])=>`<tr><th scope=row>${first}<td>${cells.join("<td>")}`))
function drivers(r){
	const {rank,name,score}=model.reference,factors=values(r.attribution)
	return`<div class=drivers><p><b>${mult(r.score/score,3)}</b> vs median #${rank} ${esc(name)} (${usd(score)})
${stats(["TVL size","7d carry","Age on odds","Issuer","Family","Rounding"]
	.map((lbl,i)=>[lbl,mult(factors[i],3)]).filter(([,x],i)=>i<4||x!=="1.000×"))}</div>`
}
const quoteFields=[
	["entryGas","Entry gas $"],["exitGas","Exit gas $"],["slippage","Slippage %",100],
	["delay","Exit delay (d)",36500],["lockup","Lockup days",36500]
],
	maybe=(n,fmt)=>n==null?"Unreachable":fmt(n)
function payLine({pay,horizon,capped}){
	const [marginal,farm]=pay.targets.map(t=>`q ${maybe(t.odds,pct)} (${oddsFactor(t.oddsRatio)}) or drop ${maybe(t.drop,money)} (${mult(t.dropRatio)})`)
	return`<p class=pay><b>What would make it pay</b> · Base ${horizon} d${capped?" · Clear flags for FARM":""}
<br>MARGINAL ${marginal} · all-in base cost ≤ ${maybe(pay.maxCost,money)}<br>FARM ${farm}`
}
function cashFlows(fp,quote=fp.quote,result=fp){
	const {horizon,q,capital,noToken,withToken,pStar,gas,fees,timeCost,holding,capitalCharge,drop,claimSell,verdict,net:gain}=result,
		gasBasis=gas===fp.gas?`${fp.transactions} tx x ${money(fp.chain.gas)} on ${esc(fp.chain.name)}`:"Quoted gas",
		half=evaluateFarm(fp,capital,{quote,horizon,q:q/2})
	return`<div class=flows>
<div><h3>No token <b>${money(noToken)}</b></h3>
<p class=gas>${gasBasis} = ${money(gas)}<br>${pct(gas/-noToken,1)} of all-in cost
<p>Fees ${money(fees)} · time ${money(timeCost)} at ${usd(hourlyUsd)}/h
<p>Capital ${money(capitalCharge)} · ${holding}d at ${pct(riskFreeRate,0)}/yr
</div><div><h3>Token <b>${net(withToken)}</b></h3><p>Drop ${money(drop)} − claim &amp; sell ${money(claimSell)}
<p>Less ${money(-noToken)} cost
<p>Net APR ${pct(result.conditionalApr)}</div>
</div>
${stats([["Capital",usd(capital)],[`Launch within ${horizon} d (q)`,pct(q)],["Break-even p*",maybe(pStar,pct)],
		["Expected net",net(gain),tone(gain)],["Quote verdict",badge(verdict)]],"metrics")}
<p class=half-q>Half q (${pct(q/2)}) gives ${net(half.net)} and ${badge(half.verdict)}.`
}

const quotePanel=({plan:fp,slug})=>panel("inset quote","Cash flows &amp; quotes",`
<div id=quote-result aria-live=polite>${cashFlows(fp)}</div>
${payLine(fp)}
<p>${timing}
<form id=quote data-slug="${esc(slug)}" class=quotes>
<label>Horizon<select name=horizon>${option(0,"Auto")}${html(horizons,h=>option(h,h+" days"))}</select></label>
${html(quoteFields,([k,lbl,max=1e6])=>`<label>${lbl}
<input name=${k} type=number step=any min=0 max=${max} placeholder=${fp.quote[k]}>
<small>Default</small></label>`)}
</form>`)
const labels="1 Verify|2a Wait|2b Stop|2c Withdrawal rehearsal|3a Stop|3b Decide on entry|4 Monitor|5 Withdraw|6 Claim &amp; sell|7 Revisit".split("|"),
	step=(lbl,body,terms,follow)=>`<li><div><h3>${lbl}</h3><p>${esc(body)}${follow?` <span>${esc(follow)}</span>`:""}</div><small>${esc(terms)}</small>`,
	tree=steps=>`<ol class=steps>${html(steps,([body,terms,follow,fallback,extra],i)=>
		step(labels[i],body,terms,follow)+(fallback?step("3c Wait",fallback,extra):""))}</ol>`
function detail(r,st){
	const back=`<a class=back href="${href("board",st)}">← Rankings</a>`
	if(!r) return back+intro("Unavailable")
	const {plan:fp,flags,band,ranges,rangeFarm:[low,high]}=r,
		summary=`${esc(r.category||r.family)} · ${short(r.tvl_usd)} TVL · ${chg(r.change_7d)} 7d · ${days(r)} days listed`,
		lbl=`<p class=kicker>Rank ${r.rank}/${ns.ranked}${r.watchlist?" · ◆ Watchlist":""}</p>`,
		lead=`<p class=verdict>${badge(fp.verdict)} · ${esc(fp.ticket)} on ${esc(fp.chain.name)} · Launch within ${fp.horizon} d: ${pct(fp.q)} (q) vs p* ${maybe(fp.pStar,pct)} · ${net(fp.net)} expected`,
		stressRows=[[null,"Base"],...scenarios].map(([k,lbl])=>{
		const p=fp.stress[k]??fp,{all=verdicts,farm}=stress[k]??{}
		return[lbl,usd(p.capital),badge(p.verdict),net(p.net),grades.map(v=>farm?`${all[v]} (${farm[v]})`:all[v]).join(" / ")]
	}),
		flips=[low,high].flatMap(({verdict},i)=>verdict===fp.verdict?[]:[`flips to ${verdict} at the ${i?"high":"low"} end`]),
		factors=[[usd(r.launchValue),"Value if launched"],[pct(r.tokenOdds),oddsLabel],[r.haircut.toFixed(2),"Issuer factor"]]
	return`${back}${intro(esc(r.name),summary,lead,lbl)}
<div class=detail><div>
${inset("Farm decision tree",`<p>${r.family}
<p class=range-net>Expected net low/high ${net(low.net)} / ${net(high.net)} · ${flips.join(" · ")||"verdict robust across 80% range"}
<h3>Exit triggers</h3><ul class=exits>${html(fp.exits,s=>`<li>${esc(s)}`)}</ul>${tree(fp.steps)}`)}
${inset(`Stress · ${fp.horizon} d · resized capital`,facts(["Scenario","Capital","Verdict","Expected net","Board F / M / S"],stressRows)+"<small>(Base FARM)</small>")}
</div><div>
${quotePanel(r)}
<section class="panel valuation">
<h2>Implied token value</h2><div class=amount>${usd(r.score)}</div>
<small class=value-range>${valueRange(ranges)}</small>
<div class=equation>${factors.map(([n,lbl])=>`<div><b>${n}</b><small>${lbl}</small></div>`).join("×")}</div>
${drivers(r)}
${stats([["Launch value · p10–p90",range([band.low,band.high])],
		["Odds-weighted band",range([band.weightedLow,band.weightedHigh])]],"band")}
<p>${flags.length?flags.map(esc).join(" · ")+" · MARGINAL cap":"No flags"}
</section>
${inset("Nearest traded peers",facts(["Protocol","TVL","Market cap"],
		r.peers.map(p=>[esc(p.name),short(p.tvl_usd),short(p.mcap_usd)])))}
</div></div>`
}
function calibration(){
	const terms=[...evidence,...odds.evidence,{term:"Flat cap / TVL ratio",withTerm:selected,without:baseline,verdict:"Baseline"},...search],
		ablation=facts(["Term",...["LOO","Walk-forward","Family"].flatMap(s=>[s+" with",s+" without"]),"Verdict"],
			terms.map(({term,withTerm,without,verdict})=>[term,...valTests.flatMap(([k])=>
				[withTerm[k],without[k]].map(f=>f?.n?`${mult(f.miss,withTerm.family?3:2)} / ${hit(f.hits[1])}`:dash)),verdict]))
	return`${intro("Trading-token calibration")}
${inset("Launch probability q",`<p>${timing}<p class=odds-misses>Odds median miss · LOO / walk · ${mult(loo.miss)} / ${mult(walk.miss)}`)}
${inset("Term keep/drop · median miss / within 3×",`<p>Odds miss = 1/P(status). Adopt if LOO/walk improve and family miss rises ≤0.1×.<div id=term-tests>${ablation}</div>`)}
<div class=research>
${inset(`${ns.valueFit} screened trading tokens`,facts(["Protocol","Family","Carried TVL","Market cap","Fit"],
	model.calibration.toSorted((a,b)=>b.mcap_usd-a.mcap_usd)
		.map(p=>[esc(p.name),p.family,short(p.carriedTvl),short(p.mcap_usd),short(p.launchValue)])))}
${inset(missTitle,valueStats+"<p>Flat uses median cap/carried TVL per fold."+
	facts(["Terms after TVL",...valTests.map(([k,lbl])=>`${lbl} (n=${selected[k].n})`)],[baseline,...trials,...(selected.candidate?[selected]:[])].map(t=>[
		(t.candidate||t.terms?.join(" + ")||(t===baseline?"Flat ratio":"None"))+(t===selected?" · selected":""),
		...valTests.map(([k])=>mult(t[k].miss,3))
	])))}
</div>`
}
function audit(st){
	const peerRange=model.peerRatios.map(n=>mult(n)).join("–")
	return`${intro("Top-20 audit","By implied value")}${inset("",
facts(["Rank","Protocol","Raw 7d","Carried 7d","Growth treatment","Value / TVL","Peer range","Issuer flags"],
	model.audit.map(r=>[r.rank,pLink(r,st),chg(r.change_7d),chg(r.growth),
		r.change_7d==null?"Imputed":r.change_7d!==r.growth?"<b>Clipped</b>":"As reported",
		mult(r.ratio),peerRange+(r.outlier?" · outlier":""),r.flags.map(esc).join(" · ")||"—"])))}`
}
function drawer(){
	const {parameters,chainQuotes,fallbackChain,mechanisms,families,notes}=setup
	const lbl=k=>k.replace(/^[a-z]|[A-Z]/g,(c,i)=>i?" "+c.toLowerCase():c.toUpperCase()),
		display=v=>[v].flat().map(n=>isInteger(n)?integer(n):esc(n)).join(" · ")
	const blocks=[
		["Parameters","Parameter|Value",entries(parameters).map(([k,v])=>[lbl(k),display(v)])],
		["Chain quotes","Chain|Gas/tx|Funding|Time",
			entries({...chainQuotes,"Other chains":fallbackChain}).map(([chain,[gas,fund,min]])=>
				[chain,money(gas),money(fund),min+" min"])],
		["Mechanisms","Family|Actions|Fees|Time|Deposit",entries(mechanisms)
			.map(([family,[actions,bps,min,,guidance]])=>[family,actions,bps+" bps",min+" min",guidance])],
		["Families","Family|Categories",entries(families).map(([f,cats])=>[f,cats.replaceAll("|",", ")])]
	]
	return`<ul>${html(notes,s=>`<li>${esc(s)}`)}</ul>${html(blocks,([title,heads,rs])=>`<h3>${title}</h3>${facts(heads.split("|"),rs)}`)}`
}
let activeRoute
function render(){
	const st=readRoute(),{route,slug}=st,focus=document.activeElement?.id,
		r=route==="detail"&&rs.find(p=>encodeURIComponent(p.slug)===slug)
	nav(st)
	document.title=`${r?.name??titles[route]} · Launch Radar`
	view.innerHTML=route==="detail"?detail(r,st):{board:boardShell,audit,calibration}[route](st)
	if(route==="board") drawBoard(st)
	const saved=board[r?.rank-1],match=sameHash&&saved?.slug===r?.slug&&r
		&&$(".amount").textContent===usd(saved.implied_value_usd)
		&&$(".value-range").textContent===valueRange(saved.implied_value_ranges_usd)
	check.hidden=route==="board"
	check.textContent=selfCount+" self-checks pass"
	if(route==="detail") check.append(` · ${+!!match}/1 rows match`)
	check.dataset.pass=allPass&&(route!=="detail"||!!match)
	document.getElementById(focus)?.focus()
	if(activeRoute!==route) window.scrollTo(0,0)
	activeRoute=route
}

$("footer").textContent=`Board digest ${boardDigest}`
check.title=results.map(({name,pass})=>`${name}: ${pass?"pass":"fail"}`).join("\n")
$(".drawer").innerHTML=drawer()
$("#open").onclick=()=>$("#assumptions").showModal()
view.onclick=({target:el})=>{
	if(el.matches(".chip")){
		$("#check-help").open=true
		$("#check-help summary").focus()
	}
}

view.oninput=({target:el})=>{
	if(el.id==="search") updateBoard({...readRoute(),q:el.value})
	const form=el.form
	if(form?.id!=="quote") return
	const fp=bySlug.get(form.dataset.slug).plan,quote={...fp.quote}
	for(const input of form.querySelectorAll("input")){
		const observed=input.validity.valid&&input.value
		input.nextElementSibling.textContent=observed?"Quoted":"Default"
		if(observed) quote[input.name]=input.valueAsNumber
	}
	$("#quote-result").innerHTML=cashFlows(fp,quote,chooseFarm(fp,quote,+form.elements.horizon.value))
}
function nav(st){
	$(".brand").href=link("board",st)
	const current=st.route==="detail"?"board":st.route
	for(const a of $$("nav a")){
		const route=a.hash.slice(1).split("?")[0]
		a.href=link(route,st)
		a.ariaCurrent=route===current?"page":null
	}
}
function updateBoard(st){
	history.replaceState(null,"",link("board",st))
	nav(st)
	drawBoard(st)
}

view.onchange=({target:el})=>{
	const slug=el.dataset.compare,st=readRoute()
	if(slug){
		st.compare=el.checked?[...st.compare,slug].slice(0,3):st.compare.filter(p=>p!==slug)
		const scroll=$("#results .scroll").scrollTop
		updateBoard(st)
		$("#results .scroll").scrollTop=scroll
		$("#"+el.id)?.focus({preventScroll:true})
	} else if(el.matches(".filters select")){
		location.hash=link("board",{...st,[el.name]:el.value})
	}
}
onhashchange=render
render()
}
