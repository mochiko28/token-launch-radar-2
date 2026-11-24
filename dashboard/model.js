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
	fallbackChain=[1.5,5,30],ethChains=["Ethereum","Base","Arbitrum","Optimism","Linea","Ink","Scroll","zkSync Era"],
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
		growthClip:[-30,30],missingGrowth:0,haircut:.65,year:365,tvlReference:1e8,missingAgeFallback:365,
		oddsPenalty:1,valueWarmup:25,oddsWarmup:60,
		bootstrapDraws:192,bootstrapSeed:918273,bandQuantiles:[.1,.9],
		hourlyUsd:20,depositorShare:.05,competingTvlShare:.2,
		capitalLadder:[1000,2500,5000,10000,25000,50000],farmMultiple:2,
		stressCost:2,stressShare:.5,weeklyMinutes:2,routeHandsOnMinutes:6,verifyMinutes:8,
		exitTvlShare:.75,exitMinutes:10,exitGrowthQuantile:.1,reviewDays:14,
		horizons:[30,90,180,365],riskFreeRate:.04,testUsd:80,testMinutes:6,
		claimMinutes:8,claimActions:2,firstSaleShare:.5,
		peerCount:3,peerCategoryPenalty:1,peerFamilyPenalty:.45
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
	DAY=86_400_000,
	familyOf=new Map(entries(families).flatMap(([family,categories])=>
	categories.split("|").map(category=>[category,family])))
const products=["Bridge","Canonical Bridge","Cross Chain Bridge","Restaked BTC"],
	liquid=["Liquid Staking","Liquid Restaking"],
	version=/\s+(?:v\s*\d+(?:\.\d+)*|\d+\.\d+(?:\.\d+)*)$/i,
	exchange=/^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i,
	receiptId=/^(wrapped|bridged|staked|restaked|savings)-/i
const byText=(a,b)=>(a>b)-(a<b),bySlug=(a,b)=>byText(a.slug,b.slug),
	rankBy=k=>(a,b)=>b[k]-a[k]||bySlug(a,b),
	limit=(value,low,high)=>min(high,max(low,value)),
	count=(rs,test)=>rs.filter(test).length,
	tally=(rs,get)=>record(["FARM","MARGINAL","SKIP"],v=>count(rs,p=>get(p)===v)),
	word1=name=>name.toLowerCase().match(/[\p{L}\p{N}]+/u)?.[0]
const hasToken=p=>p.mcap_usd>0||!!(p.gecko_id||p.symbol),
	scoreOf=(cap,age,issuer)=>max(1,round(cap*age*issuer)),
	costUsd=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format,
	integer=n=>round(n).toLocaleString("en-US"),whole=n=>"$"+integer(n)
const pct=(n,places=2)=>(n*100).toFixed(places)+"%",
	chance=n=>pct(n,1),breakEven=n=>n==null||n>1?"unreachable":chance(n),
	needs=(n,q)=>n==null||n>1?`unreachable at ${chance(q)}`:`needs ${chance(n)} vs ${chance(q)}`,
	decisionUsd=n=>Number(n.toFixed(2)),
	wage=min=>min*A.hourlyUsd/60,
	weeks=days=>floor(days/7),
	checks=checks=>entries(checks).map(([name,pass])=>({name,pass:!!pass}))
function quant(values,fraction=.5){
	if(!values.length) return null
	const order=values.toSorted((a,b)=>a-b),
		index=(order.length-1)*fraction
	return order[floor(index)]*(1-index%1)+order[ceil(index)]*(index%1)
}
const issuerWords=rs=>new Set(rs.filter(hasToken).map(p=>word1(p.name))),
	issuerFlags=(p,words)=>[words.has(word1(p.name))&&"Recorded issuer match",
		liquid.includes(p.category)&&"Liquid staking/restaking",version.test(p.name)&&"Versioned name"].filter(Boolean)
function prepare(snap){
	const asOf=Date.parse(snap.as_of),words=issuerWords(snap.protocols)
	return snap.protocols.map(p=>{
		const {category,name,tvl_usd:tvl,gecko_id}=p,
			family=familyOf.get(category)||"Other",
			isLiquid=liquid.includes(category),
			stamp=Date.parse(p.listed_at),
			date=finite(stamp)?stamp:null,
			ageDays=date===null?null:max(1,floor((asOf-date)/DAY)),
			growth=limit(p.change_7d??A.missingGrowth,...A.growthClip),
			carriedTvl=tvl*(1+growth/100),
			receipt=name.match(/\b(?:wrapped|bridged|staked)\b/i)?.[0]||(!isLiquid&&name.match(/\bstaking\b/i)?.[0]),
			venue=name.match(exchange)?.[0],wrapper=products.includes(category)||!!receipt,
			product=wrapper||category==="CEX"||!!venue,
			recorded=hasToken(p),
			watchlist=snap.watchlist.includes(p.slug),
			flags=recorded?[]:issuerFlags(p,words),
			status=p.mcap_usd>0?"traded":recorded?"recorded":product&&!watchlist?"setAside":"ranked",
			reason=status==="traded"?"cap":status==="recorded"?"id":status==="setAside"?(wrapper?"product":"exchange"):product?"watch":"pre",
			nameRule=[venue,receipt,...flags.filter(f=>f!=="Liquid staking/restaking")].filter(Boolean).join(" · ")
		return{...p,family,date,ageDays,growth,flags,
			product,productPeer:product||isLiquid||receiptId.test(gecko_id),watchlist,recorded,status,reason,nameRule,
			size:log(carriedTvl/A.tvlReference),rawSize:log(tvl/A.tvlReference)}
	})
}
const tokenId=p=>p.gecko_id?"gecko:"+p.gecko_id:p.symbol?"symbol:"+p.symbol:p.slug,
	tokenPoints=traded=>values(groupBy(traded.filter(p=>!p.productPeer).sort(rankBy("tvl_usd")),tokenId))
		.map(([p])=>({...p,response:log(p.mcap_usd)})).sort(bySlug)
const medianAge=rs=>quant(rs.map(p=>p.ageDays).filter(finite))??A.missingAgeFallback,
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
		target[i]+=x[i]*residual
		if(x[i]===0) continue
		for(let j=0;j<x.length;j++) matrix[i][j]+=x[i]*x[j]*weight
	}
}

function fitValue(pts,form="current",omitGrowth=false){
	const age=form==="direct"||form==="pooled"?medianAge(pts):0,
		families=form==="pooled"?unique(pts.map(p=>p.family)):[],
		shrink=sqrt(pts.length),fit={age,families,omitGrowth},
		eq=normal([1e-8,1e-8+shrink,...(age?[shrink,...families.map(()=>4*shrink)]:[])])
	for(const p of pts) accum(eq,capInputs(fit,p),p.response)
	return{...fit,coefficients:solve(eq.matrix,eq.target)}
}
function capInputs({age,families,omitGrowth},p){
	const x=[1,omitGrowth?p.rawSize:p.size]
	if(age){
		const a=logAge(p,age)
		x.push(a,...families.map(f=>p.family===f?a:0))
	}
	return x
}
const capLog=(fit,p)=>dot(capInputs(fit,p),fit.coefficients)
const leaveOut=(pts,group)=>[...Map.groupBy(pts,group).values()]
	.map(test=>[pts.filter(p=>!test.includes(p)),test]).filter(([train])=>train.length)
function folds(pts,walk,warmup=A.valueWarmup){
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
const levels={80:[.1,.9],50:[.25,.75]},coverage=keys(levels),
	inside=(e,[lo,hi])=>lo<=e&&e<=hi
function rangeFit(pts,form){
	const errors=folds(pts).flatMap(([train,test])=>{
		const fit=fitValue(train,form)
		return test.map(p=>p.response-capLog(fit,p))
	})
	return errors.length?record(coverage,k=>levels[k].map(q=>quant(errors,q))):null
}
const forms={current:"Full token-likeness",direct:"Age power on cap",pooled:"Family-pooled age power",shrink:"Shrunk token-likeness"},
	outerTerms={growth:"7-day growth",age:"Listing age",issuer:"Issuer factor"},
	outerTests={walk:"Walk-forward",family:"Leave-one-family-out"},
	valueSplits=(pts,k,warmup)=>k==="walk"?folds(pts,true,warmup):leaveOut(pts,p=>p.family),
	ageWeight=(form,w)=>form==="current"?1:form==="shrink"?w:0,
	ageFactor=(s,w)=>1-w*(1-s),
	errorOf=(p,cap,age,issuer)=>p.response-log(scoreOf(cap,age,issuer))
function trainingRows(test,recs,k){
	const held=new Set(test.map(tokenId))
	return recs.filter(p=>!held.has(tokenId(p))&&
		(k==="walk"?p.date!==null&&p.date<test[0].date:p.family!==test[0].family))
}
function valueInputs(test,recs){
	const odds=fitOdds(recs.filter(p=>!p.product)),words=issuerWords(recs)
	return test.map(p=>[p,tokenOdds(odds,p),issuerFlags(p,words).length?A.haircut:1])
}
function tuneWeight(pts,recs,schemes){
	const errors=schemes.flatMap(k=>valueSplits(pts,k,12).flatMap(([train,test])=>{
		const fit=fitValue(train)
		return valueInputs(test,trainingRows(test,recs,k)).map(([p,s,h])=>[p,exp(capLog(fit,p)),s,h])
	}))
	const weights=[.125,.25,.5,.75,1]
	return errors.length?weights.map(w=>[w,medianMiss(errors.map(([p,cap,s,h])=>errorOf(p,cap,ageFactor(s,w),h)))])
		.sort((a,b)=>a[1]-b[1])[0][0]:.5
}
function outerFolds(pts,recs){
	return record(keys(outerTests),k=>valueSplits(pts,k).map(([train,test])=>{
		const eligible=trainingRows(test,recs,k),w=tuneWeight(train,eligible,[k]),
			fits=record(keys(forms),f=>fitValue(train,f)),
			ratio=quant(train.map(p=>p.mcap_usd/p.tvl_usd)),
			label=k==="walk"?new Date(test[0].date).toISOString().slice(0,10):test[0].family,
			inputs=valueInputs(test,eligible),rows=inputs.map(([p,s,h])=>{
			const errors=record(keys(forms),f=>errorOf(p,exp(capLog(fits[f],p)),ageFactor(s,ageWeight(f,w)),h))
			return{slug:p.slug,...errors,flat:p.response-log(p.tvl_usd*ratio)}
		})
		return{label,rows,train,inputs,w,fits}
	}))
}
const outerMiss=(rows,kind)=>medianMiss(rows.map(row=>row[kind])),
	outerSummary=(rows,form)=>({miss:outerMiss(rows,form),flat:outerMiss(rows,"flat"),n:rows.length}),
	summarizeFolds=(folds,form)=>folds.map(({label,rows})=>({label,...outerSummary(rows,form)})),
	outerScores=(tests,kinds)=>{
		const errors=record(keys(tests),k=>tests[k].flatMap(f=>f.rows))
		return record(kinds,f=>({...record(keys(tests),k=>outerMiss(errors[k],f)),pooled:outerMiss(values(errors).flat(),f)}))
	},
	chooseForm=({flat,...scores})=>keys(scores).filter(f=>keys(outerTests).every(k=>scores[f][k]!=null&&scores[f][k]<flat[k]))
		.sort((a,b)=>scores[a].pooled-scores[b].pooled)[0]
function valueTest(pts,recs){
	const tests=outerFolds(pts,recs),candidates=outerScores(tests,[...keys(forms),"flat"]),
		winner=chooseForm(candidates),form=winner??"current",
		weight=ageWeight(form,form==="shrink"?tuneWeight(pts,recs,keys(tests)):0),
		fit=fitValue(pts,form)
	for(const [k,folds] of entries(tests)) tests[k]=folds.map(({label,rows,train,inputs,w,fits})=>{
		const noGrowth=fitValue(train,form,true),noAge=fits.current
		inputs.forEach(([p,s,h],i)=>{
			const cap=exp(capLog(fits[form],p)),factor=ageFactor(s,ageWeight(form,w))
			Object.assign(rows[i],{growth:errorOf(p,exp(capLog(noGrowth,p)),factor,h),
				age:errorOf(p,exp(capLog(noAge,p)),1,h),issuer:errorOf(p,cap,factor,1)})
		})
		return{label,rows,train,quantiles:k==="family"?rangeFit(train,form):null}
	})
	const misses=outerScores(tests,keys(outerTerms)),
		headline=record(keys(tests),k=>outerSummary(tests[k].flatMap(f=>f.rows),form)),
		foldScores=record(keys(tests),k=>summarizeFolds(tests[k],form)),
		issuerNote=misses.issuer.pooled>candidates[form].pooled?"Lower pooled miss with the factor":"Issuer assumption raised or tied pooled miss",
		ablation=entries(outerTerms).map(([k,term])=>({term,withTerm:candidates[form],without:misses[k]})),
		bands=tests.family.filter(f=>f.quantiles),n=bands.flatMap(f=>f.rows).length,
		hits=record(coverage,k=>bands.reduce((sum,f)=>sum+count(f.rows,r=>inside(r[form],f.quantiles[k])),0)),
		labels=record(coverage,k=>n?round(100*hits[k]/n):null)
	return{tests,candidates,form,winner,weight,fit,headline,foldScores,ablation,issuerNote,
		ranges:{quantiles:rangeFit(pts,form),hits,labels,n}}
}
const sigmoid=x=>1/(1+exp(-limit(x,-35,35))),
	oddsFeatures=(p,age)=>[1,p.rawSize,logAge(p,age)]
function fitOdds(pts){
	const age=medianAge(pts),
		inputs=pts.map(p=>oddsFeatures(p,age)),
		pen=[1e-6,A.oddsPenalty,A.oddsPenalty]
	let beta=zero(3)
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
	return{age,beta}
}

const tokenOdds=(fit,p)=>sigmoid(dot(oddsFeatures(p,fit.age),fit.beta))

const launchOdds=(fit,p)=>record(A.horizons,h=>max(0,
	(tokenOdds(fit,{...p,ageDays:(p.ageDays??fit.age)+h})-p.tokenOdds)/(1-p.tokenOdds)))
const tvlMillions=A.tvlReference/1e6,
	equationScore=([base,tvl,slope,...terms])=>max(1,round(terms.reduce((v,[,n])=>v*n,
		base*1e6*(tvl/tvlMillions)**slope)))
function valueEquation(fit,p){
	const [intercept,slope]=fit.coefficients,terms=[
		["growth",exp((p.size-p.rawSize)*slope)],
		[fit.age?"age":"likeness",fit.age?exp(dot(capInputs(fit,p).slice(2),fit.coefficients.slice(2))):p.valueAge],
		["issuer",p.haircut]]
	let shown
	for(let digits=4;digits<=17;digits++){
		const print=n=>+n.toPrecision(digits)
		shown=[print(exp(intercept)/1e6),print(p.tvl_usd/1e6),print(slope),
			...terms.map(([label,n])=>[label,print(n)])]
		if(equationScore(shown)===p.score) break
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
function bootstrap(pts,form){
	let seed=A.bootstrapSeed
	return Array.from({length:A.bootstrapDraws},()=>{
		const sample=pts.map(()=>{
			seed=(Math.imul(seed,1664525)+1013904223)>>>0
			return pts[floor(seed*pts.length/2**32)]
		})
		return fitValue(sample,form)
	})
}
function peersFor({rawSize,category,family},pts){
	const distance=p=>abs(p.rawSize-rawSize)+(p.category===category?0:p.family===family?A.peerFamilyPenalty:A.peerCategoryPenalty)
	return pts.toSorted((a,b)=>distance(a)-distance(b)||bySlug(a,b)).slice(0,A.peerCount)
}
const routeFor=(chains,tx)=>chains.map(name=>{
	const [gas,bridge,bridgeMinutes]=hasOwn(chainQuotes,name)?chainQuotes[name]:fallbackChain
	return{name,gas,bridge,bridgeMinutes,total:bridge+gas*(tx+A.claimActions)}
}).sort((a,b)=>a.total-b.total||a.bridgeMinutes-b.bridgeMinutes||byText(a.name,b.name))[0]
function evaluateFarm(fp,cap,{horizon:h=fp.horizon,quote=fp.quote,cost=1,share=1,
	q=fp.launchOdds[h]}={}){
	const {entryGas,exitGas,slippage,delay,lockup}=quote,
		{setupMinutes,exitMinutes}=fp,
		checkMinutes=weeks(h)*A.weeklyMinutes,handsOnMinutes=setupMinutes+exitMinutes+checkMinutes,
		holding=max(h,lockup)+delay,
		{bridge,gas:gasPerTx}=fp.chain,
		gas=(fp.testGas+entryGas+exitGas)*cost,
		funding=bridge*cost,slip=(cap+A.testUsd)*slippage/100*cost,
		timeCost=wage(handsOnMinutes)*cost,
		capitalCharge=cap*(A.riskFreeRate*holding/A.year)*cost,
		loss=gas+funding+slip+timeCost+capitalCharge,
		drop=fp.conditionalValue*(cap/(fp.competingTvl+cap))*A.depositorShare*share,
		claimSell=(gasPerTx*A.claimActions+wage(A.claimMinutes)+drop*slippage/100)*cost,
		payoff=drop-claimSell,
		pStar=payoff>0?loss/payoff:null,
		multiple=q*payoff/loss,
		verdict=multiple<1?"SKIP":multiple>=A.farmMultiple&&!fp.capped?"FARM":"MARGINAL",
		net=q*payoff-loss,withToken=payoff-loss
	return{capital:cap,horizon:h,q,cost:loss,gas,funding,slip,timeCost,capitalCharge,holding,drop,claimSell,pStar,
		setupMinutes,exitMinutes,checkMinutes,handsOnMinutes,noToken:-loss,withToken,net,multiple,verdict}
}
const bestBy=k=>(a,b)=>b[k]>a[k]?b:a
function sizeFarm(fp,scenario,below=Infinity){
	const ladder=A.capitalLadder.filter(cap=>cap<below).map(cap=>evaluateFarm(fp,cap,scenario))
	if(below<Infinity) return ladder.reduce(bestBy("net"))
	return ladder.find(p=>p.multiple>=A.farmMultiple)??ladder.reduce(bestBy("multiple"))
}
const chooseFarm=(fp,quote=fp.quote,h=0)=>h?sizeFarm(fp,{quote,horizon:h})
	:A.horizons.map(h=>sizeFarm(fp,{quote,horizon:h})).reduce(bestBy("net"))
function targetsFor({q,pStar,cost,drop,claimSell},{slippage}){
	slippage/=100
	const fixed=claimSell-drop*slippage,
		maxCost=q*(drop-claimSell)
	return{maxCost:maxCost<0?null:maxCost,targets:[1,A.farmMultiple].map(m=>{
		const odds=pStar===null?null:m*pStar,
			reward=q&&slippage<1?(m*cost/q+fixed)/(1-slippage):null
		return{odds,drop:reward,dropRatio:reward!==null&&drop?reward/drop:null}
	})}
}
const costTime=(min,fees=0)=>`${costUsd(wage(min)+fees)} · ${min} min`,
	farmTime=({handsOnMinutes,setupMinutes,exitMinutes,checkMinutes})=>
		`${handsOnMinutes} min hands-on (${setupMinutes} setup + ${exitMinutes} exit + ${checkMinutes} weekly checks)`,
	farmCost=({cost,gas,funding,slip,timeCost,capitalCharge})=>
		`${costUsd(cost)} total (gas ${costUsd(gas)} + funding ${costUsd(funding)} + slippage ${costUsd(slip)} + time ${costUsd(timeCost)} + carry ${costUsd(capitalCharge)})`,
	farmNet=n=>(n<0?"−":n>0?"+":"")+costUsd(abs(n))
function entryTrigger(p,quote,scale=false){
	const q=p.q||1,{odds,drop}=targetsFor({...p,q},quote).targets[+scale]
	if(odds!==null&&odds<=1) return{rule:`${p.horizon} d launch chance reaches ${chance(odds)}`,q:odds}
	const reward=ceil(drop*100)/100
	return{rule:`${p.q?"":"launch is certain and "}the gross reward quote reaches ${costUsd(reward)} at ${p.q?"the modeled launch chance":"100% launch chance"}`,
		q,share:reward/p.drop}
}
function farmPlan(p,review,curve,exitGrowth){
	const {name:protocol,category,family,website,url,tvl_usd:tvl,band}=p,[actions,bps,entryMins,...base]=mechanisms[family],
		[verb,entry,monitor]=category?.endsWith("Bridge")?plays.Bridge:hasOwn(plays,category)?plays[category]:base,
		transactions=2*actions,chains=unique(p.chains),chain=routeFor(chains,transactions),{name,gas,bridge,bridgeMinutes}=chain,
		native=assets[name],asset={
			Staking:native||(ethChains.includes(name)?"ETH":name+" native asset"),
			Network:/BTC$/.test(category)?"BTC":native,LP:"USDC/USDT"
		}[family]||"USDC",
		ticketFor=cap=>family==="LP"?`${whole(cap/2)} USDC + ${whole(cap/2)} USDT`:`${whole(cap)} ${asset}`,
		{verifyMinutes:verify,testUsd,exitMinutes,claimMinutes,weeklyMinutes,firstSaleShare}=A,
		prep=A.routeHandsOnMinutes+A.testMinutes,slippage=bps/100,
		quote={entryGas:gas*(actions-1),exitGas:gas,slippage,delay:0,lockup:0},
		fp={chain,quote,testGas:gas*actions,launchOdds:launchOdds(curve,p),
			competingTvl:tvl*A.competingTvlShare,conditionalValue:p.launchValue*p.haircut,
			setupMinutes:verify+prep+entryMins,exitMinutes,capped:!!p.flags.length},
		result=chooseFarm(fp),pay=targetsFor(result,quote),
		{capital:cap,verdict,horizon:h}=result,
		scaleCap=max(cap,A.capitalLadder[1]),
		test=verdict==="MARGINAL"?sizeFarm(fp,{horizon:h},scaleCap):null,
		first=test??result,trigger=first.net<0?entryTrigger(first,quote):null,
		route=`Plan route: ${name} (cheapest priced of ${chains.length} listed)`,
		gate=trigger?"If entry trigger is met":"If eligible",
		exits=[
			`TVL < ${whole(tvl*A.exitTvlShare)} (${pct(A.exitTvlShare,0)} of snapshot TVL)`,
			`token announced or no token by day ${h}`],
		testFees=bridge+fp.testGas+testUsd*slippage/100,
		weekly=costTime(weeklyMinutes)+"/check",site=website||url,
		summary=f=>`${farmCost(f)} · ${farmTime(f)}`
	if(exitGrowth!=null) exits.push(`7d TVL growth < ${exitGrowth.toFixed(2)}% (${category} p10) two weeks running`)
	const steps=[
		[trigger?"Watch":test?"Staged test":"Entry plan",
			`${verdict} · ${h} d ${test?"test":trigger?"conditional":"entry"} ticket ${ticketFor(first.capital)} · expected net ${farmNet(first.net)}. ${route}.`,
			summary(first)],
		["Verify",`${trigger?"If entry trigger is met, confirm":"Confirm"} ${protocol} venue, reward rules, assets, KYC, caps and withdrawals. Wait if unverified or ineligible.${site?" "+site:""}`,costTime(verify)],
		["Rehearse",`${gate} and venue is verified, fund ${name}, put in ${ticketFor(testUsd)} and withdraw it. Stop on failure or delay.`,
			`${costTime(prep,testFees)} + ${2*bridgeMinutes} min funding wait`],
		[test?"Test entry":"Entry",`${gate} and rehearsal passes on ${name}, ${verb} ${ticketFor(first.capital)} ${entry}.`,
			costTime(entryMins,quote.entryGas+first.capital*slippage/100)],
		["Monitor",`If position opens, log points, TVL, ${monitor} weekly.`,weekly],
		["Exit",`If position opens on ${name}, exit on ${exits.join(", or ")}.`,costTime(exitMinutes,gas)],
		["Claim & sell",`If position qualifies at launch, claim and sell ${firstSaleShare*100}% at ${whole(band.low)} circ. cap, rest near ${whole(band.high)}.`,
			costTime(claimMinutes,first.claimSell-wage(claimMinutes))]
	]
	if(trigger) steps.splice(1,0,["Entry trigger",
		`Enter only if ${trigger.rule}. Watch reward news ${weeklyMinutes} min/week. Review ${review} or on change.`,costTime(first.checkMinutes)])
	if(test){
		const scale=scaleCap===cap?result:evaluateFarm(fp,scaleCap,{horizon:h})
		steps.push(["Scale up",
			`After a successful test exit, reprice a new ${h} d cycle at ${ticketFor(scaleCap)}. Scale only if issuer flags clear and expected rewards cover 2× cost. At snapshot costs: ${entryTrigger(scale,quote,true).rule}.`,
			summary(scale)])
	}
	return{...fp,...result,test,trigger,route,quoteTicket:ticketFor,steps,exits,transactions,pay,stress:{
		doubleCost:sizeFarm(fp,{horizon:h,cost:A.stressCost}),halfShare:sizeFarm(fp,{horizon:h,share:A.stressShare})
	}}
}
const isFarm=p=>p.plan.verdict==="FARM"
const boardRows=rs=>rs.map(({slug,name,rank,score,launchValue,tokenOdds,valueAge,haircut,ranges,plan:fp})=>({slug,name,rank,
	implied_value_usd:score,launch_value_usd:launchValue,token_odds:tokenOdds,
	token_likeness_factor:valueAge,issuer_factor:haircut,implied_value_ranges_usd:ranges,
	farm_steps:fp.steps.map(([,body,terms])=>body+" "+terms)}))
const exportManifest=rows=>rows.map(({rank,slug,implied_value_usd,farm_steps})=>
	[rank,slug,implied_value_usd,farm_steps[0].split(" · ")[0]])
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
		sorted_by_value:unique(rs.map(p=>p?.implied_value_usd)).length>1&&orderedRows(rs.toSorted((a,b)=>a?.rank-b?.rank))===n,
		coverage:watchlist.every(slug=>slugs.has(slug)),
		farm_steps:rs.every(p=>validSteps(p?.farm_steps))
	})
}
const orderedRows=rs=>count(rs,(p,i)=>p?.rank===i+1&&(!i||p.implied_value_usd<=rs[i-1]?.implied_value_usd)),
	validSteps=steps=>Array.isArray(steps)&&steps.length>=3&&steps.length<=12
		&&steps.every(s=>typeof s==="string"&&/^.{20,600}$/s.test(s.trim())&&/\$\d.*\d+ min/u.test(s))
function selfChecks({rows:rs,board,counts,recs,stress,calibration,value},snap,expectedDigest){
	const {headline,foldScores,tests,fit,form,weight,candidates,ranges:{hits,labels,n}}=value,
		calibrationBySlug=new Map(calibration.map(p=>[p.slug,p])),
		bands=tests.family.filter(f=>f.quantiles),
		plans=rs.map(p=>p.plan),samples=plans.filter(p=>p.pStar!==null&&p.q>0&&p.drop>0),close=(a,b)=>abs(a-b)<1e-8
	return[...boardChecks(board,snap),...checks({
		"calibration caps":calibration.every(p=>p.mcap_usd>0&&!p.productPeer),
		"token screen":counts.total===snap.protocols.length&&counts.ranked===rs.length
			&&recs.length===counts.total&&new Set(recs.map(p=>p.slug)).size===recs.length
			&&recs.every((p,i)=>p.slug===snap.protocols[i].slug&&reasons[p.reason]?.[0]===p.status)
			&&statuses.every(k=>count(recs,p=>reasons[p.reason]?.[0]===k)===counts[k]),
		"deployed value factors":rs.length===board.rows.length&&rs.every((p,i)=>{
			const growth=limit(p.change_7d??A.missingGrowth,...A.growthClip),
				cap=exp(capLog(fit,{...p,size:log(p.tvl_usd*(1+growth/100)/A.tvlReference)})),row=board.rows[i]
			return row.slug===p.slug&&row.rank===i+1&&row.launch_value_usd===cap
				&&row.token_likeness_factor===ageFactor(row.token_odds,weight)
				&&row.implied_value_usd===scoreOf(cap,row.token_likeness_factor,row.issuer_factor)
				&&p.plan.conditionalValue===cap*row.issuer_factor
		}),
		"displayed value equation":rs.every(p=>equationScore(p.equation)===p.score),
		"bootstrap bands":rs.every(p=>p.band.low>0&&p.band.low<=p.band.high&&p.tokenOdds>0&&p.tokenOdds<1),
		"outer headline and selection replay":form===(chooseForm(candidates)??"current")
			&&JSON.stringify(candidates)===JSON.stringify(outerScores(tests,keys(candidates)))
			&&entries(tests).every(([k,folds])=>
				JSON.stringify(headline[k])===JSON.stringify(outerSummary(folds.flatMap(f=>f.rows),form))
				&&JSON.stringify(foldScores[k])===JSON.stringify(summarizeFolds(folds,form))),
		"outer band coverage label":n===bands.flatMap(f=>f.rows).length&&bands.every(({train,label,rows,quantiles})=>
			train.every(p=>p.family!==label)&&rows.every(r=>calibrationBySlug.get(r.slug).family===label)
				&&JSON.stringify(quantiles)===JSON.stringify(rangeFit(train,form)))&&coverage.every(k=>{
			const covered=bands.flatMap(f=>f.rows.filter(r=>inside(r[form],f.quantiles[k]))).length
			return hits[k]===covered&&labels[k]===(n?round(100*covered/n):null)
		}),
		"flagged plans":rs.every(p=>p.haircut===(p.flags.length?A.haircut:1)
			&&(!p.flags.length||p.plan.verdict!=="FARM")),
		"launch chance":plans.every(p=>values(p.launchOdds).every((q,i,curve)=>q>=(curve[i-1]??0)&&q<=1)),
		"farm outcomes":plans.every(fp=>{
			const {horizon:h,q,capital:cap,noToken,withToken,pStar,gas,funding,slip,timeCost,capitalCharge,drop,claimSell}=fp,
				loss=gas+funding+slip+timeCost+capitalCharge,payoff=drop-claimSell
			return h===chooseFarm(fp).horizon&&q===fp.launchOdds[h]
				&&close(gas,fp.transactions*fp.chain.gas)
				&&close(capitalCharge,cap*A.riskFreeRate*h/A.year)
				&&close(timeCost,wage(fp.handsOnMinutes))
				&&close(noToken,-loss)&&close(withToken,payoff-loss)
				&&(payoff<=0?pStar===null:close(pStar,loss/payoff))
		}),
		"SKIP conditional entry":plans.filter(p=>p.verdict==="SKIP").every(p=>
			p.steps.slice(2).every(([,body])=>/^If (entry trigger is met|position )/.test(body))),
		"SKIP trigger replay":plans.filter(p=>p.verdict==="SKIP").every(p=>{
			const {net}=evaluateFarm(p,p.capital,p.trigger)
			return p.steps[1][1].includes(p.trigger.rule)&&net>=-1e-8&&net<=1
		}),
		"hands-on total":plans.flatMap(p=>[p,p.test,...values(p.stress)].filter(Boolean)).every(p=>
			p.handsOnMinutes===p.setupMinutes+p.exitMinutes+p.checkMinutes&&p.checkMinutes===weeks(p.horizon)*A.weeklyMinutes),
		"expected net identity":plans.every(({q,withToken,noToken,net})=>close(net,q*withToken+(1-q)*noToken)),
		"Break-even":samples.length>=3&&[0,floor(samples.length/2),-1].every(i=>{
			const p=samples.at(i),{odds:q,dropRatio:share}=p.pay.targets[0]
			return[{q},{share}].every(s=>abs(evaluateFarm(p,p.capital,s).net)<=.01)
		}),
		"stress counts":entries(stress).every(([k,{all,farm}])=>keys(all).every(v=>{
			const matches=rs.filter(p=>p.plan.stress[k].verdict===v)
			return all[v]===matches.length&&farm[v]===count(matches,isFarm)
		})),
		"value term replay":value.ablation.every((a,i)=>{
			const [k,label]=entries(outerTerms)[i]
			return a.term===label&&a.withTerm===candidates[form]
				&&JSON.stringify(a.without)===JSON.stringify(outerScores(tests,[k])[k])
		}),
		"board digest":digest(boardRows(rs))===expectedDigest
	})]
}
function buildModel(snap){
	const recs=prepare(snap),groups=groupBy(recs,p=>p.status),pts=tokenPoints(groups.traded??[]),
		categories=Map.groupBy(recs,p=>p.category),
		review=new Date(Date.parse(snap.as_of)+A.reviewDays*DAY).toISOString().slice(0,10)
	if(pts.length<3) throw new Error("Need 3 screened caps.")
	const value=valueTest(pts,recs),{fit,form,weight,ranges:{quantiles}}=value,resamples=bootstrap(pts,form),
		oddsPts=recs.filter(p=>!p.product),
		oddsFit=fitOdds(oddsPts),oddsFolds=record(blindTests,k=>folds(oddsPts,k==="walk",A.oddsWarmup)),
		odds={validation:record(blindTests,k=>oddsTest(oddsFolds[k]))}
	const rs=(groups.ranked??[]).map(p=>{
		const launchValue=exp(capLog(fit,p)),
			s=tokenOdds(oddsFit,p),
			haircut=p.flags.length?A.haircut:1,
			[low,high]=band(resamples.map(fit=>exp(capLog(fit,p)))),
			row={...p,launchValue,tokenOdds:s,valueAge:ageFactor(s,weight),haircut,band:{low,high},
			peers:peersFor(p,pts)}
		row.score=scoreOf(launchValue,row.valueAge,haircut)
		row.equation=valueEquation(fit,row)
		const growth=p.category?quant(categories.get(p.category).map(r=>r.change_7d).filter(finite),A.exitGrowthQuantile):null
		return{...row,plan:farmPlan(row,review,oddsFit,growth)}
	}).sort(rankBy("score")).map((p,i)=>({...p,rank:i+1}))
	for(const p of rs){
		p.ranges=record(coverage,k=>quantiles[k].map(q=>p.score*exp(q)))
		const fp=p.plan
		p.rangeFarm=p.ranges[80].map(v=>evaluateFarm(fp,fp.capital,{share:v/p.score}))
	}
	const watched=rs.filter(p=>p.watchlist),
		counts={...record(statuses,k=>groups[k]?.length??0),total:recs.length,watchlistCovered:watched.length,
		watchlistTotal:snap.watchlist.length,valueFit:pts.length,oddsFit:oddsPts.length},
		verdicts=tally(rs,p=>p.plan.verdict),farms=rs.filter(isFarm),
		stress=record(["doubleCost","halfShare"],k=>({all:tally(rs,p=>p.plan.stress[k].verdict),
			farm:tally(farms,p=>p.plan.stress[k].verdict)}))
	return{rows:rs,recs,board:{rows:boardRows(rs)},counts,verdicts,stress,
		value,odds,calibration:pts,assumptions:settings}
}
const statuses=["traded","recorded","setAside","ranked"],band=xs=>A.bandQuantiles.map(q=>quant(xs,q)),
	reasons={cap:["traded","Positive market cap"],id:["recorded","Token ID or symbol recorded"],
		product:["setAside","Wrapped, staked or bridged product"],exchange:["setAside","Exchange category or name"],
		pre:["ranked","Pre-token"],watch:["ranked","Watchlist exception"]},
	timing="With TVL fixed, rising token-likeness with age estimates launch chance. The snapshot has no launch dates."
const settings={parameters:A,chainQuotes,fallbackChain,timing,
	notes:[timing,"Missing listing age uses the median.",
		`Rewards assume ${pct(A.depositorShare,0)} for depositors; ${pct(A.competingTvlShare,0)} of TVL competes.`,
		"Excludes yield, taxes and price moves."]}
if(typeof module==="object") module.exports={buildModel,boardChecks,selfChecks,boardRows,digest,exportManifest,
	evaluateFarm,chooseFarm,forms}
