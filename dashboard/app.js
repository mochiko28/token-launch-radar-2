"use strict";
{
const {snapshot:snap,boardDigest,manifest}=LaunchRadarData,model=buildModel(snap),
	$=sel=>document.querySelector(sel),$$=sel=>[...document.querySelectorAll(sel)]
const html=(xs,fn)=>xs.map(fn).join(""),view=$("#view"),check=$("#checks"),
	text=sel=>$(sel).textContent,put=(sel,markup)=>$(sel).innerHTML=markup,
	status=id=>`<small id=${id} role=status></small>`,
	results=selfChecks(model,snap,boardDigest),
	passed=count(results,c=>c.pass),allPass=passed===results.length,selfLine=`${passed}/${results.length} self-checks pass`,
	signed=s=>s.replace(/(^|[\s$(,])-(?=\$?\d)/g,"$1−"),
	money=n=>n==null?"unreachable":signed(costUsd(n)),short=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",
		notation:"compact",maximumFractionDigits:2}).format
const dash="—",mult=n=>n==null?dash:n.toFixed(3)+"×",
	chg=n=>n==null?dash:(n>0?"+":"")+signed(n.toFixed(2))+"%",
	net=farmNet,
	esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c])
const {rows:rs,recs,counts:ns,verdicts,value,odds,assumptions:setup,board:{rows:board}}=model,
	hashOk=digest(board)===boardDigest&&same(manifest,exportManifest(board)),
	{parameters:{horizons,riskFreeRate,hourlyUsd}}=setup,
	auc=k=>odds.validation[k].auc?.toFixed(3)??dash
const aucLabel="Token-screen ranking accuracy (AUC)",
	aucLine=`${aucLabel} ${auc("walk")} walk-forward`,
	{headline,ablation,candidates,form,weight,ranges:{coverage}}=value,
	bandName=coverage.family.Pooled.n?`${bandPct}% range`:"Uncalibrated range",
	coveragePct=({n,hits})=>n?pct(hits/n,0):dash,
	groups={traded:"traded",setAside:"set aside",recorded:"token, no cap",ranked:"ranked"},
	choices=items=>["",...unique(items).sort()]
const grades=keys(verdicts),actions=actionCounts(verdicts),
	stressCases=[["doubleCost","2× cost"],["halfShare","Reward share halved"]],
	oddsTitle="Token-likeness",netTitle="Expected net",empty="<p class=empty>No matches.",
	cols={
	rank:["Rank","rank","asc"],name:["Protocol","name","asc"],
	value:["Implied value","score"],odds:[oddsTitle,"tokenOdds"],tvl:["TVL","tvl_usd"],
	growth:["7d TVL","change_7d"],days:["Days listed","ageDays"],
	verdict:["Action",p=>grades.indexOf(p.plan.verdict),"asc"],
	net:[netTitle,({plan:p})=>+costUsd((p.trial??p).net).replace(/[$,]/g,"")]
}
const order=k=>cols[k][2]||"desc",filters=[
	["Scope","scope",["all","watchlist"],"All ranked","Watchlist"],
	["Family","family",choices(rs.map(p=>p.family)),"All families"],
	["Action","verdict",["",...grades],"All actions"],
	["Listed on","chain",choices(rs.flatMap(p=>p.chains)),"All chains"],
	["Min TVL","tvl",["",1e7,5e7,1e8,5e8].map(String),"Any TVL"],
	["Issuer","flag",["","flagged","clear"],"Any issuer","Flagged","No flags"]
]
const ariaSort=st=>st.dir+"ending",base={q:"",sort:"rank",...object(filters.map(([,k,[v]])=>[k,v]))},
	bySlug=new Map(rs.map(p=>[p.slug,p])),picked=new Set
function readRoute(){
	const [path,query]=location.hash.slice(1).split("?"),[route,slug]=path.split("/"),qs=new URLSearchParams(query),
		sort=qs.get("sort"),dir=qs.get("dir"),st={...base,route:hasOwn(pages,route)?route:"board",slug,q:qs.get("q")??""}
	if(hasOwn(cols,sort)) st.sort=sort
	st.dir=["asc","desc"].includes(dir)?dir:order(st.sort)
	for(const [,k,opts] of filters){
		const v=qs.get(k)
		if(opts.includes(v)) st[k]=v
	}
	return st
}
function link(route,st,slug=""){
	const qs=new URLSearchParams()
	for(const k in base) if(st[k]!==base[k]) qs.set(k,st[k])
	if(st.dir!==order(st.sort)) qs.set("dir",st.dir)
	return "#"+route+(slug&&"/"+slug)+(qs.size?"?"+qs:"")
}
const badge=v=>`<span class="badge ${stages[v]}">${stages[v]}</span>`,
	href=(route,st,slug)=>esc(link(route,st,slug)),
	pLink=(p,st)=>`<a class=protocol href="${href("detail",st,encodeURIComponent(p.slug))}">${esc(p.name)}</a>`,
	calLink=st=>`<a class=evidence href="${href("calibration",st)}">Calibration →</a>`,
	days=r=>r.ageDays==null?dash:integer(r.ageDays),
	rowName=r=>esc(r.category||r.family),
	watch=p=>watchLines(p,short).join("<br>")
const intro=(title,copy="",lead="",lbl="")=>`<header class=intro><div>${lbl}<h1>${title}</h1>${lead}<p>${copy}</div><small>DefiLlama<br>${esc(snap.as_of)} UTC</small></header>`,
	missTitle="Median miss · full model vs flat ratio",
	panel=(kind,title,body)=>`<section class="panel ${kind}"><h2>${title}</h2>${body}</section>`,
	card=(title,body)=>panel("kpi",title,body),inset=(title,body,kind="")=>panel("inset"+kind,title,body)

const valueStats=`<p class=nested>Form chosen inside training only</p>
<div class="readings misses">${html(entries(outerTests),([k,lbl])=>{
		const {miss,flat,n}=headline[k]
		return`<div><span>${lbl} · n=${n}</span><strong>${mult(miss)}</strong> / ${mult(flat)}${miss!==null&&miss>=flat?"<small>Flat ratio ties or wins.</small>":""}</div>`
	})}</div>
<p class=coverage>${bandName} · Coverage ${coveragePct(coverage.walk.Pooled)} date / ${coveragePct(coverage.family.Pooled)} family</p>`
const dropPairs=entries(outerTerms).map(([k,label])=>[label,...schemes.map(s=>mult(ablation[k][s].miss))]),
	kept=i=>schemes.every(s=>ablation[keys(outerTerms)[i]][s].miss<headline[s].miss)?"dropped":"kept",
	dropLine=`<p class=drop>Held out without · ${dropPairs.map(([label,...miss])=>label+" "+miss.join("/")).join(" · ")}</p>`
const tokenLinks=(st,separator="")=>entries(groups).map(([k,label])=>
	`<a href="${href("tokens",st,k)}"${st.route==="tokens"&&st.slug===k?" aria-current=page":""}><b>${ns[k]}</b> ${label}</a>`).join(separator),
	searchBox=st=>`<label>Search<input id=search type=search value="${esc(st.q)}" autocomplete=off></label>`,
	matches=(p,q)=>`${p.name} ${p.slug}`.toLowerCase().includes(q.trim().toLowerCase())
const kpis=st=>`<section class=kpis>
${card("Snapshot",`<strong>${ns.total}</strong>
<div class=groups id=token-groups></div>`)}
${card(missTitle,valueStats+dropLine+calLink(st))}
${card(aucLabel,`<div class=readings>${html([["loo","Leave-one-out"],["walk",outerTests.walk]],([k,lbl])=>
	`<div><strong>${auc(k)}</strong><span>${lbl}</span></div>`)}</div><p>Token-likeness uses TVL and listing age`)}
${card(`First actions · all ${ns.ranked}`,`<b>${actions}</b><p>Watchlist floor ${short(snap.floor_usd)}`)}</section>`
const option=(v,lbl,selected)=>`<option value="${esc(v)}"${selected?" selected":""}>${esc(lbl)}`,
	select=(lbl,k,opts)=>`<label>${lbl}<select name=${k}>${opts}</select></label>`,
	optName=(k,v,name)=>name??(k==="tvl"?short(v)+"+":k==="verdict"?stages[v]:v),
	filter=([lbl,k,opts,...names],st)=>select(lbl,k,html(opts,(v,i)=>option(v,optName(k,v,names[i]),v===st[k])))
function plans(st,rows){
	const best=rows.filter(p=>p.plan.capital).sort((a,b)=>b.plan.net-a.plan.net).slice(0,5)
	return inset(`Top plans <small>${actionCounts(byGrade(rows,p=>grade(p.plan)))} in this view</small>`,
		html(best,p=>{
			const {plan:f}=p
			return`<div><b class=pos>${net(f.net)} net</b>${pLink(p,st)}
${html([firstAction(f),esc(f.route),`${f.mins} min hands-on`,`${money(f.cost)} total cost`],s=>`<small>${s}</small>`)}</div>`
		})
		||"<p>No funded plans."," plans")
}
const boardView=st=>`${intro("Pre-token rankings","30–365 d farms")}
<div class=integrity role=group aria-label=Checks></div>
${kpis(st)}
<div class=board><section class=panel>
<div class=bar><h2>Protocols</h2><small class=grid-key>Amber bar = value range · Tick = estimate · <b class=watch>◆</b> Watchlist · Status = token-likeness factor (TVL, age)</small>${status("compare-count")}${status("shown")}</div>
<div class=filters>${searchBox(st)}
${html(filters,spec=>filter(spec,st))}
<small class=chain-note>Plan route uses the cheapest priced listed chain.</small></div>
<div id=active-filters></div><div id=compare></div><div id=results></div>
</section><aside class=rail id=plans></aside></div>`
function filtered({scope,family,chain,verdict,flag,tvl,q,sort,dir}){
	const field=cols[sort][1],read=typeof field==="function"?field:p=>p[field]
	return rs.filter(p=>matches(p,q)
		&&(scope!=="watchlist"||p.watchlist)&&(!family||p.family===family)
		&&(!chain||p.chains.includes(chain))&&(!verdict||p.plan.verdict===verdict)
		&&p.tvl_usd>=+tvl&&(!flag||!!p.flags.length===(flag==="flagged"))).sort((a,b)=>{
		const x=read(a),y=read(b),cmp=x==null||y==null?+(x==null)-+(y==null)
			:(typeof x==="string"?x.localeCompare(y):x-y)*(dir==="asc"?1:-1)
		return cmp||a.rank-b.rank
	})
}
const valRange=r=>`${bandName} ${r[bandPct].map(short).join("–")}`,
	ends=rs.flatMap(({score,ranges})=>[score,...ranges[bandPct]]),
	logMin=log(min(...ends)),logSpan=log(max(...ends))-logMin||1,
	barX=n=>1+40*(log(n)-logMin)/logSpan,
	clipped=r=>r.growth!==(r.change_7d??0)
function equation(r,format){
	const [base,tvl,slope,...terms]=r.equation
	return`<small class=equation>$${base}M × (${tvl}M/${refM}M)^${slope}${html(terms,([label,n])=>` × ${label} ${n}${label==="growth"&&clipped(r)?" (clipped)":""}`)} = ${format(r.score)}</small>`
}
function rankRow(r,st){
	const {slug,score,tokenOdds,ranges,rank,plan:fp,watchlist,tvl_usd,change_7d}=r,
		[lo,hi]=ranges[bandPct].map(barX)
	return`<tr data-slug="${esc(slug)}">
<td class=rank>${rank} ${pick(r)}
<th scope=row>${pLink(r,st)}${r.flags.length?" <span title='Issuer flag'>!</span>":""}
<small>${rowName(r)}${watchlist?" <span class=watch title=Watchlist>◆</span>":""}
<td class=value title="${valRange(ranges)}"><b>${short(score)}</b><svg class=range aria-hidden=true><path d="M${lo} 4H${hi}"/><path d="M${barX(score)} 0v8"/></svg>${equation(r,short)}
<td>${pct(tokenOdds,1)}<td>${short(tvl_usd)}
<td><b class="${change_7d>0?"pos":change_7d<0?"neg":""}">${chg(change_7d)}</b>
<td>${days(r)}
<td>${badge(fp.verdict)}<td>${fp.trial?watch(fp.trial):`${stages[fp.verdict]} ${short(fp.capital)} <b>${net(fp.net)}</b><small>${fp.horizon} d</small>`}`
}
function exported(rank,slug,value,verdict,format){
	const [n,s,v,a]=manifest?.[rank-1]??[]
	return n===rank&&s===slug&&format(v)===value&&stages[a]===verdict
}
function rowCheck(rows,st){
	const trs=$$("#results tbody tr"),total=rows.length
	const pass=hashOk&&trs.length===total&&trs.every((tr,i)=>{
		const [rank,,value,odds]=tr.cells,n=+rank.textContent,{slug}=tr.dataset,cell=tr.lastElementChild,r=rows[i]
		const p=r?.plan
		return slug===r?.slug&&exported(n,slug,value.firstElementChild.textContent,tr.querySelector(".badge")?.textContent,short)
			&&odds.textContent===pct(board[n-1].token_odds,1)
			&&(p.trial?cell.innerHTML===watch(p.trial):cell.querySelector("b").textContent===net(p.net))
	})&&$(`#sort-${st.sort}`)?.parentNode.ariaSort===ariaSort(st)
	put(".integrity",html([
		[total?pass:null,!total?"No rows to verify":pass?`${total}/${total} ranks and values match board.json`:"Row check failed"],
		[hashOk&&ns.watchCovered===ns.watchTotal,`${ns.watchCovered}/${ns.watchTotal} watchlist rows exported`],
		[allPass,selfLine]
	],([ok,lbl])=>`<span class=chip data-pass=${ok}>${ok==null?"":ok?"✓ ":"✗ "}${lbl}</span>`))
}
function draw(st){
	const rows=filtered(st),chips=filters.flatMap(([lbl,k,opts,...names])=>
		st[k]===base[k]?[]:[`${lbl}: ${optName(k,st[k],names[opts.indexOf(st[k])])}`])
	if(st.q.trim()) chips.unshift(`Search: ${st.q.trim()}`)
	put("#token-groups",tokenLinks(st))
	put("#active-filters",chips.length?`${html(chips,s=>`<span class=chip>${esc(s)}</span>`)}
<a class=btn href="${href("board",{...st,...base,sort:st.sort})}">Reset filters</a>`:"")
	$("#shown").textContent=`${rows.length}/${st.scope==="watchlist"?ns.watchCovered:ns.ranked} shown`
	const heads=html(entries(cols),([k,[lbl]])=>{
		const active=k===st.sort,dir=active?(st.dir==="asc"?"desc":"asc"):order(k)
		if(k==="rank"&&chips.length) lbl=`Rank (of ${ns.ranked})`
		return`<th${active?` aria-sort=${ariaSort(st)}`:""}>
<a id=sort-${k} href="${href("board",{...st,sort:k,dir})}">${lbl}${active?` <span aria-hidden=true>${dir==="desc"?"↑":"↓"}</span>`:""}</a>`
	})
	put("#results",rows.length?table("ranks",heads,html(rows,r=>rankRow(r,st))," role=region aria-label=Rankings"):empty)
	put("#plans",plans(st,rows))
	rowCheck(rows,st)
	compare(st)
}

const table=(kind,heads,body,attrs="")=>`<div class=scroll tabindex=0${attrs}><table class=${kind}><thead><tr>${heads}<tbody>${body}</table></div>`,
	facts=(heads,rs)=>table("facts","<th>"+heads.join("<th>"),
		html(rs,([first,...cells])=>`<tr><th scope=row>${first}<td>${cells.join("<td>")}`))
const pick=r=>`<input type=checkbox name=compare value=${r.rank} aria-label="Compare ${esc(r.name)}">`
function compare(st){
	const rows=[...picked].map(rank=>rs[rank-1])
	$("#compare-count").textContent=`Compare ${picked.size}/3`
	put("#compare",picked.size?facts(["Compare",...rows.map(r=>pLink(r,st)+pick(r))],[
		[cols.value[0],r=>whole(r.score)],
		["First action",r=>firstAction(r.plan)],
		[cols.verdict[0],r=>badge(r.plan.verdict)],
		[netTitle,({plan:p})=>p.trial?watch(p.trial):net(p.net)],
		["Time / cost",({plan:p})=>p.trial?dash:`${p.mins} min hands-on · ${money(p.cost)}`]
	].map(([label,read])=>[label,...rows.map(read)])):"")
	for(const box of $$("[name=compare]")){
		box.checked=picked.has(+box.value)
		box.disabled=picked.size===3&&!box.checked
	}
}
const sources=(r,st)=>`<div class=sources><p>Value at launch ${short(r.plan.grossCap)} (traded-peer fit${r.haircut===1?"":" × issuer factor"}) · Ranked value ${short(r.score)} = that × status (rounded${r.score===1?", min $1":""})
<p>7-day growth ${chg(r.change_7d)}${clipped(r)?` (uses ${chg(r.growth)})`:""}
<p>${forms[form]} · ${r.ageDays==null?"median age":days(r)+" d listed"}${form==="shrink"?` · 1 − ${weight} × (1 − token-likeness)`:""}
<p>Issuer factor · ${r.flags.map(esc).join(" · ")||"No flags"}
<p>${calLink(st)}</div>`
const fields=[
	["entryGas","Entry gas $"],["exitGas","Exit gas $"],["slippage","Slippage %",100],
	["delay","Exit delay (d)",36500],["lockup","Lockup days",36500]
],
	actionLine=p=>firstAction(p)+(p.trial?"":` · ${netTitle} ${net(p.net)}`)
function flows(fp,quote,action,edited){
	const {trial}=action,result=trial??action
	const {horizon,q,capital,noToken,tokenNet,pStar,gas,hold,drop,claimCost,verdict,net:gain}=result,
		{chain,tx,quote:base}=fp,name=esc(chain.name),gasLabel=quote.entryGas===base.entryGas&&quote.exitGas===base.exitGas
			?`${tx} tx × ${money(chain.gas)}`:"Quoted gas",
		half=priceFarm(fp,capital,{quote,horizon,q:q/2}),pay=targetsFor(result,quote),
		[test,farm]=pay.targets.map(t=>`${needs(t.odds,q)} or reward ${money(t.drop)}`)
	return`${edited?`<p class=quote-action>With edited inputs · ${actionLine(action)}`:""}
${trial?`<p class=conditional>Conditional ticket · ${esc(fp.ticketFor(capital))} · ${horizon} d`:""}
<div class=decision>
${trial?`<div class=watch-terms>${watch(trial)}</div>`:""}
<p><b>Launch chance (${horizon} d) ${chance(q)} · Token outcome ${net(tokenNet)}</b>
<p><b>No-token outcome ${net(noToken)}</b>
<p>${farmCost(result)}
<p>${farmTime(result)} at ${whole(hourlyUsd)}/h · capital cost at ${pct(riskFreeRate,0)}/yr for ${hold} d
<p>${breakEven(pStar)} · ${badge(verdict)}
<p><b>${trial?"Net before cash reward":netTitle} ${net(gain)}</b> = launch chance × token outcome + chance of no token × no-token outcome.</div>
<p class=gas>${gasLabel} on ${name} = ${money(gas)}
<p>Token reward ${money(drop)} − claim &amp; sell ${money(claimCost)}
<p class=half-q>Launch chance halved (${chance(q/2)}) · ${net(half.net)} · ${badge(half.verdict)}
<p class=pay><b>What would make it pay</b> · ${name} · ${horizon} d${fp.flagged?" · Farm needs clear flags":""}
<br>Test ${test} · all-in cost ≤ ${money(pay.maxCost)}<br>Farm ${farm}`
}

const ticket=({plan:fp,slug})=>inset("Ticket economics",`
<div id=quote-result aria-live=polite>${flows(fp,fp.quote,fp)}</div>
<p class=timing>${aucLine}.
<form id=quote data-slug="${esc(slug)}" class=quotes>
${select("Horizon","horizon",option(0,"Auto")+html(horizons,h=>option(h,h+" days")))}
${html(fields,([k,lbl,max=1e6])=>`<label>${lbl}
<input name=${k} type=number step=any min=0 max=${max} placeholder=${fp.quote[k]}>
<small>Default</small></label>`)}
</form>`," quote")
function chart(r,p){
	const {horizon:h,pStar,q}=p.trial??p,{age,end,points}=series(odds.fit,r,h),
		top=ceil(10*max(.1,...points.map(([,p])=>p)))/10,
		x=d=>(2+296*(d-1)/(end-1)).toFixed(2),y=p=>(44-40*p/top).toFixed(2)
	return`<h3>${h}-day launch chance by days without a token</h3>
<div><span>0–${pct(top,0)} · <b>${integer(age)} d${r.ageDays==null?" (median)":""} · ${chance(q)}</b></span>
<span>${breakEven(pStar,top)}</span></div>
<svg viewBox="0 0 300 48" preserveAspectRatio=none aria-hidden=true>
${pStar!=null&&pStar<=top?`<path d="M2 ${y(pStar)}H298"/>`:""}
<polyline points="${points.map(([d,p])=>x(d)+","+y(p)).join(" ")}"/>
<circle cx=${x(age)} cy=${y(q)} r=2 /></svg>
<div><span>1 d</span><span>${integer(end)} d</span></div>
<figcaption>${setup.timing}</figcaption>`
}
const tree=steps=>`<ol class=steps>${html(steps,([label,body,terms])=>
	`<li><div><h3>${label}</h3><p>${esc(signed(body))}</div><small>${esc(signed(terms))}</small>`)}</ol>`
function detail(st,r){
	const back=`<a class=back href="${href("board",st)}">← Rankings</a>`
	if(!r) return back+intro("Unavailable")
	const {plan:fp,ranges,edgePlans,family}=r,
		kind=coverage.family[family]?family:"Other",band=coverage.family[kind]??{hits:0,n:0},
		tokenLine=r.reason==="watch"?`watchlist exception — kept despite ${r.nameRule||r.category}`:
			`no CoinGecko ID, token symbol or ${r.mcap_usd==null?"":"positive "}market cap in the snapshot`,
		summary=`${rowName(r)} · ${short(r.tvl_usd)} TVL · ${chg(r.change_7d)} 7d · ${days(r)} d listed<br><span id=token-reason>Token screen · ${esc(tokenLine)}</span>`,
		lbl=`<p class=kicker>#${r.rank}/${ns.ranked}${r.watchlist?" · ◆ Watchlist":""}`,
		lead=`<p><b class=route>${actionLine(fp)}</b> · <span class=plan-route>${esc(fp.route)}</span>
<small>All ${ns.ranked} · ${actions}</small>`,
		stressRows=[[null,"Default"],...stressCases].map(([k,lbl])=>{
		const p=fp.stress[k]??fp
		return[lbl,badge(p.verdict),net(p.net)]
	}),
		flips=edgePlans.flatMap(({verdict},i)=>verdict===fp.verdict?[]:[`flips to ${stages[verdict]} at ${i?"high":"low"} end`])
	return`${back}${intro(esc(r.name),summary,lead,lbl)}
<div class=detail><div>
${ticket(r)}
${inset("Implied token value",`<div class=amount>${whole(r.score)}</div>
<small class=value-range>${valRange(ranges)}</small>
<small>${kind}: ${band.hits}/${band.n} held-out values in range</small>
${equation(r,whole)}${sources(r,st)}`," valuation")}
${inset("Nearest traded peers",facts(["Protocol","TVL","Cap"],
		r.peers.map(p=>[esc(p.name),short(p.tvl_usd),short(p.mcap_usd)]))," peers")}
</div><div>
<figure class="panel age">${chart(r,fp)}</figure>
${inset("Farm checklist · snapshot defaults",`${fp.capital?`<p class=range-net>${netTitle} ${edgePlans.map(p=>net(p.net)).join(" / ")} · ${flips.join(" · ")||`same action at both ends of ${bandName}`}`:""}
<h3>Exit triggers</h3><ul class=exits>${html(fp.exits,s=>`<li>${esc(signed(s))}`)}</ul>${tree(fp.steps)}`)}
${fp.capital?inset("Same ticket · snapshot defaults",facts(["Scenario","Action","Net"],stressRows)," stress"):""}
</div></div>`
}
function calibration(){
	const tests=[...schemes,"pooled"],
		scores=facts(["Value form",...values(outerTests),"Pooled"],entries(forms).map(([f,label])=>
			[label+(f===form?" · deployed":""),...tests.map(k=>mult(candidates[f][k]))])),
		table=facts(["Model",...schemes.map(k=>`${outerTests[k]} · n=${headline[k].n}`),"Both tests improve?"],[
			["Full model",...schemes.map(k=>mult(headline[k].miss)),dash],
			...dropPairs.map(([label,...miss],i)=>["Without "+label,...miss,kept(i)])]),
		bands=facts(["Family",...values(outerTests)],keys(coverage.family).map(f=>[f,...schemes.map(k=>{
			const b=coverage[k][f]
			return b?.n?`${coveragePct(b)} (${b.hits}/${b.n})`:dash
		})]))
	return`${intro("Trading-token calibration")}
${inset(missTitle,valueStats+`<p>Flat uses median training cap/TVL.`)}
${inset("Reference scores on outer folds",scores," candidates")}
${inset("Held-out median miss by omitted term",table," ablation")}
${inset("80% range coverage",`<p>Fixed deployed formula. Training-only residuals, families under 8 pooled as Other, widths shrunk toward pooled.</p>`+bands," bands")}
${inset(oddsTitle,`<p class=likeness>${aucLine}. ${setup.timing}`)}`
}
const tokens=st=>`${intro("Token screen","Pre-token means no token recorded.")}
<section class=panel><div class=bar><div id=token-groups></div>${status("shown")}</div>
<div class=filters>${searchBox(st)}</div><div id=results></div></section>`
function drawTokens(st){
	const scope=hasOwn(groups,st.slug)?recs.filter(p=>p.status===st.slug):recs,
		rows=scope.filter(p=>matches(p,st.q)),field=v=>esc(v||dash)
	put("#token-groups",`<a href="${href("tokens",st)}">All ${ns.total}</a> · `+tokenLinks(st," · "))
	$("#shown").textContent=`${rows.length}/${scope.length} shown`
	put("#results",rows.length?facts(["Protocol","Reason","Market cap ($)","CoinGecko ID","Symbol","Category","Name rule hit"],
		rows.map(p=>[bySlug.has(p.slug)?pLink(p,st):esc(p.name),reasons[p.reason][1],esc(p.mcap_usd??dash),
			field(p.gecko_id),field(p.symbol),field(p.category),field(p.nameRule)])):empty)
}
function detailCheck(){
	const rank=parseInt(text(".kicker").slice(1)),saved=board[rank-1],
		fp=rs[rank-1].plan,steps=$$(".steps li")
	return hashOk&&exported(rank,$("#quote").dataset.slug,text(".amount"),stages[fp.verdict],whole)
		&&text(".route")===actionLine(fp)
		&&text(".value-range")===valRange(saved.implied_value_ranges_usd)
		&&same(steps.map(li=>li.querySelector("p").textContent+" "+li.querySelector("small").textContent),saved.farm_steps.map(signed))
}
const pages={board:boardView,tokens,calibration,detail},draws={board:draw,tokens:drawTokens}
let lastRoute
function render(){
	const st=readRoute(),{route,slug}=st,focus=document.activeElement?.id,
		r=route==="detail"&&rs.find(p=>encodeURIComponent(p.slug)===slug)
	nav(st)
	view.innerHTML=pages[route](st,r)
	document.title=text("h1")+" · Launch Radar"
	draws[route]?.(st)
	const match=r&&detailCheck()
	check.hidden=route==="board"
	check.textContent=selfLine
	if(r) check.append(match?" · Rank, value, range and checklist match board.json":" · Row check failed")
	check.dataset.pass=allPass&&(route!=="detail"||!!match)
	document.getElementById(focus)?.focus()
	if(lastRoute!==route) scrollTo(0,0)
	lastRoute=route
}

check.title=results.map(c=>(c.pass?"✓ ":"✗ ")+c.name).join("\n")
put(".drawer",`<ul>${html(setup.notes,s=>`<li>${esc(s)}`)}</ul>`)
$("#open").onclick=()=>$("#assumptions").showModal()
view.oninput=({target:el})=>{
	if(el.id==="search"){
		const st={...readRoute(),q:el.value}
		history.replaceState(null,"",link(st.route,st,st.route==="tokens"?st.slug:""))
		nav(st)
		return draws[st.route](st)
	}
	const form=el.form
	if(form?.id!=="quote") return
	const r=bySlug.get(form.dataset.slug),fp=r.plan,quote={...fp.quote}
	for(const input of $$("#quote input")){
		const valid=input.validity.valid&&input.value
		input.nextElementSibling.textContent=valid?"Quoted":"Default"
		if(valid) quote[input.name]=input.valueAsNumber
	}
	const h=+form.elements.horizon.value,action=chooseFarm(fp,quote,h)
	put("#quote-result",flows(fp,quote,action,h||!same(quote,fp.quote)))
	put(".age",chart(r,action))
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
		const n=+el.value
		if(!el.checked) picked.delete(n)
		else if(picked.size<3) picked.add(n)
		compare(readRoute())
	}
}
onhashchange=render
render()
}
