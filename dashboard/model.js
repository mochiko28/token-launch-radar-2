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
		familyPenalty:2,oddsPenalty:1,valueWarmup:25,oddsWarmup:60,
		bootstrapDraws:192,bootstrapSeed:918273,bandQuantiles:[.1,.9],
		hourlyUsd:20,depositorShare:.05,competingTvlShare:.2,
		capitalLadder:[1000,2500,5000,10000,25000,50000],portfolioCapital:10000,farmMultiple:2,
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
const products=["Bridge","Canonical Bridge","Cross Chain Bridge","Restaked BTC","CEX"],
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
	rawScore=({launchValue,tokenOdds,haircut})=>launchValue*tokenOdds*haircut,
	scoreOf=p=>max(1,round(rawScore(p))),
	costUsd=n=>"$"+n.toFixed(2),
	integer=n=>round(n).toLocaleString("en-US"),whole=n=>"$"+integer(n)
const pct=(n,places=2)=>(n*100).toFixed(places)+"%",
	decisionQ=q=>pct(q,5),decisionUsd=n=>Number(n.toFixed(2)),
	oddsFactor=n=>n===null?"unreachable":"x"+n.toFixed(2),
	wage=min=>min*A.hourlyUsd/60,
	weeks=days=>floor(days/7),
	checks=checks=>entries(checks).map(([name,pass])=>({name,pass:!!pass}))
function quant(values,fraction=.5){
	if(!values.length) return null
	const order=values.toSorted((a,b)=>a-b),
		index=(order.length-1)*fraction
	return order[floor(index)]*(1-index%1)+order[ceil(index)]*(index%1)
}
function prepare(snap){
	const asOf=Date.parse(snap.as_of),issuerWords=new Set(snap.protocols.filter(hasToken).map(p=>word1(p.name)))
	return snap.protocols.map(p=>{
		const {category,name,tvl_usd:tvl,gecko_id}=p,
			family=familyOf.get(category)||"Other",
			isLiquid=liquid.includes(category),
			stamp=Date.parse(p.listed_at),
			date=finite(stamp)?stamp:null,
			ageDays=date===null?null:max(1,floor((asOf-date)/DAY)),
			growth=limit(p.change_7d??A.missingGrowth,...A.growthClip),
			carriedTvl=tvl*(1+growth/100),
			product=products.includes(category)||exchange.test(name)
			||/\b(?:wrapped|bridged|staked)\b/i.test(name)||(!isLiquid&&/\bstaking\b/i.test(name)),
			recorded=hasToken(p),
			watchlist=snap.watchlist.includes(p.slug),
			flags=recorded?[]:[issuerWords.has(word1(name))&&"Recorded issuer match",
				isLiquid&&"Liquid staking/restaking",version.test(name)&&"Versioned name"].filter(Boolean),
			status=p.mcap_usd>0?"traded":recorded?"recorded":product&&!watchlist?"setAside":"ranked"
		return{...p,family,date,ageDays,growth,carriedTvl,flags,
			product,productPeer:product||isLiquid||receiptId.test(gecko_id),watchlist,recorded,status,
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

const normal=(pen,n=pen.length)=>({target:zero(n),matrix:pen.map((v,i)=>zero(n).with(i,v))})
function accum({matrix,target},x,residual,weight=1){
	for(let i=0;i<x.length;i++){
		target[i]+=x[i]*residual
		if(x[i]===0) continue
		for(let j=0;j<x.length;j++) matrix[i][j]+=x[i]*x[j]*weight
	}
}

const shrinkage="TVL slope shrinkage",valueTerms=[
	["age","logAge",logAge],["growth","clippedGrowth",p=>p.growth/100],
	...keys(families).concat("Other").map(f=>["family",f,p=>+(f===p.family)])
]
const candidates={
	"Family shrinkage":["group",p=>p.family],
	"Category shrinkage":["group",p=>p.category],
	"Single-chain shrinkage":["group",p=>p.chains.length===1?p.chains[0]:null],
	"Chain breadth":["feature",p=>log(new Set(p.chains).size)],
	"Squared log TVL":["feature",p=>p.rawSize**2],
	"Log TVL hinge":["feature",p=>max(0,p.rawSize)],
	"TVL × age":["feature",(p,age)=>p.rawSize*logAge(p,age)],
	"Downside growth":["feature",p=>min(0,p.growth)/100],
	"Continuous carry":["carry",p=>p.rawSize+p.growth/100],
	"Huber fit":["huber"],"Median intercept":["median"],
	"Theil–Sen TVL fit":["theilSen"],[shrinkage]:["ridge"]
},
	capInputs=(p,{features,medianDays,omit,carry})=>[
	1,omit==="scale"?0:omit==="carry"?p.rawSize:carry?.(p)??p.size,
	...features.map(([,,read])=>read(p,medianDays))]
function fitValue(pts,terms,omit,alt){
	const [kind,read]=candidates[alt]??[],features=valueTerms.filter(([term])=>terms.includes(term)),
		fit={terms,features,medianDays:medianAge(pts),omit,carry:kind==="carry"?read:null,candidate:alt}
	if(kind==="feature") features.push([alt,alt,read])
	const inputs=pts.map(p=>capInputs(p,fit)),eps=1e-8,
		pen=[eps,eps+(kind==="ridge"?sqrt(pts.length):0),...features.map(([t])=>t==="family"?A.familyPenalty:eps)]
	const regress=weights=>{
		const eq=normal(pen)
		inputs.forEach((x,i)=>{
			const w=weights?.[i]??1
			accum(eq,x,pts[i].response*w,w)
		})
		return solve(eq.matrix,eq.target)
	}
	let coef=regress()
	const errors=()=>inputs.map((x,i)=>pts[i].response-dot(x,coef))
	if(kind==="huber"){
		const first=errors(),center=quant(first),cutoff=max(eps,1.345*1.4826*quant(first.map(e=>abs(e-center))))
		for(let i=0;i<20;i++) coef=regress(errors().map(e=>min(1,cutoff/abs(e))))
	}
	if(kind==="theilSen"){
		const es=errors(),slopes=[]
		inputs.forEach(([,x],i)=>{
			for(let j=0;j<i;j++){
				const dx=x-inputs[j][1]
				if(dx) slopes.push((es[i]-es[j])/dx)
			}
		})
		coef[1]+=quant(slopes)??0
	}
	if(kind==="median"||kind==="theilSen") coef[0]+=quant(errors())
	const group=kind==="group"?read:null,offsets=new Map()
	if(group) for(const [k,es] of Map.groupBy(errors(),(_,i)=>group(pts[i])))
		if(k!=null) offsets.set(k,sum(es)/(es.length+A.familyPenalty))
	return{...fit,coefficients:coef,group,offsets}
}
const capLog=(fit,p)=>dot(capInputs(p,fit),fit.coefficients)+(fit.offsets.get(fit.group?.(p))??0),
	capRatio=p=>p.mcap_usd/p.carriedTvl
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

const sum=ns=>ns.reduce((a,b)=>a+b,0),blindTests=["loo","walk"],
	flagNote="untested assumption (no traded rows carry the flag)"
const missStats=(es,n=es.length)=>({miss:n?exp(quant(es)):null,n,hits:[2,3].map(x=>n?inside(es,[0,log(x)])/n:null)})
function termTest(term,withTerm,without){
	const deltas=blindTests.map(k=>withTerm[k].n?without[k].miss-withTerm[k].miss:0)
	return{term,withTerm,without,verdict:deltas.every(d=>d<0)?"fails both":"kept · "+
		["no measured effect","helps one","helps both tests"][count(deltas,d=>d>0)]}
}
function residuals(splits,terms,omit,alt){
	return splits.flatMap(([train,test])=>{
		const fit=terms&&fitValue(train,terms,omit,alt),ratio=fit?0:log(quant(train.map(capRatio)))
		return test.map(p=>p.response-(fit?capLog(fit,p):log(p.carriedTvl)+ratio))
	})
}

const lowerMiss=(a,b,k)=>a[k].n&&a[k].miss<b[k].miss,
	passes=({withTerm:a,without:b})=>blindTests.every(k=>lowerMiss(a,b,k))
	&&a.family.n&&a.family.miss<=b.family.miss+.1
function selectFit(pts,inner){
	const splits={loo:folds(pts),walk:folds(pts,true),family:leaveOut(pts,p=>p.family)},tests=keys(splits),
		assess=(terms,candidate,omit)=>({terms,candidate,...record(tests,k=>missStats(residuals(splits[k],terms,omit,candidate).map(abs)))}),
		terms=["age","family","growth"],
		trials=Array.from({length:2**terms.length},(_,mask)=>assess(terms.filter((_,i)=>mask&(1<<i)))),
		mass=trial=>tests.reduce((n,k)=>n*(trial[k].miss??1),1),
		better=(a,b)=>tests.every(k=>lowerMiss(a,b,k)),
		deployed=trials.filter((trial,mask)=>terms.every((_,i)=>!(mask&(1<<i))||better(trial,trials[mask^(1<<i)])))
			.sort((a,b)=>mass(a)-mass(b))[0],
		search=keys(candidates).map(term=>({term,withTerm:assess(deployed.terms,term),without:deployed})),
		chosen=search.filter(passes).sort((a,b)=>mass(a.withTerm)-mass(b.withTerm))[0],
		winner=chosen?.withTerm??deployed
	if(inner) return winner
	for(const row of search) row.verdict=row===chosen?"Adopted":passes(row)?"Eligible":"Rejected"
	const labels={scale:"TVL exponent",carry:"7d carry",age:"Age in cap",family:"Family in cap"},
		evidence=entries(labels).filter(([t])=>t==="scale"||t==="carry"||winner.terms.includes(t))
			.map(([omit,label])=>termTest(label,winner,
				assess(winner.terms.filter(t=>t!==(omit==="carry"?"growth":omit)),winner.candidate,omit)))
	evidence.push({term:"Issuer haircut",withTerm:winner,without:winner,verdict:flagNote})
	return{fit:fitValue(pts,winner.terms,null,winner.candidate),
		validation:{baseline:assess(null),deployed,selected:winner,trials,evidence,search},
		ranges:rangeTest(splits,winner),nested:nestedTest(splits.walk)}
}
const levels={80:[.1,.9],50:[.25,.75]},coverage=keys(levels),
	bounds=errors=>record(coverage,k=>levels[k].map(q=>quant(errors,q))),
	inside=(errors,[lo,hi])=>count(errors,e=>lo<=e&&e<=hi)
function rangeTest({loo,walk},{terms,candidate}){
	const errors=splits=>residuals(splits,terms,null,candidate),leftOut=errors(loo),quantiles=bounds(leftOut),
		scores=walk.map(split=>[errors([split]),bounds(errors(folds(split[0])))]),n=scores.flatMap(([es])=>es).length,
		heldOut=record(coverage,k=>n?scores.reduce((sum,[es,range])=>sum+inside(es,range[k]),0)/n:null)
	return{quantiles,heldOut,n,loo80:inside(leftOut,quantiles[80])/leftOut.length}
}
function nestedTest(walk){
	const later=walk.slice(floor(walk.length/2))
	if(!later.length) return{miss:null,shrinkage:0,folds:0}
	const [train]=later[0],test=later.flatMap(([,rows])=>rows),
		{terms,candidate}=selectFit(train,true)
	return{miss:exp(quant(residuals([[train,test]],terms,null,candidate).map(abs))),shrinkage:+(candidate===shrinkage),folds:1}
}
const sigmoid=x=>1/(1+exp(-limit(x,-35,35))),
	oddsFeatures=(p,age)=>[1,p.rawSize,logAge(p,age)]
function fitOdds(pts,omit){
	const age=medianAge(pts),
		inputs=pts.map(p=>oddsFeatures(p,age).map((x,i)=>i===omit?0:x)),
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
function attribution(p,ref,fit,odds){
	const sized={...ref,rawSize:p.rawSize,size:p.rawSize+(ref.size-ref.rawSize)},
		carried={...sized,size:p.size,growth:p.growth},
		aged={...carried,ageDays:p.ageDays},
		[size,carry,age,family]=[sized,carried,aged,p].map((row,i,path) =>
		exp(capLog(fit,row)-capLog(fit,path[i-1]??ref))),
		midOdds=tokenOdds(odds,sized)
	return{size:size*midOdds/ref.tokenOdds,carry,age:age*p.tokenOdds/midOdds,
		issuer:p.haircut/ref.haircut,family,
		rounding:(p.score/rawScore(p))/(ref.score/rawScore(ref))}
}
function oddsTest(splits,omit){
	const scored=splits.flatMap(([train,test])=>{
		const fit=fitOdds(train,omit)
		return test.map(p=>[p.recorded,tokenOdds(fit,p)])
	}),{true:positive=[],false:negative=[]}=groupBy(scored,p=>p[0])
	let wins=0
	for(const [,p] of positive) for(const [,n] of negative) wins+=p>n?1:p===n?.5:0
	const pairs=positive.length*negative.length
	return{auc:pairs?wins/pairs:null,
		...missStats(scored.map(([recorded,score])=>-log(recorded?score:1-score)))}
}
function bootstrap(pts,{terms,candidate:alt}){
	let seed=A.bootstrapSeed
	return Array.from({length:A.bootstrapDraws},()=>{
		const sample=pts.map(()=>{
			seed=(Math.imul(seed,1664525)+1013904223)>>>0
			return pts[floor(seed*pts.length/2**32)]
		})
		return fitValue(sample,terms,null,alt)
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
	q=fp.launchOdds[h],shared=0}={}){
	const {entryGas,exitGas,slippage,delay,lockup}=quote,
		holding=max(h,lockup)+delay,
		{bridge,gas:gasPerTx}=fp.chain,
		gas=(fp.testGas+entryGas+exitGas)*cost,
		fees=(bridge+(cap+A.testUsd)*slippage/100)*cost,
		timeCost=wage(fp.handsOnMinutes+(weeks(h)-shared)*A.weeklyMinutes)*cost,
		capitalCharge=cap*(A.riskFreeRate*holding/A.year)*cost,
		loss=gas+fees+timeCost+capitalCharge,
		drop=fp.conditionalValue*(cap/(fp.competingTvl+cap))*A.depositorShare*share,
		claimSell=(gasPerTx*A.claimActions+wage(A.claimMinutes)+drop*slippage/100)*cost,
		payoff=drop-claimSell,
		pStar=payoff>0?loss/payoff:null,
		multiple=q*payoff/loss,
		verdict=multiple<1?"SKIP":multiple>=A.farmMultiple&&!fp.capped?"FARM":"MARGINAL",
		net=q*payoff-loss,withToken=payoff-loss
	return{capital:cap,horizon:h,q,cost:loss,gas,fees,timeCost,capitalCharge,holding,drop,claimSell,pStar,
		noToken:-loss,withToken,net,multiple,verdict,expectedYield:net/cap,conditionalApr:withToken/cap*A.year/holding}
}
const bestBy=k=>(a,b)=>b[k]>a[k]?b:a
function sizeFarm(fp,scenario){
	const ladder=A.capitalLadder.map(cap=>evaluateFarm(fp,cap,scenario))
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
		return{odds,oddsRatio:q&&odds!==null?odds/q:null,
			drop:reward,dropRatio:reward!==null&&drop?reward/drop:null}
	})}
}
const costTime=(min,fees=0)=>`${costUsd(wage(min)+fees)} · ${min} min`
function farmPlan(p,review,curve,exitGrowth){
	const {name:protocol,category,family,website,url,tvl_usd:tvl,band}=p,[actions,bps,entryMins,...base]=mechanisms[family],
		[verb,entry,monitor]=category?.endsWith("Bridge")?plays.Bridge:hasOwn(plays,category)?plays[category]:base,
		transactions=2*actions,chains=unique(p.chains),chain=routeFor(chains,transactions),{name,gas,bridge,bridgeMinutes}=chain,
		native=assets[name],asset={
			Staking:native||(ethChains.includes(name)?"ETH":name+" native asset"),
			Network:/BTC$/.test(category)?"BTC":native,LP:"USDC/USDT"
		}[family]||"USDC",
		ticketFor=cap=>family==="LP"?`${whole(cap/2)} USDC + ${whole(cap/2)} USDT`:`${whole(cap)} ${asset}`,
		action=`${verb} ${asset} on ${name}`,
		{verifyMinutes:verify,testUsd,exitMinutes,claimMinutes,weeklyMinutes,firstSaleShare}=A,
		prep=A.routeHandsOnMinutes+A.testMinutes,slippage=bps/100,
		quote={entryGas:gas*(actions-1),exitGas:gas,slippage,delay:0,lockup:0},
		fp={chain,quote,testGas:gas*actions,launchOdds:launchOdds(curve,p),
			competingTvl:tvl*A.competingTvlShare,conditionalValue:p.launchValue*p.haircut,
			handsOnMinutes:verify+prep+entryMins+exitMinutes,capped:!!p.flags.length},
		result=chooseFarm(fp),pay=targetsFor(result,quote),
		{capital:cap,pStar,verdict,horizon:h,q,claimSell}=result,
		exits=[
			`TVL < ${whole(tvl*A.exitTvlShare)} (${pct(A.exitTvlShare,0)} of snapshot TVL)`,
			`token announced or no token by day ${h}`],
		testFees=bridge+fp.testGas+testUsd*slippage/100,entryFees=quote.entryGas+cap*slippage/100,
		verified=costTime(verify),weekly=costTime(weeklyMinutes)+"/check",ticket=verb+" "+ticketFor(cap),site=website||url,
		route=chains.length>1?`. ${name}: cheapest priced route among ${chains.length} chains`:` on ${name}`
	if(exitGrowth!=null) exits.push(`7d TVL growth < ${exitGrowth.toFixed(2)}% (${category} p10) two weeks running`)
	const steps=[
		[`If farming ${protocol}, check rewards, assets, KYC, exits, deposit caps for ${whole(cap)}${route}.${site?" "+site:""}`,verified],
		["If rules pending or caps full, wait.",verified,`Review ${review} or on change`],
		["If ineligible, exit blocked or token recorded, stop.",verified],
		[`If FARM, fund ${name}, deposit ${ticketFor(testUsd)} and withdraw it.`,`${costTime(prep,testFees)} + ${2*bridgeMinutes} min funding`],
		["If test fails or is late, stop.",`${costTime(verify+prep,testFees)} spent. Recover ≤ ${whole(testUsd)}.`],
		[`If FARM after rehearsal on ${name}, ${ticket} ${entry}.`,
			`${costTime(entryMins,entryFees)}. Gas + slip cap ${costUsd(entryFees)}.`,
			`${verdict} · ${h} d · q ${pct(q)} vs p* ${pStar===null?"unreachable":pct(pStar)}.`,
			`Wait for lower costs${fp.capped?" and cleared flags":""}. Review ${review}.`,costTime(0)],
		[`If eligible, log points, TVL, ${monitor} weekly.`,weekly],
		[`If ${exits.join(", or ")}, exit on ${name}.`,`${costTime(exitMinutes,gas)} + lock/delay`],
		[`If eligible at launch, claim and sell ${firstSaleShare*100}% at ${whole(band.low)} circ. cap, rest near ${whole(band.high)}.`,
			`${costTime(claimMinutes,claimSell-wage(claimMinutes))}. Undo: buy back.`]
	]
	const [{drop,oddsRatio}]=pay.targets
	if(verdict==="SKIP") steps.push([`Revisit if points or snapshot announced. ${name} needs ${
		drop===null?"higher launch odds":`launch odds ${oddsFactor(oddsRatio)} or ${costUsd(drop)} drop`} to break even.`,weekly])
	return{...fp,...result,action,ticket,steps,exits,transactions,pay,stress:{
		doubleCost:sizeFarm(fp,{horizon:h,cost:A.stressCost}),halfShare:sizeFarm(fp,{horizon:h,share:A.stressShare})
	}}
}
const isFarm=p=>p.plan.verdict==="FARM"
function allocate(farms){
	const budget=A.portfolioCapital,eligible=farms.length,overlap=min(...farms.map(p=>weeks(p.plan.horizon)))
	for(let n=min(eligible,floor(budget/A.capitalLadder[0]));n>0;n--){
		const shared=overlap*(1-1/n),
			picks=farms.map(p=>[p,sizeFarm(p.plan,{shared}).capital])
			.sort(([a,x],[b,y])=>x-y||a.rank-b.rank).slice(0,n),
			minimum=sum(picks.map(([,cap])=>cap))
		if(minimum>budget) continue
		const score=sum(picks.map(([p])=>p.score)),surplus=(budget-minimum)*100
		let remaining=surplus
		const positions=picks.map(([p,cap],i)=>{
			const extra=i===n-1?remaining:floor(surplus*p.score/score)
			remaining-=extra
			return{slug:p.slug,name:p.name,...evaluateFarm(p.plan,cap+extra/100,{shared})}
		})
		return{budget,eligible,capital:budget,unallocated:0,positions,cost:sum(positions.map(p=>p.cost)),net:sum(positions.map(p=>p.net))}
	}
	return{budget,eligible,capital:0,unallocated:budget,positions:[],cost:0,net:0}
}
const boardRows=rs=>rs.map(({slug,name,rank,score,launchValue,tokenOdds,haircut,ranges,plan:fp})=>({slug,name,rank,
	implied_value_usd:score,launch_value_usd:launchValue,token_odds:tokenOdds,
	issuer_factor:haircut,implied_value_ranges_usd:ranges,farm_steps:fp.steps.map(parts=>parts.join(" "))}))
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
		&&steps.every(s=>typeof s==="string"&&/^.{20,600}$/s.test(s.trim())&&/^(If|Revisit if) .+\$\d.*\d+ min/u.test(s))
function selfChecks({rows:rs,board,counts,stress,portfolio,reference,calibration,value,odds},snap,expectedDigest){
	const {evidence,search,deployed,selected:winner}=value.validation,
		plans=rs.map(p=>p.plan),samples=plans.filter(p=>p.pStar!==null&&p.q>0&&p.drop>0),close=(a,b)=>abs(a-b)<1e-8
	return[...boardChecks(board,snap),...checks({
		"group counts":statuses.reduce((n,k)=>n+counts[k],0)===counts.total
			&&counts.ranked===rs.length&&calibration.every(p=>p.mcap_usd>0&&!p.productPeer),
		"value factors":rs.every(p=>scoreOf(p)===p.score),
		"attribution":rs.every(p=>abs(values(p.attribution).reduce((a,b)=>a*b,1)*reference.score/p.score-1)<1e-10),
		"bootstrap bands":rs.every(p=>p.band.low>0&&p.band.low<=p.band.high&&p.tokenOdds>0&&p.tokenOdds<1),
		"80% LOO coverage":abs(value.ranges.loo80-.8)<=.02,
		"flagged plans":rs.every(p=>p.flags.length?p.haircut===A.haircut&&p.plan.verdict!=="FARM":p.haircut===1),
		"launch odds":plans.every(p=>values(p.launchOdds).every((q,i,curve)=>q>=(curve[i-1]??0)&&q<=1)),
		"farm outcomes":plans.every(fp=>{
			const {horizon:h,q,capital:cap,noToken,withToken,net,pStar,gas,fees,timeCost,capitalCharge,drop,claimSell}=fp,
				loss=gas+fees+timeCost+capitalCharge,payoff=drop-claimSell
			return h===chooseFarm(fp).horizon&&q===fp.launchOdds[h]
				&&close(gas,fp.transactions*fp.chain.gas)
				&&close(capitalCharge,cap*A.riskFreeRate*h/A.year)
				&&close(timeCost,wage(fp.handsOnMinutes+weeks(h)*A.weeklyMinutes))
				&&close(noToken,-loss)&&close(withToken,payoff-loss)
				&&close(net,(1-q)*noToken+q*withToken)
				&&(payoff<=0?pStar===null:close(pStar,loss/payoff))
		}),
		"displayed decision net":plans.every(({q,withToken,noToken,net})=>{
			const odds=parseFloat(decisionQ(q))/100,
				expected=odds*decisionUsd(withToken)+(1-odds)*decisionUsd(noToken)
			return abs(expected-net)<=.01&&abs(expected-decisionUsd(net))<=.01
		}),
		"Break-even":samples.length>=3&&[0,floor(samples.length/2),-1].every(i=>{
			const p=samples.at(i),{odds:q,dropRatio:share}=p.pay.targets[0]
			return[{q},{share}].every(s=>abs(evaluateFarm(p,p.capital,s).net)<=.01)
		}),
		"stress counts":entries(stress).every(([k,{all,farm}])=>keys(all).every(v=>{
			const matches=rs.filter(p=>p.plan.stress[k].verdict===v)
			return all[v]===matches.length&&farm[v]===count(matches,isFarm)
		})),
		"allocation":round((portfolio.capital+portfolio.unallocated)*100)===portfolio.budget*100
			&&portfolio.positions.every(p=>p.verdict==="FARM"&&rs.some(r=>r.watchlist&&isFarm(r)&&r.slug===p.slug)),
		"term table":[[evidence,winner],[odds.evidence,odds.validation]].every(([rs,fit])=>rs.length&&rs.every(r=>r.withTerm===fit)),
		"value search":search.every(row=>row.without===deployed&&passes(row)===(row.verdict!=="Rejected")
			&&(row.withTerm===winner)===(row.verdict==="Adopted")),
		"board digest":digest(boardRows(rs))===expectedDigest
	})]
}
function buildModel(snap){
	const recs=prepare(snap),groups=groupBy(recs,p=>p.status),pts=tokenPoints(groups.traded??[]),
		categories=Map.groupBy(recs,p=>p.category),
		review=new Date(Date.parse(snap.as_of)+A.reviewDays*DAY).toISOString().slice(0,10)
	if(pts.length<3) throw new Error("Need 3 screened caps.")
	const value=selectFit(pts),{fit,ranges:{quantiles}}=value,
		resamples=bootstrap(pts,fit),
		oddsPts=recs.filter(p=>!p.product),
		oddsFit=fitOdds(oddsPts),oddsFolds=record(blindTests,k=>folds(oddsPts,k==="walk",A.oddsWarmup)),
		assess=omit=>record(blindTests,k=>oddsTest(oddsFolds[k],omit)),
		validation=assess(),
		odds={validation,evidence:[[2,"Age in status odds"],[1,"TVL in status odds"]]
			.map(([omit,label])=>termTest(label,validation,assess(omit)))}
	const rs=(groups.ranked??[]).map(p=>{
		const launchValue=exp(capLog(fit,p)),
			s=tokenOdds(oddsFit,p),
			haircut=p.flags.length?A.haircut:1,
			[low,high]=band(resamples.map(fit=>exp(capLog(fit,p)))),
			row={...p,launchValue,tokenOdds:s,haircut,band:{low,high,weightedLow:low*s*haircut,weightedHigh:high*s*haircut},
			peers:peersFor(p,pts)}
		row.score=scoreOf(row)
		const growth=p.category?quant(categories.get(p.category).map(r=>r.change_7d).filter(finite),A.exitGrowthQuantile):null
		return{...row,plan:farmPlan(row,review,oddsFit,growth)}
	}).sort(rankBy("score"))
		.map((p,i)=>({...p,rank:i+1})),
		reference=rs[floor(rs.length/2)]
	for(const p of rs){
		p.attribution=attribution(p,reference,fit,oddsFit)
		p.ranges=record(coverage,k=>quantiles[k].map(q=>p.score*exp(q)))
		const fp=p.plan
		p.rangeFarm=p.ranges[80].map(v=>evaluateFarm(fp,fp.capital,{share:v/p.score}))
	}
	const watched=rs.filter(p=>p.watchlist),
		counts={...record(statuses,k=>groups[k]?.length??0),total:recs.length,watchlistCovered:watched.length,
		watchlistTotal:snap.watchlist.length,valueFit:pts.length,oddsFit:oddsPts.length},
		verdicts=tally(rs,p=>p.plan.verdict),farms=rs.filter(isFarm),
		stress=record(["doubleCost","halfShare"],k=>({all:tally(rs,p=>p.plan.stress[k].verdict),
			farm:tally(farms,p=>p.plan.stress[k].verdict)})),
		calibration=pts.map(p=>({...p,launchValue:exp(capLog(fit,p))})),peerRatios=band(pts.map(capRatio)),
		audit=rs.slice(0,20).map(p=>{
			const ratio=p.launchValue/p.carriedTvl
			return{...p,ratio,outlier:ratio<peerRatios[0]||ratio>peerRatios[1]}
		})
	return{rows:rs,reference,board:{rows:boardRows(rs)},counts,verdicts,stress,portfolio:allocate(watched.filter(isFarm)),
		value,odds,calibration,audit,peerRatios,assumptions:settings}
}
const statuses=["traded","recorded","setAside","ranked"],band=xs=>A.bandQuantiles.map(q=>quant(xs,q)),
	timing="Fixed-TVL age curve. No launch dates."
const settings={parameters:A,chainQuotes,fallbackChain,mechanisms,families,timing,
	notes:[timing,"Issuer haircut · "+flagNote,
		"q(H) = max(0,(F(a+H)−F(a))/(1−F(a))). Median age fallback.",
		"Excludes yield/tax/price moves. Requote borrow/mint/trade."]}
if(typeof module==="object") module.exports={buildModel,boardChecks,selfChecks,boardRows,digest,
	evaluateFarm,chooseFarm,oddsFactor,orderedRows,validSteps}
