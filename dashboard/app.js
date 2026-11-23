"use strict";
{
const api=globalThis.LaunchRadar,
	{snapshot:snap,boardDigest}=globalThis.LaunchRadarData,
	model=api.buildModel(snap),
	doc=document,
	$=sel=>doc.querySelector(sel),
	$$=sel=>[...doc.querySelectorAll(sel)];
const html=(items,draw)=>items.map(draw).join(""),
	view=$("#view"),check=$("#checks"),
	checks=fromEntries(api.selfChecks(model,snap,boardDigest).map(({name,pass})=>[name,pass])),
	passed=count(values(checks),Boolean),total=keys(checks).length,
	allPass=passed===total,selfCount=`${passed}/${total}`,
	number=opts=>new Intl.NumberFormat("en-US",opts).format;
const currency={style:"currency",currency:"USD"},
	money=number(currency),
	short=number({...currency,notation:"compact",maximumFractionDigits:2}),
	usd=whole;
const pct=percent,
	hit=n=>n==null?"—":pct(n,0),
	hits=({hits:[two,three]})=>`3× ${hit(three)} · 2× ${hit(two)}`,
	mult=(n,dp=2)=>n==null?"—":n.toFixed(dp)+"×",
	sign=n=>n>0?"+":"",
	chg=n=>n==null?"—":sign(n)+n.toFixed(2)+"%",
	net=n=>sign(n)+money(n),
	tone=n=>n>0?"pos":n<0?"neg":"",
	esc=value=>String(value??"").replace(/[&<>"']/g,c=>({
	"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
})[c]);
const {rows:rs,counts:ns,verdicts,stress,portfolio,value,odds,assumptions:setup,board:{rows:board}}=model,
	hash=api.digest(board),sameHash=hash===boardDigest,
	{parameters:{horizons,tvlReference,riskFreeRate,hourlyUsd}}=setup,auc=odds.validation,
	{loo,walk}=auc,
	showAuc=fold=>fold.auc?.toFixed(3)??"—";
const timingNote=`${setup.timing} F walk-forward AUC ${showAuc(walk)} (n=${walk.n}).`,
	valTests=[["loo","Leave-one-out"],["walk","Walk-forward"],["family","Family hold-out"]],
	oddsTests=valTests.slice(0,2),
	{baseline,selected,trials,evidence,search}=value.validation,
	groups=[["traded"],["recorded","token without cap"],["setAside","set aside"],["ranked"]],
	families=unique(rs.map(p=>p.family)).sort(),chains=unique(rs.flatMap(p=>p.chains)).sort();
const grades=keys(verdicts),
	scenarios=[["doubleCost","2× cost"],["halfShare","½ share"]],
	oddsLabel="Token status odds",
	cols={
	rank:["Rank","rank","asc"],name:["Protocol","name","asc"],
	value:["Implied value","score"],odds:[oddsLabel,"tokenOdds"],tvl:["TVL","tvl_usd"],
	growth:["7d TVL","change_7d"],days:["Days listed","ageDays"],
	verdict:["Verdict",p=>grades.indexOf(p.plan.verdict),"asc"],net:["Expected net",p=>p.plan.net]
};
const order=k=>cols[k][2]||"desc",flip=dir=>dir==="asc"?"desc":"asc",
	filters=[
	["Scope","scope",["all","watchlist"],"All ranked","Watchlist"],
	["Family","family",["",...families],"All families"],
	["Verdict","verdict",["",...grades],"All verdicts"],
	["Chain","chain",["",...chains],"All chains"],
	["Min TVL","tvl",["",1e7,5e7,1e8,5e8].map(String),"Any TVL"],
	["Issuer","flag",["","flagged","clear"],"Any issuer","Flagged","No flags"]
];
const defaults={q:"",sort:"rank",...fromEntries(filters.map(([,k,[first]])=>[k,first]))},
	titles={board:"Rankings",calibration:"Calibration",audit:"Top-20 audit",detail:"Protocol"},
	bySlug=new Map(rs.map(p=>[p.slug,p]));

function readRoute(){
	const [path,query]=location.hash.slice(1).split("?"),[route,slug]=path.split("/"),
		qs=new URLSearchParams(query),sort=qs.get("sort"),dir=qs.get("dir"),
		st={route:hasOwn(titles,route)?route:"board",slug,q:qs.get("q")||"",sort:hasOwn(cols,sort)?sort:"rank",
		compare:unique(qs.getAll("compare")).filter(s=>bySlug.has(s)).slice(0,3)};
	st.dir=["asc","desc"].includes(dir)?dir:order(st.sort);
	for(const [,k,opts] of filters) st[k]=opts.find(x=>x===qs.get(k))??opts[0];
	return st;
}

function link(route,st,slug=""){
	const qs=new URLSearchParams();
	for(const k in defaults) if(st[k]!==defaults[k]) qs.set(k,st[k]);
	for(const slug of st.compare) qs.append("compare",slug);
	if(st.dir!==order(st.sort)) qs.set("dir",st.dir);
	return "#"+route+(slug?"/"+slug:"")+(qs.size?"?"+qs:"");
}
const badge=v=>`<span class="badge ${v.toLowerCase()}">${v}</span>`,
	href=(route,st,slug)=>esc(link(route,st,slug)),
	pLink=(p,st)=>`<a class=protocol href="${href("detail",st,encodeURIComponent(p.slug))}">${esc(p.name)}</a>`,
	days=r=>r.ageDays==null?"—":integer(r.ageDays);

const intro=(title,description="",lead="",lbl="")=>`<header class=intro><div>${lbl}<h1>${title}</h1>${lead}<p>${description}</div><div class=asof>DefiLlama<br><time>${esc(snap.as_of)} UTC</time></div></header>`,
	missTitle="Median held-out miss vs flat ratio",
	panel=(kind,title,body)=>`<section class="panel ${kind}">${title?`<h2>${title}</h2>`:""}${body}</section>`,
	card=(title,body)=>panel("kpi",title,body),inset=(title,body)=>panel("inset",title,body);

function valueStats(){
	const [intercept,slope]=value.fit.coefficients;
	return`<div class="readings misses">${html(valTests,([k,lbl]) =>
		`<div><span>${lbl}</span><strong>${mult(selected[k].miss,3)}</strong> / ${mult(baseline[k].miss)}<small>${hits(selected[k])}</small></div>`)}</div>
<p class=curve>${short(exp(intercept))} × (carried TVL / ${short(tvlReference)})<sup>${slope.toFixed(3)}</sup> · n=${ns.valueFit}`;
}

const kpis=()=>`<section class=kpis aria-label=Validation>
${card("Snapshot coverage",`<strong>${ns.total}</strong>
<div class=groups>${html(groups,([k,lbl=k])=>`<span><b>${ns[k]}</b> ${lbl}</span>`)}</div>`)}
${card(missTitle,valueStats())}
${card(`${oddsLabel} · held-out AUC`,`<div class=readings>${html(oddsTests,([k,lbl])=>
	`<div><strong>${showAuc(auc[k])}</strong><span>${lbl}</span></div>`)}</div><p>TVL + age`)}
${card("Watchlist coverage",`<strong>${ns.watchlistCovered}<small> / ${ns.watchlistTotal}</small></strong>
<p>TVL floor ${short(snap.floor_usd)}`)}</section>`;

const filter=([lbl,k,opts,...titles],st)=>`<label>${lbl}<select id=filter-${k} name=${k}>${html(opts,(opt,i)=>
	`<option value="${esc(opt)}"${opt===st[k]?" selected":""}>${esc(titles[i]??(k==="tvl"?short(opt)+"+":opt))}`
)}</select></label>`;

function portfolioStrip(st){
	const {positions,capital,cost,net:gain,unallocated,eligible,budget}=portfolio;
	return`<section class=portfolio>
<div><h2>${short(budget)} watchlist portfolio</h2>
<p>${positions.length}/${eligible} FARM · Shared upkeep
<p>${unallocated?usd(unallocated)+" unallocated":"Score-weighted surplus"}</div>
<div class=positions>${html(positions,p=>`<div>${pLink(p,st)}
<small>${usd(p.capital)} capital</small><small>${money(p.cost)} cost · ${net(p.net)} net</small></div>`)}</div>
	${stats([["Capital",usd(capital)],["Cost",money(cost)],["Expected net",net(gain),tone(gain)]],"totals")}</section>`;
}

const best=rs.filter(({plan:p})=>p.pStar!==null&&p.q>=p.pStar)
	.sort((a,b)=>b.plan.net-a.plan.net).slice(0,5);

function farmPanel(st){
	return`<section class="panel inset best-plans"><p>${grades.map(v=>`${verdicts[v]} ${v}`).join(" · ")} · FARM at q ≥ 2p* with clear flags. MARGINAL from p*.
<h2>Best plans that clear break-even</h2>${html(best,p=>{
		const {chain,capital,horizon,q,pStar,net:gain,cost,handsOnMinutes,verdict}=p.plan;
		return`<div><b class=pos>${net(gain)} net</b>${pLink(p,st)} ${badge(verdict)}
<small>${esc(chain.name)} · ${usd(capital)} · ${horizon} d · ${money(cost)} cost<br>q ${pct(q)} vs p* ${pct(pStar)} · ${handsOnMinutes} min hands-on</small></div>`;
	})||"No plans clear break-even."}</section>`;
}

const boardShell=st=>`${intro("Pre-token rankings","Farm horizons · 30–365 days")}
<div class=integrity role=group aria-label=Integrity></div>
	${kpis()}${st.scope==="watchlist"?portfolioStrip(st):""}
<div class=board><section class=panel>
<div class=bar><h2>Ranked protocols</h2><small id=shown role=status></small></div>
<div class=filters><label>Search<input id=search type=search value="${esc(st.q)}" autocomplete=off></label>
	${html(filters,spec=>filter(spec,st))}</div>
<div id=comparison></div><div id=results></div>
</section><aside class=rail>
	${farmPanel(st)}
${inset("Expected yield by age",`<div id=yield-chart></div>
<div class=legend>${html(grades,v=>`<span class=${v.toLowerCase()}-dot>${v}</span>`)}</div>`)}
</aside></div>
<details class="panel inset" id=checks-info><summary>Integrity</summary><ul>
<li>Export rows and digest
<li>Groups, watchlist, order, plan cost and time
<li>Value vs flat and AUC vs 0.500
</ul></details>`;

function filtered(st){
	const {scope,family,chain,verdict,flag,tvl}=st,
		query=st.q.trim().toLowerCase();
	return rs.filter(p=>(!query||`${p.name} ${p.slug}`.toLowerCase().includes(query))
		&&(scope!=="watchlist"||p.watchlist)&&(!family||p.family===family)
		&&(!chain||p.chains.includes(chain))&&(!verdict||p.plan.verdict===verdict)
		&&p.tvl_usd>=+tvl&&(!flag||!!p.flags.length===(flag==="flagged"))
	).sort((a,b)=>compareRows(a,b,st));
}

function compareRows(a,b,{sort,dir}){
	const field=cols[sort][1],
		read=typeof field==="function"?field:p=>p[field],
		x=read(a),y=read(b);
	if(x==null||y==null) return +(x==null)-+(y==null)||a.rank-b.rank;
	return(typeof x==="string"?x.localeCompare(y):x-y)*(dir==="asc"?1:-1)||a.rank-b.rank;
}

const showOdds=n=>pct(n,1),
	formula=(value,odds,issuer)=>`${short(value)} × ${showOdds(odds)} × ${issuer}`;

function tableRow(r,st){
	const {slug,score,launchValue,tokenOdds,haircut,rank,plan:fp,category,family,watchlist,tvl_usd,change_7d}=r,
		picked=st.compare.includes(slug),k=esc(slug);
	return`<tr data-slug="${k}" data-factors=${[score,launchValue,tokenOdds,haircut]}>
<td class=rank>${rank}
<th scope=row>${pLink(r,st)}${r.flags.length?" <span title='Issuer flag'>!</span>":""}
<small>${esc(category||family)}${watchlist?" <span class=watch title=Watchlist aria-label=Watchlist>◆</span>":""}
<td title="${usd(score)}"><b>${short(score)}</b>
<small>${formula(launchValue,tokenOdds,haircut)}</small>
<td>${showOdds(tokenOdds)}<td>${short(tvl_usd)}
<td class="${tone(change_7d)}">${chg(change_7d)}
<td>${days(r)}
<td>${badge(fp.verdict)}<td>${net(fp.net)}<small>${fp.horizon} d${fp.verdict==="SKIP"?` · needs ${api.oddsFactor(fp.pay.targets[0].oddsRatio)} odds`:""}</small>
<td><input type=checkbox data-compare="${k}" id=pick-${rank} aria-label="Compare ${esc(r.name)}"${picked?" checked":st.compare.length===3?" disabled":""}>`;
}

function comparison(st){
	const picks=st.compare.map(slug=>bySlug.get(slug));
	if(!picks.length) return '<p class=hint>Compare up to 3 protocols.';
	const update=(compare,lbl,title=lbl)=>`<a class=btn href="${href("board",{...st,compare})}" title="${esc(title)}">${lbl}</a>`,
		heads=picks.map(p=>pLink(p,st)+" "+update(st.compare.filter(s=>s!==p.slug),"×",`Remove ${p.name}`)),
		stats=[["Value",p=>short(p.score)],[oddsLabel,p=>pct(p.tokenOdds)],["TVL",p=>short(p.tvl_usd)],
		["7d TVL",p=>chg(p.change_7d)],["Days listed",days],["Verdict",p=>badge(p.plan.verdict)],
		["Capital",p=>usd(p.plan.capital)],["Expected net",p=>net(p.plan.net)]];
	return`<section class=compare><div class=bar><h2>Compare</h2>${update([],"Clear")}</div>
		${facts(["Metric",...heads],stats.map(([lbl,read])=>[lbl,...picks.map(read)]))}</section>`;
}

function verifyRows(rs,st){
	const trs=$$("#results tbody tr"),
		sorted=trs.length===rs.length&&(!rs.length||$(`[aria-sort=${ariaSort(st)}] #sort-${st.sort}`))
			&&trs.every((tr,i)=>tr.dataset.slug===rs[i].slug);
	const matched=count(trs,tr=>{
		const [rank,,value,odds]=tr.cells,p=board[rank?.textContent-1];
		if(!p||p.slug!==tr.dataset.slug) return false;
		const {implied_value_usd:score,launch_value_usd:base,token_odds:s,issuer_factor:factor}=p;
		return tr.dataset.factors===[score,base,s,factor].join()&&value?.title===usd(score)
			&&value.firstElementChild?.textContent===short(score)&&odds?.textContent===showOdds(s)
			&&value.lastElementChild?.textContent===formula(base,s,factor);
	});
	integrity(matched,rs.length,sorted&&matched===rs.length);
}

function integrity(matched,total,rowsPass){
	const {ranked,watchlistCovered,watchlistTotal}=ns,
		ordered=api.orderedRows(board),costed=count(board,p=>api.validSteps(p.farm_steps)),
		miss=(k,lbl)=>{
			const fold=selected[k],b=baseline[k];
			return[fold.n&&fold.miss<b.miss,`${lbl} ${mult(fold.miss)} · ${hits(fold)}`];
		};
	$(".integrity").innerHTML=html([
		[rowsPass&&sameHash,`Rows match board.json ${matched}/${total}`],
		[sameHash,`Hash ${hash}`],
		[checks["group counts"],`${ns.total}=${groups.map(([k])=>ns[k]).join("+")}`],
		[checks.coverage,`Watchlist ${watchlistCovered}/${watchlistTotal}`],
		[checks.sorted_by_value&&ordered===ranked,`Sorted ${ordered}`],
		miss("loo","Value LOO"),miss("walk","Walk"),
		[loo.auc>.5&&walk.auc>.5,`AUC ${showAuc(loo)}/${showAuc(walk)}`],
		[checks.farm_steps&&costed===ranked,`Plans ${costed}`],
		[allPass,`Checks ${selfCount}`]
	],([ok,lbl])=>`<button class=chip data-pass=${ok}>${ok?"✓":"✗"} ${lbl}</button>`);
}

const ariaSort=st=>st.dir==="asc"?"ascending":"descending";

function drawBoard(st){
	const rs=filtered(st);
	$("#shown").textContent=`${rs.length} of ${st.scope==="watchlist"?ns.watchlistCovered:ns.ranked} shown`;
	const heads=html(entries(cols),([k,[lbl]])=>{
		const active=k===st.sort,
			dir=active?flip(st.dir):order(k);
			return`<th scope=col${active?` aria-sort=${ariaSort(st)}`:""}>
<a id=sort-${k} href="${href("board",{...st,sort:k,dir})}">${lbl}${active?` <span aria-hidden=true>${dir==="desc"?"↑":"↓"}</span>`:""}</a>`;
	})+"<th scope=col>Compare";
	$("#results").innerHTML=rs.length?table("ranks",heads,html(rs,r=>tableRow(r,st))," role=region aria-label=Rankings")
		:"<p class=empty>No matching protocols.";
	verifyRows(rs,st);
	$("#yield-chart").innerHTML=yieldChart(rs);
	$("#comparison").innerHTML=comparison(st);
}

function yieldChart(rs){
	const points=rs.filter(r=>r.ageDays!=null&&Number.isFinite(r.plan.expectedYield));
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
	${html(points.reverse(),({plan:fp,ageDays,name})=>`<circle class=${fp.verdict.toLowerCase()}-dot cx=${x(ageDays)} cy=${y(fp.expectedYield)} r=3.1>
<title>${esc(name)} · ${ageDays} days · ${pct(fp.expectedYield)}</title></circle>`)}
<text x=156 y=167 text-anchor=middle>Days without a recorded token</text>
</svg><p>${points.length} plotted${rs.length>points.length?` · ${rs.length-points.length} undated`:""}`;
}

const stats=(items,kind="")=>`<dl class="${kind}">${html(items,([lbl,reading,style=""])=>
	`<div><dt>${lbl}<dd class="${style}">${reading}</div>`)}</dl>`,
	table=(kind,heads,body,attrs="")=>`<div class=scroll tabindex=0${attrs}><table class=${kind}><thead><tr>${heads}<tbody>${body}</table></div>`,
	facts=(heads,rs)=>table("facts",html(heads,title=>`<th scope=col>${title}`),
		html(rs,([first,...cells])=>`<tr><th scope=row>${first}${html(cells,cell=>`<td>${cell}`)}`));

function valueDrivers(r){
	const {rank,name,score}=model.reference,
		labels=["TVL size","7d carry","Age on odds","Issuer","Family","Rounding"],
		show=n=>n.toFixed(3)+"×",
		factors=values(r.attribution).map(show);
	return`<div class=attribution><p><b>${show(r.score/score)}</b> vs median #${rank} ${esc(name)} (${usd(score)})
	${stats(labels.map((lbl,i)=>[lbl,factors[i]]).filter(([,value],i)=>i<4||value!=="1.000×"))}</div>`;
}

const quoteFields=[
	["entryGas","Entry gas $",1e6],["exitGas","Exit gas $",1e6],["slippage","Slippage %",100],
	["delay","Exit delay (d)",36500],["lockup","Lockup days",36500]
],
	maybe=(n,format)=>n===null?"Unreachable":format(n);
function payLine({pay,horizon,capped}){
	const [marginal,farm]=pay.targets.map(t=>`q ${maybe(t.odds,pct)} (${api.oddsFactor(t.oddsRatio)}) or drop ${maybe(t.drop,money)} (${mult(t.dropRatio)})`);
	return`<p class=pay><b>What would make it pay</b> · Base ${horizon} d${capped?" · Clear flags for FARM":""}
<br>MARGINAL ${marginal} · all-in base cost ≤ ${maybe(pay.maxCost,money)}<br>FARM ${farm}`;
}

function cashFlows(fp,quote=fp.quote,result=fp){
	const {horizon,q,capital,noToken,withToken,pStar,gas,fees,timeCost,holding,capitalCharge,drop,claimSell,verdict,net:gain}=result,
		half=api.evaluateFarm(fp,capital,{quote,horizon,q:q/2});
	return`<div class=outcomes>
<div><h3>No token <b>${money(noToken)}</b></h3><p>Gas ${money(gas)} · fees ${money(fees)}
<p>Time ${money(timeCost)} at ${usd(hourlyUsd)}/h
<p>Capital ${money(capitalCharge)} · ${holding}d at ${pct(riskFreeRate,0)}/yr
</div><div><h3>Token <b>${net(withToken)}</b></h3><p>Drop ${money(drop)} − claim &amp; sell ${money(claimSell)}
<p>Less ${money(-noToken)} cost
<p>Net APR ${pct(result.conditionalApr)}</div>
</div>
	${stats([["Capital",usd(capital)],[`Launch within ${horizon} d (q)`,pct(q)],["Break-even p*",maybe(pStar,pct)],
		["Expected net",net(gain),tone(gain)],["Quote verdict",badge(verdict)]],"metrics")}
<p class=half-q>Half q (${pct(q/2)}) gives ${net(half.net)} and ${badge(half.verdict)}.`;
}

const quotePanel=({plan:fp,slug})=>inset("Cash flows &amp; quotes",`<div class=quote>
<div id=quote-result aria-live=polite>${cashFlows(fp)}</div>
	${payLine(fp)}
<p>${timingNote}
<form id=quote data-slug="${esc(slug)}" class=quotes>
<label>Horizon<select name=horizon><option value=0>Auto${html(horizons,h=>`<option value=${h}>${h} days`)}</select></label>
${html(quoteFields,([k,lbl,max])=>`<label>${lbl}
<input name=${k} type=number step=any min=0 max=${max} placeholder=${fp.quote[k]}>
<small>Default</small></label>`)}
</form>
</div>`);

function decisionTree(steps){
	const labels=["1 Verify","2a Wait","2b Stop","2c Withdrawal rehearsal","3a Stop","3b Decide on entry","4 Monitor","5 Withdraw","6 Claim &amp; sell","7 Revisit"],
		step=(lbl,body,terms,follow)=>`<li><div><h3>${lbl}</h3><p>${esc(body)}${follow?` <span>${esc(follow)}</span>`:""}</div><small>${esc(terms)}</small>`;
	return`<ol class=steps>${html(steps,([body,terms,follow,fallback,extra],i)=>
		step(labels[i],body,terms,follow)+
		(fallback?step("3c Wait",fallback,extra):""))}</ol>`;
}

function detail(r,st){
	const back=`<a class=back href="${href("board",st)}">← Back to rankings</a>`;
	if(!r) return back+intro("Protocol unavailable");
	const {plan:fp,flags,band}=r,
		age=r.ageDays==null?"Undated":days(r)+" days listed",
		summary=`${esc(r.category||r.family)} · ${short(r.tvl_usd)} TVL · ${chg(r.change_7d)} 7d · ${age}`,
		lbl=`<p class=rank-note>Rank ${r.rank}/${ns.ranked}${r.watchlist?" · ◆ Watchlist":""}</p>`,
		lead=`<p class=verdict>${badge(fp.verdict)} · ${esc(fp.ticket)} on ${esc(fp.chain.name)} · Launch within ${fp.horizon} d: ${pct(fp.q)} (q) vs p* ${maybe(fp.pStar,pct)} · ${net(fp.net)} expected`,
		stressRows=[[null,"Base"],...scenarios].map(([k,lbl])=>{
		const p=fp.stress[k]??fp,
			{all,farm}=stress[k]??{},
			ns=k?grades.map(v=>`${all[v]} (${farm[v]})`):values(verdicts);
		return[lbl,usd(p.capital),badge(p.verdict),net(p.net),ns.join(" / ")];
	}),
		range=(low,high)=>short(low)+"–"+short(high),
		factors=[[usd(r.launchValue),"Value if launched"],[pct(r.tokenOdds),oddsLabel],[r.haircut.toFixed(2),"Issuer factor"]];
	return`${back}${intro(esc(r.name),summary,lead,lbl)}
<div class=detail><div>
	${inset("Farm decision tree",`<p>${r.family} on ${esc(fp.chain.name)}${decisionTree(fp.steps)}`)}
	${inset(`Stress · ${fp.horizon} d · re-sized capital`,facts(["Scenario","Capital","Verdict","Expected net","Board F / M / S"],stressRows)+"<small>Base FARM in parentheses.</small>")}
</div><div>
	${quotePanel(r)}
<section class="panel valuation">
<h2>Implied token value</h2><div class=amount>${usd(r.score)}</div>
<div class=equation>${factors.map(([n,lbl])=>`<div><b>${n}</b><small>${lbl}</small></div>`).join("×")}</div>
	${valueDrivers(r)}
	${stats([["Launch value · p10–p90",range(band.low,band.high)],
		["Odds-weighted band",range(band.weightedLow,band.weightedHigh)]],"band")}
<p>${flags.length?flags.map(esc).join(" · ")+" · MARGINAL cap":"No flags"}
</section>
	${inset("Nearest traded peers",facts(["Protocol","TVL","Market cap"],
		r.peers.map(p=>[esc(p.name),short(p.tvl_usd),short(p.mcap_usd)])))}
</div></div>`;
}

function calibration(){
	const reading=(fold,dp)=>fold?.n?`${mult(fold.miss,dp)} / ${hit(fold.hits[1])}`:"—",
		terms=[...evidence,...odds.evidence,{term:"Flat cap / TVL ratio",withTerm:selected,without:baseline,verdict:"Baseline"},...search],
		ablation=facts(["Term",...["LOO","Walk-forward","Family"].flatMap(s=>[s+" with",s+" without"]),"Verdict"],
			terms.map(({term,withTerm,without,verdict})=>[term,
				...valTests.flatMap(([k])=>[withTerm,without].map(t=>reading(t[k],withTerm.family?3:2))),verdict]));
	return`${intro("Trading-token calibration")}
${inset("Launch probability q",`<p>${timingNote}<p class=odds-misses>Odds median miss · LOO / walk · ${mult(loo.miss)} / ${mult(walk.miss)}`)}
${inset("Term keep/drop · median miss / within 3×",`<p>Fit per fold. Odds miss = 1 / P(observed status). Keep if LOO and walk improve with family miss up ≤ 0.10×.<div id=term-tests>${ablation}</div>`)}
<div class=research>
${inset(`${ns.valueFit} screened trading tokens`,facts(["Protocol","Family","Carried TVL","Market cap","Fit"],
	model.calibration.toSorted((a,b)=>b.mcap_usd-a.mcap_usd)
		.map(p=>[esc(p.name),p.family,short(p.carriedTvl),short(p.mcap_usd),short(p.launchValue)])))}
${inset(missTitle,`${valueStats()}<p>Flat uses median cap / carried TVL per fold.`+
	facts(["Terms after TVL",...valTests.map(([k,lbl])=>`${lbl} (n=${selected[k].n})`)],[baseline,...trials,...(selected.candidate?[selected]:[])].map(t=>[
		(t.candidate||t.terms?.join(" + ")||(t===baseline?"Flat ratio":"None"))+(t===selected?" · selected":""),
		...valTests.map(([k])=>mult(t[k].miss,3))
	])))}
</div>`;
}

function audit(st){
	const peerRange=model.peerRatios.map(n=>mult(n)).join("–");
	return`${intro("Top-20 audit","By implied value")}${inset("",
facts(["Rank","Protocol","Raw 7d","Carried 7d","Growth treatment","Value / TVL","Peer range","Issuer flags"],
	model.audit.map(r=>[r.rank,pLink(r,st),chg(r.change_7d),chg(r.growth),
		r.change_7d==null?"Imputed":r.change_7d!==r.growth?"<b>Clipped</b>":"As reported",
		mult(r.ratio),peerRange+(r.outlier?" · outlier":""),r.flags.map(esc).join(" · ")||"—"])))}`;
}

function drawer(){
	const lbl=k=>k.replace(/^[a-z]|[A-Z]/g,(c,i)=>i?" "+c.toLowerCase():c.toUpperCase()),
		display=v=>[v].flat().map(n=>Number.isInteger(n)?integer(n):esc(n)).join(" · "),
		{parameters,chainQuotes,fallbackChain,mechanisms,families,notes}=setup;
	const blocks=[
		["Parameters",["Parameter","Value"],entries(parameters).map(([k,v])=>[lbl(k),display(v)])],
		["Chain quotes",["Chain","Gas/action","Funding","Time"],
			[...entries(chainQuotes),["Other chains",fallbackChain]].map(([chain,[gas,fund,min]]) =>
				[chain,money(gas),money(fund),min+" min"])],
		["Mechanisms",["Family","Actions","Fees","Time","Deposit"],entries(mechanisms)
			.map(([family,[actions,bps,min,,guidance]])=>[family,actions,bps+" bps",min+" min",guidance])],
		["Families",["Family","Categories"],entries(families).map(([f,cats])=>[f,cats.replaceAll("|",", ")])]
	];
	return`<ul>${html(notes,note=>`<li>${esc(note)}`)}</ul>${html(blocks,([title,heads,rs])=>
		`<h3>${title}</h3>${facts(heads,rs)}`)}`;
}

let activeRoute;

function render(){
	const st=readRoute(),
		focus=doc.activeElement?.id,
		{route,slug}=st,isDetail=route==="detail",
		r=isDetail&&rs.find(p=>encodeURIComponent(p.slug)===slug);
	nav(st);
	doc.title=`${r?.name??titles[route]} · Launch Radar`;
	view.innerHTML=isDetail?detail(r,st):{board:boardShell,audit,calibration}[route](st);
	if(route==="board") drawBoard(st);
	const saved=board[r?.rank-1],match=sameHash&&saved&&saved.slug===r.slug
		&&$(".amount").textContent===usd(saved.implied_value_usd);
	check.hidden=route==="board";
	check.textContent=`${selfCount} self-checks pass${allPass?"":"ed"}`;
	if(isDetail) check.append(` · ${+!!match}/1 rows match`);
	check.dataset.pass=allPass&&(!isDetail||!!match);
	doc.getElementById(focus)?.focus();
	if(activeRoute!==route) window.scrollTo(0,0);
	activeRoute=route;
}

$("footer").textContent=`Board digest ${boardDigest}`;
check.title=entries(checks).map(([name,ok])=>`${name}: ${ok?"pass":"fail"}`).join("\n");
$(".drawer").innerHTML=drawer();
$("#open").onclick=()=>$("#assumptions").showModal();
view.onclick=({target:el})=>{
	if(!el.matches(".chip")) return;
	const help=$("#checks-info");
	help.open=true;
	help.firstElementChild.focus();
};

view.oninput=({target:el})=>{
	if(el.id==="search") updateBoard({...readRoute(),q:el.value});
	const form=el.form;
	if(form?.id!=="quote") return;
	const {plan:fp}=bySlug.get(form.dataset.slug),
		quote={...fp.quote};
	for(const input of form.querySelectorAll("input")){
		const observed=input.validity.valid&&input.value;
		input.nextElementSibling.textContent=observed?"Quoted":"Default";
		if(observed) quote[input.name]=input.valueAsNumber;
	}
	$("#quote-result").innerHTML=cashFlows(fp,quote,api.chooseFarm(fp,quote,+form.elements.horizon.value));
};

function nav(st){
	$(".brand").href=link("board",st);
	for(const a of $$("nav a")){
		const {route}=a.dataset;
		a.href=link(route,st);
		a.ariaCurrent=route===(st.route==="detail"?"board":st.route)?"page":"false";
	}
}

function updateBoard(st){
	history.replaceState(null,"",link("board",st));
	nav(st);
	drawBoard(st);
}

view.onchange=({target:el})=>{
	const {compare:slug}=el.dataset,
		st=readRoute();
	if(slug){
		st.compare=el.checked?[...st.compare,slug].slice(0,3):st.compare.filter(p=>p!==slug);
		const scroll=$("#results .scroll").scrollTop;
		updateBoard(st);
		$("#results .scroll").scrollTop=scroll;
		$("#"+el.id)?.focus({preventScroll:true});
	} else if(el.matches(".filters select")){
		location.hash=link("board",{...st,[el.name]:el.value});
	}
};
window.onhashchange=render;
render();
}
