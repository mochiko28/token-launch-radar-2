"use strict";
{
const {snapshot:snap,boardDigest,manifest}=LaunchRadarData,model=buildModel(snap),
	$=sel=>document.querySelector(sel),$$=sel=>[...document.querySelectorAll(sel)]
const html=(items,draw)=>items.map(draw).join(""),view=$("#view"),check=$("#checks"),
	results=selfChecks(model,snap,boardDigest),
	passed=count(results,c=>c.pass),allPass=passed===results.length,selfCount=`${passed}/${results.length}`,
	signed=s=>s.replace(/(^|[\s$(,])-(?=\$?\d)/g,"$1−"),
	money=n=>signed(costUsd(n)),short=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",
		notation:"compact",maximumFractionDigits:2}).format,usd=whole
const dash="—",mult=n=>n==null?dash:n.toFixed(3)+"×",
	chg=n=>n==null?dash:(n>0?"+":"")+signed(n.toFixed(2))+"%",
	net=farmNet,decisionNet=n=>net(decisionUsd(n)),
	esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c])
const {rows:rs,recs,counts:ns,verdicts,value,odds,assumptions:setup,board:{rows:board}}=model,
	sameHash=digest(board)===boardDigest&&digest(manifest)===digest(exportManifest(board)),
	{parameters:{horizons,riskFreeRate,hourlyUsd}}=setup,
	showAuc=k=>odds.validation[k].auc?.toFixed(3)??dash
const aucLabel="Token-screen ranking accuracy (AUC)",
	likenessTest=`${aucLabel} ${showAuc("walk")} walk-forward`,
	{headline,ablation,issuerNote,candidates,form,weight,ranges:{label,hits,n:rangeN}}=value,
	rangeLabel=label==null?"Uncalibrated range":`${bandPercent}% range`,
	groups=[["traded","traded"],["setAside","set aside"],["recorded","token, no cap"],["ranked","ranked"]],
	choices=items=>["",...unique(items).sort()]
const grades=keys(verdicts),boardCounts=actionCounts(verdicts),
	scenarios=[["doubleCost","2× cost"],["halfShare","Reward share halved"]],
	oddsLabel="Token-likeness",netLabel="Expected net",empty="<p class=empty>No matches.",
	cols={
	rank:["Rank","rank","asc"],name:["Protocol","name","asc"],
	value:["Implied value","score"],odds:[oddsLabel,"tokenOdds"],tvl:["TVL","tvl_usd"],
	growth:["7d TVL","change_7d"],days:["Days listed","ageDays"],
	verdict:["Verdict",p=>grades.indexOf(p.plan.verdict),"asc"],net:[netLabel,p=>p.plan.net]
}
const order=k=>cols[k][2]||"desc",filters=[
	["Scope","scope",["all","watchlist"],"All ranked","Watchlist"],
	["Family","family",choices(rs.map(p=>p.family)),"All families"],
	["Verdict","verdict",["",...grades],"All verdicts"],
	["Listed on","chain",choices(rs.flatMap(p=>p.chains)),"All chains"],
	["Min TVL","tvl",["",1e7,5e7,1e8,5e8].map(String),"Any TVL"],
	["Issuer","flag",["","flagged","clear"],"Any issuer","Flagged","No flags"]
]
const ariaSort=st=>st.dir==="asc"?"ascending":"descending",defaults={q:"",sort:"rank",...object(filters.map(([,k,[v]])=>[k,v]))},
	bySlug=new Map(rs.map(p=>[p.slug,p])),compared=new Set
function readRoute(){
	const [path,query]=location.hash.slice(1).split("?"),[route,slug]=path.split("/"),qs=new URLSearchParams(query),
		get=k=>qs.get(k),sort=get("sort"),dir=get("dir"),
		st={...defaults,route:hasOwn(pages,route)?route:"board",slug,q:get("q")??""}
	if(hasOwn(cols,sort)) st.sort=sort
	st.dir=["asc","desc"].includes(dir)?dir:order(st.sort)
	for(const [,k,opts] of filters) if(opts.includes(get(k))) st[k]=get(k)
	return st
}
function link(route,st,slug=""){
	const qs=new URLSearchParams()
	for(const k in defaults) if(st[k]!==defaults[k]) qs.set(k,st[k])
	if(st.dir!==order(st.sort)) qs.set("dir",st.dir)
	return "#"+route+(slug&&"/"+slug)+(qs.size?"?"+qs:"")
}
const badge=v=>`<span class="badge ${v.toLowerCase()}">${v}</span>`,
	href=(route,st,slug)=>esc(link(route,st,slug)),
	pLink=(p,st)=>`<a class=protocol href="${href("detail",st,encodeURIComponent(p.slug))}">${esc(p.name)}</a>`,
	calLink=st=>`<a class=evidence href="${href("calibration",st)}">Calibration →</a>`,
	days=r=>r.ageDays==null?dash:integer(r.ageDays),
	rowName=r=>esc(r.category||r.family),
	watchTerms=p=>watchTermsFor(p,short).join("<small>")+"</small>"
const intro=(title,copy="",lead="",lbl="")=>`<header class=intro><div>${lbl}<h1>${title}</h1>${lead}<p>${copy}</div><small>DefiLlama<br>${esc(snap.as_of)} UTC</small></header>`,
	missTitle="Median miss vs flat ratio",
	panel=(kind,title,body)=>`<section class="panel ${kind}">${title?`<h2>${title}</h2>`:""}${body}</section>`,
	card=(title,body)=>panel("kpi",title,body),inset=(title,body,kind="")=>panel("inset"+kind,title,body)

const valueStats=`<p class=nested>Form chosen inside training only</p>
<div class="readings misses">${html(entries(outerTests),([k,lbl])=>{
		const {miss,flat,n}=headline[k]
		return`<div><span>${lbl} · n=${n}</span><strong>${mult(miss)}</strong> / ${mult(flat)}${miss!==null&&miss>=flat?"<small>Flat ratio ties or wins.</small>":""}</div>`
	})}</div>
<p class=coverage>${rangeN?`${rangeLabel} · Family holdout coverage ${label}% (${hits}/${rangeN})`:"Range coverage unavailable"}</p>`
const tokenLinks=(st,separator="")=>groups.map(([k,lbl])=>
	`<a href="${href("tokens",st,k)}"${st.route==="tokens"&&st.slug===k?' aria-current="page"':""}><b>${ns[k]}</b> ${lbl}</a>`).join(separator),
	searchBox=st=>`<label>Search<input id=search type=search value="${esc(st.q)}" autocomplete=off></label>`,
	matchesSearch=(p,q)=>`${p.name} ${p.slug}`.toLowerCase().includes(q.trim().toLowerCase())
const kpis=st=>`<section class=kpis>
${card("Snapshot",`<strong>${ns.total}</strong>
<div class=groups id=token-groups></div>`)}
${card(missTitle,valueStats+calLink(st))}
${card(aucLabel,`<div class=readings>${html([["loo","Leave-one-out"],["walk",outerTests.walk]],([k,lbl])=>
	`<div><strong>${showAuc(k)}</strong><span>${lbl}</span></div>`)}</div><p>TVL and listing age vs traded peers`)}
${card("First actions",`<b id=cover-counts>${boardCounts}</b><p>Floor ${short(snap.floor_usd)}`)}</section>`
const option=(v,lbl,selected)=>`<option value="${esc(v)}"${selected?" selected":""}>${esc(lbl)}`,
	filterName=(k,v,name)=>name??(k==="tvl"?short(v)+"+":v),
	filter=([lbl,k,opts,...names],st)=>`<label>${lbl}<select name=${k}>${html(opts,(v,i)=>option(v,filterName(k,v,names[i]),v===st[k]))}</select></label>`
function plans(st,rows){
	const best=rows.filter(p=>p.plan.capital).sort((a,b)=>b.plan.net-a.plan.net).slice(0,5)
	return inset(`Top funded plans <small id=rail-counts>${boardCounts}</small>`,
		(best.length?html(best,p=>{
			const f=p.plan
			return`<div><b class=pos>${net(f.net)} net</b>${pLink(p,st)}
<small class=action>${firstAction(f)}</small><small class=plan-route>${esc(f.route)}</small>
<small class=plan-time>${f.handsOnMinutes} min hands-on</small><small class=plan-cost>${money(f.cost)} total cost</small></div>`
		}):"<p>No funded plans in these results.")," plans")
}
const boardShell=st=>`${intro("Pre-token rankings","30–365 d farms")}
<div class=integrity role=group aria-label=Integrity></div>
${kpis(st)}
<div class=board><section class=panel>
<div class=bar><h2>Protocols</h2><small id=compare-count role=status></small><small id=shown role=status></small></div>
<div class=filters>${searchBox(st)}
${html(filters,spec=>filter(spec,st))}
<small class=chain-note>Listed on = chains in the snapshot; plan route = cheapest priced chain among them</small></div>
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
	valueRange=r=>`${rangeLabel} ${range(r[bandPercent])}`,
	endpoints=rs.flatMap(({score,ranges})=>[score,...ranges[bandPercent]]),
	logMin=log(min(...endpoints)),logSpan=log(max(...endpoints))-logMin||1,
	barAt=n=>1+40*(log(n)-logMin)/logSpan
function equation(r,format){
	const [base,tvl,slope,...terms]=r.equation
	return`<small class=equation>$${base}M × (${tvl}M/${tvlMillions}M)^${slope}${html(terms,([label,n])=>` × ${label} ${n}`)} = ${format(r.score)}</small>`
}
function tableRow(r,st){
	const {slug,score,tokenOdds,ranges,rank,plan:fp,watchlist,tvl_usd,change_7d}=r,
		[lo,hi]=ranges[bandPercent].map(barAt)
	return`<tr data-slug="${esc(slug)}">
<td class=rank>${rank} ${pick(r)}
<th scope=row>${pLink(r,st)}${r.flags.length?" <span title='Issuer flag'>!</span>":""}
<small>${rowName(r)}${watchlist?" <span class=watch title=Watchlist>◆</span>":""}
<td class=value title="${valueRange(ranges)}"><b>${short(score)}</b><svg class=range aria-hidden=true><path d="M${lo} 4H${hi}"/><path d="M${barAt(score)} 0v8"/></svg>${equation(r,short)}
<td>${pct(tokenOdds,1)}<td>${short(tvl_usd)}
<td><b class="${change_7d>0?"pos":change_7d<0?"neg":""}">${chg(change_7d)}</b>
<td>${days(r)}
<td>${badge(fp.verdict)}<td>${fp.candidate?watchTerms(fp.candidate):`${stages[fp.verdict]} ${short(fp.capital)} <b>${net(fp.net)}</b><small>${fp.horizon} d</small>`}`
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
		const [rank,,value,odds]=tr.cells,n=Number(rank.textContent),{plan:p}=rs[n-1],cell=tr.lastElementChild
		return matchesExport(n,tr.dataset.slug,value.firstElementChild.textContent,tr.querySelector(".badge")?.textContent,short)
			&&odds.textContent===pct(board[n-1].token_odds,1)
			&&(p.candidate?cell.innerHTML===watchTerms(p.candidate):cell.querySelector("b").textContent===net(p.net))
	})
	const pass=!!(sameHash&&sorted&&matched===total
		&&$("#cover-counts").textContent===$("#rail-counts").textContent)
	$(".integrity").innerHTML=html([
		[total?pass:null,rowStatus(matched,total,pass)],
		[ns.watchlistCovered===ns.watchlistTotal,`Export watchlist ${ns.watchlistCovered}/${ns.watchlistTotal}`],
		[allPass,selfCount+" checks"]
	],([ok,lbl])=>`<span class=chip data-pass=${ok}>${ok==null?"":ok?"✓ ":"✗ "}${lbl}</span>`)
}
function drawBoard(st){
	const rows=filtered(st),activeFilters=filters.flatMap(([lbl,k,opts,...names])=>
		st[k]===defaults[k]?[]:[`${lbl}: ${filterName(k,st[k],names[opts.indexOf(st[k])])}`])
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
	})
	$("#results").innerHTML=rows.length?table("ranks",heads,html(rows,r=>tableRow(r,st))," role=region aria-label=Rankings"):empty
	$("#plans").innerHTML=plans(st,rows)
	verifyRows(rows,st)
	drawCompare(st)
}

const table=(kind,heads,body,attrs="")=>`<div class=scroll tabindex=0${attrs}><table class=${kind}><thead><tr>${heads}<tbody>${body}</table></div>`,
	facts=(heads,rs)=>table("facts","<th>"+(typeof heads==="string"?heads.split("|"):heads).join("<th>"),
		html(rs,([first,...cells])=>`<tr><th scope=row>${first}<td>${cells.join("<td>")}`))
const pick=r=>`<input type=checkbox name=compare value=${r.rank} aria-label="Compare ${esc(r.name)}">`
function drawCompare(st){
	const rows=[...compared].map(rank=>rs[rank-1]),size=rows.length
	$("#compare-count").textContent=`Compare ${size}/3`
	$("#compare").innerHTML=size?facts(["Compare",...rows.map(r=>pLink(r,st)+pick(r))],[
		[cols.value[0],...rows.map(r=>usd(r.score))],
		["First action",...rows.map(r=>firstAction(r.plan))],
		[cols.verdict[0],...rows.map(r=>badge(r.plan.verdict))],
		[netLabel,...rows.map(({plan:p})=>p.candidate?watchTerms(p.candidate):net(p.net))],
		["Time / cost",...rows.map(({plan:p})=>p.candidate?dash:`${p.handsOnMinutes} min hands-on · ${money(p.cost)}`)]
	]):""
	for(const box of $$("input[name=compare]")){
		box.checked=compared.has(+box.value)
		box.disabled=size===3&&!box.checked
	}
}
function valueSources(r,st){
	return`<div class=sources><p>Traded-cap fit ${usd(r.launchValue)}
<p>7-day growth ${chg(r.change_7d)}${r.growth!==r.change_7d?` (uses ${chg(r.growth)})`:""}
<p>${forms[form]} · ${r.ageDays==null?"median age":days(r)+" d listed"}${form==="shrink"?` · 1 − ${weight} × (1 − token-likeness)`:""}
<p>Issuer factor · ${r.flags.map(esc).join(" · ")||"No flags"}
<p>${calLink(st)}</div>`
}
const quoteFields=[
	["entryGas","Entry gas $"],["exitGas","Exit gas $"],["slippage","Slippage %",100],
	["delay","Exit delay (d)",36500],["lockup","Lockup days",36500]
],
	maybeMoney=n=>n==null?"unreachable":money(n),
	actionLine=p=>firstAction(p)+(p.candidate?"":` · ${netLabel} ${net(p.net)}`)
function cashFlows(fp,quote,action,edited=false){
	const result=action.candidate??action
	const {horizon,q,capital,noToken,withToken,pStar,gas,holding,drop,claimSell,verdict,net:gain}=result,
		{chain,transactions}=fp,gasBasis=quote.entryGas===fp.quote.entryGas&&quote.exitGas===fp.quote.exitGas
			?`${transactions} tx × ${money(chain.gas)}`:"Quoted gas",
		half=evaluateFarm(fp,capital,{quote,horizon,q:q/2}),pay=targetsFor(result,quote),
		[marginal,farm]=pay.targets.map(t=>`${needs(t.odds,q)} or drop ${maybeMoney(t.drop)}`)
	return`${edited?`<p class=quote-action>With edited inputs · ${actionLine(action)}`:""}
${action.candidate?`<p class=conditional>Conditional ticket · ${esc(fp.quoteTicket(capital))} · ${horizon} d`:""}
<div class=decision>
${action.candidate?`<div class=watch-terms>${watchTerms(result)}</div>`:""}
<p><b>Launch chance (${horizon} d) ${chance(q)} · Token outcome ${decisionNet(withToken)}</b>
<p><b>No-token outcome ${decisionNet(noToken)}</b>
<p>${farmCost(result)}
<p>${farmTime(result)} at ${usd(hourlyUsd)}/h · carry at ${pct(riskFreeRate,0)}/yr for ${holding} d
<p>Break-even chance ${breakEven(pStar)} → ${badge(verdict)}
<p><b>${action.candidate?"Net before cash reward":netLabel} ${decisionNet(gain)}</b> = launch chance × token outcome + chance of no token × no-token outcome.</div>
<p class=gas>${gasBasis} on ${esc(chain.name)} = ${money(gas)}
<p>Drop ${money(drop)} − claim &amp; sell ${money(claimSell)}
<p class=half-q>Launch chance halved (${chance(q/2)}) · ${net(half.net)} · ${badge(half.verdict)}
<p class=pay><b>What would make it pay</b> · ${esc(chain.name)} · ${horizon} d${fp.capped?" · FARM needs clear flags":""}
<br>MARGINAL ${marginal} · all-in cost ≤ ${maybeMoney(pay.maxCost)}<br>FARM ${farm}`
}

const quotePanel=({plan:fp,slug})=>inset("Ticket economics",`
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
	const {plan:fp,ranges,rangeFarm}=r,
		tokenLine=r.reason==="watch"?`watchlist exception — kept despite ${r.nameRule||r.category}`:
			`pre-token — no gecko_id, no symbol, no ${r.mcap_usd==null?"":"positive "}market cap recorded in the snapshot`,
		summary=`${rowName(r)} · ${short(r.tvl_usd)} TVL · ${chg(r.change_7d)} 7d · ${days(r)} d listed<br><span id=token-reason>Token screen: ${esc(tokenLine)}</span>`,
		lbl=`<p class=kicker>#${r.rank}/${ns.ranked}${r.watchlist?" · ◆ Watchlist":""}`,
		lead=`<p><b class=route>${actionLine(fp)}</b> · <span class=plan-route>${esc(fp.route)}</span>
<small id=detail-counts>${boardCounts}</small></p>`,
		stressRows=[[null,"Default"],...scenarios].map(([k,lbl])=>{
		const p=fp.stress[k]??fp
		return[lbl,badge(p.verdict),net(p.net)]
	}),
		flips=rangeFarm.flatMap(({verdict},i)=>verdict===fp.verdict?[]:[`flips to ${verdict} at ${i?"high":"low"} end`])
	return`${back}${intro(esc(r.name),summary,lead,lbl)}
<div class=detail><div>
${quotePanel(r)}
${inset("Implied token value",`<div class=amount>${usd(r.score)}</div>
<small class=value-range>${valueRange(ranges)}</small>
${equation(r,usd)}${valueSources(r,st)}`," valuation")}
${inset("Nearest traded peers",facts("Protocol|TVL|Cap",
		r.peers.map(p=>[esc(p.name),short(p.tvl_usd),short(p.mcap_usd)]))," peers")}
</div><div>
${inset("Farm checklist · snapshot defaults",`${fp.capital?`<p class=range-net>${netLabel} ${rangeFarm.map(p=>net(p.net)).join(" / ")} · ${flips.join(" · ")||`same verdict at both ends of ${rangeLabel}`}`:""}
<h3>Exit triggers</h3><ul class=exits>${html(fp.exits,s=>`<li>${esc(signed(s))}`)}</ul>${tree(fp.steps)}`)}
${fp.capital?inset("Same ticket · snapshot defaults",facts("Scenario|Verdict|Net",stressRows)," stress"):""}
</div></div>`
}
function calibration(){
	const axes=[...values(outerTests),"Pooled"],tests=[...keys(outerTests),"pooled"],
		scores=facts(["Value form",...axes],entries(forms).map(([f,label])=>
			[label+(f===form?" · deployed":""),...tests.map(k=>mult(candidates[f][k]))])),
		table=facts(["Term",...axes],ablation.map(({term,withTerm,without})=>
			[term,...tests.map(k=>`${mult(withTerm[k])} / ${mult(without[k])}`)]))
	return`${intro("Trading-token calibration")}
${inset(missTitle,valueStats+`<p>Flat uses median training cap/TVL. Ranges use leave-one-out cap residuals.`)}
${inset("Candidates scored on outer folds, for reference",scores," candidates")}
${inset("Deployed terms · median miss with / without",table," ablation")}
${inset(oddsLabel,`<p class=likeness>${likenessTest}. ${setup.timing}`)}`
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
			field(p.gecko_id),field(p.symbol),field(p.category),field(p.nameRule)])):empty
}
function verifyDetail(){
	const rank=Number($(".kicker").textContent.split("/")[0].slice(1)),saved=board[rank-1],
		steps=$$(".steps li"),fp=rs[rank-1].plan
	return sameHash&&matchesExport(rank,$("#quote").dataset.slug,$(".amount").textContent,fp.verdict,usd)
		&&$(".route").textContent===actionLine(fp)&&$("#detail-counts").textContent===boardCounts
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
$(".drawer").innerHTML=`<ul><li>Issuer factor · ${issuerNote}${html(setup.notes,s=>`<li>${esc(s)}`)}</ul>`
$("#open").onclick=()=>$("#assumptions").showModal()
view.oninput=({target:el})=>{
	if(el.id==="search"){
		const st={...readRoute(),q:el.value}
		history.replaceState(null,"",link(st.route,st,st.route==="tokens"?st.slug:""))
		nav(st)
		return (st.route==="tokens"?drawTokens:drawBoard)(st)
	}
	const form=el.form
	if(form?.id!=="quote") return
	const fp=bySlug.get(form.dataset.slug).plan,quote={...fp.quote}
	for(const input of form.querySelectorAll("input")){
		const observed=input.validity.valid&&input.value
		input.nextElementSibling.textContent=observed?"Quoted":"Default"
		if(observed) quote[input.name]=input.valueAsNumber
	}
	const h=+form.elements.horizon.value,edited=h||!same(quote,fp.quote)
	$("#quote-result").innerHTML=cashFlows(fp,quote,chooseFarm(fp,quote,h),edited)
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
view.onchange=({target:el})=>{
	if(el.matches(".filters select")) location.hash=link("board",{...readRoute(),[el.name]:el.value})
	if(el.name==="compare"){
		if(!el.checked) compared.delete(+el.value)
		else if(compared.size<3) compared.add(+el.value)
		drawCompare(readRoute())
	}
}
onhashchange=render
render()
}
