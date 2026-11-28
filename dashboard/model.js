"use strict";
const tableData=(numbers,table)=>Object.fromEntries(table.trim().split("\n").map(line=>{
	const [key,...fields]=line.split("|")
	return [key,fields.map((field,i)=>i<numbers?Number(field):field)]
}))
const chainQuotes=tableData(3,`
Ethereum|4.5|9|25
Bitcoin|3|9|60
Solana|.08|1.8|8
Base|.16|.8|8
Arbitrum|.23|1.2|10
Optimism|.19|1|10
Binance|.18|1.2|9
Polygon|.12|.9|9
Avalanche|.3|1.5|12
Monad|.15|1.2|12
Ink|.17|1.1|10
Plasma|.14|1.3|14
Hyperliquid L1|.23|1.6|15
Sui|.12|1.6|12
Aptos|.12|1.5|12
Stellar|.08|1.8|12
Flare|.16|1.9|15
Algorand|.09|2|12
Ripple|.12|2.1|14
Tron|1.2|3.5|16
Linea|.24|1.3|15
Mantle|.22|1.5|14
Sonic|.15|1.5|12
Scroll|.25|1.5|15
xDai|.13|1.4|12
Berachain|.24|1.5|15
TON|.25|2|15
Near|.18|2|15
Starknet|.26|1.5|18
Celo|.13|1.5|12
zkSync Era|.24|1.5|16
Unichain|.18|1.3|12
World Chain|.21|1.5|12
Ronin|.21|1.7|15
Sei|.18|1.8|15
Cardano|.32|2.5|20
Plume Mainnet|.24|1.7|16
Arc|.2|1.7|15
Pharos|.25|2|18
CORE|.27|2.3|18
Bittensor|.32|2.7|18
BSquared|.35|3|22
Noble|.25|2|15
Mezo|.34|2.6|17`),
	fallback=[1.5,5,30],ethChains=["Ethereum","Base","Arbitrum","Optimism","Linea","Ink","Scroll","zkSync Era"],
	assets={
		Algorand:"ALGO",Bitcoin:"BTC",BSquared:"BTC",CORE:"CORE",Flare:"FLR","Hyperliquid L1":"HYPE",
		Mezo:"BTC",Monad:"MON",Near:"NEAR",Qubic:"QU",Solana:"SOL",Stacks:"STX",Starknet:"STRK",
		Sui:"SUI",TON:"TON",XDC:"XDC","Bifrost Network":"BNC",Mixin:"XIN",XION:"XION",ZIGChain:"ZIG"
	},
	families={
		Lending:"Lending|Uncollateralized Lending|Collateral Markets|Collateral Management",
		Vault:"Yield|Yield Aggregator|Risk Curators|Onchain Capital Allocator|Basis Trading|Leveraged Farming|Farm|Indexes|Options Vault|CeDeFi",
		LP:"Dexs|Liquidity Manager",
		Perps:"Derivatives|Synthetics|Options|Interest Rate Derivatives|Prediction Market",
		Staking:"Liquid Staking|Liquid Restaking|Staking Pool|Restaking|Token Locker|Governance Incentives",
		RWA:"RWA",
		Stablecoin:"CDP|CDP Manager|Algo-Stables|Dual-Token Stablecoin|Stablecoin Wrapper|Stablecoin Issuer|Reserve Currency",
		Network:"Chain|Payments|Decentralized BTC|Anchor BTC|Cross Chain Bridge",
		Insurance:"Insurance"
	},
	A={
		clip:[-30,30],haircut:.65,year:365,refTvl:1e8,fallbackAge:365,
		oddsRidge:1,capWarmup:25,oddsWarmup:60,
		hourlyUsd:20,depositorShare:.05,tvlShare:.2,
		tickets:[1000,2500,5000,10000,25000,50000],farmRatio:2,
		stressCost:2,stressShare:.5,weeklyMins:2,routeMins:6,verifyMinutes:8,
		exitTvlShare:.75,exitMins:10,exitQ:.1,reviewIn:14,
		horizons:[30,90,180,365],riskFreeRate:.04,testUsd:80,testMinutes:6,
		claimMins:8,claimTx:2,
		peerCount:3,categoryGap:1,familyGap:.45
	}
const {entries,fromEntries:object,groupBy,hasOwn,keys,values}=Object,{isFinite:finite,isInteger}=Number,
	mechanisms=tableData(3,`
Lending|3|4|9|supply|to deepest stablecoin market. Borrow <30% LTV if needed|utilization, LTV
Vault|3|12|12|deposit|in liquid yield vault. Hold shares|share price, exits
LP|4|30|14|pair|in deepest pool. Stay in range|depth, range
Perps|4|25|14|post|as margin. If needed, 1 unlevered min-size round trip/wk|fills, margin
Staking|3|12|11|stake|in pool. Hold receipt|slashing, unbonding
RWA|3|25|16|subscribe with|in KYC fund with open redemptions|NAV, redemption dates
Stablecoin|4|18|13|supply|to deepest reserve|peg, liquidity
Network|3|15|13|deposit|and verify settlement|return liquidity
Insurance|3|25|14|supply|to underwriting pool|claims, exit queue
Other|3|20|13|deposit|in the rewards product|eligible balance`),
	plays=tableData(0,`
CDP|post|as collateral. Mint <30% LTV|peg, LTV
CDP Manager|post|in managed vault. Mint <30% LTV|debt ceiling, LTV
Prediction Market|post|as collateral. If needed, 2 min-size trades|fills, resolution
Liquid Restaking|restake|and hold liquid receipt|slashing, redemptions
Restaking|restake|with operator. Hold receipt|delegation, unbonding
Liquidity Manager|pair|in managed range vault. Hold LP shares|range, rebalances
Yield Aggregator|deposit|in auto-compounding vault. Hold shares|harvests, share price
Risk Curators|supply|to liquid-market curator vault. Hold shares|caps, idle liquidity
Onchain Capital Allocator|deposit|in an allocator vault. Hold shares|allocations, idle liquidity
Basis Trading|deposit|in hedged vault. Hold shares|funding, hedge drift
Leveraged Farming|deposit|in farm at 1× if supported|debt, liquidation buffer
Stablecoin Wrapper|wrap|and hold receipt|peg, unwrap liquidity
Bridge|bridge|via eligible lane. Verify receipt|return liquidity
OTC Marketplace|fund with|for eligible min-size order|settlement
Crypto Card Issuer|load|if card top-ups qualify|redemption
Privacy|deposit|in eligible privacy pool|withdrawal access`),
	{abs,ceil,exp,floor,log,max,min,round,sqrt}=Math
const record=(keys,read)=>object(keys.map(k=>[k,read(k)])),unique=items=>[...new Set(items)],
	same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),
	DAY=86_400_000,
	familyOf=new Map(entries(families).flatMap(([family,categories])=>
	categories.split("|").map(category=>[category,family])))
const products=["Bridge","Canonical Bridge","Cross Chain Bridge","Restaked BTC"],
	liquid=["Liquid Staking","Liquid Restaking"],
	version=/\s+(?:v\s*\d+(?:\.\d+)*|\d+\.\d+(?:\.\d+)*)$/i,
	exchange=/^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i,
	receiptKey=/^(wrapped|bridged|staked|restaked|savings)-/i
const byText=(a,b)=>(a>b)-(a<b),bySlug=(a,b)=>byText(a.slug,b.slug),
	rankBy=k=>(a,b)=>b[k]-a[k]||bySlug(a,b),
	limit=(value,low,high)=>min(high,max(low,value)),
	count=(rs,test)=>rs.filter(test).length,
	byGrade=(rs,get)=>record(["FARM","MARGINAL","SKIP"],v=>count(rs,p=>get(p)===v)),
	word1=name=>name.toLowerCase().match(/[\p{L}\p{N}]+/u)?.[0]
const hasToken=p=>p.mcap_usd>0||!!(p.gecko_id||p.symbol),
	score=(cap,age,issuer)=>max(1,round(cap*age*issuer)),
	costUsd=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format,
	integer=n=>round(n).toLocaleString("en-US"),whole=n=>"$"+integer(n)
const pct=(n,d=2)=>(n*100).toFixed(d)+"%",
	chance=n=>pct(n,1),breakEven=(n,top=1)=>n==null||n>1?"No launch chance breaks even at this ticket":
		`Break-even ${n>top?"↑ ":""}${chance(n)}`,
	needs=(n,q)=>(n==null||n>1?"unreachable at ":`needs ${chance(n)} vs `)+chance(q),
	wage=min=>min*A.hourlyUsd/60,
	weeks=days=>floor(days/7),
	checks=checks=>entries(checks).map(([name,pass])=>({name,pass:!!pass}))
function quant(values,fraction=.5){
	if(!values.length) return null
	const order=values.toSorted((a,b)=>a-b),
		index=(order.length-1)*fraction
	return order[floor(index)]*(1-index%1)+order[ceil(index)]*(index%1)
}
const issuers=rs=>new Set(rs.filter(hasToken).map(p=>p.firstWord)),
	flagsFor=(p,words)=>[words.has(p.firstWord)&&"Recorded issuer match",
		liquid.includes(p.category)&&"Liquid staking/restaking",version.test(p.name)&&"Versioned name"].filter(Boolean)
function prepare(snap){
	const protocols=snap.protocols.map(p=>({...p,firstWord:word1(p.name)})),
		asOf=Date.parse(snap.as_of),words=issuers(protocols)
	return protocols.map(p=>{
		const {category,name,tvl_usd:tvl,gecko_id}=p,
			family=familyOf.get(category)||"Other",
			isLiquid=liquid.includes(category),
			stamp=Date.parse(p.listed_at),
			date=finite(stamp)?stamp:null,
			ageDays=date===null?null:max(1,floor((asOf-date)/DAY)),
			growth=limit(p.change_7d??0,...A.clip),
			grownTvl=tvl*(1+growth/100),
			receipt=name.match(/\b(?:wrapped|bridged|staked)\b/i)?.[0]||(!isLiquid&&name.match(/\bstaking\b/i)?.[0]),
			venue=name.match(exchange)?.[0],wrapper=products.includes(category)||!!receipt,
			product=wrapper||category==="CEX"||!!venue,
			recorded=hasToken(p),
			watchlist=snap.watchlist.includes(p.slug),
			flags=recorded?[]:flagsFor(p,words),
			reason=p.mcap_usd>0?"cap":recorded?"id":product&&!watchlist?(wrapper?"product":"exchange"):product?"watch":"pre",
			status=reasons[reason][0],
			nameRule=[venue,receipt,...flags.filter(f=>f!=="Liquid staking/restaking")].filter(Boolean).join(" · ")
		return{...p,family,date,ageDays,growth,flags,
			product,excludedCap:product||isLiquid||receiptKey.test(gecko_id),watchlist,recorded,status,reason,nameRule,
			size:log(grownTvl/A.refTvl),rawSize:log(tvl/A.refTvl)}
	})
}
const tokenKey=({gecko_id:id,symbol,slug})=>id?"gecko:"+id:symbol?"symbol:"+symbol:slug,
	capPoints=traded=>values(groupBy(traded.filter(p=>!p.excludedCap).sort(rankBy("tvl_usd")),tokenKey))
		.map(([p])=>({...p,response:log(p.mcap_usd)})).sort(bySlug)
const medianAge=rs=>quant(rs.map(p=>p.ageDays).filter(finite))??A.fallbackAge,
	logAge=(p,fallback)=>log((p.ageDays??fallback)/A.year)
function solve(matrix,target){
	const rs=matrix.map((r,i)=>[...r,target[i]]),n=rs.length
	for(let c=0;c<n;c++){
		let pivot=c
		for(let r=c+1;r<n;r++) if(abs(rs[r][c])>abs(rs[pivot][c])) pivot=r;
		[rs[c],rs[pivot]]=[rs[pivot],rs[c]]
		const scale=rs[c][c]
		for(let j=c;j<=n;j++) rs[c][j]/=scale
		for(let r=0;r<n;r++) if(r!==c){
			const factor=rs[r][c]
			for(let j=c;j<=n;j++) rs[r][j]-=factor*rs[c][j]
		}
	}
	return rs.map(r=>r[n])
}
const dot=(row,coef)=>row.reduce((sum,x,i)=>sum+x*coef[i],0),
	zero=n=>Array(n).fill(0)

const normal=pen=>({target:zero(pen.length),matrix:pen.map((v,i)=>zero(pen.length).with(i,v))})
function accum({matrix,target},x,residual,weight=1){
	for(let i=0;i<x.length;i++){
		const xi=x[i],row=matrix[i]
		target[i]+=xi*residual
		if(xi!==0) for(let j=0;j<x.length;j++) row[j]+=xi*x[j]*weight
	}
}

function fitValue(pts,form,omit){
	const age=omit!=="age"&&(form==="direct"||form==="pooled")?medianAge(pts):0,
		families=age&&form==="pooled"?unique(pts.map(p=>p.family)):[],
		shrink=sqrt(pts.length),fit={age,families,omit},
		eq=normal([1e-8,1e-8+shrink,...(age?[shrink,...families.map(()=>4*shrink)]:[])])
	for(const p of pts) accum(eq,capInputs(fit,p),p.response)
	return{...fit,coefs:solve(eq.matrix,eq.target)}
}
function capInputs({age,families,omit},p){
	const x=[1,omit==="tvl"?log(1+p.growth/100):omit==="growth"?p.rawSize:p.size]
	if(age){
		const a=logAge(p,age)
		x.push(a,...families.map(f=>p.family===f?a:0))
	}
	return x
}
const capLog=(fit,p)=>dot(capInputs(fit,p),fit.coefs)
const leaveOut=(pts,group)=>[...Map.groupBy(pts,group).values()]
	.map(test=>[pts.filter(p=>!test.includes(p)),test]).filter(([train])=>train.length)
function folds(pts,walk,warmup=A.capWarmup){
	if(!walk) return leaveOut(pts,p=>p)
	const dated=pts.filter(p=>p.date!==null).sort((a,b)=>a.date-b.date||bySlug(a,b)),
		groups=Map.groupBy(dated,p=>p.date),splits=[]
	let i=0
	for(const test of groups.values()){
		if(i>=warmup) splits.push([dated.slice(0,i),test])
		i+=test.length
	}
	return splits
}

const blindTests=["loo","walk"]
const medianMiss=es=>es.length?exp(quant(es.map(abs))):null
const bandPct=80,levels=[.1,.9,.25,.75],byFamily=rs=>groupBy(rs,p=>p.family),
	bandKind=(groups,f)=>groups[f]?.length>=8?f:"Other",
	bandFor=(bounds,f)=>bounds[f]??bounds.Pooled
function fitBands(rows){
	const groups=byFamily(rows),kinds=groupBy(rows,r=>bandKind(groups,r.family)),
		errors=rows.map(r=>r.shipped),pooled=levels.map(q=>quant(errors,q)??0),
		local=record(keys(kinds),k=>{
			const es=kinds[k].map(r=>r.shipped),n=es.length
			return levels.map((q,i)=>(n*quant(es,q)+8*pooled[i])/(n+8))
		})
	return {...record(keys(groups),f=>local[bandKind(groups,f)]),Pooled:pooled}
}
function coverageFor(folds,groups){
	const result={Pooled:{n:0,hits:0}}
	for(const f of folds) if(f.inner.length) for(const {family,shipped} of f.rows){
		const [lo,hi]=bandFor(f.bounds,family),kind=bandKind(groups,family)
		for(const s of [result.Pooled,result[kind]??={n:0,hits:0}]){
			s.n++
			s.hits+=lo<=shipped&&shipped<=hi
		}
	}
	return result
}
const forms={current:"Full token-likeness",direct:"Age power on cap",pooled:"Family-pooled age power",shrink:"Shrunk token-likeness"},
	outerTerms={tvl:"TVL",growth:"7d growth",age:"Age"},
	outerTests={walk:"Walk-forward",family:"Leave-one-family-out"},
	schemes=keys(outerTests),
	weights=[.125,.25,.5,.75,1],
	splitsFor=(pts,k,warmup)=>k==="walk"?folds(pts,true,warmup):leaveOut(pts,p=>p.family),
	mixFor=(form,w)=>form==="current"?1:form==="shrink"?w:0,
	ageMul=(s,w)=>1-w*(1-s),
	errFor=(fit,p,s,h,w)=>p.response-log(score(exp(capLog(fit,p)),ageMul(s,w),h))
function training(test,recs,k){
	const held=new Set(test.map(tokenKey))
	return recs.filter(p=>!held.has(tokenKey(p))&&
		(k==="walk"?p.date!==null&&p.date<test[0].date:p.family!==test[0].family))
}
function valueFolds(pts,recs,cache,warmup){
	return record(schemes,k=>splitsFor(pts,k,warmup).map(([train,test])=>{
		const eligible=training(test,recs,k),ratio=quant(train.map(p=>p.mcap_usd/p.tvl_usd)),
			screen=eligible.filter(p=>!p.product),key=screen.map(p=>p.slug).join("\n"),
			odds=cache.get(key)??record(["full","tvl","age"],t=>fitOdds(screen,t)),words=issuers(eligible)
		cache.set(key,odds)
		return{train,eligible,odds,
			inputs:test.map(p=>[p,tokenOdds(odds.full,p),flagsFor(p,words).length?A.haircut:1]),
			rows:test.map(p=>({family:p.family,flat:p.response-log(p.tvl_usd*ratio)}))}
	}))
}
const capForms=["current","direct","pooled"]
function scoreRows({inputs,rows,odds},fit,w,key){
	const screen=odds[fit.omit]
	inputs.forEach(([p,s,h],i)=>rows[i][key]=errFor(fit,p,screen?tokenOdds(screen,p):s,h,w))
}
function scoreFold(fold,kinds,omit){
	const current=fitValue(fold.train,"current",omit)
	for(const k of kinds){
		const fit=k==="direct"||k==="pooled"?fitValue(fold.train,k,omit):current
		scoreRows(fold,fit,k==="current"?1:+k||0,k)
	}
}
const foldRows=fs=>fs.flatMap(f=>f.rows),
	missOf=(rows,kind)=>medianMiss(rows.map(row=>row[kind])),
	missStats=(rows,form)=>({miss:missOf(rows,form),flat:missOf(rows,"flat"),n:rows.length}),
	scoresFor=(tests,kinds)=>{
		const errors=record(schemes,k=>foldRows(tests[k])),pooled=values(errors).flat()
		return record(kinds,f=>({...record(schemes,k=>missOf(errors[k],f)),pooled:missOf(pooled,f)}))
	},
	chooseForm=({flat,...scores})=>keys(scores).filter(f=>schemes.every(k=>scores[f]?.[k]!=null&&scores[f][k]<flat[k]))
		.sort((a,b)=>scores[a].pooled-scores[b].pooled)[0]
function innerScores(folds,omit){
	const kinds=[...capForms,...weights]
	for(const fold of values(folds).flat()) scoreFold(fold,kinds,omit)
	return scoresFor(folds,["flat",...kinds])
}
const bestWeight=(scores,k)=>scores[weights[0]]?.[k]==null?.5:
	weights.reduce((a,b)=>scores[b][k]<scores[a][k]?b:a)
function confirm(fold,scores,omit){
	const w=bestWeight(scores,"pooled"),{current,direct,pooled,flat}=scores,
		form=chooseForm({current,direct,pooled,shrink:scores[w],flat})??"current",
		fit=fitValue(fold.train,form,omit)
	if(omit) (fold.drop??={})[omit]=fit
	scoreRows(fold,fit,mixFor(form,w),omit??"confirmed")
}
function valueTest(pts,recs){
	const cache=new Map,tests=valueFolds(pts,recs,cache)
	for(const [k,folds] of entries(tests)) for(const fold of folds){
		const inner=valueFolds(fold.train,fold.eligible,cache,12),scores=innerScores(inner),w=bestWeight(scores,k)
		fold.inner=inner.family
		scoreFold(fold,[...capForms,w])
		for(const row of fold.rows) row.shrink=row[w]
		confirm(fold,scores)
		for(const omit of keys(outerTerms)) confirm(fold,innerScores(inner,omit),omit)
	}
	const candidates=scoresFor(tests,[...keys(forms),"flat"]),
		winner=chooseForm(candidates),form=winner??"current",
		inner=valueFolds(pts,recs,cache,12),
		weight=form==="shrink"?bestWeight(innerScores(inner),"pooled"):mixFor(form,0),
		fit=fitValue(pts,form),headline=confirmation(tests),
		ablation=record(keys(outerTerms),k=>confirmation(tests,k)),groups=byFamily(pts),
		ship=f=>scoreRows(f,f.bandFit=fitValue(f.train,form),weight,"shipped")
	for(const fold of values(tests).flat()){
		[fold,...fold.inner].forEach(ship)
		fold.bounds=fitBands(foldRows(fold.inner))
	}
	inner.family.forEach(ship)
	return{tests,candidates,form,winner,weight,fit,headline,ablation,ranges:{
		bounds:fitBands(foldRows(inner.family)),coverage:record(schemes,k=>coverageFor(tests[k],groups))}}
}
const confirmation=(tests,term="confirmed")=>record(schemes,k=>missStats(foldRows(tests[k]),term))
const sigmoid=x=>1/(1+exp(-limit(x,-35,35))),
	oddsInputs=({age,omit},p)=>omit==="tvl"?[1,logAge(p,age)]:omit==="age"?[1,p.rawSize]:[1,p.rawSize,logAge(p,age)]
function fitOdds(pts,omit){
	const fit={age:omit==="age"?0:medianAge(pts),omit},
		inputs=pts.map(p=>oddsInputs(fit,p)),
		pen=omit==="tvl"||omit==="age"?[1e-6,A.oddsRidge]:[1e-6,A.oddsRidge,A.oddsRidge]
	let beta=zero(pen.length)
	for(let i=0;i<20;i++){
		const eq=normal(pen)
		eq.target=beta.map((c,j)=>-c*pen[j])
		for(let j=0;j<pts.length;j++){
			const x=inputs[j],prob=sigmoid(dot(x,beta))
			accum(eq,x,pts[j].recorded-prob,prob*(1-prob))
		}
		const delta=solve(eq.matrix,eq.target)
		beta=beta.map((c,j)=>c+delta[j])
		if(max(...delta.map(abs))<1e-8) break
	}
	return{...fit,beta}
}

const tokenOdds=(fit,p)=>sigmoid(dot(oddsInputs(fit,p),fit.beta))
function launchAt(fit,p,h,d=p.ageDays??fit.age){
	const at=ageDays=>tokenOdds(fit,{...p,ageDays}),s=at(d)
	return max(0,(at(d+h)-s)/(1-s))
}
function series(fit,p,h){
	const age=p.ageDays??fit.age,end=max(1000,ceil(age/80)*100),
		days=unique([...Array.from({length:41},(_,i)=>1+(end-1)*(i/40)**2),age]).sort((a,b)=>a-b)
	return{age,end,points:days.map(d=>[d,launchAt(fit,p,h,d)])}
}
const refM=A.refTvl/1e6,scoreEq=([base,tvl,slope,...terms])=>max(1,round(terms.reduce((v,[,n])=>v*n,
		base*1e6*(tvl/refM)**slope)))
function equationFor(fit,p){
	const [intercept,slope]=fit.coefs,terms=[
		["growth",exp((p.size-p.rawSize)*slope)],
		fit.age?["age",exp(dot(capInputs(fit,p).slice(2),fit.coefs.slice(2)))]:["status",p.valueAge],
		["issuer",p.haircut]]
	const base=+(exp(intercept)/1e6).toPrecision(9),power=+slope.toPrecision(9)
	let shown
	for(let digits=4;digits<=17;digits++){
		const print=n=>+n.toPrecision(digits)
		shown=[base,print(p.tvl_usd/1e6),power,...terms.map(([label,n])=>[label,print(n)])]
		if(scoreEq(shown)===p.score) break
	}
	return shown
}
function oddsTest(splits){
	const scored=splits.flatMap(([train,test])=>{
		const fit=fitOdds(train)
		return test.map(p=>[p.recorded,tokenOdds(fit,p)])
	}),{true:positive=[],false:negative=[]}=groupBy(scored,p=>p[0])
	let wins=0
	for(const [,p] of positive) for(const [,n] of negative) wins+=p>n?1:p===n?.5:0
	const pairs=positive.length*negative.length
	return{auc:pairs?wins/pairs:null,n:scored.length}
}
function peersFor({rawSize,category,family},pts){
	const distance=p=>abs(p.rawSize-rawSize)+(p.category===category?0:p.family===family?A.familyGap:A.categoryGap)
	return pts.toSorted((a,b)=>distance(a)-distance(b)||bySlug(a,b)).slice(0,A.peerCount)
}
const routeFor=(chains,tx)=>chains.map(name=>{
	const [gas,bridge,bridgeMins]=hasOwn(chainQuotes,name)?chainQuotes[name]:fallback
	return{name,gas,bridge,bridgeMins,total:bridge+gas*(tx+A.claimTx)}
}).sort((a,b)=>a.total-b.total||a.bridgeMins-b.bridgeMins||byText(a.name,b.name))[0]
function priceFarm(fp,cap,{horizon:h=fp.horizon,quote=fp.quote,cost=1,share=1,
	q=fp.chances[h],apr=0}={}){
	const {entryGas,exitGas,slippage,delay,lockup}=quote,
		{prepMins,exitMins}=fp,
		checkMins=weeks(h)*A.weeklyMins,mins=prepMins+exitMins+checkMins,
		hold=max(h,lockup)+delay,
		{bridge,gas:txGas}=fp.chain,
		gas=(fp.probeGas+entryGas+exitGas)*cost,
		funding=bridge*cost,slip=(cap+A.testUsd)*slippage/100*cost,
		labor=wage(mins)*cost,
		carry=cap*(A.riskFreeRate*hold/A.year)*cost,
		loss=gas+funding+slip+labor+carry,
		reward=cap*h/A.year*apr/100,
		drop=fp.grossCap*(cap/(fp.rivalTvl+cap))*A.depositorShare*share,
		claimCost=(txGas*A.claimTx+wage(A.claimMins)+drop*slippage/100)*cost,
		payoff=drop-claimCost,
		pStar=payoff>0?(loss-reward)/payoff:null,
		multiple=(q*payoff+reward)/loss,
		verdict=multiple<1?"SKIP":multiple>=A.farmRatio&&!fp.flagged?"FARM":"MARGINAL",
		net=q*payoff-loss+reward,tokenNet=payoff-loss+reward
	return{capital:cap,horizon:h,q,cost:loss,gas,funding,slip,labor,carry,hold,drop,claimCost,pStar,
		prepMins,exitMins,checkMins,mins,noToken:reward-loss,tokenNet,net,verdict}
}
const byNet=(a,b)=>b.net>a.net?b:a
function sizeFarm(fp,quote,horizons){
	const ladder=A.tickets.map(cap=>horizons.map(horizon=>priceFarm(fp,cap,{quote,horizon}))),
		farm=ladder.map(rung=>rung.filter(p=>p.verdict==="FARM")).find(rung=>rung.length)
	if(farm) return farm.reduce(byNet)
	const trials=ladder.slice(0,-1).map(rung=>rung.reduce(byNet)),
		test=trials.find(p=>p.net>=0)
	return test?{...test,verdict:"MARGINAL"}:
		{capital:0,net:0,cost:0,verdict:"SKIP",trial:ladder.slice(0,-1).flat().reduce((a,b)=>entryApr(b)<entryApr(a)?b:a)}
}
const chooseFarm=(fp,quote=fp.quote,h=0)=>sizeFarm(fp,quote,h?[h]:A.horizons),
	stages={SKIP:"Watch",MARGINAL:"Test",FARM:"Farm"},
	firstAction=({verdict,capital,horizon})=>stages[verdict]+(capital?` · ${whole(capital)} · ${horizon} d`:""),
	actionCounts=counts=>keys(stages).map(v=>counts[v]+" "+stages[v]).join(" / ")
function targetsFor({q,pStar,cost,drop,claimCost},{slippage}){
	slippage/=100
	const fixed=claimCost-drop*slippage,maxCost=q*(drop-claimCost)
	return{maxCost:maxCost<0?null:maxCost,targets:[1,A.farmRatio].map(m=>{
		const odds=pStar===null?null:m*pStar,
			reward=q&&slippage<1?(m*cost/q+fixed)/(1-slippage):null
		return{odds,drop:reward,share:reward!==null&&drop?reward/drop:null}
	})}
}
const timeFee=(min,fees=0)=>`${costUsd(wage(min)+fees)} · ${min} min`,
	farmTime=({mins,prepMins,exitMins,checkMins})=>
		`${mins} min hands-on (${prepMins} setup + ${exitMins} exit + ${checkMins} weekly checks)`,
	farmCost=({cost,gas,funding,slip,labor,carry})=>
		`${costUsd(cost)} total (gas ${costUsd(gas)} + funding ${costUsd(funding)} + slippage ${costUsd(slip)} + time ${costUsd(labor)} + capital cost ${costUsd(carry)})`,
	farmNet=n=>(n<0?"−":n>0?"+":"")+costUsd(abs(n)),
	entryApr=({capital,horizon,net})=>-net/(capital*horizon/A.year)*100,
	aprCeil=apr=>ceil(apr*10)/10,aprLabel=apr=>aprCeil(apr).toFixed(1)+"% APR",
	aprBasis=({q,drop,claimCost})=>q&&drop!==claimCost?"includes token "+(drop>claimCost?"upside":"costs"):"cash APR alone",
	watchLines=(p,format=whole)=>[`Watch · needs ${aprLabel(entryApr(p))}`,aprBasis(p),`${farmNet(p.net)} at ${format(p.capital)}, ${p.horizon} d`],
	actionTerms=p=>p.trial?watchLines(p.trial).join(" · "):
		`${firstAction(p)} · expected net ${farmNet(p.net)}`
function farmPlan(p,review,curve,exitGrowth){
	const {name:protocol,category,family,website,url,tvl_usd:tvl}=p,[actions,bps,entryMins,...base]=mechanisms[family],
		[verb,entry,monitor]=category?.endsWith("Bridge")?plays.Bridge:hasOwn(plays,category)?plays[category]:base,
		tx=2*actions,chains=unique(p.chains),chain=routeFor(chains,tx),{name,gas,bridge,bridgeMins}=chain,
		native=assets[name],asset={
			Staking:native||(ethChains.includes(name)?"ETH":name+" native asset"),
			Network:/BTC$/.test(category)?"BTC":native,LP:"USDC/USDT"
		}[family]||"USDC",
		ticketFor=cap=>family==="LP"?`${whole(cap/2)} USDC + ${whole(cap/2)} USDT`:`${whole(cap)} ${asset}`,
		{verifyMinutes:verify,testUsd,exitMins,claimMins,weeklyMins}=A,
		prep=A.routeMins+A.testMinutes,slippage=bps/100,
		quote={entryGas:gas*(actions-1),exitGas:gas,slippage,delay:0,lockup:0},
		fp={chain,quote,probeGas:gas*actions,chances:record(A.horizons,h=>launchAt(curve,p,h)),
			rivalTvl:tvl*A.tvlShare,grossCap:p.launchCap*p.haircut,
			prepMins:verify+prep+entryMins,exitMins,flagged:!!p.flags.length},
		result=chooseFarm(fp),priced=result.trial??result,
		{capital:cap,horizon:h}=priced,apr=result.trial?entryApr(priced):null,
		trigger=apr===null?null:{apr,rule:`the venue quotes ≥ ${aprLabel(apr)} in net cash rewards on ${ticketFor(cap)} for ${h} d (${aprBasis(priced)})`},
		route=`Plan route: ${name} (cheapest priced of ${chains.length} listed)`,
		gate=trigger?"If entry trigger is met":"If eligible",
		exits=[
			`TVL < ${whole(tvl*A.exitTvlShare)} (${pct(A.exitTvlShare,0)} of snapshot TVL)`,
			`claim eligibility confirmed and tokens claimable, or day ${h}`],
		probeFees=bridge+fp.probeGas+testUsd*slippage/100,
		weekly=timeFee(weeklyMins)+"/check",site=website||url
	if(exitGrowth!=null) exits.push(`7d TVL growth < ${exitGrowth.toFixed(2)}% (${category}, bottom 10% cutoff) two weeks running`)
	const steps=[
		["First action",`${actionTerms(result)}. ${route}.`,
			trigger?`${costUsd(0)} · 0 min to wait. Review ${review}.`:`${farmCost(priced)} · ${farmTime(priced)}`],
		["Verify",`${trigger?gate+", confirm":"Confirm"} ${protocol} venue, reward rules, assets, KYC, caps and withdrawals. Wait if unverified or ineligible.${site?" "+site:""}`,timeFee(verify)],
		["Rehearse",`${gate} and venue is verified, fund ${name}, put in ${ticketFor(testUsd)} and withdraw it. Stop on failure or delay.`,
			`${timeFee(prep,probeFees)} + ${2*bridgeMins} min funding wait`],
		["Entry",`${gate} and rehearsal passes on ${name}, ${verb} ${ticketFor(cap)} ${entry}.`,
			timeFee(entryMins,quote.entryGas+cap*slippage/100)],
		["Monitor",`If position opens, log points, TVL, ${monitor} weekly.`,weekly],
		["Exit",`If position opens on ${name}, exit on ${exits.join(", or ")}.`,timeFee(exitMins,gas)],
		["Sale assumption",`If position qualifies, the model assumes sale at ~${whole(p.launchCap)} implied circulating cap${p.haircut===1?"":" before issuer adjustment"}.`,
			timeFee(claimMins,priced.claimCost-wage(claimMins))]
	]
	if(trigger) steps.splice(1,0,["Entry trigger",
		`Enter only if ${trigger.rule}.`,timeFee(0)])
	return{...fp,...result,trigger,route,ticketFor,steps,exits,tx,stress:{
		doubleCost:trigger?result:priceFarm(fp,cap,{horizon:h,cost:A.stressCost}),
		halfShare:trigger?result:priceFarm(fp,cap,{horizon:h,share:A.stressShare})
	}}
}
const grade=p=>p.verdict,isFarm=p=>grade(p)==="FARM"
const boardRows=rs=>rs.map(({slug,name,rank,score,launchCap,tokenOdds,valueAge,haircut,ranges,plan:fp})=>({slug,name,rank,
	implied_value_usd:score,launch_value_usd:launchCap,token_odds:tokenOdds,
	token_likeness_factor:valueAge,issuer_factor:haircut,implied_value_ranges_usd:ranges,
	farm_steps:fp.steps.map(([,body,terms])=>body+" "+terms)}))
const exportManifest=rows=>rows.map(({rank,slug,implied_value_usd,farm_steps})=>
	[rank,slug,implied_value_usd,keys(stages).find(v=>stages[v]===farm_steps[0].split(" · ")[0])])
function digest(rs){
	let hash=2166136261
	for(const byte of new TextEncoder().encode(JSON.stringify(rs))) hash=Math.imul(hash^byte,16777619)
	return(hash >>> 0).toString(16).padStart(8,"0")
}
function boardChecks(board,{protocols,watchlist},bytes){
	const rs=board?.rows??board
	if(!Array.isArray(rs)) return[{name:"board_file",pass:false}]
	const known=new Set(protocols.map(p=>p.slug)),slugs=new Set(rs.map(p=>p?.slug)),n=rs.length
	return checks({
		board_file:(bytes??new TextEncoder().encode(JSON.stringify(board)).length)<=8*1024*1024
			&&n>=100&&n<=4000&&slugs.size===n&&rs.every(p=>{
			if(!p) return false
			const {slug,name,rank,implied_value_usd:v,farm_steps}=p
			return known.has(slug)&&/^\S{1,128}$/u.test(slug)&&typeof name==="string"&&name.trim()
				&&isInteger(rank)&&rank>0&&isInteger(v)&&v>0&&v<=1e14&&Array.isArray(farm_steps)
		}),
		sorted_by_value:unique(rs.map(p=>p?.implied_value_usd)).length>1&&inOrder(rs.toSorted((a,b)=>a?.rank-b?.rank)),
		coverage:watchlist.every(slug=>slugs.has(slug)),
		farm_steps:rs.every(p=>validSteps(p?.farm_steps))
	})
}
const inOrder=rs=>rs.every((p,i)=>p?.rank===i+1&&(!i||p.implied_value_usd<=rs[i-1]?.implied_value_usd)),
	validSteps=steps=>Array.isArray(steps)&&steps.length>=3&&steps.length<=12
		&&steps.every(s=>typeof s==="string"&&/^.{20,600}$/s.test(s.trim())&&/\$\d.*\d+ min/u.test(s))
function selfChecks({rows:rs,board,counts,recs,verdicts,stress,calibration,value,odds},snap,expectedDigest){
	const {headline,tests,fit,form,weight,candidates,ranges:{coverage}}=value,
		outer=values(tests).flat(),
		plans=rs.map(p=>p.plan),priced=plans.map(p=>p.trial??p),
		watch=plans.filter(p=>p.verdict==="SKIP"),
		samples=priced.filter(p=>p.pStar!==null&&p.q>0&&p.drop>0),close=(a,b)=>abs(a-b)<1e-8
	return[...boardChecks(board,snap),...checks({
		"calibration caps":calibration.every(p=>p.mcap_usd>0&&!p.excludedCap),
		"token screen":counts.total===snap.protocols.length&&counts.ranked===rs.length
			&&recs.length===counts.total&&new Set(recs.map(p=>p.slug)).size===recs.length
			&&recs.every((p,i)=>p.slug===snap.protocols[i].slug&&reasons[p.reason]?.[0]===p.status)
			&&statuses.every(k=>count(recs,p=>reasons[p.reason]?.[0]===k)===counts[k]),
		"deployed value factors":rs.length===board.rows.length&&rs.every((p,i)=>{
			const growth=limit(p.change_7d??0,...A.clip),
				cap=exp(capLog(fit,{...p,size:log(p.tvl_usd*(1+growth/100)/A.refTvl)})),row=board.rows[i]
			return row.slug===p.slug&&row.rank===i+1&&row.launch_value_usd===cap
				&&row.token_likeness_factor===ageMul(row.token_odds,weight)
				&&row.implied_value_usd===score(cap,row.token_likeness_factor,row.issuer_factor)
				&&p.plan.grossCap===cap*row.issuer_factor
		}),
		"displayed value equation":rs.every(p=>scoreEq(p.equation)===p.score),
		"token score bounds":rs.every(p=>p.tokenOdds>0&&p.tokenOdds<1),
		"outer candidate replay":form===(chooseForm(candidates)??"current")&&same(candidates,scoresFor(tests,keys(candidates))),
		"training-only headline":same(headline,confirmation(tests))
			&&values(tests).flat().every(f=>f.rows.every(r=>finite(r.confirmed))),
		"training-only shipped band residuals":outer.every(f=>{
			const train=new Set(f.train)
			return f.inner.every(g=>g.train.every(p=>train.has(p))&&g.inputs.every(([p])=>train.has(p)))
				&&[f,...f.inner].every(g=>g.inputs.every(([p,s,h],i)=>
					g.rows[i].shipped===p.response-log(score(exp(capLog(g.bandFit,p)),ageMul(s,weight),h))))
				&&same(f.bounds,fitBands(foldRows(f.inner)))
		}),
		"family coverage sums":schemes.every(k=>{
			const {Pooled,...kinds}=coverage[k],groups=values(kinds)
			return Pooled.n===foldRows(tests[k].filter(f=>f.inner.length)).length
				&&["n","hits"].every(key=>Pooled[key]===groups.reduce((sum,g)=>sum+g[key],0))
		}),
		"flagged plans":rs.every(p=>p.haircut===(p.flags.length?A.haircut:1)
			&&(!p.flags.length||p.plan.verdict!=="FARM")),
		"launch chance":plans.every(p=>values(p.chances).every((q,i,curve)=>q>=(curve[i-1]??0)&&q<=1)),
		"age chart horizon":rs.every((p,i)=>{
			const {horizon:h,q}=priced[i],{age,points}=series(odds.fit,p,h)
			return points.some(([d,s])=>d===age&&s===q)
		}),
		"farm outcomes":plans.every((fp,i)=>{
			const {horizon:h,q,capital:cap,noToken,tokenNet,pStar,gas,funding,slip,labor,carry,drop,claimCost,mins}=priced[i],
				loss=gas+funding+slip+labor+carry,payoff=drop-claimCost
			return q===fp.chances[h]
				&&close(gas,fp.tx*fp.chain.gas)
				&&close(carry,cap*A.riskFreeRate*h/A.year)
				&&close(labor,wage(mins))
				&&close(noToken,-loss)&&close(tokenNet,payoff-loss)
				&&(payoff<=0?pStar===null:close(pStar,loss/payoff))
		}),
		"one first action":plans.every((p,i)=>{
			const next=chooseFarm(p),first=board.rows[i].farm_steps[0]
			return p.verdict===next.verdict&&p.capital===next.capital&&p.horizon===next.horizon&&p.net===next.net
				&&first.startsWith(actionTerms(p)+".")
		}),
		"action counts":same(verdicts,byGrade(plans,grade))&&values(verdicts).reduce((a,b)=>a+b,0)===rs.length,
		"Watch conditional entry":watch.every(p=>
			p.steps.slice(2).every(([,body])=>/^If (entry trigger is met|position )/.test(body))),
		"Watch trigger replay":watch.every(p=>{
			const {apr,rule}=p.trigger,{capital,horizon,net:before}=p.trial
			const {net}=priceFarm(p,capital,{horizon,apr})
			return p.steps[1][1].includes(rule)&&rule.includes(aprLabel(apr))&&before<0&&close(net,0)&&aprCeil(apr)>=apr
		}),
		"hands-on total":[...priced,...plans.flatMap(p=>values(p.stress).filter(s=>s.capital))].every(p=>
			p.mins===p.prepMins+p.exitMins+p.checkMins&&p.checkMins===weeks(p.horizon)*A.weeklyMins),
		"expected net identity":priced.every(({q,tokenNet,noToken,net})=>close(net,q*tokenNet+(1-q)*noToken)),
		"Break-even":samples.length>=3&&[0,floor(samples.length/2),-1].every(i=>{
			const p=samples.at(i),fp=plans[priced.indexOf(p)],{odds:q,share}=targetsFor(p,fp.quote).targets[0]
			return[{q},{share}].every(s=>abs(priceFarm(fp,p.capital,{horizon:p.horizon,...s}).net)<=.01)
		}),
		"stress counts":entries(stress).every(([k,{all,farm}])=>keys(all).every(v=>{
			const matches=plans.filter(p=>p.stress[k].verdict===v)
			return all[v]===matches.length&&farm[v]===count(matches,isFarm)
		})),
		"drop-one folds and counts":keys(outerTerms).every(t=>same(value.ablation[t],confirmation(tests,t))
			&&schemes.every(k=>value.ablation[t][k].n===headline[k].n
				&&tests[k].every(f=>f.rows.every(r=>finite(r[t]))))
			&&outer.every(f=>{
				const cap=f.drop[t],screen=f.odds[t]??f.odds.full,[p]=f.inputs[0],
					q={...p,...(t==="age"?{ageDays:1}:t==="tvl"?{rawSize:2,size:3}:{growth:20,size:3})}
				return cap.omit===t&&same(capInputs(cap,p),capInputs(cap,q))&&same(oddsInputs(screen,p),oddsInputs(screen,q))
			})),
		"board digest":digest(boardRows(rs))===expectedDigest
	})]
}
function buildModel(snap){
	const recs=prepare(snap),groups=groupBy(recs,p=>p.status),pts=capPoints(groups.traded??[]),
		categories=Map.groupBy(recs,p=>p.category),
		review=new Date(Date.parse(snap.as_of)+A.reviewIn*DAY).toISOString().slice(0,10)
	if(pts.length<3) throw new Error("Need 3 screened caps.")
	const value=valueTest(pts,recs),{fit,weight,ranges:{bounds}}=value,
		oddsPts=recs.filter(p=>!p.product),
		oddsFit=fitOdds(oddsPts),
		odds={fit:oddsFit,validation:record(blindTests,k=>oddsTest(folds(oddsPts,k==="walk",A.oddsWarmup)))}
	const rs=(groups.ranked??[]).map(p=>{
		const launchCap=exp(capLog(fit,p)),
			s=tokenOdds(oddsFit,p),
			haircut=p.flags.length?A.haircut:1,
			row={...p,launchCap,tokenOdds:s,valueAge:ageMul(s,weight),haircut,
			peers:peersFor(p,pts)}
		row.score=score(launchCap,row.valueAge,haircut)
		row.equation=equationFor(fit,row)
		const growth=p.category?quant(categories.get(p.category).map(r=>r.change_7d).filter(finite),A.exitQ):null
		return{...row,plan:farmPlan(row,review,oddsFit,growth)}
	}).sort(rankBy("score")).map((p,i)=>({...p,rank:i+1}))
	for(const p of rs){
		const [lo,hi,midLo,midHi]=bandFor(bounds,p.family).map(q=>p.score*exp(q))
		p.ranges={[bandPct]:[lo,hi],50:[midLo,midHi]}
		const fp=p.plan
		p.edgePlans=fp.capital?p.ranges[bandPct].map(v=>priceFarm(fp,fp.capital,{share:v/p.score})):[]
	}
	const counts={...record(statuses,k=>groups[k]?.length??0),total:recs.length,watchCovered:count(rs,p=>p.watchlist),
		watchTotal:snap.watchlist.length,valueFit:pts.length,oddsFit:oddsPts.length},
		plans=rs.map(p=>p.plan),verdicts=byGrade(plans,grade),farms=plans.filter(isFarm),
		stress=record(["doubleCost","halfShare"],k=>{
			const get=p=>grade(p.stress[k])
			return{all:byGrade(plans,get),farm:byGrade(farms,get)}
		})
	return{rows:rs,recs,board:{rows:boardRows(rs)},counts,verdicts,stress,
		value,odds,calibration:pts,assumptions:settings}
}
const statuses=["traded","recorded","setAside","ranked"],
	reasons={cap:["traded","Positive market cap"],id:["recorded","Token ID or symbol recorded"],
		product:["setAside","Wrapped, staked or bridged product"],exchange:["setAside","Exchange category or name"],
		pre:["ranked","Pre-token"],watch:["ranked","Watchlist exception"]},
	timing="Launch chance = rise in token-likeness from day d to d + horizon over (1 − token-likeness at d), TVL fixed; the snapshot has no launch dates."
const settings={parameters:A,timing,
	notes:[`Test cap ${whole(A.tickets.at(-2))}. Farm requires ${A.farmRatio}× cost in expected proceeds and no flags.`,
		`Depositors get ${pct(A.depositorShare,0)} of rewards. ${pct(A.tvlShare,0)} of TVL competes.`,
		"Issuer haircut is fixed. Excludes yield, taxes and price moves."]}
if(typeof module==="object") module.exports={buildModel,boardChecks,selfChecks,boardRows,digest,exportManifest,
	priceFarm,chooseFarm,firstAction,actionCounts,forms,outerTerms}
