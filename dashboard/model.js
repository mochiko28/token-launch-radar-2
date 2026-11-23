"use strict";
const {abs,ceil,exp,floor,log,max,min,round,sqrt}=Math;
const {entries,fromEntries,hasOwn,keys,values}=Object;
const record=(keys,read)=>fromEntries(keys.map(key=>[key,read(key)])),unique=items=>[...new Set(items)];
const {farm,chainQuotes,fallbackChain,mechanisms,ethChains,assets,families}=
	globalThis.LaunchRadarData?.tables??require("../lib/tables.json");
const A={
	growthClip:[-30,30],missingGrowth:0,haircut:.65,year:365,
	tvlReference:1e8,missingAgeFallback:365,
	familyPenalty:2,oddsPenalty:1,valueWarmup:25,oddsWarmup:60,
	bootstrapDraws:192,bootstrapSeed:918273,bandQuantiles:[.1,.9],
	...farm,peerCount:3,peerCategoryPenalty:1,peerFamilyPenalty:.45
};
const DAY=86_400_000;
const familyByCategory=new Map(entries(families).flatMap(([family,categories])=>
	categories.split("|").map(category=>[category,family])));
const productCategories=new Set(["Bridge","Canonical Bridge","Cross Chain Bridge","Restaked BTC","CEX"]),
	liquid=new Set(["Liquid Staking","Liquid Restaking"]),
	version=/\s+(?:v\s*\d+(?:\.\d+)*|\d+\.\d+(?:\.\d+)*)$/i,
	exchange=/^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i,
	receiptId=/^(wrapped|bridged|staked|restaked|savings)-/i;
const byText=(a,b)=>(a>b)-(a<b),
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

function quantile(values,fraction=.5){
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
		const product=productCategories.has(category)||exchange.test(name)
			||/\b(?:wrapped|bridged|staked)\b/i.test(name)||(!isLiquid&&/\bstaking\b/i.test(name));
		const recorded=hasToken(p),
			watched=watchlist.has(p.slug),
			flags=recorded?[]:[recordedWords.has(firstWord(name))&&"Name matches a recorded issuer",
				isLiquid&&"Liquid staking or restaking",version.test(name)&&"Versioned name"].filter(Boolean),
			status=p.mcap_usd>0?"traded":recorded?"recorded":product&&!watched?"setAside":"ranked";
		return{...p,family,date,ageDays,growth,carriedTvl,flags,
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
const medianAge=rows=>quantile(rows.map(p=>p.ageDays).filter(Number.isFinite))??A.missingAgeFallback,
	ageFeature=(p,fallback)=>log((p.ageDays??fallback)/A.year);

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

const normalEquations=(penalties,n=penalties.length)=>({target:zero(n),matrix:penalties.map((v,i)=>zero(n).with(i,v))});

function accumulate({matrix,target},x,residual,weight=1){
	for(let i=0;i<x.length;i++){
		target[i]+=x[i]*residual;
		if(x[i]===0) continue;
		for(let j=0;j<x.length;j++) matrix[i][j]+=x[i]*x[j]*weight;
	}
}

const valueTerms=[
	["age","logAge",ageFeature],["growth","clippedGrowth",p=>p.growth/100],
	...keys(families).concat("Other").map(f=>["family",f,p=>+(f===p.family)])
];
const valueCandidates={
	"Shrunk family offset":["group",p=>p.family],
	"Shrunk category offset":["group",p=>p.category],
	"Shrunk single-chain offset":["group",p=>p.chains.length===1?p.chains[0]:null],
	"Chain breadth":["feature",p=>log(new Set(p.chains).size)],
	"Quadratic log TVL":["feature",p=>p.rawSize**2],
	"Log TVL hinge":["feature",p=>max(0,p.rawSize)],
	"TVL × listing age":["feature",(p,age)=>p.rawSize*ageFeature(p,age)],
	"Downside growth":["feature",p=>min(0,p.growth)/100],
	"Continuous 7d carry":["carry",p=>p.rawSize+p.growth/100],
	"Huber fit":["huber"],"Median residual intercept":["median"],
	"Theil–Sen TVL fit":["theilSen"],"TVL slope shrinkage":["ridge"]
};
const valueFeatures=(p,{features,medianDays,omit,carry})=>[
	1,omit==="scale"?0:omit==="carry"?p.rawSize:carry?.(p)??p.size,
	...features.map(([,,read])=>read(p,medianDays))];

function fitValue(points,terms,omit,candidate){
	const [method,read]=valueCandidates[candidate]??[],
		features=valueTerms.filter(([term])=>terms.includes(term)),
		fit={terms,features,medianDays:medianAge(points),omit,carry:method==="carry"?read:null,candidate};
	if(method==="feature") features.push([candidate,candidate,read]);
	const inputs=points.map(p=>valueFeatures(p,fit)),
		names=["intercept","logCarriedTvl",...features.map(([,name])=>name)],
		penalties=[1e-8,1e-8+(method==="ridge"?sqrt(points.length):0),...features.map(([term])=>term==="family"?A.familyPenalty:1e-8)];
	const regress=weights=>{
		const system=normalEquations(penalties);
		inputs.forEach((x,i)=>{
			const w=weights?.[i]??1;
			accumulate(system,x,points[i].response*w,w);
		});
		return solve(system.matrix,system.target);
	};
	let coefficients=regress();
	const errors=()=>inputs.map((x,i)=>points[i].response-dot(x,coefficients));
	if(method==="huber"){
		const first=errors(),center=quantile(first),
			cutoff=max(1e-8,1.345*1.4826*quantile(first.map(e=>abs(e-center))));
		for(let i=0;i<20;i++) coefficients=regress(errors().map(e=>min(1,cutoff/abs(e))));
	}
	if(method==="theilSen"){
		const residuals=errors(),slopes=[];
		inputs.forEach(([,x],i)=>{
			for(let j=0;j<i;j++){
				const dx=x-inputs[j][1];
				if(dx) slopes.push((residuals[i]-residuals[j])/dx);
			}
		});
		coefficients[1]+=quantile(slopes)??0;
	}
	if(method==="median"||method==="theilSen") coefficients[0]+=quantile(errors());
	const offsets=new Map(),group=method==="group"?read:null;
	if(group){
		errors().forEach((error,i)=>{
			const key=group(points[i]),[sum,n]=offsets.get(key)??[0,A.familyPenalty];
			if(key!=null) offsets.set(key,[sum+error,n+1]);
		});
		for(const [key,[sum,n]] of offsets) offsets.set(key,sum/n);
	}
	return{...fit,names,coefficients,group,offsets};
}

const logValue=(fit,p)=>dot(valueFeatures(p,fit),fit.coefficients)+(fit.offsets.get(fit.group?.(p))??0),
	medianRatio=points=>log(quantile(points.map(p=>p.mcap_usd/p.carriedTvl)));

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
const issuerNote="untested assumption (no traded rows carry the flag)";

function missSummary(misses){
	const n=misses.length;
	return{miss:n?exp(quantile(misses)):null,n,
		hits:[2,3].map(x=>n?count(misses,m=>m<=log(x))/n:null)};
}

function termTest(term,withTerm,without){
	const deltas=blindTests.map(k=>withTerm[k].n?without[k].miss-withTerm[k].miss:0);
	return{term,withTerm,without,verdict:deltas.every(d=>d<0)?"fails both":"kept · "+
		["no measured effect","helps one","helps both tests"][count(deltas,d=>d>0)]};
}

function valueMiss(splits,terms,omit,candidate){
	return missSummary(splits.flatMap(([train,test])=>{
		const fit=terms&&fitValue(train,terms,omit,candidate),ratio=fit?0:medianRatio(train);
		return test.map(p=>abs((fit?logValue(fit,p):log(p.carriedTvl)+ratio)-p.response));
	}));
}

const passesValue=({withTerm:a,without:b})=>blindTests.every(k=>a[k].n&&a[k].miss<b[k].miss)
	&&a.family.n&&a.family.miss<=b.family.miss+.1;

function chooseValue(points){
	const splits={
		loo:folds(points,false,A.valueWarmup),walk:folds(points,true,A.valueWarmup),
		family:unique(points.map(p=>p.family)).map(f=>[points.filter(p=>p.family!==f),points.filter(p=>p.family===f)])
			.filter(([train])=>train.length)
	};
	const tests=keys(splits),
		assess=(terms,candidate,omit)=>({terms,candidate,...record(tests,k=>valueMiss(splits[k],terms,omit,candidate))}),
		baseline=assess(null),
		terms=["age","family","growth"],
		trials=Array.from({length:1 << terms.length},(_,mask)=>assess(terms.filter((_,i)=>mask & (1 << i))));
	const volume=trial=>tests.reduce((product,k)=>product*(trial[k].miss??1),1),
		better=(a,b)=>tests.every(k=>a[k].n&&a[k].miss<b[k].miss);
	const deployed=trials.filter((trial,mask)=>terms.every((_,i)=>{
		const bit=1 << i;
		return !(mask & bit)||better(trial,trials[mask ^ bit]);
	})).sort((a,b)=>volume(a)-volume(b))[0];
	const search=keys(valueCandidates).map(term=>({term,withTerm:assess(deployed.terms,term),without:deployed})),
		chosen=search.filter(passesValue).sort((a,b)=>volume(a.withTerm)-volume(b.withTerm))[0],
		selected=chosen?.withTerm??deployed;
	for(const row of search) row.verdict=row===chosen?"Adopted":passesValue(row)?"Eligible":"Rejected";
	const labels={scale:"TVL scale exponent",carry:"7d-growth carry",age:"Listing age in cap",family:"Family in cap"},
		evidence=entries(labels).filter(([t])=>t==="scale"||t==="carry"||selected.terms.includes(t))
			.map(([omit,label])=>termTest(label,selected,
				assess(selected.terms.filter(t=>t!==(omit==="carry"?"growth":omit)),selected.candidate,omit)));
	evidence.push({term:"Issuer haircut",withTerm:selected,without:selected,verdict:issuerNote});
	return{fit:fitValue(points,selected.terms,null,selected.candidate),validation:{baseline,deployed,selected,trials,evidence,search}};
}

const sigmoid=x=>1/(1+exp(-limit(x,-35,35))),
	oddsFeatures=(p,age)=>[1,p.rawSize,ageFeature(p,age)];

function fitTokenOdds(points,omit){
	const age=medianAge(points),
		inputs=points.map(p=>oddsFeatures(p,age).map((x,i)=>i===omit?0:x)),
		penalties=[1e-6,A.oddsPenalty,A.oddsPenalty];
	let beta=zero(3);
	for(let i=0;i<20;i++){
		const system=normalEquations(penalties);
		system.target=beta.map((c,j)=>-c*penalties[j]);
		for(let j=0;j<points.length;j++){
			const x=inputs[j],prob=sigmoid(dot(x,beta));
			accumulate(system,x,points[j].recorded-prob,prob*(1-prob));
		}
		const delta=solve(system.matrix,system.target);
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

function bootstrap(points,{terms,candidate}){
	let seed=A.bootstrapSeed;
	return Array.from({length:A.bootstrapDraws},()=>{
		const sample=points.map(()=>{
			seed=(Math.imul(seed,1664525)+1013904223) >>> 0;
			return points[floor(seed*points.length/4294967296)];
		});
		return fitValue(sample,terms,null,candidate);
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
	return unique(chains).map(name=>{
		const [gas,bridge,bridgeMinutes]=hasOwn(chainQuotes,name)?chainQuotes[name]:fallbackChain;
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

function depositTicket({family,category},chain,capital){
	if(family==="LP") return`${whole(capital/2)} USDC + ${whole(capital/2)} USDT`;
	const native=assets[chain]||(ethChains.includes(chain)?"ETH":chain+" native asset"),
		network=/BTC$/.test(category)?"BTC":assets[chain]??"USDC",
		asset={Staking:native,Network:network,Perps:category==="Prediction Market"?"USDC collateral":"USDC margin"}[family]||"USDC";
	return`${whole(capital)} ${asset}`;
}

function farmPlan(p,asOf,curve){
	const [actions,bps,depositMinutes,verb,guidance]=mechanisms[p.family],
		chain=cheapestChain(p.chains,actions),
		{name,gas,bridge,bridgeMinutes}=chain,
		{verifyMinutes,testUsd,exitMinutes,claimMinutes,weeklyMinutes,firstSaleShare}=A,
		prep=A.routeHandsOnMinutes+A.testMinutes,slippage=bps/100;
	const quote={entryGas:gas*(actions-1),exitGas:gas,slippage,delay:0,lockup:0};
	const plan={
		chain,quote,testGas:gas*actions,launchOdds:launchOdds(curve,p),
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

const isFarm=p=>p.plan.verdict==="FARM";

function watchlistPortfolio(farms){
	const budget=A.portfolioCapital,eligible=farms.length,
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

const boardRows=rows=>rows.map(({slug,name,rank,score,launchValue,tokenOdds,haircut,plan})=>({slug,name,rank,
	implied_value_usd:score,launch_value_usd:launchValue,token_odds:tokenOdds,
	issuer_factor:haircut,farm_steps:plan.steps.map(parts=>parts.join(" "))}));

function digest(rows){
	let hash=2166136261;
	for(const byte of new TextEncoder().encode(JSON.stringify(rows))) hash=Math.imul(hash^byte,16777619);
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
		{evidence,search,deployed,selected}=value.validation,
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
				&&farm[v]===count(rows,p=>isFarm(p)&&p.plan.stress[key].verdict===v))),
		"portfolio allocation":round((basket.capital+basket.unallocated)*100)===basket.budget*100
			&&basket.positions.every(p=>p.verdict==="FARM"&&rows.some(r=>p.slug===r.slug&&r.watchlist&&isFarm(r))),
		"term table matches headline":[[evidence,selected],[odds.evidence,odds.validation]]
			.every(([rows,headline])=>rows.length&&rows.every(row=>row.withTerm===headline)),
		"value search":search.every(({withTerm,without,verdict})=>without===deployed
			&&passesValue({withTerm,without})===(verdict!=="Rejected")&&(withTerm===selected)===(verdict==="Adopted")),
		"board digest":typeof expectedDigest==="string"&&digest(boardRows(rows))===expectedDigest
	})];
}

function buildModel(snapshot){
	const records=prepare(snapshot),
		points=tokenPoints(records);
	if(points.length<3) throw new Error("Need three screened positive caps.");
	const value=chooseValue(points),{fit}=value,
		resamples=bootstrap(points,fit),
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
	const verdicts=tally(rows,p=>p.plan.verdict),farms=rows.filter(isFarm);
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
	return{rows,reference,board:{rows:boardRows(rows)},counts,verdicts,stress,portfolio:watchlistPortfolio(farms.filter(p=>p.watchlist)),
		value,odds,calibration,audit,peerRatios,assumptions:settings};
}
const timing="Fixed TVL age curve. Snapshot has no launch dates.";
const settings={parameters:A,chainQuotes,fallbackChain,mechanisms,families,timing,
	notes:[
		"Token status uses cap, ID or symbol. Dedup by TVL. Audit uses cap/carried TVL.",
		timing,"Issuer haircut · "+issuerNote,"F(a) is status at age a. q(H) = max(0, (F(a+H)−F(a))/(1−F(a))). Impute median age.",
		"Prorate by eligible TVL. Exclude yield, tax, price moves.",
		"First 2× ticket or best payoff/cost. Auto picks best net, shortest hold.",
		"Charge max(horizon, lockup) + delay. Slip on test, entry, exit, sale."
	]};

const modelApi={buildModel,boardChecks,selfChecks,boardRows,digest,evaluateFarm,chooseFarm,oddsFactor,orderedRows,validSteps};
if(typeof module==="object"&&module.exports) module.exports=modelApi;
else globalThis.LaunchRadar=modelApi;
