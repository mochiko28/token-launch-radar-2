"use strict";
const {abs,ceil,exp,floor,log,max,min,round}=Math;
const {entries,fromEntries,hasOwn,keys,values}=Object;
const record=(keys,read)=>fromEntries(keys.map(key=>[key,read(key)]));
const A={
	growthClip:[-30,30],missingGrowth:0,haircut:.65,year:365,
	tvlReference:1e8,missingAgeFallback:365,
	familyPenalty:2,oddsPenalty:1,valueWarmup:25,oddsWarmup:60,
	bootstrapDraws:192,bootstrapSeed:918273,bandQuantiles:[.1,.9],
	hourlyUsd:20,depositorShare:.05,competingTvlShare:.2,
	capitalLadder:[1_000,2_500,5_000,10_000,25_000,50_000],portfolioCapital:10_000,
	farmMultiple:2,stressCost:2,stressShare:.5,weeklyMinutes:2,
	routeHandsOnMinutes:6,verifyMinutes:8,exitTvlShare:.75,exitMinutes:10,
	weeklyLossBuffer:10,reviewDays:14,horizons:[30,90,180,365],riskFreeRate:.04,
	testUsd:80,testMinutes:6,claimMinutes:8,claimActions:2,
	firstSaleShare:.5,peerCount:3,
	peerCategoryPenalty:1,peerFamilyPenalty:.45
};
const DAY=86_400_000;
const CHAINS={
	Ethereum:[4.5,9,25],Bitcoin:[3,9,60],Solana:[.08,1.8,8],
	Base:[.16,.8,8],Arbitrum:[.23,1.2,10],Optimism:[.19,1,10],
	Binance:[.18,1.2,9],Polygon:[.12,.9,9],Avalanche:[.3,1.5,12],
	Monad:[.15,1.2,12],Ink:[.17,1.1,10],Plasma:[.14,1.3,14],
	"Hyperliquid L1":[.23,1.6,15],Sui:[.12,1.6,12],Aptos:[.12,1.5,12],
	Stellar:[.08,1.8,12],Flare:[.16,1.9,15],Algorand:[.09,2,12],
	Ripple:[.12,2.1,14],Tron:[1.2,3.5,16],Linea:[.24,1.3,15],
	Mantle:[.22,1.5,14],Sonic:[.15,1.5,12],Scroll:[.25,1.5,15],
	xDai:[.13,1.4,12],Berachain:[.24,1.5,15],TON:[.25,2,15],
	Near:[.18,2,15],Starknet:[.26,1.5,18],Celo:[.13,1.5,12],
	"zkSync Era":[.24,1.5,16],Unichain:[.18,1.3,12],
	"World Chain":[.21,1.5,12],Ronin:[.21,1.7,15],Sei:[.18,1.8,15],
	Cardano:[.32,2.5,20],"Plume Mainnet":[.24,1.7,16],
	Arc:[.2,1.7,15],Pharos:[.25,2,18],CORE:[.27,2.3,18],
	Bittensor:[.32,2.7,18],BSquared:[.35,3,22],
	Noble:[.25,2,15],Mezo:[.34,2.6,17]
};
const FALLBACK_CHAIN=[1.5,5,30];
const MECHANISMS={
	Lending:[3,4,9,"Supply","Liquid markets only. No borrowing."],
	Vault:[3,12,12,"Deposit","Review strategy."],
	LP:[4,30,14,"Pair","Check pool depth and receipt."],
	Perps:[4,25,14,"Post","No leverage."],
	Staking:[3,12,11,"Stake","Check unbonding and slashing."],
	RWA:[3,25,16,"Subscribe with","Check KYC and exits."],
	Stablecoin:[4,18,13,"Supply","Check peg depth. No leverage."],
	Network:[3,15,13,"Deposit","Follow docs."],
	Insurance:[3,25,14,"Supply","Check claims and exit queue."],
	Other:[3,20,13,"Deposit","Check deposit docs."]
};
const NATIVE=fromEntries(
	"Algorand:ALGO|Bitcoin:BTC|BSquared:BTC|CORE:CORE|Flare:FLR|Hyperliquid L1:HYPE|Mezo:BTC|Monad:MON|Near:NEAR|Qubic:QU|Solana:SOL|Stacks:STX|Starknet:STRK|Sui:SUI|TON:TON|XDC:XDC|Bifrost Network:BNC|Mixin:XIN|XION:XION|ZIGChain:ZIG"
		.split("|").map(entry=>entry.split(":")));
const FAMILIES={
	Lending:"Lending|Uncollateralized Lending|Collateral Markets|Collateral Management",
	Vault:"Yield|Yield Aggregator|Risk Curators|Onchain Capital Allocator|Basis Trading|Leveraged Farming|Farm|Indexes|Options Vault|CeDeFi",
	LP:"Dexs|Liquidity Manager",
	Perps:"Derivatives|Synthetics|Options|Interest Rate Derivatives|Prediction Market",
	Staking:"Liquid Staking|Liquid Restaking|Staking Pool|Restaking|Token Locker|Governance Incentives",
	RWA:"RWA",
	Stablecoin:"CDP|CDP Manager|Algo-Stables|Dual-Token Stablecoin|Stablecoin Wrapper|Stablecoin Issuer|Reserve Currency",
	Network:"Chain|Payments|Decentralized BTC|Anchor BTC|Cross Chain Bridge",
	Insurance:"Insurance"
};
const familyByCategory=new Map(entries(FAMILIES).flatMap(([family,categories]) =>
	categories.split("|").map(category=>[category,family])));
const productCategories=new Set(["Bridge","Canonical Bridge","Cross Chain Bridge","Restaked BTC","CEX"]),
	liquid=new Set(["Liquid Staking","Liquid Restaking"]),
	version=/\s+(?:v\s*\d+(?:\.\d+)*|\d+\.\d+(?:\.\d+)*)$/i,
	exchange=/^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i,
	receiptId=/^(wrapped|bridged|staked|restaked|savings)-/i;
const byText=(a,b)=>a<b?-1:a>b?1:0,
	limit=(value,low,high)=>min(high,max(low,value)),
	count=(rows,test)=>rows.filter(test).length,
	tally=(rows,get)=>record(["FARM","MARGINAL","SKIP"],v=>count(rows,p=>get(p)===v)),
	firstWord=name=>name.toLowerCase().match(/[\p{L}\p{N}]+/u)?.[0];
const hasToken=p=>p.mcap_usd>0||Boolean(p.gecko_id||p.symbol),
	rawScore=p=>p.launchValue*p.tokenOdds*p.haircut,
	costUsd=n=>"$"+n.toFixed(2),
	integer=n=>round(n).toLocaleString("en-US"),whole=n=>"$"+integer(n);
const percent=(n,places=2)=>(n*100).toFixed(places)+"%",
	oddsFactor=n=>n===null?"unreachable":"x"+n.toFixed(2),
	wage=min=>min*A.hourlyUsd/60,
	weeks=days=>floor(days/7),
	checksFor=checks=>entries(checks).map(([name,pass])=>({name,pass:!!pass}));

function quantile(values,fraction){
	if(!values.length) return null;
	const sorted=values.toSorted((a,b)=>a-b),
		index=(sorted.length-1)*fraction;
	return sorted[floor(index)]*(1-index%1)+sorted[ceil(index)]*(index%1);
}

function prepare(snapshot){
	const asOf=Date.parse(snapshot.as_of),
		watchlist=new Set(snapshot.watchlist),
		recordedWords=new Set(snapshot.protocols.filter(hasToken).map(p=>firstWord(p.name)));
	return snapshot.protocols.map(p=>{
		const {category,name,tvl_usd:tvl}=p,
			family=familyByCategory.get(category)||"Other",
			isLiquid=liquid.has(category),
			parsedDate=Date.parse(p.listed_at),
			date=Number.isFinite(parsedDate)?parsedDate:null,
			ageDays=date===null?null:max(1,floor((asOf-date)/DAY));
		const growth=limit(p.change_7d??A.missingGrowth,...A.growthClip),
			carriedTvl=tvl*(1+growth/100);
		const flags=[recordedWords.has(firstWord(name))&&"Name matches a recorded issuer",
			isLiquid&&"Liquid staking or restaking",version.test(name)&&"Versioned name"].filter(Boolean);
		const product=productCategories.has(category)||exchange.test(name)
			||/\b(?:wrapped|bridged|staked)\b/i.test(name)||(!isLiquid&&/\bstaking\b/i.test(name));
		const recorded=hasToken(p),
			watched=watchlist.has(p.slug),
			status=p.mcap_usd>0?"traded":recorded?"recorded":product&&!watched?"setAside":"ranked";
		return{...p,family,date,ageDays,growth,carriedTvl,flags:recorded?[]:flags,
			product,productPeer:product||isLiquid||receiptId.test(p.gecko_id),watchlist:watched,recorded,status,
			size:log(carriedTvl/A.tvlReference),rawSize:log(tvl/A.tvlReference)};
	});
}

function tokenPoints(records){
	const tokens=new Map();
	for(const p of records.filter(p=>p.status==="traded"&&!p.productPeer)
		.sort((a,b)=>b.tvl_usd-a.tvl_usd||byText(a.slug,b.slug))){
		const key=p.gecko_id?"gecko:"+p.gecko_id:p.symbol?"symbol:"+p.symbol:p.slug;
		if(!tokens.has(key)) tokens.set(key,{...p,response:log(p.mcap_usd)});
	}
	return[...tokens.values()].sort((a,b)=>byText(a.slug,b.slug));
}
const medianAge=rows=>quantile(rows.map(p=>p.ageDays).filter(Number.isFinite),0.5)??A.missingAgeFallback;

const ageFeature=(p,fallback)=>log((p.ageDays??fallback)/A.year);

function solve(matrix,target){
	const rows=matrix.map((row,i)=>[...row,target[i]]),
		n=rows.length;
	for(let col=0;col<n;col++){
		let pivot=col;
		for(let row=col+1;row<n;row++){
			if(abs(rows[row][col])>abs(rows[pivot][col])) pivot=row;
		}
		[rows[col],rows[pivot]]=[rows[pivot],rows[col]];
		const scale=rows[col][col];
		for(let j=col;j<=n;j++) rows[col][j]/=scale;
		for(let row=0;row<n;row++){
			if(row===col) continue;
			const factor=rows[row][col];
			for(let j=col;j<=n;j++) rows[row][j]-=factor*rows[col][j];
		}
	}
	return rows.map(row=>row[n]);
}
const dot=(row,coefficients)=>row.reduce((sum,x,i)=>sum+x*coefficients[i],0),
	zero=n=>Array(n).fill(0);

const normalEquations=(n,penalties)=>({target:zero(n),matrix:penalties.map((v,i)=>zero(n).with(i,v))});

function accumulate(system,x,residual,weight=1){
	for(let i=0;i<x.length;i++){
		system.target[i]+=x[i]*residual;
		if(x[i]===0) continue;
		for(let j=0;j<x.length;j++) system.matrix[i][j]+=x[i]*x[j]*weight;
	}
}

const valueTerms=[
	["age","logAge",ageFeature],["growth","clippedGrowth",p=>p.growth/100],
	...keys(FAMILIES).concat("Other").map(f=>["family",f,p=>Number(f===p.family)])
];
const valueFeatures=(p,{features,medianDays,omit})=>[
	1,omit==="scale"?0:omit==="carry"?p.rawSize:p.size,...features.map(([,,read])=>read(p,medianDays))];

function fitValue(points,terms,omit){
	const features=valueTerms.filter(([term])=>terms.includes(term)),
		fit={terms,features,medianDays:medianAge(points),omit},
		names=["intercept","logCarriedTvl",...features.map(([,name])=>name)],
		system=normalEquations(names.length,[1e-8,1e-8,...features.map(([term])=>term==="family"?A.familyPenalty:1e-8)]);
	for(const p of points) accumulate(system,valueFeatures(p,fit),p.response);
	return{...fit,names,coefficients:solve(system.matrix,system.target)};
}

const logValue=(fit,p)=>dot(valueFeatures(p,fit),fit.coefficients),
	medianRatio=points=>log(quantile(points.map(p=>p.mcap_usd/p.carriedTvl),0.5));

function folds(points,walk,warmup){
	if(!walk) return points.map((p,i)=>[points.filter((_,j)=>i!==j),[p]]);
	const dated=points.filter(p=>p.date!==null).sort((a,b)=>a.date-b.date||byText(a.slug,b.slug));
	return dated.flatMap((p,i)=>{
		if(i<warmup||p.date===dated[i-1]?.date) return[];
		let end=i+1;
		while(dated[end]?.date===p.date) end++;
		return[[dated.slice(0,i),dated.slice(i,end)]];
	});
}

const blindTests=["loo","walk"];

function missSummary(misses){
	const n=misses.length;
	return{miss:n?exp(quantile(misses,.5)):null,n,
		hits:[2,3].map(x=>n?count(misses,m=>m<=log(x))/n:null)};
}

function termTest(term,withTerm,without){
	const deltas=blindTests.map(k=>withTerm[k].n?without[k].miss-withTerm[k].miss:0);
	return{term,withTerm,without,verdict:deltas.every(d=>d<0)?"fails both":"kept: "+
		["no measured effect","helps one","helps both tests"][count(deltas,d=>d>0)]};
}

function valueMiss(splits,terms,omit){
	return missSummary(splits.flatMap(([train,test])=>{
		if(!terms){
			const ratio=medianRatio(train);
			return test.map(p=>abs(log(p.carriedTvl)+ratio-p.response));
		}
		const fit=fitValue(train,terms,omit);
		return test.map(p=>abs(logValue(fit,p)+(omit!=="issuer"&&p.flags.length?log(A.haircut):0)-p.response));
	}));
}

function chooseValue(points){
	const families=[...new Set(points.map(p=>p.family))];
	const splits={
		loo:folds(points,false,A.valueWarmup),walk:folds(points,true,A.valueWarmup),
		family:families.map(f=>[points.filter(p=>p.family!==f),points.filter(p=>p.family===f)])
			.filter(([train])=>train.length)
	};
	const tests=keys(splits),
		assess=terms=>({terms,...record(tests,k=>valueMiss(splits[k],terms))}),
		baseline=assess(null),
		terms=["age","family","growth"],
		trials=Array.from({length:1 << terms.length},(_,mask)=>assess(terms.filter((_,i)=>mask & (1 << i))));
	const better=(a,b)=>tests.every(k=>a[k].n&&a[k].miss<b[k].miss),
		volume=trial=>tests.reduce((product,k)=>product*(trial[k].miss??1),1);
	const selected=trials.filter((trial,mask)=>terms.every((_,i)=>{
		const bit=1 << i;
		return !(mask & bit)||better(trial,trials[mask ^ bit]);
	})).sort((a,b)=>volume(a)-volume(b))[0];
	const labels={scale:"TVL scale exponent",carry:"7d-growth carry",issuer:"Issuer haircut",
		age:"Listing age in cap",family:"Family in cap"};
	const evidence=entries(labels).filter(([t])=>t!=="age"&&t!=="family"||selected.terms.includes(t))
		.map(([omit,label])=>termTest(label,selected,record(blindTests,k=>
			valueMiss(splits[k],selected.terms.filter(t=>t!==(omit==="carry"?"growth":omit)),omit))));
	return{fit:fitValue(points,selected.terms),validation:{baseline,selected,trials,evidence}};
}

const sigmoid=x=>1/(1+exp(-limit(x,-35,35))),
	oddsFeatures=(p,age)=>[1,p.rawSize,ageFeature(p,age)];

function fitTokenOdds(points,omit){
	const age=medianAge(points),
		inputs=points.map(p=>oddsFeatures(p,age).map((x,i)=>i===omit?0:x)),
		penalties=[1e-6,A.oddsPenalty,A.oddsPenalty];
	let beta=zero(3);
	for(let i=0;i<20;i++){
		const system=normalEquations(beta.length,penalties);
		system.target=beta.map((c,j)=>-c*penalties[j]);
		for(let j=0;j<points.length;j++){
			const x=inputs[j],prob=sigmoid(dot(x,beta));
			accumulate(system,x,Number(points[j].recorded)-prob,prob*(1-prob));
		}
		const delta=solve(system.matrix,system.target);
		beta=beta.map((c,j)=>c+delta[j]);
		if(max(...delta.map(abs))<1e-8) break;
	}
	return{age,beta};
}

const tokenOdds=(fit,p)=>sigmoid(dot(oddsFeatures(p,fit.age),fit.beta));

function launchOdds(fit,p,s){
	const age=p.ageDays??fit.age;
	return record(A.horizons,h=>max(0,(tokenOdds(fit,{...p,ageDays:age+h})-s)/(1-s)));
}

function attribution(p,ref,fit,odds){
	const sized={...ref,rawSize:p.rawSize,size:p.rawSize+(ref.size-ref.rawSize)},
		carried={...sized,size:p.size,growth:p.growth},
		aged={...carried,ageDays:p.ageDays};
	const [size,carry,age,family]=[sized,carried,aged,p].map((row,i,path) =>
		exp(logValue(fit,row)-logValue(fit,path[i-1]??ref)));
	const midOdds=tokenOdds(odds,sized);
	return{size:size*midOdds/ref.tokenOdds,carry,age:age*p.tokenOdds/midOdds,
		issuer:p.haircut/ref.haircut,family,
		rounding:(p.score/rawScore(p))/(ref.score/rawScore(ref))};
}

function auc(scored){
	const sorted=scored.toSorted((a,b)=>a.score-b.score);
	let wins=0,negative=0;
	for(let i=0;i<sorted.length;){
		let next=i,groupPositive=0;
		while(next<sorted.length&&sorted[next].score===sorted[i].score){
			groupPositive+=Number(sorted[next++].recorded);
		}
		const groupNegative=next-i-groupPositive;
		wins+=groupPositive*(negative+groupNegative/2);
		negative+=groupNegative;
		i=next;
	}
	const pairs=(sorted.length-negative)*negative;
	return pairs?wins/pairs:null;
}

function testTokenOdds(splits,omit){
	const scored=splits.flatMap(([train,test])=>{
		const fit=fitTokenOdds(train,omit);
		return test.map(p=>({recorded:p.recorded,score:tokenOdds(fit,p)}));
	});
	return{auc:auc(scored),...missSummary(scored.map(({recorded,score})=>-log(recorded?score:1-score)))};
}

function bootstrap(points,terms){
	let seed=A.bootstrapSeed;
	return Array.from({length:A.bootstrapDraws},()=>{
		const sample=points.map(()=>{
			seed=(Math.imul(seed,1664525)+1013904223) >>> 0;
			return points[floor(seed*points.length/4294967296)];
		});
		return fitValue(sample,terms);
	});
}

function nearestPeers(p,points){
	return points.map(peer=>{
		const penalty=peer.category===p.category?0:peer.family===p.family?A.peerFamilyPenalty:A.peerCategoryPenalty;
		return{peer,distance:abs(peer.rawSize-p.rawSize)+penalty};
	}).sort((a,b)=>a.distance-b.distance||byText(a.peer.slug,b.peer.slug))
		.slice(0,A.peerCount).map(({peer})=>peer);
}

function cheapestChain(chains,actions){
	return[...new Set(chains)].map(name=>{
		const [gas,bridge,bridgeMinutes]=hasOwn(CHAINS,name)?CHAINS[name]:FALLBACK_CHAIN;
		return{name,gas,bridge,bridgeMinutes,total:bridge+gas*(2*actions+A.claimActions)};
	}).sort((a,b)=>a.total-b.total||a.bridgeMinutes-b.bridgeMinutes||byText(a.name,b.name))[0];
}

function evaluateFarm(plan,capital,{horizon=plan.horizon,quote=plan.quote,cost=1,share=1,
	q=plan.launchOdds[horizon],shared=0}={}){
	const {entryGas,exitGas,slippage,delay,lockup}=quote,
		holding=max(horizon,lockup)+delay,
		gas=(plan.testGas+entryGas+exitGas)*cost,
		fees=(plan.chain.bridge+(capital+A.testUsd)*slippage/100)*cost,
		timeCost=wage(plan.handsOnMinutes+(weeks(horizon)-shared)*A.weeklyMinutes)*cost;
	const capitalCharge=capital*(A.riskFreeRate*holding/A.year)*cost,
		loss=gas+fees+timeCost+capitalCharge,
		drop=plan.conditionalValue*(capital/(plan.competingTvl+capital))*A.depositorShare*share,
		claimSell=(plan.chain.gas*A.claimActions+wage(A.claimMinutes)+drop*slippage/100)*cost,
		payoff=drop-claimSell;
	const pStar=payoff>0?loss/payoff:null,
		multiple=q*payoff/loss,
		verdict=multiple<1?"SKIP":multiple>=A.farmMultiple&&!plan.capped?"FARM":"MARGINAL",
		net=q*payoff-loss,withToken=payoff-loss;
	return{capital,horizon,q,cost:loss,gas,fees,timeCost,capitalCharge,holding,drop,claimSell,pStar,
		noToken:-loss,withToken,net,multiple,verdict,expectedYield:net/capital,conditionalApr:withToken/capital*A.year/holding};
}

function sizeFarm(plan,scenario){
	const ladder=A.capitalLadder.map(capital=>evaluateFarm(plan,capital,scenario));
	return ladder.find(step=>step.multiple>=A.farmMultiple)
		??ladder.reduce((best,step)=>step.multiple>best.multiple?step:best);
}

function chooseFarm(plan,quote=plan.quote,horizon=0){
	if(horizon) return sizeFarm(plan,{quote,horizon});
	return A.horizons.map(h=>sizeFarm(plan,{quote,horizon:h}))
		.reduce((best,step)=>step.net>best.net?step:best);
}

function payThresholds({q,pStar,cost,drop,claimSell},quote){
	const slippage=quote.slippage/100,
		fixed=claimSell-drop*slippage;
	const maxCost=q*(drop-claimSell);
	return{maxCost:maxCost<0?null:maxCost,targets:[1,A.farmMultiple].map(m=>{
		const odds=pStar===null?null:m*pStar,
			reward=q&&slippage<1?(m*cost/q+fixed)/(1-slippage):null;
		return{odds,oddsRatio:q&&odds!==null?odds/q:null,
			drop:reward,dropRatio:reward!==null&&drop?reward/drop:null};
	})};
}

const stepCost=(min,fees=0)=>`${costUsd(wage(min)+fees)} · ${min} min`;

function depositTicket(p,chain,capital){
	if(p.family==="LP") return`${whole(capital/2)} USDC + ${whole(capital/2)} USDT`;
	const native=NATIVE[chain]||(/^(Ethereum|Base|Arbitrum|Optimism|Linea|Ink|Scroll|zkSync Era)$/.test(chain)?"ETH":chain+" native asset"),
		network=/BTC$/.test(p.category)?"BTC":NATIVE[chain]??"USDC",
		asset={Staking:native,Network:network,Perps:p.category==="Prediction Market"?"USDC collateral":"USDC margin"}[p.family]||"USDC";
	return`${whole(capital)} ${asset}`;
}

function farmPlan(p,asOf,curve){
	const [actions,bps,depositMinutes,verb,guidance]=MECHANISMS[p.family],
		chain=cheapestChain(p.chains,actions),
		{name,gas,bridge,bridgeMinutes}=chain,
		{verifyMinutes,testUsd,exitMinutes,claimMinutes,weeklyMinutes,firstSaleShare}=A,
		prep=A.routeHandsOnMinutes+A.testMinutes,slippage=bps/100;
	const quote={entryGas:gas*(actions-1),exitGas:gas,slippage,delay:0,lockup:0};
	const plan={
		chain,quote,testGas:gas*actions,launchOdds:launchOdds(curve,p,p.tokenOdds),
		competingTvl:p.tvl_usd*A.competingTvlShare,conditionalValue:p.launchValue*p.haircut,
		handsOnMinutes:verifyMinutes+prep+depositMinutes+exitMinutes,capped:!!p.flags.length
	};
	const result=chooseFarm(plan),
		pay=payThresholds(result,quote),
		{capital,pStar,verdict,horizon,q}=result,
		exitGrowth=min(0,p.growth)-A.weeklyLossBuffer,
		testFees=bridge+plan.testGas+testUsd*slippage/100;
	const entryFees=quote.entryGas+capital*slippage/100,
		review=new Date(Date.parse(asOf)+A.reviewDays*DAY).toISOString().slice(0,10),
		verified=stepCost(verifyMinutes),ticket=`${verb.toLowerCase()} ${depositTicket(p,name,capital)}`;
	const steps=[
		[`If considering ${name}, verify rewards, asset, KYC, exits and deposit caps for ${whole(capital)}.`,verified],
		["If rules are pending or caps full, wait.",verified,`Recheck ${review} or on changes.`],
		["If ineligible, exit blocked or a token recorded, stop.",verified],
		[`If terms pass and quotes clear FARM, fund ${name}, deposit ${depositTicket(p,name,testUsd)} and withdraw it.`,
			`${stepCost(prep,testFees)} + ${2*bridgeMinutes} min funding. Reversible on receipt.`],
		["If rehearsal fails or runs late, stop.",`${stepCost(verifyMinutes+prep,testFees)} spent. Recover up to ${whole(testUsd)}.`],
		[`If checks pass and quotes clear FARM, ${ticket}. ${guidance}`,
			`${stepCost(depositMinutes,entryFees)}. Gas + slip cap ${costUsd(entryFees)}. Exit gas ${costUsd(gas)}.`,
			`${verdict} · launch within ${horizon} d: ${percent(q)} (q) vs p* ${pStar===null?"unreachable":percent(pStar)}.`,
			`Else wait to ${review} for lower costs${plan.capped?" and cleared flags":""}`,`${stepCost(0)} extra.`],
		["If eligible, log receipt and TVL weekly.",`${stepCost(weeklyMinutes)}/check.`],
		[`If TVL < ${whole(p.tvl_usd*A.exitTvlShare)}, 7d change < ${exitGrowth.toFixed(2)}%, token announced or day ${horizon}, withdraw.`,
			`${stepCost(exitMinutes,gas)}. Honor lock and delay.`],
		[`If eligible at launch, claim and sell ${firstSaleShare*100}% at ${whole(p.band.low)} circulating cap, rest near ${whole(p.band.high)}.`,
			`${stepCost(claimMinutes,result.claimSell-wage(claimMinutes))}. Buy back to undo.`]
	];
	if(verdict==="SKIP"){
		const target=pay.targets[0],
			need=target.drop===null?"higher launch odds":`launch odds ${oddsFactor(target.oddsRatio)} or a drop of ${costUsd(target.drop)}`;
		steps.push([`Revisit if a points program or snapshot is announced: the plan needs ${need} to break even.`,
			`${stepCost(weeklyMinutes)} per weekly check.`]);
	}
	return{...plan,...result,ticket,steps,pay,stress:{
		doubleCost:sizeFarm(plan,{horizon,cost:A.stressCost}),halfShare:sizeFarm(plan,{horizon,share:A.stressShare})
	}};
}

function watchlistPortfolio(rows){
	const farms=rows.filter(p=>p.watchlist&&p.plan.verdict==="FARM"),
		budget=A.portfolioCapital,eligible=farms.length,
		total=(list,key)=>list.reduce((sum,p)=>sum+p[key],0),
		overlap=min(...farms.map(p=>weeks(p.plan.horizon)));
	for(let n=min(eligible,floor(budget/A.capitalLadder[0]));n>0;n--){
		const shared=overlap*(1-1/n);
		const picks=farms.map(p=>({p,capital:sizeFarm(p.plan,{shared}).capital}))
			.sort((a,b)=>a.capital-b.capital||a.p.rank-b.p.rank).slice(0,n);
		const minimum=total(picks,"capital");
		if(minimum>budget) continue;
		const score=total(picks.map(({p})=>p),"score"),surplus=(budget-minimum)*100;
		let remaining=surplus;
		const positions=picks.map(({p,capital},i)=>{
			const extra=i===n-1?remaining:floor(surplus*p.score/score);
			remaining-=extra;
			return{slug:p.slug,name:p.name,...evaluateFarm(p.plan,capital+extra/100,{shared})};
		});
		return{budget,eligible,capital:budget,unallocated:0,positions,
			cost:total(positions,"cost"),net:total(positions,"net")};
	}
	return{budget,eligible,capital:0,unallocated:budget,positions:[],cost:0,net:0};
}

function boardRows(rows){
	return rows.map(p=>({slug:p.slug,name:p.name,rank:p.rank,
		implied_value_usd:p.score,launch_value_usd:p.launchValue,token_odds:p.tokenOdds,
		issuer_factor:p.haircut,farm_steps:p.plan.steps.map(parts=>parts.join(" "))}));
}

function digest(rows){
	const bytes=new TextEncoder().encode(JSON.stringify(rows));
	let hash=2166136261;
	for(const byte of bytes) hash=Math.imul(hash ^ byte,16777619);
	return(hash >>> 0).toString(16).padStart(8,"0");
}

function boardChecks(board,snapshot,bytes){
	const rows=Array.isArray(board)?board:board?.rows;
	if(!Array.isArray(rows)) return[{name:"board_file",pass:false}];
	const known=new Set(snapshot.protocols.map(p=>p.slug)),
		slugs=new Set(rows.map(p=>p?.slug)),size=rows.length,
		sorted=rows.toSorted((a,b)=>a?.rank-b?.rank);
	return checksFor({
		board_file:(bytes??new TextEncoder().encode(JSON.stringify(board)).length)<=8*1024*1024
			&&size>=100&&size<=4000&&slugs.size===size
			&&rows.every(p=>{
				if(!p) return false;
				const {slug,name,rank,implied_value_usd:value,farm_steps:steps}=p;
				return known.has(slug)&&/^\S{1,128}$/u.test(slug)&&typeof name==="string"&&name.trim()
					&&[rank,value].every(n=>Number.isInteger(n)&&n>0)&&value<=1e14&&Array.isArray(steps);
			}),
		sorted_by_value:new Set(rows.map(p=>p?.implied_value_usd)).size>1&&orderedRows(sorted)===size,
		coverage:snapshot.watchlist.every(slug=>slugs.has(slug)),
		farm_steps:rows.every(p=>validSteps(p?.farm_steps))
	});
}

const orderedRows=rows=>count(rows,(p,i)=>p?.rank===i+1&&(!i||p.implied_value_usd<=rows[i-1]?.implied_value_usd)),
	validSteps=steps=>Array.isArray(steps)&&steps.length>=3&&steps.length<=12
		&&steps.every(s=>typeof s==="string"&&/^.{20,600}$/s.test(s.trim())&&/^(If|Revisit if) .+\$\d.*\d+ min/u.test(s));

function selfChecks(model,snapshot,expectedDigest){
	const {rows,board,counts,stress,portfolio:basket,reference,calibration,value,odds}=model,
		samples=rows.map(p=>p.plan).filter(p=>p.pStar!==null&&p.q>0&&p.drop>0);
	return[...boardChecks(board,snapshot),...checksFor({
		"group counts":counts.traded+counts.recorded+counts.setAside+counts.ranked===counts.total
			&&counts.ranked===rows.length&&calibration.every(p=>p.mcap_usd>0&&!p.productPeer),
		"value factors":rows.every(p=>max(1,round(rawScore(p)))===p.score),
		"relative attribution":rows.every(p=>abs(values(p.attribution)
			.reduce((product,factor)=>product*factor,1)*reference.score/p.score-1)<1e-10),
		"bootstrap bands":rows.every(p=>p.band.low>0&&p.band.low<=p.band.high&&p.tokenOdds>0&&p.tokenOdds<1),
		"flagged plans":rows.every(p=>p.flags.length?p.haircut===A.haircut&&p.plan.verdict!=="FARM":p.haircut===1),
		"launch odds":rows.every(({plan:{launchOdds}})=>A.horizons.map(h=>launchOdds[h])
			.every((q,i,curve)=>q>=(curve[i-1]??0)&&q<=1)),
		"farm outcomes":rows.every(({plan})=>{
			const {horizon,q,capital,noToken,withToken,net,pStar,gas,fees,timeCost,capitalCharge,drop,claimSell}=plan,
				close=(a,b)=>abs(a-b)<1e-8,
				loss=gas+fees+timeCost+capitalCharge,payoff=drop-claimSell;
			return horizon===chooseFarm(plan).horizon&&q===plan.launchOdds[horizon]
				&&close(capitalCharge,capital*A.riskFreeRate*horizon/A.year)
				&&close(timeCost,wage(plan.handsOnMinutes+weeks(horizon)*A.weeklyMinutes))
				&&close(noToken,-loss)&&close(withToken,payoff-loss)
				&&close(net,(1-q)*noToken+q*withToken)
				&&(payoff<=0?pStar===null:close(pStar,loss/payoff));
		}),
		"MARGINAL break-even":samples.length>=3&&[0,floor(samples.length/2),-1].every(i=>{
			const plan=samples.at(i),
				{odds:q,dropRatio:share}=plan.pay.targets[0];
			return[{q},{share}].every(input=>abs(evaluateFarm(plan,plan.capital,input).net)<=.01);
		}),
		"stress counts":entries(stress).every(([key,{all,farm}]) =>
			keys(all).every(v=>all[v]===count(rows,p=>p.plan.stress[key].verdict===v)
				&&farm[v]===count(rows,p=>p.plan.verdict==="FARM"&&p.plan.stress[key].verdict===v))),
		"portfolio allocation":round((basket.capital+basket.unallocated)*100)===basket.budget*100
			&&basket.positions.every(p=>p.verdict==="FARM"&&rows.some(r=>r.slug===p.slug&&r.watchlist&&r.plan.verdict==="FARM")),
		"term table matches headline":[[value.validation.evidence,value.validation.selected],[odds.evidence,odds.validation]]
			.every(([rows,headline])=>rows.length&&rows.every(({withTerm})=>blindTests.every(k=>withTerm[k].miss===headline[k].miss))),
		"board digest":typeof expectedDigest==="string"&&digest(boardRows(rows))===expectedDigest
	})];
}

function buildModel(snapshot){
	const records=prepare(snapshot),
		points=tokenPoints(records);
	if(points.length<3) throw new Error("Need three screened positive caps.");
	const value=chooseValue(points),{fit}=value,
		resamples=bootstrap(points,fit.terms),
		oddsPoints=records.filter(p=>!p.product),
		oddsFit=fitTokenOdds(oddsPoints),
		oddsFolds=record(blindTests,k=>folds(oddsPoints,k==="walk",A.oddsWarmup)),
		assess=omit=>record(blindTests,k=>testTokenOdds(oddsFolds[k],omit)),
		validation=assess(),
		odds={validation,evidence:[[2,"Listing age in token odds"],[1,"TVL in token odds"]]
			.map(([omit,label])=>termTest(label,validation,assess(omit)))};
	const rows=records.filter(p=>p.status==="ranked").map(p=>{
		const launchValue=exp(logValue(fit,p)),
			s=tokenOdds(oddsFit,p),
			haircut=p.flags.length?A.haircut:1,
			draws=resamples.map(fit=>exp(logValue(fit,p))),
			[low,high]=A.bandQuantiles.map(q=>quantile(draws,q));
		const row={...p,launchValue,tokenOdds:s,haircut,score:max(1,round(launchValue*s*haircut)),
			band:{low,high,weightedLow:low*s*haircut,weightedHigh:high*s*haircut},
			peers:nearestPeers(p,points)};
		return{...row,plan:farmPlan(row,snapshot.as_of,oddsFit)};
	}).sort((a,b)=>b.score-a.score||byText(a.slug,b.slug))
		.map((p,i)=>({...p,rank:i+1}));
	const reference=rows[floor(rows.length/2)];
	for(const p of rows) p.attribution=attribution(p,reference,fit,oddsFit);
	const groups=record(["traded","recorded","setAside","ranked"],k=>count(records,p=>p.status===k));
	const counts={...groups,total:records.length,watchlistCovered:count(rows,p=>p.watchlist),
		watchlistTotal:snapshot.watchlist.length,valueFit:points.length,oddsFit:oddsPoints.length};
	const verdicts=tally(rows,p=>p.plan.verdict),
		farms=rows.filter(p=>p.plan.verdict==="FARM");
	const stress=record(["doubleCost","halfShare"],k=>{
		const verdict=p=>p.plan.stress[k].verdict;
		return{all:tally(rows,verdict),farm:tally(farms,verdict)};
	});
	const calibration=points.map(p=>({...p,launchValue:exp(logValue(fit,p))})),
		peerRatios=A.bandQuantiles.map(q=>quantile(points.map(p=>p.mcap_usd/p.carriedTvl),q));
	const audit=rows.slice(0,20).map(p=>{
		const ratio=p.launchValue/p.carriedTvl;
		return{...p,ratio,outlier:ratio<peerRatios[0]||ratio>peerRatios[1]};
	});
	return{rows,reference,board:{rows:boardRows(rows)},counts,verdicts,stress,portfolio:watchlistPortfolio(rows),
		value,odds,calibration,audit,peerRatios,assumptions:settings};
}
const timing="Fixed TVL age curve. Snapshot has no launch dates.";
const settings={parameters:A,chainQuotes:CHAINS,fallbackChain:FALLBACK_CHAIN,mechanisms:MECHANISMS,families:FAMILIES,timing,
	notes:[
		"Cap, ID or symbol signal token status. Dedup by TVL. Audit: cap/carried TVL.",
		timing,"F(a) is status at age a. q(H) = max(0, (F(a+H)−F(a))/(1−F(a))). Impute median age.",
		"Prorate by eligible TVL. Exclude yield, tax, price moves.",
		"First 2× ticket or best payoff/cost. Auto: best net, shortest hold.",
		"Charge max(horizon, lockup) + delay. Slip on test, entry, exit and sale."
	]};

const modelApi={buildModel,boardChecks,selfChecks,boardRows,digest,evaluateFarm,chooseFarm,oddsFactor,orderedRows,validSteps};
if(typeof module==="object"&&module.exports) module.exports=modelApi;
else globalThis.LaunchRadar=modelApi;
