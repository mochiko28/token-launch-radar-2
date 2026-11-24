"use strict";
{
const {snapshot:snap,boardDigest,manifest}=LaunchRadarData,model=buildModel(snap),
	$=sel=>document.querySelector(sel),$$=sel=>[...document.querySelectorAll(sel)]
const html=(items,draw)=>items.map(draw).join(""),view=$("#view"),check=$("#checks"),
	results=selfChecks(model,snap,boardDigest),
	passed=count(results,c=>c.pass),allPass=passed===results.length,selfCount=`${passed}/${results.length}`,
	signed=s=>s.replace(/(^|[\s$(,])-(?=\$?\d)/g,"$1−"),
	dollars=opts=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",...opts}).format,
	cents=dollars(),money=n=>signed(cents(n)),short=dollars({notation:"compact",maximumFractionDigits:2}),usd=whole
const dash="—",hit=n=>n==null?dash:pct(n,0),
	mult=(n,dp=2)=>n==null?dash:signed(n.toFixed(dp))+"×",
	sign=n=>n>0?"+":"",
	chg=n=>n==null?dash:sign(n)+signed(n.toFixed(2))+"%",
	pill=n=>n==null?dash:`<b class="change ${tone(n)}"><span aria-hidden=true>${n>0?"↑ ":n<0?"↓ ":""}</span>${chg(n)}</b>`,
	net=n=>sign(n)+money(n),decisionNet=n=>net(decisionUsd(n)),
	tone=n=>n>0?"pos":n<0?"neg":"",
	esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c])
const {rows:rs,recs,counts:ns,verdicts,stress,value,odds,assumptions:setup,board:{rows:board}}=model,
	sameHash=digest(board)===boardDigest&&digest(manifest)===digest(exportManifest(board)),
	{parameters:{horizons,tvlReference,riskFreeRate,hourlyUsd}}=setup,
	auc=odds.validation,{loo,walk}=auc,
	showAuc=fold=>fold.auc?.toFixed(3)??dash
const likenessTest=`Token-likeness test: AUC ${showAuc(walk)} walk-forward`,
	valTests=entries({loo:"Leave-one-out",walk:"Walk-forward",family:"Family hold-out"}),
	{baseline,selected,evidence,search}=value.validation,
	{ranges:{heldOut,n:rangeN},nested}=value,
	groups=[["traded","traded"],["setAside","set aside"],["recorded","token, no cap"],["ranked","ranked"]],
	choices=items=>["",...unique(items).sort()]
const grades=keys(verdicts),
	scenarios=[["doubleCost","2× cost"],["halfShare","Reward share halved"]],
	oddsLabel="Token-likeness",launchLabel=h=>`Launch chance (${h} d)`,
	cols={
	rank:["Rank","rank","asc"],name:["Protocol","name","asc"],
	value:["Implied value","score"],odds:[oddsLabel,"tokenOdds"],tvl:["TVL","tvl_usd"],
	growth:["7d TVL","change_7d"],days:["Days listed","ageDays"],
	verdict:["Verdict",p=>grades.indexOf(p.plan.verdict),"asc"],net:["Expected net",p=>p.plan.net]
}
const order=k=>cols[k][2]||"desc",filters=[
	["Scope","scope",["all","watchlist"],"All ranked","Watchlist"],
	["Family","family",choices(rs.map(p=>p.family)),"All families"],
	["Verdict","verdict",["",...grades],"All verdicts"],
	["Listed chain","chain",choices(rs.flatMap(p=>p.chains)),"All chains"],
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
const tokenLinks=(st,separator="")=>groups.map(([k,lbl])=>
	`<a href="${href("tokens",st,k)}"${st.route==="tokens"&&st.slug===k?' aria-current="page"':""}><b>${ns[k]}</b> ${lbl}</a>`).join(separator),
	searchBox=st=>`<label>Search<input id=search type=search value="${esc(st.q)}" autocomplete=off></label>`,
	matchesSearch=(p,q)=>`${p.name} ${p.slug}`.toLowerCase().includes(q.trim().toLowerCase())
const kpis=st=>`<section class=kpis>
${card("Snapshot",`<strong>${ns.total}</strong>
<div class=groups id=token-groups>${tokenLinks(st)}</div>`)}
${card(missTitle,valueStats)}
${card(`${oddsLabel} · held-out AUC`,`<div class=readings>${html(valTests.slice(0,2),([k,lbl])=>
	`<div><strong>${showAuc(auc[k])}</strong><span>${lbl}</span></div>`)}</div><p>Snapshot score from TVL and listing age compared with traded-token peers`)}
${card("Watchlist",`<strong>${ns.watchlistCovered}<small> / ${ns.watchlistTotal}</small></strong>
<p>Floor ${short(snap.floor_usd)}`)}</section>`
const option=(v,lbl,selected)=>`<option value="${esc(v)}"${selected?" selected":""}>${esc(lbl)}`,
	filterName=(k,v,name)=>name??(k==="tvl"?short(v)+"+":v),
	filter=([lbl,k,opts,...names],st)=>`<label>${lbl}<select name=${k}>${html(opts,(v,i)=>option(v,filterName(k,v,names[i]),v===st[k]))}</select></label>`
function plans(st,rows){
	const ticket=p=>p.plan.test??p.plan,
		eligible=rows.filter(p=>ticket(p).net>=0).sort((a,b)=>ticket(b).net-ticket(a).net),
		best=eligible.slice(0,5)
	return inset(`Best plans that clear break-even · ${eligible.length}/${rows.length}`,
		(best.length?`<p>Showing ${best.length} · ${rows.length-eligible.length} below break-even`+html(best,p=>{
			const f=ticket(p)
			return`<div><b class=pos>${net(f.net)} net</b>${pLink(p,st)} ${badge(p.plan.verdict)}
<small class=action>${esc(p.plan.quoteTicket(f.capital))} ${p.plan.test?"test":"entry"} · ${f.horizon} d</small>
<small class=plan-route>${esc(p.plan.route)}</small>
<small class=plan-time>${farmTime(f)}</small><small class=plan-cost>${farmCost(f)}</small></div>`
		}):"<p>No visible row clears break-even.")," plans")
}
const boardShell=st=>`${intro("Pre-token rankings","30–365 d farms")}
<div class=integrity role=group aria-label=Integrity></div>
${kpis(st)}
<div class=board><section class=panel>
<div class=bar><h2>Protocols</h2><small id=shown role=status></small></div>
<div class=filters>${searchBox(st)}
${html(filters,spec=>filter(spec,st))}</div>
<div id=active-filters></div><div id=compare></div><div id=results></div>
</section><aside class=rail id=plans></aside></div>`
function filtered({scope,family,chain,verdict,flag,tvl,q,sort,dir}){
	const field=cols[sort][1],read=typeof field==="function"?field:p=>p[field]
	return rs.filter(p=>matchesSearch(p,q)
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
	endpoints=rs.flatMap(({score,ranges})=>[score,...ranges[80]]),
	logMin=log(min(...endpoints)),logSpan=log(max(...endpoints))-logMin||1,
	barAt=n=>1+40*(log(n)-logMin)/logSpan
function equation(r,format){
	const [base,tvl,slope,...terms]=r.equation
	return`<small class=equation>$${base}M × (${tvl}M/${tvlMillions}M)^${slope}${html(terms,([label,n])=>` × ${label} ${n}`)} = ${format(r.score)}</small>`
}
function tableRow(r,st){
	const {slug,score,tokenOdds,ranges,rank,plan:fp,watchlist,tvl_usd,change_7d}=r,
		k=esc(slug),[lo,hi]=ranges[80].map(barAt)
	return`<tr data-slug="${k}">
<td class=rank>${rank}
<th scope=row>${pLink(r,st)}${r.flags.length?" <span title='Issuer flag'>!</span>":""}
<small>${rowName(r)}${watchlist?" <span class=watch title=Watchlist>◆</span>":""}
<td class=value title="80% range ${range(ranges[80])}"><b>${short(score)}</b><svg class=range aria-hidden=true><path d="M${lo} 4H${hi}"/><path d="M${barAt(score)} 0v8"/></svg>${equation(r,short)}
<td>${pct(tokenOdds,1)}<td>${short(tvl_usd)}
<td>${pill(change_7d)}
<td>${days(r)}
<td>${badge(fp.verdict)}<td>${net(fp.net)}<small>${usd(fp.capital)} · ${fp.horizon} d</small>
<td><input type=checkbox data-compare="${k}" id=pick-${rank} aria-label="Compare ${esc(r.name)}"${st.compare.includes(slug)?" checked":st.compare.length===3?" disabled":""}>`
}
function compare(st){
	const picks=st.compare.map(slug=>bySlug.get(slug))
	if(!picks.length) return ""
	const update=(compare,lbl,title=lbl)=>`<a class=btn href="${href("board",{...st,compare})}" title="${esc(title)}">${lbl}</a>`,
		heads=picks.map(p=>pLink(p,st)+" "+update(st.compare.filter(s=>s!==p.slug),"×",`Remove ${p.name}`)),
		stats=[["Value",p=>short(p.score)],["TVL",p=>short(p.tvl_usd)],
		["Verdict",p=>badge(p.plan.verdict)],["Expected net",p=>net(p.plan.net)]]
	return`<div class=compare><div class=bar><h2>Compare</h2>${update([],"Clear")}</div>
${facts(["Metric",...heads],stats.map(([lbl,read])=>[lbl,...picks.map(read)]))}</div>`
}
function matchesExport(rank,slug,value,verdict,format){
	const row=manifest?.[rank-1]
	return row?.[0]===rank&&row[1]===slug&&format(row[2])===value&&row[3]===verdict
}
const rowStatus=(matched,total,pass)=>!total?"No rows to verify":
	`${pass?"Shown rows = board.json (digest ok)":"Export check failed"} · ${matched}/${total}`
function verifyRows(rows,st){
	const trs=$$("#results tbody tr"),
		total=rows.length,sorted=trs.length===total&&$(`[aria-sort=${ariaSort(st)}] #sort-${st.sort}`)
			&&trs.every((tr,i)=>tr.dataset.slug===rows[i].slug)
	const matched=count(trs,tr=>{
		const [rank,,value,odds]=tr.cells,n=Number(rank.textContent)
		return matchesExport(n,tr.dataset.slug,value.firstElementChild.textContent,tr.querySelector(".badge")?.textContent,short)
			&&odds.textContent===pct(board[n-1].token_odds,1)
	})
	const pass=!!(sameHash&&sorted&&matched===total)
	$(".integrity").innerHTML=html([
		[total?pass:null,rowStatus(matched,total,pass)],
		[ns.watchlistCovered===ns.watchlistTotal,`Export watchlist ${ns.watchlistCovered}/${ns.watchlistTotal}`],
		[allPass,selfCount+" checks"]
	],([ok,lbl])=>`<span class=chip data-pass=${ok}>${ok==null?"":ok?"✓ ":"✗ "}${lbl}</span>`)
}
function drawBoard(st){
	const rows=filtered(st),activeFilters=filters.flatMap(([lbl,k,opts,...names])=>
		st[k]===defaults[k]?[]:[`${k==="chain"?"Listed on":lbl}: ${filterName(k,st[k],names[opts.indexOf(st[k])])}`])
	if(st.q.trim()) activeFilters.unshift(`Search: ${st.q.trim()}`)
	$("#token-groups").innerHTML=tokenLinks(st)
	$("#active-filters").innerHTML=activeFilters.length?`${html(activeFilters,s=>`<span class=chip>${esc(s)}</span>`)}
<a class=btn href="${href("board",{...st,...defaults,sort:st.sort})}">Reset filters</a>`:""
	$("#shown").textContent=`${rows.length}/${st.scope==="watchlist"?ns.watchlistCovered:ns.ranked} shown`
	const heads=html(entries(cols),([k,[lbl]])=>{
		const active=k===st.sort,dir=active?(st.dir==="asc"?"desc":"asc"):order(k)
		if(k==="rank"&&activeFilters.length) lbl=`Rank (of ${ns.ranked})`
		return`<th${active?` aria-sort=${ariaSort(st)}`:""}>
<a id=sort-${k} href="${href("board",{...st,sort:k,dir})}">${lbl}${active?` <span aria-hidden=true>${dir==="desc"?"↑":"↓"}</span>`:""}</a>`
	})+"<th>Compare"
	$("#results").innerHTML=rows.length?table("ranks",heads,html(rows,r=>tableRow(r,st))," role=region aria-label=Rankings"):"<p class=empty>No matches."
	verifyRows(rows,st)
	$("#plans").innerHTML=plans(st,rows)
	$("#compare").innerHTML=compare(st)
}

const table=(kind,heads,body,attrs="")=>`<div class=scroll tabindex=0${attrs}><table class=${kind}><thead><tr>${heads}<tbody>${body}</table></div>`,
	facts=(heads,rs)=>table("facts","<th>"+(typeof heads==="string"?heads.split("|"):heads).join("<th>"),
		html(rs,([first,...cells])=>`<tr><th scope=row>${first}<td>${cells.join("<td>")}`))
function valueSources(r){
	const miss=(rows,label)=>{
		const test=rows.find(e=>e.term===label)
		return test?` · ${mult(test.withTerm.walk.miss,3)} vs ${mult(test.without.walk.miss,3)}`:""
	}
	return`<div class=sources><p>Base and power fit to traded caps.
<p>Walk-forward median miss · with vs without
<p>TVL from snapshot ${usd(r.tvl_usd)}${miss(evidence,"TVL exponent")}
<p>7-day TVL change from snapshot ${chg(r.change_7d)}${r.growth!==r.change_7d?` (uses ${chg(r.growth)})`:""}${miss(evidence,"7d carry")}
<p>Token-likeness uses TVL and days listed without a token (${r.ageDays==null?"median used":days(r)+" d"}). TVL${miss(odds.evidence,"TVL in token-likeness")}. Age${miss(odds.evidence,"Age in token-likeness")}.
<p>Issuer factor · ${r.flags.length?r.flags.map(esc).join(" · ")+" · MARGINAL cap":"No flags"} · ${flagNote}</div>`
}
const quoteFields=[
	["entryGas","Entry gas $"],["exitGas","Exit gas $"],["slippage","Slippage %",100],
	["delay","Exit delay (d)",36500],["lockup","Lockup days",36500]
],
	maybeMoney=n=>n==null?"unreachable":money(n),
	quoteHeadline=(fp,{capital,horizon})=>`Decision scenario · ${fp.quoteTicket(capital)} · ${horizon} d`
function cashFlows(fp,quote,result){
	const {horizon,q,capital,noToken,withToken,pStar,gas,holding,drop,claimSell,verdict,net:gain}=result,
		{chain,transactions}=fp,gasBasis=quote.entryGas===fp.quote.entryGas&&quote.exitGas===fp.quote.exitGas
			?`${transactions} tx × ${money(chain.gas)}`:"Quoted gas",
		half=evaluateFarm(fp,capital,{quote,horizon,q:q/2}),pay=targetsFor(result,quote),
		[marginal,farm]=pay.targets.map(t=>`${needs(t.odds,q)} or drop ${maybeMoney(t.drop)}`)
	return`<div class=decision>
<p><b>${launchLabel(horizon)} ${chance(q)} · Token outcome ${decisionNet(withToken)}</b>
<p><b>No-token outcome ${decisionNet(noToken)}</b>
<p>${farmCost(result)}
<p>${farmTime(result)} at ${usd(hourlyUsd)}/h · carry at ${pct(riskFreeRate,0)}/yr for ${holding} d
<p>Break-even chance ${breakEven(pStar)} → ${badge(verdict)}
<p><b>Expected net ${decisionNet(gain)}</b> = launch chance × token outcome + chance of no token × no-token outcome. Displayed figures rounded.</div>
<p class=gas>${gasBasis} on ${esc(chain.name)} = ${money(gas)}
<p>Drop ${money(drop)} − claim &amp; sell ${money(claimSell)}
<p class=half-q>Launch chance halved (${chance(q/2)}) · ${net(half.net)} · ${badge(half.verdict)}
<p class=pay><b>What would make it pay</b> · ${esc(chain.name)} · ${horizon} d${fp.capped?" · FARM needs clear flags":""}
<br>MARGINAL ${marginal} · all-in cost ≤ ${maybeMoney(pay.maxCost)}<br>FARM ${farm}`
}

const quotePanel=({plan:fp,slug})=>inset("Decision",`
<div id=quote-result aria-live=polite>${cashFlows(fp,fp.quote,fp)}</div>
<p class=timing>${setup.timing} ${likenessTest}.
<form id=quote data-slug="${esc(slug)}" class=quotes>
<label>Horizon<select name=horizon>${option(0,"Auto")}${html(horizons,h=>option(h,h+" days"))}</select></label>
${html(quoteFields,([k,lbl,max=1e6])=>`<label>${lbl}
<input name=${k} type=number step=any min=0 max=${max} placeholder=${fp.quote[k]}>
<small>Default</small></label>`)}
</form>`," quote")
const tree=steps=>`<ol class=steps>${html(steps,([label,body,terms])=>
		`<li><div><h3>${label}</h3><p>${esc(signed(body))}</div><small>${esc(terms)}</small>`)}</ol>`
function detail(st,r){
	const back=`<a class=back href="${href("board",st)}">← Rankings</a>`
	if(!r) return back+intro("Unavailable")
	const {plan:fp,ranges,rangeFarm:[low,high]}=r,
		tokenLine=r.reason==="watch"?`watchlist exception — kept despite ${r.nameRule||r.category}`:
			`pre-token — no gecko_id, no symbol, no ${r.mcap_usd==null?"":"positive "}market cap recorded in the snapshot`,
		summary=`${rowName(r)} · ${short(r.tvl_usd)} TVL · ${chg(r.change_7d)} 7d · ${days(r)} d listed<br><span id=token-reason>Token screen: ${esc(tokenLine)}</span>`,
		lbl=`<p class=kicker>#${r.rank}/${ns.ranked}${r.watchlist?" · ◆ Watchlist":""}`,
		lead=`<p><span class=route>${esc(quoteHeadline(fp,fp))}</span> · <span class=plan-route>${esc(fp.route)}</span></p>`,
		stressRows=[[null,"Default"],...scenarios].map(([k,lbl])=>{
		const p=fp.stress[k]??fp,{all=verdicts,farm}=stress[k]??{}
		return[lbl,usd(p.capital),badge(p.verdict),net(p.net),grades.map(v=>farm?`${all[v]} (${farm[v]})`:all[v]).join(" / ")]
	}),
		flips=[low,high].flatMap(({verdict},i)=>verdict===fp.verdict?[]:[`flips to ${verdict} at ${i?"high":"low"} end`])
	return`${back}${intro(esc(r.name),summary,lead,lbl)}
<div class=detail><div>
${quotePanel(r)}
<section class="panel inset valuation">
<h2>Implied token value</h2><div class=amount>${usd(r.score)}</div>
<small class=value-range>${valueRange(ranges)}</small>
${equation(r,usd)}
${valueSources(r)}
</section>
${inset("Nearest traded peers",facts("Protocol|TVL|Cap",
		r.peers.map(p=>[esc(p.name),short(p.tvl_usd),short(p.mcap_usd)]))," peers")}
</div><div>
${inset("Farm checklist · snapshot defaults",`<p class=range-net>Expected net ${net(low.net)} / ${net(high.net)} · ${flips.join(" · ")||"robust across 80% range"}
<h3>Exit triggers</h3><ul class=exits>${html(fp.exits,s=>`<li>${esc(signed(s))}`)}</ul>${tree(fp.steps)}`)}
${inset(`Stress · snapshot defaults (${fp.horizon} d)`,facts("Scenario|Capital|Verdict|Net|Board F/M/S",stressRows)+"<small>(Default FARM)</small>"," stress")}
</div></div>`
}
function calibration(){
	const terms=[...evidence,...odds.evidence,{term:"Flat cap / TVL ratio",withTerm:selected,without:baseline,verdict:"Baseline"},...search],
		ablation=facts(["Term",...["LOO","Walk-forward","Family"].flatMap(s=>[s+" with",s+" without"]),"Verdict"],
			terms.map(({term,withTerm,without,verdict})=>[term,...valTests.flatMap(([k])=>
				[withTerm[k],without[k]].map(f=>f?.n?`${mult(f.miss,withTerm.family?3:2)} / ${hit(f.hits[1])}`:dash)),verdict]))
	return`${intro("Trading-token calibration")}
${inset(oddsLabel,`<p>${likenessTest}<p class=odds-misses>Median miss · LOO/WF · ${mult(loo.miss)} / ${mult(walk.miss)}`)}
${inset("Terms · miss / within 3×",`<p>Token-likeness miss uses the inverse score for the observed status. Adopt: better LOO/WF, family miss rises ≤0.1×.${ablation}`)}
<div class=research>
${inset(`${ns.valueFit} screened tokens`,facts("Protocol|Family|Carried TVL|Cap|Fit",
	model.calibration.toSorted((a,b)=>b.mcap_usd-a.mcap_usd)
		.map(p=>[esc(p.name),p.family,short(p.carriedTvl),short(p.mcap_usd),short(p.launchValue)])))}
${inset(missTitle,valueStats+"<p>Flat ratio: fold median cap/carried TVL.")}
</div>`
}
const tokens=st=>`${intro("Token screen","Pre-token means the snapshot records no token.")}
<section class=panel><div class=bar><div id=token-groups></div><small id=shown role=status></small></div>
<div class=filters>${searchBox(st)}</div><div id=results></div></section>`
function drawTokens(st){
	const scope=statuses.includes(st.slug)?recs.filter(p=>p.status===st.slug):recs,
		rows=scope.filter(p=>matchesSearch(p,st.q)),field=v=>esc(v||dash)
	$("#token-groups").innerHTML=`<a href="${href("tokens",st)}">All ${ns.total}</a> · `+tokenLinks(st," · ")
	$("#shown").textContent=`${rows.length}/${scope.length} shown`
	$("#results").innerHTML=rows.length?facts("Protocol|Reason|Market cap ($)|gecko_id|Symbol|Category|Name rule hit",
		rows.map(p=>[bySlug.has(p.slug)?pLink(p,st):esc(p.name),reasons[p.reason][1],esc(p.mcap_usd??dash),
			field(p.gecko_id),field(p.symbol),field(p.category),field(p.nameRule)])):"<p class=empty>No matches."
}
function drawer(){
	const {chainQuotes,fallbackChain,notes}=setup
	return`<ul>${html(notes,s=>`<li>${esc(s)}`)}</ul>
${facts("Chain|Gas/tx|Funding|Time",entries({...chainQuotes,"Other chains":fallbackChain})
	.map(([k,[g,f,m]])=>[k,money(g),money(f),m+" min"]))}`
}
function verifyDetail(){
	const rank=Number($(".kicker").textContent.split("/")[0].slice(1)),saved=board[rank-1],
		steps=$$(".steps li")
	return sameHash&&matchesExport(rank,$("#quote").dataset.slug,$(".amount").textContent,$(".decision .badge").textContent,usd)
		&&$(".value-range").textContent===valueRange(saved.implied_value_ranges_usd)
		&&steps.length===saved.farm_steps.length
		&&steps.every((li,i)=>li.querySelector("p").textContent+" "+li.querySelector("small").textContent===signed(saved.farm_steps[i]))
}
const pages={board:boardShell,tokens,calibration,detail}
let activeRoute
function render(){
	const st=readRoute(),{route,slug}=st,focus=document.activeElement?.id,
		r=route==="detail"&&rs.find(p=>encodeURIComponent(p.slug)===slug)
	nav(st)
	view.innerHTML=pages[route](st,r)
	document.title=$("h1").textContent+" · Launch Radar"
	if(route==="board") drawBoard(st)
	else if(route==="tokens") drawTokens(st)
	const match=r&&verifyDetail()
	check.hidden=route==="board"
	check.textContent=selfCount+" self-checks pass"
	if(route==="detail") check.append(` · ${rowStatus(+!!match,+!!r,match)}`)
	check.dataset.pass=allPass&&(route!=="detail"||!!match)
	document.getElementById(focus)?.focus()
	if(activeRoute!==route) window.scrollTo(0,0)
	activeRoute=route
}

check.title=results.map(({name,pass})=>`${name}: ${pass?"pass":"fail"}`).join("\n")
$(".drawer").innerHTML=drawer()
$("#open").onclick=()=>$("#assumptions").showModal()
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
	const result=chooseFarm(fp,quote,+form.elements.horizon.value)
	$("#quote-result").innerHTML=cashFlows(fp,quote,result)
	$(".route").textContent=quoteHeadline(fp,result)
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
	history.replaceState(null,"",link(st.route,st,st.route==="tokens"?st.slug:""))
	nav(st)
	if(st.route==="tokens") drawTokens(st)
	else drawBoard(st)
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
