"use strict";
{
const {snapshot:snap,boardDigest}=LaunchRadarData,model=buildModel(snap),
	$=sel=>document.querySelector(sel),$$=sel=>[...document.querySelectorAll(sel)]
const html=(items,draw)=>items.map(draw).join(""),view=$("#view"),check=$("#checks"),
	results=selfChecks(model,snap,boardDigest),checks=object(results.map(c=>[c.name,c.pass])),
	passed=count(results,c=>c.pass),allPass=passed===results.length,selfCount=`${passed}/${results.length}`,
	signed=s=>s.replace(/(^|[\s$(,])-(?=\$?\d)/g,"$1−"),
	dollars=opts=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",...opts}).format,
	cents=dollars(),money=n=>signed(cents(n)),short=dollars({notation:"compact",maximumFractionDigits:2}),usd=whole
const dash="—",hit=n=>n==null?dash:pct(n,0),
	mult=(n,dp=2)=>n==null?dash:signed(n.toFixed(dp))+"×",
	sign=n=>n>0?"+":"",
	chg=n=>n==null?dash:sign(n)+signed(n.toFixed(2))+"%",
	pill=n=>n==null?dash:`<b class="change ${tone(n)}"><span aria-hidden=true>${n>0?"↑ ":n<0?"↓ ":""}</span>${chg(n)}</b>`,
	net=n=>sign(n)+money(n),
	tone=n=>n>0?"pos":n<0?"neg":"",
	esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c])
const {rows:rs,counts:ns,verdicts,stress,portfolio,value,odds,assumptions:setup,board:{rows:board}}=model,
	hash=digest(board),sameHash=hash===boardDigest,
	{parameters:{horizons,tvlReference,riskFreeRate,hourlyUsd}}=setup,
	auc=odds.validation,{loo,walk}=auc,
	showAuc=fold=>fold.auc?.toFixed(3)??dash
const timing=`${setup.timing} F walk-forward AUC ${showAuc(walk)} (n=${walk.n}).`,
	valTests=entries({loo:"Leave-one-out",walk:"Walk-forward",family:"Family hold-out"}),
	{baseline,selected,trials,evidence,search}=value.validation,
	{ranges:{heldOut,n:rangeN},nested}=value,
	groups=[["traded"],["recorded","token, no cap"],["setAside","set aside"],["ranked"]],
	choices=items=>["",...unique(items).sort()]
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
	["Family","family",choices(rs.map(p=>p.family)),"All families"],
	["Verdict","verdict",["",...grades],"All verdicts"],
	["Chain","chain",choices(rs.flatMap(p=>p.chains)),"All chains"],
	["Min TVL","tvl",["",1e7,5e7,1e8,5e8].map(String),"Any TVL"],
	["Issuer","flag",["","flagged","clear"],"Any issuer","Flagged","No flags"]
]
const ariaSort=st=>st.dir==="asc"?"ascending":"descending",defaults={q:"",sort:"rank",...object(filters.map(([,k,[v]])=>[k,v]))},
	bySlug=new Map(rs.map(p=>[p.slug,p]))
function readRoute(){
	const [path,query]=location.hash.slice(1).split("?"),[route,slug]=path.split("/"),qs=new URLSearchParams(query),
		get=k=>qs.get(k),sort=get("sort"),dir=get("dir"),
		st={...defaults,route:hasOwn(pages,route)?route:"board",slug,q:get("q")??"",
			compare:unique(qs.getAll("compare")).filter(s=>bySlug.has(s)).slice(0,3)}
	if(hasOwn(cols,sort)) st.sort=sort
	st.dir=["asc","desc"].includes(dir)?dir:order(st.sort)
	for(const [,k,opts] of filters) if(opts.includes(get(k))) st[k]=get(k)
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
	days=r=>r.ageDays==null?dash:integer(r.ageDays),
	rowName=r=>esc(r.category||r.family)
const intro=(title,copy="",lead="",lbl="")=>`<header class=intro><div>${lbl}<h1>${title}</h1>${lead}<p>${copy}</div><small>DefiLlama<br>${esc(snap.as_of)} UTC</small></header>`,
	missTitle="Held-out miss vs flat ratio",
	panel=(kind,title,body)=>`<section class="panel ${kind}">${title?`<h2>${title}</h2>`:""}${body}</section>`,
	card=(title,body)=>panel("kpi",title,body),inset=(title,body,kind="")=>panel("inset"+kind,title,body)

const [intercept,slope]=value.fit.coefficients,
	valueStats=`<div class="readings misses">${html(valTests,([k,lbl])=>{
		const {miss,hits:[two,three]}=selected[k]
		return`<div><span>${lbl}</span><strong>${mult(miss,3)}</strong> / ${mult(baseline[k].miss)}<small>3× ${hit(three)} · 2× ${hit(two)}</small></div>`
	})}</div>
<p class=curve>${short(exp(intercept))} × (carried TVL / ${short(tvlReference)})<sup>${signed(slope.toFixed(3))}</sup> · n=${ns.valueFit}
<p class=nested>Nested walk-forward ${mult(nested.miss)} · shrinkage ${nested.shrinkage}/${nested.folds}
<p class=coverage>WF coverage (n=${rangeN}) · 80% range ${hit(heldOut[80])} · 50% range ${hit(heldOut[50])}`
const kpis=`<section class=kpis aria-label=Validation>
${card("Snapshot",`<strong>${ns.total}</strong>
<div class=groups>${html(groups,([k,lbl=k])=>`<span><b>${ns[k]}</b> ${lbl}</span>`)}</div>`)}
${card(missTitle,valueStats)}
${card(`${oddsLabel} · held-out AUC`,`<div class=readings>${html(valTests.slice(0,2),([k,lbl])=>
	`<div><strong>${showAuc(auc[k])}</strong><span>${lbl}</span></div>`)}</div><p>TVL + age`)}
${card("Watchlist",`<strong>${ns.watchlistCovered}<small> / ${ns.watchlistTotal}</small></strong>
<p>Floor ${short(snap.floor_usd)}`)}</section>`
const option=(v,lbl,selected)=>`<option value="${esc(v)}"${selected?" selected":""}>${esc(lbl)}`,
	filter=([lbl,k,opts,...names],st)=>`<label>${lbl}<select name=${k}>${html(opts,(v,i)=>option(v,names[i]??(k==="tvl"?short(v)+"+":v),v===st[k]))}</select></label>`

const {positions,capital,cost,net:gain,unallocated,eligible,budget}=portfolio,
	holdings=st=>inset("",`<div><h2>${short(budget)} watchlist portfolio</h2>
<p>${positions.length}/${eligible} FARM · Shared checks
<p>${unallocated?usd(unallocated)+" idle":"Score-weighted surplus"}</div>
<div class=positions>${html(positions,p=>`<div>${pLink(p,st)}<small>${usd(p.capital)} capital · ${money(p.cost)} cost · ${net(p.net)} net</small></div>`)}</div>
${stats([["Capital",usd(capital)],["Cost",money(cost)],["Expected net",net(gain),tone(gain)]],"totals")}`," portfolio")
const best=rs.filter(({plan:p})=>p.pStar!==null&&p.q>=p.pStar).sort((a,b)=>b.plan.net-a.plan.net).slice(0,5),
	plans=st=>inset("Best plans that clear break-even",`<p>${grades.map(v=>verdicts[v]+" "+v).join(" · ")} · FARM ≥ 2p* with clear flags · MARGINAL ≥ p*
${html(best,p=>{
	const f=p.plan
	return`<div><b class=pos>${net(f.net)} net</b>${pLink(p,st)} ${badge(f.verdict)}
<small class=action>${esc(f.action)}</small><small>${usd(f.capital)} · ${f.horizon} d · ${money(f.cost)} cost<br>q ${pct(f.q)} vs p* ${pct(f.pStar)} · ${f.handsOnMinutes} min hands-on</small></div>`
})||"None."}`," plans")
const boardShell=st=>`${intro("Pre-token rankings","30–365 d farms")}
<div class=integrity role=group aria-label=Integrity></div>
${kpis}${st.scope==="watchlist"?holdings(st):""}
<div class=board><section class=panel>
<div class=bar><h2>Protocols</h2><small id=shown role=status></small></div>
<div class=filters><label>Search<input id=search type=search value="${esc(st.q)}" autocomplete=off></label>
${html(filters,spec=>filter(spec,st))}</div>
<div id=compare></div><div id=results></div>
</section><aside class=rail>
${inset("Expected yield by age",`<div id=yield></div>
<div class=legend>${html(grades,v=>`<span class=${v.toLowerCase()}>${v}</span>`)}</div>`)}
${plans(st)}
</aside></div>
<details class="panel inset" id=check-help><summary>Integrity</summary><ul>
<li>LOO: log-cap residuals. WF: prior rows.
<li>Nested: midpoint split.
</ul></details>`
function filtered({scope,family,chain,verdict,flag,tvl,q,sort,dir}){
	const query=q.trim().toLowerCase(),field=cols[sort][1],read=typeof field==="function"?field:p=>p[field]
	return rs.filter(p=>`${p.name} ${p.slug}`.toLowerCase().includes(query)
		&&(scope!=="watchlist"||p.watchlist)&&(!family||p.family===family)
		&&(!chain||p.chains.includes(chain))&&(!verdict||p.plan.verdict===verdict)
		&&p.tvl_usd>=+tvl&&(!flag||!!p.flags.length===(flag==="flagged"))).sort((a,b)=>{
		const x=read(a),y=read(b),cmp=x==null||y==null?+(x==null)-+(y==null)
			:(typeof x==="string"?x.localeCompare(y):x-y)*(dir==="asc"?1:-1)
		return cmp||a.rank-b.rank
	})
}
const range=r=>r.map(short).join("–"),
	valueRange=r=>`80% ${range(r[80])} · 50% ${range(r[50])}`,
	valueTitle=([score,base,s,factor],r)=>`${usd(score)} · 80% range ${range(r[80])} · ${short(base)} × ${pct(s,1)} × ${factor}`,
	fields="implied_value_usd launch_value_usd token_odds issuer_factor".split(" "),
	endpoints=rs.flatMap(({score,ranges})=>[score,...ranges[80]]),
	logMin=log(min(...endpoints)),logSpan=log(max(...endpoints))-logMin||1,
	barAt=n=>1+40*(log(n)-logMin)/logSpan
function tableRow(r,st){
	const {slug,score,launchValue,tokenOdds,haircut,ranges,rank,plan:fp,watchlist,tvl_usd,change_7d}=r,
		k=esc(slug),[lo,hi]=ranges[80].map(barAt),factors=[score,launchValue,tokenOdds,haircut]
	return`<tr data-slug="${k}" data-factors=${factors}>
<td class=rank>${rank}
<th scope=row>${pLink(r,st)}${r.flags.length?" <span title='Issuer flag'>!</span>":""}
<small>${rowName(r)}${watchlist?" <span class=watch title=Watchlist>◆</span>":""}
<td class=value title="${valueTitle(factors,ranges)}"><b>${short(score)}</b><svg class=range aria-hidden=true><path d="M${lo} 4H${hi}"/><path d="M${barAt(score)} 0v8"/></svg>
<td>${pct(tokenOdds,1)}<td>${short(tvl_usd)}
<td>${pill(change_7d)}
<td>${days(r)}
<td>${badge(fp.verdict)}<td>${net(fp.net)}<small>${fp.horizon} d${fp.verdict==="SKIP"?` · ${esc(fp.chain.name)} ${oddsFactor(fp.pay.targets[0].oddsRatio)} q`:""}</small>
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
	return`<div class=compare><div class=bar><h2>Compare</h2>${update([],"Clear")}</div>
${facts(["Metric",...heads],stats.map(([lbl,read])=>[lbl,...picks.map(read)]))}</div>`
}
function verifyRows(rows,st){
	const trs=$$("#results tbody tr"),
		total=rows.length,sorted=trs.length===total&&(!total||$(`[aria-sort=${ariaSort(st)}] #sort-${st.sort}`))
			&&trs.every((tr,i)=>tr.dataset.slug===rows[i].slug)
	const matched=count(trs,tr=>{
		const [rank,,value,odds]=tr.cells,p=board[rank.textContent-1]
		if(p?.slug!==tr.dataset.slug) return false
		const factors=fields.map(k=>p[k]),[score,,s]=factors
		return tr.dataset.factors===factors.join()&&odds.textContent===pct(s,1)
			&&value.textContent.trim()===short(score)&&value.title===valueTitle(factors,p.implied_value_ranges_usd)
	})
	integrity(matched,total,sorted&&matched===total)
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
		[checks["80% LOO coverage"],`80% range: ${hit(heldOut[80])} held-out`],
		[!!nested.folds,`nested WF ${mult(nested.miss)}`],
		[loo.auc>.5&&walk.auc>.5,`AUC ${showAuc(loo)}/${showAuc(walk)}`],
		[checks.farm_steps,`Plans ${board.length}`],
		[allPass,`Checks ${selfCount}`]
	],([ok,lbl])=>`<button class=chip data-pass=${ok}>${ok?"✓":"✗"} ${lbl}</button>`)
}
function drawBoard(st){
	const rows=filtered(st)
	$("#shown").textContent=`${rows.length}/${st.scope==="watchlist"?ns.watchlistCovered:ns.ranked} shown`
	const heads=html(entries(cols),([k,[lbl]])=>{
		const active=k===st.sort,dir=active?(st.dir==="asc"?"desc":"asc"):order(k)
			return`<th${active?` aria-sort=${ariaSort(st)}`:""}>
<a id=sort-${k} href="${href("board",{...st,sort:k,dir})}">${lbl}${active?` <span aria-hidden=true>${dir==="desc"?"↑":"↓"}</span>`:""}</a>`
	})+"<th>Compare"
	$("#results").innerHTML=rows.length?table("ranks",heads,html(rows,r=>tableRow(r,st))," role=region aria-label=Rankings"):"<p class=empty>No matches."
	verifyRows(rows,st)
	$("#yield").innerHTML=yieldChart(rows)
	$("#compare").innerHTML=compare(st)
}
function yieldChart(rs){
	const rate=p=>p.plan.expectedYield,pts=rs.filter(p=>p.ageDays!=null&&finite(rate(p))),n=pts.length
	if(!n) return "<p>No dated rows."
	const days=ceil(max(...pts.map(p=>p.ageDays))/100)*100,rates=pts.map(p=>100*rate(p)),
		low=floor(min(0,...rates)),span=ceil(max(1,...rates))-low,
		x=t=>57+217*t,y=t=>130-120*t,
		text=(x,y,anchor,s)=>`<text x=${x} y=${y} text-anchor=${anchor}>${s}</text>`,
		points=pts.map((p,i)=>[p,x(p.ageDays/days),y((rates[i]-low)/span)]),
		top=points.toSorted(([a],[b])=>rate(b)-rate(a)||a.rank-b.rank).slice(0,3)
	let labelY=0
	return`<svg class=plot viewBox="0 0 288 170" role=img aria-label="Age vs expected yield">
${html(["start","middle","middle","end"],(anchor,i)=>{
	const at=i/3
	return`<path d="M57,${y(at)}H274M${x(at)},10V130"/>${text(51,y(at)+4,"end",signed(String(+(low+span*at).toFixed(1)))+"%")}${text(x(at),148,anchor,integer(days*at))}`
})}
${html(points.toReversed(),([{plan,ageDays,name},cx,cy])=>`<circle class=${plan.verdict.toLowerCase()} cx=${cx} cy=${cy} r=3.1>
<title>${esc(name)} · ${ageDays} d · ${signed(pct(plan.expectedYield))}</title></circle>`)}
<g>${html(top,([{name},cx,cy],i)=>{
	labelY=max(labelY+20,min(cy+4,128-20*(top.length-1-i)))
	const dx=cx>165?-8:8
	return`<path d="M${cx},${cy}L${cx+dx},${labelY-4}"/>${text(cx+dx,labelY,dx<0?"end":"start",esc(name))}`
})}</g>
<text transform="translate(12 70) rotate(-90)" text-anchor=middle>Expected yield</text>
${text(166,167,"middle","Days pre-token")}
</svg><p>${n} plotted${rs.length>n?` · ${rs.length-n} undated`:""}`
}

const stats=(items,kind="")=>`<dl class="${kind}">${html(items,([lbl,val,style=""])=>
	`<div><dt>${lbl}<dd class="${style}">${val}</div>`)}</dl>`,
	table=(kind,heads,body,attrs="")=>`<div class=scroll tabindex=0${attrs}><table class=${kind}><thead><tr>${heads}<tbody>${body}</table></div>`,
	facts=(heads,rs)=>table("facts","<th>"+(typeof heads==="string"?heads.split("|"):heads).join("<th>"),
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
function payLine({pay,horizon,capped,chain}){
	const [marginal,farm]=pay.targets.map(t=>`q ${maybe(t.odds,pct)} (${oddsFactor(t.oddsRatio)}) or drop ${maybe(t.drop,money)} (${mult(t.dropRatio)})`)
	return`<p class=pay><b>What would make it pay</b> · ${esc(chain.name)} · ${horizon} d${capped?" · FARM needs clear flags":""}
<br>MARGINAL ${marginal} · all-in cost ≤ ${maybe(pay.maxCost,money)}<br>FARM ${farm}`
}
function cashFlows(fp,quote=fp.quote,result=fp){
	const {horizon,q,capital,noToken,withToken,pStar,gas,fees,timeCost,holding,capitalCharge,drop,claimSell,verdict,net:gain}=result,
		{chain,transactions}=fp,gasBasis=gas===fp.gas?`${transactions} tx x ${money(chain.gas)}`:"Quoted gas",
		half=evaluateFarm(fp,capital,{quote,horizon,q:q/2})
	return`<div class=flows>
<div><h3>No token <b>${money(noToken)}</b></h3>
<p class=gas>${gasBasis} on ${esc(chain.name)} = ${money(gas)}<br>${pct(gas/-noToken,1)} of all-in cost
<p>Fees ${money(fees)} · time ${money(timeCost)} at ${usd(hourlyUsd)}/h
<p>Capital ${money(capitalCharge)} · ${holding}d at ${pct(riskFreeRate,0)}/yr
</div><div><h3>Token <b>${net(withToken)}</b></h3><p>Drop ${money(drop)} − claim &amp; sell ${money(claimSell)}
<p>Cost ${money(-noToken)} · Net APR ${signed(pct(result.conditionalApr))}</div>
</div>
${stats([["Capital",usd(capital)],[`Launch within ${horizon} d (q)`,pct(q)],["Break-even p*",maybe(pStar,pct)],
		["Expected net",net(gain),tone(gain)],["Quote verdict",badge(verdict)]],"metrics")}
<p class=half-q>½ q (${pct(q/2)}) · ${net(half.net)} · ${badge(half.verdict)}`
}

const quotePanel=({plan:fp,slug})=>inset("Cash flows & quotes",`
<div id=quote-result aria-live=polite>${cashFlows(fp)}</div>
${payLine(fp)}
<p>${timing}
<form id=quote data-slug="${esc(slug)}" class=quotes>
<label>Horizon<select name=horizon>${option(0,"Auto")}${html(horizons,h=>option(h,h+" days"))}</select></label>
${html(quoteFields,([k,lbl,max=1e6])=>`<label>${lbl}
<input name=${k} type=number step=any min=0 max=${max} placeholder=${fp.quote[k]}>
<small>Default</small></label>`)}
</form>`," quote")
const labels="1 Verify|2a Wait|2b Stop|2c Test withdrawal|3a Stop|3b Entry|4 Monitor|5 Exit|6 Claim & sell|7 Revisit".split("|"),
	step=(lbl,body,terms,follow)=>`<li><div><h3>${lbl}</h3><p>${esc(signed(body))}${follow?` <span>${esc(signed(follow))}</span>`:""}</div><small>${esc(signed(terms))}</small>`,
	tree=steps=>`<ol class=steps>${html(steps,([body,terms,follow,fallback,extra],i)=>
		step(labels[i],body,terms,follow)+(fallback?step("3c Wait",fallback,extra):""))}</ol>`
function detail(st,r){
	const back=`<a class=back href="${href("board",st)}">← Rankings</a>`
	if(!r) return back+intro("Unavailable")
	const {plan:fp,flags,band,ranges,rangeFarm:[low,high]}=r,
		summary=`${rowName(r)} · ${short(r.tvl_usd)} TVL · ${chg(r.change_7d)} 7d · ${days(r)} d listed`,
		lbl=`<p class=kicker>#${r.rank}/${ns.ranked}${r.watchlist?" · ◆ Watchlist":""}`,
		lead=`<p class=verdict>${badge(fp.verdict)} · ${esc(fp.ticket)} on ${esc(fp.chain.name)} · Launch within ${fp.horizon} d: ${pct(fp.q)} (q) vs p* ${maybe(fp.pStar,pct)} · ${net(fp.net)} expected`,
		stressRows=[[null,"Default"],...scenarios].map(([k,lbl])=>{
		const p=fp.stress[k]??fp,{all=verdicts,farm}=stress[k]??{}
		return[lbl,usd(p.capital),badge(p.verdict),net(p.net),grades.map(v=>farm?`${all[v]} (${farm[v]})`:all[v]).join(" / ")]
	}),
		flips=[low,high].flatMap(({verdict},i)=>verdict===fp.verdict?[]:[`flips to ${verdict} at ${i?"high":"low"} end`]),
		factors=[[usd(r.launchValue),"Launch value"],[pct(r.tokenOdds),oddsLabel],[r.haircut.toFixed(2),"Issuer factor"]]
	return`${back}${intro(esc(r.name),summary,lead,lbl)}
<div class=detail><div>
${inset("Farm checklist",`<p class=range-net>Expected net ${net(low.net)} / ${net(high.net)} · ${flips.join(" · ")||"robust across 80% range"}
<h3>Exit triggers</h3><ul class=exits>${html(fp.exits,s=>`<li>${esc(signed(s))}`)}</ul>${tree(fp.steps)}`)}
${inset(`Stress · ${fp.horizon} d · resized`,facts("Scenario|Capital|Verdict|Net|Board F/M/S",stressRows)+"<small>(Default FARM)</small>")}
</div><div>
${quotePanel(r)}
<section class="panel inset valuation">
<h2>Implied token value</h2><div class=amount>${usd(r.score)}</div>
<small class=value-range>${valueRange(ranges)}</small>
<div class=equation>${factors.map(([n,lbl])=>`<div><b>${n}</b><small>${lbl}</small></div>`).join("×")}</div>
${drivers(r)}
${stats([["Launch p10–p90",range([band.low,band.high])],
		["Odds-weighted band",range([band.weightedLow,band.weightedHigh])]],"band")}
<p>${flags.length?flags.map(esc).join(" · ")+" · MARGINAL cap":"No flags"}
</section>
${inset("Nearest traded peers",facts("Protocol|TVL|Cap",
		r.peers.map(p=>[esc(p.name),short(p.tvl_usd),short(p.mcap_usd)])))}
</div></div>`
}
function calibration(){
	const terms=[...evidence,...odds.evidence,{term:"Flat cap / TVL ratio",withTerm:selected,without:baseline,verdict:"Baseline"},...search],
		ablation=facts(["Term",...["LOO","Walk-forward","Family"].flatMap(s=>[s+" with",s+" without"]),"Verdict"],
			terms.map(({term,withTerm,without,verdict})=>[term,...valTests.flatMap(([k])=>
				[withTerm[k],without[k]].map(f=>f?.n?`${mult(f.miss,withTerm.family?3:2)} / ${hit(f.hits[1])}`:dash)),verdict]))
	return`${intro("Trading-token calibration")}
${inset("Launch probability q",`<p>${timing}<p class=odds-misses>Median miss · LOO/WF · ${mult(loo.miss)} / ${mult(walk.miss)}`)}
${inset("Terms · miss / within 3×",`<p>Odds miss: 1/P(status). Adopt: better LOO/WF, family miss rises ≤0.1×.${ablation}`)}
<div class=research>
${inset(`${ns.valueFit} screened tokens`,facts("Protocol|Family|Carried TVL|Cap|Fit",
	model.calibration.toSorted((a,b)=>b.mcap_usd-a.mcap_usd)
		.map(p=>[esc(p.name),p.family,short(p.carriedTvl),short(p.mcap_usd),short(p.launchValue)])))}
${inset(missTitle,valueStats+"<p>Flat ratio: fold median cap/carried TVL."+
	facts(["Terms after TVL",...valTests.map(([k,lbl])=>`${lbl} (n=${selected[k].n})`)],[baseline,...trials,...(selected.candidate?[selected]:[])].map(t=>[
		(t.candidate||t.terms?.join(" + ")||(t===baseline?"Flat ratio":"None"))+(t===selected?" · selected":""),
		...valTests.map(([k])=>mult(t[k].miss,3))
	])))}
</div>`
}
function audit(st){
	const peerRange=model.peerRatios.map(n=>mult(n)).join("–")
	return`${intro("Top 20 audit")}${inset("",
facts("Rank|Protocol|Raw 7d|Carried 7d|Growth|Value / TVL|Peer range|Issuer flags",
	model.audit.map(r=>[r.rank,pLink(r,st),chg(r.change_7d),chg(r.growth),
		r.change_7d==null?"Imputed":r.change_7d!==r.growth?"<b>Clipped</b>":"As reported",
		mult(r.ratio),peerRange+(r.outlier?" · outlier":""),r.flags.map(esc).join(" · ")||"—"])))}`
}
function drawer(){
	const {parameters,chainQuotes,fallbackChain,mechanisms,families,notes}=setup,
		section=(heads,obj,read)=>facts(heads,entries(obj).map(([k,v])=>[k,...read(v)]))
	return`<ul>${html(notes,s=>`<li>${esc(s)}`)}</ul>
${facts("Parameter|Value",entries(parameters).map(([k,v])=>[k.replace(/[A-Z]/g,c=>" "+c.toLowerCase()),signed(String(v))]))}
${section("Chain|Gas/tx|Funding|Time",{...chainQuotes,"Other chains":fallbackChain},([g,f,m])=>[money(g),money(f),m+" min"])}
${section("Family|Actions|Fees|Time|Deposit",mechanisms,([n,bps,m,verb,where])=>[n,bps+" bps",m+" min",verb+" "+esc(where)])}
${section("Family|Categories",families,cats=>[cats.replaceAll("|",", ")])}`
}
const pages={board:boardShell,audit,calibration,detail}
let activeRoute
function render(){
	const st=readRoute(),{route,slug}=st,focus=document.activeElement?.id,
		r=route==="detail"&&rs.find(p=>encodeURIComponent(p.slug)===slug)
	nav(st)
	view.innerHTML=pages[route](st,r)
	document.title=$("h1").textContent+" · Launch Radar"
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

$("footer").textContent=`Digest ${boardDigest}`
check.title=results.map(({name,pass})=>`${name}: ${pass?"pass":"fail"}`).join("\n")
$(".drawer").innerHTML=drawer()
$("#open").onclick=()=>$("#assumptions").showModal()
view.onclick=({target})=>{
	if(!target.matches(".chip")) return
	const help=$("#check-help")
	help.open=true
	help.firstChild.focus()
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
