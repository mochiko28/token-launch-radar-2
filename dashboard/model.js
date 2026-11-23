"use strict";
const TABLES={
	farm:{"hourlyUsd":20,depositorShare:.05,competingTvlShare:.2,capitalLadder:[1000,2500,5000,10000,25000,50000],portfolioCapital:10000,farmMultiple:2,stressCost:2,stressShare:.5,weeklyMinutes:2,routeHandsOnMinutes:6,verifyMinutes:8,exitTvlShare:.75,exitMinutes:10,weeklyLossBuffer:10,reviewDays:14,horizons:[30,90,180,365],riskFreeRate:.04,testUsd:80,testMinutes:6,claimMinutes:8,claimActions:2,firstSaleShare:.5},
	chainQuotes:{Ethereum:[4.5,9,25],Bitcoin:[3,9,60],Solana:[.08,1.8,8],Base:[.16,.8,8],Arbitrum:[.23,1.2,10],Optimism:[.19,1,10],Binance:[.18,1.2,9],Polygon:[.12,.9,9],Avalanche:[.3,1.5,12],Monad:[.15,1.2,12],Ink:[.17,1.1,10],Plasma:[.14,1.3,14],"Hyperliquid L1":[.23,1.6,15],Sui:[.12,1.6,12],Aptos:[.12,1.5,12],Stellar:[.08,1.8,12],Flare:[.16,1.9,15],Algorand:[.09,2,12],Ripple:[.12,2.1,14],Tron:[1.2,3.5,16],Linea:[.24,1.3,15],Mantle:[.22,1.5,14],Sonic:[.15,1.5,12],Scroll:[.25,1.5,15],xDai:[.13,1.4,12],Berachain:[.24,1.5,15],TON:[.25,2,15],Near:[.18,2,15],Starknet:[.26,1.5,18],Celo:[.13,1.5,12],"zkSync Era":[.24,1.5,16],Unichain:[.18,1.3,12],"World Chain":[.21,1.5,12],Ronin:[.21,1.7,15],Sei:[.18,1.8,15],Cardano:[.32,2.5,20],"Plume Mainnet":[.24,1.7,16],Arc:[.2,1.7,15],Pharos:[.25,2,18],CORE:[.27,2.3,18],Bittensor:[.32,2.7,18],BSquared:[.35,3,22],Noble:[.25,2,15],Mezo:[.34,2.6,17]},
	fallbackChain:[1.5,5,30],
	mechanisms:{Lending:[3,4,9,"Supply","Liquid markets only. No borrowing."],Vault:[3,12,12,"Deposit","Review strategy."],LP:[4,30,14,"Pair","Check pool depth and receipt."],Perps:[4,25,14,"Post","No leverage."],Staking:[3,12,11,"Stake","Check unbonding and slashing."],RWA:[3,25,16,"Subscribe with","Check KYC and exits."],Stablecoin:[4,18,13,"Supply","Check peg depth. No leverage."],Network:[3,15,13,"Deposit","Follow docs."],Insurance:[3,25,14,"Supply","Check claims and exit queue."],Other:[3,20,13,"Deposit","Check deposit docs."]},
	ethChains:["Ethereum","Base","Arbitrum","Optimism","Linea","Ink","Scroll","zkSync Era"],
	assets:{Algorand:"ALGO",Bitcoin:"BTC",BSquared:"BTC",CORE:"CORE",Flare:"FLR","Hyperliquid L1":"HYPE",Mezo:"BTC",Monad:"MON",Near:"NEAR",Qubic:"QU",Solana:"SOL",Stacks:"STX",Starknet:"STRK",Sui:"SUI",TON:"TON",XDC:"XDC","Bifrost Network":"BNC",Mixin:"XIN",XION:"XION",ZIGChain:"ZIG"},
	families:{Lending:"Lending|Uncollateralized Lending|Collateral Markets|Collateral Management",Vault:"Yield|Yield Aggregator|Risk Curators|Onchain Capital Allocator|Basis Trading|Leveraged Farming|Farm|Indexes|Options Vault|CeDeFi",LP:"Dexs|Liquidity Manager",Perps:"Derivatives|Synthetics|Options|Interest Rate Derivatives|Prediction Market",Staking:"Liquid Staking|Liquid Restaking|Staking Pool|Restaking|Token Locker|Governance Incentives",RWA:"RWA",Stablecoin:"CDP|CDP Manager|Algo-Stables|Dual-Token Stablecoin|Stablecoin Wrapper|Stablecoin Issuer|Reserve Currency",Network:"Chain|Payments|Decentralized BTC|Anchor BTC|Cross Chain Bridge",Insurance:"Insurance"}
},
	{abs,ceil,exp,floor,log,max,min,round,sqrt}=Math,
	{entries,fromEntries,hasOwn,keys,values}=Object;
const record=(keys,read)=>fromEntries(keys.map(k=>[k,read(k)])),unique=items=>[...new Set(items)],
	{farm,chainQuotes,fallbackChain,mechanisms,ethChains,assets,families}=TABLES,
	A={
	growthClip:[-30,30],missingGrowth:0,haircut:.65,year:365,
	tvlReference:1e8,missingAgeFallback:365,
	familyPenalty:2,oddsPenalty:1,valueWarmup:25,oddsWarmup:60,
	bootstrapDraws:192,bootstrapSeed:918273,bandQuantiles:[.1,.9],
	...farm,peerCount:3,peerCategoryPenalty:1,peerFamilyPenalty:.45
},
	DAY=86_400_000,
	familyOf=new Map(entries(families).flatMap(([family,categories])=>
	categories.split("|").map(category=>[category,family])));
const products=new Set(["Bridge","Canonical Bridge","Cross Chain Bridge","Restaked BTC","CEX"]),
	liquid=new Set(["Liquid Staking","Liquid Restaking"]),
	version=/\s+(?:v\s*\d+(?:\.\d+)*|\d+\.\d+(?:\.\d+)*)$/i,
	exchange=/^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i,
	receiptId=/^(wrapped|bridged|staked|restaked|savings)-/i;
const byText=(a,b)=>(a>b)-(a<b),
	rankBy=k=>(a,b)=>b[k]-a[k]||byText(a.slug,b.slug),
	limit=(value,low,high)=>min(high,max(low,value)),
	count=(rs,test)=>rs.filter(test).length,
	tally=(rs,get)=>record(["FARM","MARGINAL","SKIP"],v=>count(rs,p=>get(p)===v)),
	word1=name=>name.toLowerCase().match(/[\p{L}\p{N}]+/u)?.[0];
const hasToken=p=>p.mcap_usd>0||Boolean(p.gecko_id||p.symbol),
	rawScore=p=>p.launchValue*p.tokenOdds*p.haircut,
	costUsd=n=>"$"+n.toFixed(2),
	integer=n=>round(n).toLocaleString("en-US"),whole=n=>"$"+integer(n);
const percent=(n,places=2)=>(n*100).toFixed(places)+"%",
	oddsFactor=n=>n===null?"unreachable":"x"+n.toFixed(2),
	wage=min=>min*A.hourlyUsd/60,
	weeks=days=>floor(days/7),
	checksFor=checks=>entries(checks).map(([name,pass])=>({name,pass:!!pass}));

function quant(values,fraction=.5){
	if(!values.length) return null;
	const order=values.toSorted((a,b)=>a-b),
		index=(order.length-1)*fraction;
	return order[floor(index)]*(1-index%1)+order[ceil(index)]*(index%1);
}

function prepare(snap){
	const asOf=Date.parse(snap.as_of),
		watchlist=new Set(snap.watchlist),
		issuerWords=new Set(snap.protocols.filter(hasToken).map(p=>word1(p.name)));
	return snap.protocols.map(p=>{
		const {category,name,tvl_usd:tvl}=p,
			family=familyOf.get(category)||"Other",
			isLiquid=liquid.has(category),
			stamp=Date.parse(p.listed_at),
			date=Number.isFinite(stamp)?stamp:null,
			ageDays=date===null?null:max(1,floor((asOf-date)/DAY)),
			growth=limit(p.change_7d??A.missingGrowth,...A.growthClip),
			carriedTvl=tvl*(1+growth/100),
			product=products.has(category)||exchange.test(name)
			||/\b(?:wrapped|bridged|staked)\b/i.test(name)||(!isLiquid&&/\bstaking\b/i.test(name)),
			recorded=hasToken(p),
			watched=watchlist.has(p.slug),
			flags=recorded?[]:[issuerWords.has(word1(name))&&"Name matches a recorded issuer",
				isLiquid&&"Liquid staking or restaking",version.test(name)&&"Versioned name"].filter(Boolean),
			status=p.mcap_usd>0?"traded":recorded?"recorded":product&&!watched?"setAside":"ranked";
		return{...p,family,date,ageDays,growth,carriedTvl,flags,
			product,productPeer:product||isLiquid||receiptId.test(p.gecko_id),watchlist:watched,recorded,status,
			size:log(carriedTvl/A.tvlReference),rawSize:log(tvl/A.tvlReference)};
	});
}

function tokenPoints(recs){
	const tokens=new Map();
	for(const p of recs.filter(p=>p.status==="traded"&&!p.productPeer).sort(rankBy("tvl_usd"))){
		const k=p.gecko_id?"gecko:"+p.gecko_id:p.symbol?"symbol:"+p.symbol:p.slug;
		if(!tokens.has(k)) tokens.set(k,{...p,response:log(p.mcap_usd)});
	}
	return[...tokens.values()].sort((a,b)=>byText(a.slug,b.slug));
}
const medianAge=rs=>quant(rs.map(p=>p.ageDays).filter(Number.isFinite))??A.missingAgeFallback,
	logAge=(p,fallback)=>log((p.ageDays??fallback)/A.year);

function solve(matrix,target){
	const rs=matrix.map((r,i)=>[...r,target[i]]),
		n=rs.length;
	for(let c=0;c<n;c++){
		let pivot=c;
		for(let r=c+1;r<n;r++){
			if(abs(rs[r][c])>abs(rs[pivot][c])) pivot=r;
		}
		[rs[c],rs[pivot]]=[rs[pivot],rs[c]];
		const scale=rs[c][c];
		for(let j=c;j<=n;j++) rs[c][j]/=scale;
		for(let r=0;r<n;r++){
			if(r===c) continue;
			const factor=rs[r][c];
			for(let j=c;j<=n;j++) rs[r][j]-=factor*rs[c][j];
		}
	}
	return rs.map(r=>r[n]);
}
const dot=(row,coef)=>row.reduce((sum,x,i)=>sum+x*coef[i],0),
	zero=n=>Array(n).fill(0);

const normal=(pen,n=pen.length)=>({target:zero(n),matrix:pen.map((v,i)=>zero(n).with(i,v))});

function accum({matrix,target},x,residual,weight=1){
	for(let i=0;i<x.length;i++){
		target[i]+=x[i]*residual;
		if(x[i]===0) continue;
		for(let j=0;j<x.length;j++) matrix[i][j]+=x[i]*x[j]*weight;
	}
}

const valueTerms=[
	["age","logAge",logAge],["growth","clippedGrowth",p=>p.growth/100],
	...keys(families).concat("Other").map(f=>["family",f,p=>+(f===p.family)])
];
const candidates={
	"Shrunk family offset":["group",p=>p.family],
	"Shrunk category offset":["group",p=>p.category],
	"Shrunk single-chain offset":["group",p=>p.chains.length===1?p.chains[0]:null],
	"Chain breadth":["feature",p=>log(new Set(p.chains).size)],
	"Quadratic log TVL":["feature",p=>p.rawSize**2],
	"Log TVL hinge":["feature",p=>max(0,p.rawSize)],
	"TVL × listing age":["feature",(p,age)=>p.rawSize*logAge(p,age)],
	"Downside growth":["feature",p=>min(0,p.growth)/100],
	"Continuous 7d carry":["carry",p=>p.rawSize+p.growth/100],
	"Huber fit":["huber"],"Median residual intercept":["median"],
	"Theil–Sen TVL fit":["theilSen"],"TVL slope shrinkage":["ridge"]
},
	capInputs=(p,{features,medianDays,omit,carry})=>[
	1,omit==="scale"?0:omit==="carry"?p.rawSize:carry?.(p)??p.size,
	...features.map(([,,read])=>read(p,medianDays))];

function fitValue(pts,terms,omit,alt){
	const [kind,read]=candidates[alt]??[],
		features=valueTerms.filter(([term])=>terms.includes(term)),
		fit={terms,features,medianDays:medianAge(pts),omit,carry:kind==="carry"?read:null,candidate:alt};
	if(kind==="feature") features.push([alt,alt,read]);
	const inputs=pts.map(p=>capInputs(p,fit)),
		names=["intercept","logCarriedTvl",...features.map(([,name])=>name)],
		pen=[1e-8,1e-8+(kind==="ridge"?sqrt(pts.length):0),...features.map(([term])=>term==="family"?A.familyPenalty:1e-8)];
	const regress=weights=>{
		const eq=normal(pen);
		inputs.forEach((x,i)=>{
			const w=weights?.[i]??1;
			accum(eq,x,pts[i].response*w,w);
		});
		return solve(eq.matrix,eq.target);
	};
	let coef=regress();
	const errors=()=>inputs.map((x,i)=>pts[i].response-dot(x,coef));
	if(kind==="huber"){
		const first=errors(),center=quant(first),
			cutoff=max(1e-8,1.345*1.4826*quant(first.map(e=>abs(e-center))));
		for(let i=0;i<20;i++) coef=regress(errors().map(e=>min(1,cutoff/abs(e))));
	}
	if(kind==="theilSen"){
		const residuals=errors(),slopes=[];
		inputs.forEach(([,x],i)=>{
			for(let j=0;j<i;j++){
				const dx=x-inputs[j][1];
				if(dx) slopes.push((residuals[i]-residuals[j])/dx);
			}
		});
		coef[1]+=quant(slopes)??0;
	}
	if(kind==="median"||kind==="theilSen") coef[0]+=quant(errors());
	const offsets=new Map(),group=kind==="group"?read:null;
	if(group){
		errors().forEach((error,i)=>{
			const k=group(pts[i]),[sum,n]=offsets.get(k)??[0,A.familyPenalty];
			if(k!=null) offsets.set(k,[sum+error,n+1]);
		});
		for(const [k,[sum,n]] of offsets) offsets.set(k,sum/n);
	}
	return{...fit,names,coefficients:coef,group,offsets};
}

const capLog=(fit,p)=>dot(capInputs(p,fit),fit.coefficients)+(fit.offsets.get(fit.group?.(p))??0),
	flatRatio=pts=>log(quant(pts.map(p=>p.mcap_usd/p.carriedTvl)));

function folds(pts,walk,warmup){
	if(!walk) return pts.map((p,i)=>[pts.filter((_,j)=>i!==j),[p]]);
	const dated=pts.filter(p=>p.date!==null).sort((a,b)=>a.date-b.date||byText(a.slug,b.slug));
	return dated.flatMap((p,i)=>{
		if(i<warmup||p.date===dated[i-1]?.date) return[];
		let end=i+1;
		while(dated[end]?.date===p.date) end++;
		return[[dated.slice(0,i),dated.slice(i,end)]];
	});
}

const blindTests=["loo","walk"],
	flagNote="untested assumption (no traded rows carry the flag)";

function missStats(misses){
	const n=misses.length;
	return{miss:n?exp(quant(misses)):null,n,
		hits:[2,3].map(x=>n?count(misses,m=>m<=log(x))/n:null)};
}

function termTest(term,withTerm,without){
	const deltas=blindTests.map(k=>withTerm[k].n?without[k].miss-withTerm[k].miss:0);
	return{term,withTerm,without,verdict:deltas.every(d=>d<0)?"fails both":"kept · "+
		["no measured effect","helps one","helps both tests"][count(deltas,d=>d>0)]};
}

function valueMiss(splits,terms,omit,alt){
	return missStats(splits.flatMap(([train,test])=>{
		const fit=terms&&fitValue(train,terms,omit,alt),ratio=fit?0:flatRatio(train);
		return test.map(p=>abs((fit?capLog(fit,p):log(p.carriedTvl)+ratio)-p.response));
	}));
}

const passes=({withTerm:a,without:b})=>blindTests.every(k=>a[k].n&&a[k].miss<b[k].miss)
	&&a.family.n&&a.family.miss<=b.family.miss+.1;

function selectFit(pts){
	const splits={
		loo:folds(pts,false,A.valueWarmup),walk:folds(pts,true,A.valueWarmup),
		family:unique(pts.map(p=>p.family)).map(f=>[pts.filter(p=>p.family!==f),pts.filter(p=>p.family===f)])
			.filter(([train])=>train.length)
	},
		tests=keys(splits),
		assess=(terms,alt,omit)=>({terms,candidate:alt,...record(tests,k=>valueMiss(splits[k],terms,omit,alt))}),
		baseline=assess(null),
		terms=["age","family","growth"],
		trials=Array.from({length:1 << terms.length},(_,mask)=>assess(terms.filter((_,i)=>mask & (1 << i)))),
		mass=trial=>tests.reduce((product,k)=>product*(trial[k].miss??1),1),
		better=(a,b)=>tests.every(k=>a[k].n&&a[k].miss<b[k].miss),
		deployed=trials.filter((trial,mask)=>terms.every((_,i)=>{
		const bit=1 << i;
		return !(mask & bit)||better(trial,trials[mask ^ bit]);
	})).sort((a,b)=>mass(a)-mass(b))[0],
		search=keys(candidates).map(term=>({term,withTerm:assess(deployed.terms,term),without:deployed})),
		chosen=search.filter(passes).sort((a,b)=>mass(a.withTerm)-mass(b.withTerm))[0],
		winner=chosen?.withTerm??deployed;
	for(const row of search) row.verdict=row===chosen?"Adopted":passes(row)?"Eligible":"Rejected";
	const labels={scale:"TVL scale exponent",carry:"7d-growth carry",age:"Listing age in cap",family:"Family in cap"},
		evidence=entries(labels).filter(([t])=>t==="scale"||t==="carry"||winner.terms.includes(t))
			.map(([omit,label])=>termTest(label,winner,
				assess(winner.terms.filter(t=>t!==(omit==="carry"?"growth":omit)),winner.candidate,omit)));
	evidence.push({term:"Issuer haircut",withTerm:winner,without:winner,verdict:flagNote});
	return{fit:fitValue(pts,winner.terms,null,winner.candidate),validation:{baseline,deployed,selected:winner,trials,evidence,search}};
}

const sigmoid=x=>1/(1+exp(-limit(x,-35,35))),
	oddsFeatures=(p,age)=>[1,p.rawSize,logAge(p,age)];

function fitOdds(pts,omit){
	const age=medianAge(pts),
		inputs=pts.map(p=>oddsFeatures(p,age).map((x,i)=>i===omit?0:x)),
		pen=[1e-6,A.oddsPenalty,A.oddsPenalty];
	let beta=zero(3);
	for(let i=0;i<20;i++){
		const eq=normal(pen);
		eq.target=beta.map((c,j)=>-c*pen[j]);
		for(let j=0;j<pts.length;j++){
			const x=inputs[j],prob=sigmoid(dot(x,beta));
			accum(eq,x,pts[j].recorded-prob,prob*(1-prob));
		}
		const delta=solve(eq.matrix,eq.target);
		beta=beta.map((c,j)=>c+delta[j]);
		if(max(...delta.map(abs))<1e-8) break;
	}
	return{age,beta};
}

const tokenOdds=(fit,p)=>sigmoid(dot(oddsFeatures(p,fit.age),fit.beta));

const launchOdds=(fit,p)=>record(A.horizons,h=>max(0,
	(tokenOdds(fit,{...p,ageDays:(p.ageDays??fit.age)+h})-p.tokenOdds)/(1-p.tokenOdds)));

function attribution(p,ref,fit,odds){
	const sized={...ref,rawSize:p.rawSize,size:p.rawSize+(ref.size-ref.rawSize)},
		carried={...sized,size:p.size,growth:p.growth},
		aged={...carried,ageDays:p.ageDays},
		[size,carry,age,family]=[sized,carried,aged,p].map((row,i,path) =>
		exp(capLog(fit,row)-capLog(fit,path[i-1]??ref))),
		midOdds=tokenOdds(odds,sized);
	return{size:size*midOdds/ref.tokenOdds,carry,age:age*p.tokenOdds/midOdds,
		issuer:p.haircut/ref.haircut,family,
		rounding:(p.score/rawScore(p))/(ref.score/rawScore(ref))};
}

function auc(scored){
	const order=scored.toSorted((a,b)=>a.score-b.score);
	let wins=0,negative=0;
	for(let i=0;i<order.length;){
		let next=i,pos=0;
		while(next<order.length&&order[next].score===order[i].score){
			pos+=+order[next++].recorded;
		}
		const neg=next-i-pos;
		wins+=pos*(negative+neg/2);
		negative+=neg;
		i=next;
	}
	const pairs=(order.length-negative)*negative;
	return pairs?wins/pairs:null;
}

function oddsTest(splits,omit){
	const scored=splits.flatMap(([train,test])=>{
		const fit=fitOdds(train,omit);
		return test.map(p=>({recorded:p.recorded,score:tokenOdds(fit,p)}));
	});
	return{auc:auc(scored),...missStats(scored.map(({recorded,score})=>-log(recorded?score:1-score)))};
}

function bootstrap(pts,{terms,candidate:alt}){
	let seed=A.bootstrapSeed;
	return Array.from({length:A.bootstrapDraws},()=>{
		const sample=pts.map(()=>{
			seed=(Math.imul(seed,1664525)+1013904223) >>> 0;
			return pts[floor(seed*pts.length/4294967296)];
		});
		return fitValue(sample,terms,null,alt);
	});
}

function nearestPeers(p,pts){
	return pts.map(peer=>{
		const penalty=peer.category===p.category?0:peer.family===p.family?A.peerFamilyPenalty:A.peerCategoryPenalty;
		return{peer,distance:abs(peer.rawSize-p.rawSize)+penalty};
	}).sort((a,b)=>a.distance-b.distance||byText(a.peer.slug,b.peer.slug))
		.slice(0,A.peerCount).map(({peer})=>peer);
}

function cheapestChain(chains,actions){
	return unique(chains).map(name=>{
		const [gas,bridge,bridgeMinutes]=hasOwn(chainQuotes,name)?chainQuotes[name]:fallbackChain;
		return{name,gas,bridge,bridgeMinutes,total:bridge+gas*(2*actions+A.claimActions)};
	}).sort((a,b)=>a.total-b.total||a.bridgeMinutes-b.bridgeMinutes||byText(a.name,b.name))[0];
}

function evaluateFarm(fp,cap,{horizon:h=fp.horizon,quote=fp.quote,cost=1,share=1,
	q=fp.launchOdds[h],shared=0}={}){
	const {entryGas,exitGas,slippage,delay,lockup}=quote,
		holding=max(h,lockup)+delay,
		gas=(fp.testGas+entryGas+exitGas)*cost,
		fees=(fp.chain.bridge+(cap+A.testUsd)*slippage/100)*cost,
		timeCost=wage(fp.handsOnMinutes+(weeks(h)-shared)*A.weeklyMinutes)*cost,
		capitalCharge=cap*(A.riskFreeRate*holding/A.year)*cost,
		loss=gas+fees+timeCost+capitalCharge,
		drop=fp.conditionalValue*(cap/(fp.competingTvl+cap))*A.depositorShare*share,
		claimSell=(fp.chain.gas*A.claimActions+wage(A.claimMinutes)+drop*slippage/100)*cost,
		payoff=drop-claimSell,
		pStar=payoff>0?loss/payoff:null,
		multiple=q*payoff/loss,
		verdict=multiple<1?"SKIP":multiple>=A.farmMultiple&&!fp.capped?"FARM":"MARGINAL",
		net=q*payoff-loss,withToken=payoff-loss;
	return{capital:cap,horizon:h,q,cost:loss,gas,fees,timeCost,capitalCharge,holding,drop,claimSell,pStar,
		noToken:-loss,withToken,net,multiple,verdict,expectedYield:net/cap,conditionalApr:withToken/cap*A.year/holding};
}

function sizeFarm(fp,scenario){
	const ladder=A.capitalLadder.map(cap=>evaluateFarm(fp,cap,scenario));
	return ladder.find(step=>step.multiple>=A.farmMultiple)
		??ladder.reduce((best,step)=>step.multiple>best.multiple?step:best);
}

function chooseFarm(fp,quote=fp.quote,h=0){
	if(h) return sizeFarm(fp,{quote,horizon:h});
	return A.horizons.map(h=>sizeFarm(fp,{quote,horizon:h}))
		.reduce((best,step)=>step.net>best.net?step:best);
}

function payTargets({q,pStar,cost,drop,claimSell},quote){
	const slippage=quote.slippage/100,
		fixed=claimSell-drop*slippage,
		maxCost=q*(drop-claimSell);
	return{maxCost:maxCost<0?null:maxCost,targets:[1,A.farmMultiple].map(m=>{
		const odds=pStar===null?null:m*pStar,
			reward=q&&slippage<1?(m*cost/q+fixed)/(1-slippage):null;
		return{odds,oddsRatio:q&&odds!==null?odds/q:null,
			drop:reward,dropRatio:reward!==null&&drop?reward/drop:null};
	})};
}

const stepCost=(min,fees=0)=>`${costUsd(wage(min)+fees)} · ${min} min`;

function ticketFor({family,category},chain,cap){
	if(family==="LP") return`${whole(cap/2)} USDC + ${whole(cap/2)} USDT`;
	const native=assets[chain]||(ethChains.includes(chain)?"ETH":chain+" native asset"),
		network=/BTC$/.test(category)?"BTC":assets[chain]??"USDC",
		asset={Staking:native,Network:network,Perps:category==="Prediction Market"?"USDC collateral":"USDC margin"}[family]||"USDC";
	return`${whole(cap)} ${asset}`;
}

function farmPlan(p,asOf,curve){
	const [actions,bps,depositMins,verb,guidance]=mechanisms[p.family],
		chain=cheapestChain(p.chains,actions),
		{name,gas,bridge,bridgeMinutes}=chain,
		{verifyMinutes:verify,testUsd,exitMinutes,claimMinutes,weeklyMinutes:weekMins,firstSaleShare}=A,
		prep=A.routeHandsOnMinutes+A.testMinutes,slippage=bps/100,
		quote={entryGas:gas*(actions-1),exitGas:gas,slippage,delay:0,lockup:0},
		fp={
		chain,quote,testGas:gas*actions,launchOdds:launchOdds(curve,p),
		competingTvl:p.tvl_usd*A.competingTvlShare,conditionalValue:p.launchValue*p.haircut,
		handsOnMinutes:verify+prep+depositMins+exitMinutes,capped:!!p.flags.length
	},
		result=chooseFarm(fp),
		pay=payTargets(result,quote),
		{capital:cap,pStar,verdict,horizon:h,q}=result,
		exitGrowth=min(0,p.growth)-A.weeklyLossBuffer,
		testFees=bridge+fp.testGas+testUsd*slippage/100,
		entryFees=quote.entryGas+cap*slippage/100,
		review=new Date(Date.parse(asOf)+A.reviewDays*DAY).toISOString().slice(0,10),
		verified=stepCost(verify),ticket=`${verb.toLowerCase()} ${ticketFor(p,name,cap)}`;
	const steps=[
		[`If considering ${name}, verify rewards, asset, KYC, exits and deposit caps for ${whole(cap)}.`,verified],
		["If rules are pending or caps full, wait.",verified,`Recheck ${review} or on changes.`],
		["If ineligible, exit blocked or a token recorded, stop.",verified],
		[`If terms pass and quotes clear FARM, fund ${name}, deposit ${ticketFor(p,name,testUsd)} and withdraw it.`,
			`${stepCost(prep,testFees)} + ${2*bridgeMinutes} min funding. Reversible on receipt.`],
		["If rehearsal fails or runs late, stop.",`${stepCost(verify+prep,testFees)} spent. Recover up to ${whole(testUsd)}.`],
		[`If checks pass and quotes clear FARM, ${ticket}. ${guidance}`,
			`${stepCost(depositMins,entryFees)}. Gas + slip cap ${costUsd(entryFees)}. Exit gas ${costUsd(gas)}.`,
			`${verdict} · launch within ${h} d: ${percent(q)} (q) vs p* ${pStar===null?"unreachable":percent(pStar)}.`,
			`Else wait to ${review} for lower costs${fp.capped?" and cleared flags":""}`,`${stepCost(0)} extra.`],
		["If eligible, log receipt and TVL weekly.",`${stepCost(weekMins)}/check.`],
		[`If TVL < ${whole(p.tvl_usd*A.exitTvlShare)}, 7d change < ${exitGrowth.toFixed(2)}%, token announced or day ${h}, withdraw.`,
			`${stepCost(exitMinutes,gas)}. Honor lock and delay.`],
		[`If eligible at launch, claim and sell ${firstSaleShare*100}% at ${whole(p.band.low)} circulating cap, rest near ${whole(p.band.high)}.`,
			`${stepCost(claimMinutes,result.claimSell-wage(claimMinutes))}. Buy back to undo.`]
	];
	if(verdict==="SKIP"){
		const target=pay.targets[0],
			need=target.drop===null?"higher launch odds":`launch odds ${oddsFactor(target.oddsRatio)} or a drop of ${costUsd(target.drop)}`;
		steps.push([`Revisit if a points program or snapshot is announced: the plan needs ${need} to break even.`,
			`${stepCost(weekMins)} per weekly check.`]);
	}
	return{...fp,...result,ticket,steps,pay,stress:{
		doubleCost:sizeFarm(fp,{horizon:h,cost:A.stressCost}),halfShare:sizeFarm(fp,{horizon:h,share:A.stressShare})
	}};
}

const isFarm=p=>p.plan.verdict==="FARM";

function allocate(farms){
	const budget=A.portfolioCapital,eligible=farms.length,
		total=(list,k)=>list.reduce((sum,p)=>sum+p[k],0),
		overlap=min(...farms.map(p=>weeks(p.plan.horizon)));
	for(let n=min(eligible,floor(budget/A.capitalLadder[0]));n>0;n--){
		const shared=overlap*(1-1/n),
			picks=farms.map(p=>({p,capital:sizeFarm(p.plan,{shared}).capital}))
			.sort((a,b)=>a.capital-b.capital||a.p.rank-b.p.rank).slice(0,n),
			minimum=total(picks,"capital");
		if(minimum>budget) continue;
		const score=total(picks.map(({p})=>p),"score"),surplus=(budget-minimum)*100;
		let remaining=surplus;
		const positions=picks.map(({p,capital:cap},i)=>{
			const extra=i===n-1?remaining:floor(surplus*p.score/score);
			remaining-=extra;
			return{slug:p.slug,name:p.name,...evaluateFarm(p.plan,cap+extra/100,{shared})};
		});
		return{budget,eligible,capital:budget,unallocated:0,positions,
			cost:total(positions,"cost"),net:total(positions,"net")};
	}
	return{budget,eligible,capital:0,unallocated:budget,positions:[],cost:0,net:0};
}

const boardRows=rs=>rs.map(({slug,name,rank,score,launchValue,tokenOdds,haircut,plan:fp})=>({slug,name,rank,
	implied_value_usd:score,launch_value_usd:launchValue,token_odds:tokenOdds,
	issuer_factor:haircut,farm_steps:fp.steps.map(parts=>parts.join(" "))}));

function digest(rs){
	let hash=2166136261;
	for(const byte of new TextEncoder().encode(JSON.stringify(rs))) hash=Math.imul(hash^byte,16777619);
	return(hash >>> 0).toString(16).padStart(8,"0");
}

function boardChecks(board,snap,bytes){
	const rs=Array.isArray(board)?board:board?.rows;
	if(!Array.isArray(rs)) return[{name:"board_file",pass:false}];
	const known=new Set(snap.protocols.map(p=>p.slug)),
		slugs=new Set(rs.map(p=>p?.slug)),size=rs.length,
		order=rs.toSorted((a,b)=>a?.rank-b?.rank);
	return checksFor({
		board_file:(bytes??new TextEncoder().encode(JSON.stringify(board)).length)<=8*1024*1024
			&&size>=100&&size<=4000&&slugs.size===size
			&&rs.every(p=>{
				if(!p) return false;
				const {slug,name,rank,implied_value_usd:value,farm_steps:steps}=p;
				return known.has(slug)&&/^\S{1,128}$/u.test(slug)&&typeof name==="string"&&name.trim()
					&&[rank,value].every(n=>Number.isInteger(n)&&n>0)&&value<=1e14&&Array.isArray(steps);
			}),
		sorted_by_value:new Set(rs.map(p=>p?.implied_value_usd)).size>1&&orderedRows(order)===size,
		coverage:snap.watchlist.every(slug=>slugs.has(slug)),
		farm_steps:rs.every(p=>validSteps(p?.farm_steps))
	});
}

const orderedRows=rs=>count(rs,(p,i)=>p?.rank===i+1&&(!i||p.implied_value_usd<=rs[i-1]?.implied_value_usd)),
	validSteps=steps=>Array.isArray(steps)&&steps.length>=3&&steps.length<=12
		&&steps.every(s=>typeof s==="string"&&/^.{20,600}$/s.test(s.trim())&&/^(If|Revisit if) .+\$\d.*\d+ min/u.test(s));

function selfChecks(model,snap,expectedDigest){
	const {rows:rs,board,counts,stress,portfolio:basket,reference,calibration,value,odds}=model,
		{evidence,search,deployed,selected:winner}=value.validation,
		samples=rs.map(p=>p.plan).filter(p=>p.pStar!==null&&p.q>0&&p.drop>0);
	return[...boardChecks(board,snap),...checksFor({
		"group counts":counts.traded+counts.recorded+counts.setAside+counts.ranked===counts.total
			&&counts.ranked===rs.length&&calibration.every(p=>p.mcap_usd>0&&!p.productPeer),
		"value factors":rs.every(p=>max(1,round(rawScore(p)))===p.score),
		"relative attribution":rs.every(p=>abs(values(p.attribution)
			.reduce((product,factor)=>product*factor,1)*reference.score/p.score-1)<1e-10),
		"bootstrap bands":rs.every(p=>p.band.low>0&&p.band.low<=p.band.high&&p.tokenOdds>0&&p.tokenOdds<1),
		"flagged plans":rs.every(p=>p.flags.length?p.haircut===A.haircut&&p.plan.verdict!=="FARM":p.haircut===1),
		"launch odds":rs.every(({plan:{launchOdds}})=>A.horizons.map(h=>launchOdds[h])
			.every((q,i,curve)=>q>=(curve[i-1]??0)&&q<=1)),
		"farm outcomes":rs.every(({plan:fp})=>{
			const {horizon:h,q,capital:cap,noToken,withToken,net,pStar,gas,fees,timeCost,capitalCharge,drop,claimSell}=fp,
				close=(a,b)=>abs(a-b)<1e-8,
				loss=gas+fees+timeCost+capitalCharge,payoff=drop-claimSell;
			return h===chooseFarm(fp).horizon&&q===fp.launchOdds[h]
				&&close(capitalCharge,cap*A.riskFreeRate*h/A.year)
				&&close(timeCost,wage(fp.handsOnMinutes+weeks(h)*A.weeklyMinutes))
				&&close(noToken,-loss)&&close(withToken,payoff-loss)
				&&close(net,(1-q)*noToken+q*withToken)
				&&(payoff<=0?pStar===null:close(pStar,loss/payoff));
		}),
		"MARGINAL break-even":samples.length>=3&&[0,floor(samples.length/2),-1].every(i=>{
			const fp=samples.at(i),
				{odds:q,dropRatio:share}=fp.pay.targets[0];
			return[{q},{share}].every(input=>abs(evaluateFarm(fp,fp.capital,input).net)<=.01);
		}),
		"stress counts":entries(stress).every(([k,{all,farm}]) =>
			keys(all).every(v=>all[v]===count(rs,p=>p.plan.stress[k].verdict===v)
				&&farm[v]===count(rs,p=>isFarm(p)&&p.plan.stress[k].verdict===v))),
		"portfolio allocation":round((basket.capital+basket.unallocated)*100)===basket.budget*100
			&&basket.positions.every(p=>p.verdict==="FARM"&&rs.some(r=>p.slug===r.slug&&r.watchlist&&isFarm(r))),
		"term table matches headline":[[evidence,winner],[odds.evidence,odds.validation]]
			.every(([rs,headline])=>rs.length&&rs.every(row=>row.withTerm===headline)),
		"value search":search.every(({withTerm,without,verdict})=>without===deployed
			&&passes({withTerm,without})===(verdict!=="Rejected")&&(withTerm===winner)===(verdict==="Adopted")),
		"board digest":typeof expectedDigest==="string"&&digest(boardRows(rs))===expectedDigest
	})];
}

function buildModel(snap){
	const recs=prepare(snap),
		pts=tokenPoints(recs);
	if(pts.length<3) throw new Error("Need three screened positive caps.");
	const value=selectFit(pts),{fit}=value,
		resamples=bootstrap(pts,fit),
		oddsPts=recs.filter(p=>!p.product),
		oddsFit=fitOdds(oddsPts),
		oddsFolds=record(blindTests,k=>folds(oddsPts,k==="walk",A.oddsWarmup)),
		assess=omit=>record(blindTests,k=>oddsTest(oddsFolds[k],omit)),
		validation=assess(),
		odds={validation,evidence:[[2,"Listing age in token odds"],[1,"TVL in token odds"]]
			.map(([omit,label])=>termTest(label,validation,assess(omit)))};
	const rs=recs.filter(p=>p.status==="ranked").map(p=>{
		const launchValue=exp(capLog(fit,p)),
			s=tokenOdds(oddsFit,p),
			haircut=p.flags.length?A.haircut:1,
			draws=resamples.map(fit=>exp(capLog(fit,p))),
			[low,high]=A.bandQuantiles.map(q=>quant(draws,q)),
			row={...p,launchValue,tokenOdds:s,haircut,score:max(1,round(launchValue*s*haircut)),
			band:{low,high,weightedLow:low*s*haircut,weightedHigh:high*s*haircut},
			peers:nearestPeers(p,pts)};
		return{...row,plan:farmPlan(row,snap.as_of,oddsFit)};
	}).sort(rankBy("score"))
		.map((p,i)=>({...p,rank:i+1})),
		reference=rs[floor(rs.length/2)];
	for(const p of rs) p.attribution=attribution(p,reference,fit,oddsFit);
	const groups=record(["traded","recorded","setAside","ranked"],k=>count(recs,p=>p.status===k)),
		counts={...groups,total:recs.length,watchlistCovered:count(rs,p=>p.watchlist),
		watchlistTotal:snap.watchlist.length,valueFit:pts.length,oddsFit:oddsPts.length},
		verdicts=tally(rs,p=>p.plan.verdict),farms=rs.filter(isFarm),
		stress=record(["doubleCost","halfShare"],k=>{
		const verdict=p=>p.plan.stress[k].verdict;
		return{all:tally(rs,verdict),farm:tally(farms,verdict)};
	}),
		calibration=pts.map(p=>({...p,launchValue:exp(capLog(fit,p))})),
		peerRatios=A.bandQuantiles.map(q=>quant(pts.map(p=>p.mcap_usd/p.carriedTvl),q)),
		audit=rs.slice(0,20).map(p=>{
		const ratio=p.launchValue/p.carriedTvl;
		return{...p,ratio,outlier:ratio<peerRatios[0]||ratio>peerRatios[1]};
	});
	return{rows:rs,reference,board:{rows:boardRows(rs)},counts,verdicts,stress,portfolio:allocate(farms.filter(p=>p.watchlist)),
		value,odds,calibration,audit,peerRatios,assumptions:settings};
}
const timing="Fixed TVL age curve. Snapshot has no launch dates.";
const settings={parameters:A,chainQuotes,fallbackChain,mechanisms,families,timing,
	notes:[
		"Token status uses cap, ID or symbol. Dedup by TVL. Audit uses cap/carried TVL.",
		timing,"Issuer haircut · "+flagNote,"F(a) is status at age a. q(H) = max(0, (F(a+H)−F(a))/(1−F(a))). Impute median age.",
		"Prorate by eligible TVL. Exclude yield, tax, price moves.",
		"First 2× ticket or best payoff/cost. Auto picks best net, shortest hold.",
		"Charge max(horizon, lockup) + delay. Slip on test, entry, exit, sale."
	]};

const modelApi={buildModel,boardChecks,selfChecks,boardRows,digest,evaluateFarm,chooseFarm,oddsFactor,orderedRows,validSteps};
if(typeof module==="object"&&module.exports) module.exports=modelApi;
else globalThis.LaunchRadar=modelApi;
