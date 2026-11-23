(function (root, factory) {
	if (typeof module === "object" && module.exports) module.exports = factory();
	else root.LaunchRadar = factory();
})(globalThis, function () {
	"use strict";

	const DAY = 86_400_000;
	const A = {
		growthClip: [-30, 30], missingGrowth: 0, haircut: 0.65, year: 365,
		tvlReference: 100_000_000, missingAgeFallback: 365,
		familyPenalty: 2, oddsPenalty: 1, valueWarmup: 25, oddsWarmup: 60,
		bootstrapDraws: 192, bootstrapSeed: 918273, bandQuantiles: [0.1, 0.9],
		hourlyUsd: 20, depositorShare: 0.05, competingTvlShare: 0.20,
		capitalLadder: [1_000, 2_500, 5_000, 10_000, 25_000, 50_000], portfolioCapital: 10_000,
		farmMultiple: 2, stressCost: 2, stressShare: 0.5, weeklyMinutes: 2,
		routeHandsOnMinutes: 6, eligibilityMinutes: 2, exitTvlShare: 0.75, exitMinutes: 10,
		weeklyLossBuffer: 10, researchMinutes: [5, 8, 4], reviewDays: 7,
		claimMinutes: 8, claimActions: 2,
		firstSaleShare: 0.5, peerCount: 3,
		peerCategoryPenalty: 1, peerFamilyPenalty: 0.45
	};

	const CHAINS = {
		Ethereum: [4.5, 9, 25], Bitcoin: [3, 9, 60], Solana: [0.08, 1.8, 8],
		Base: [0.16, 0.8, 8], Arbitrum: [0.23, 1.2, 10], Optimism: [0.19, 1, 10],
		Binance: [0.18, 1.2, 9], Polygon: [0.12, 0.9, 9], Avalanche: [0.3, 1.5, 12],
		Monad: [0.15, 1.2, 12], Ink: [0.17, 1.1, 10], Plasma: [0.14, 1.3, 14],
		"Hyperliquid L1": [0.23, 1.6, 15], Sui: [0.12, 1.6, 12], Aptos: [0.12, 1.5, 12],
		Stellar: [0.08, 1.8, 12], Flare: [0.16, 1.9, 15], Algorand: [0.09, 2, 12],
		Ripple: [0.12, 2.1, 14], Tron: [1.2, 3.5, 16], Linea: [0.24, 1.3, 15],
		Mantle: [0.22, 1.5, 14], Sonic: [0.15, 1.5, 12], Scroll: [0.25, 1.5, 15],
		xDai: [0.13, 1.4, 12], Berachain: [0.24, 1.5, 15], TON: [0.25, 2, 15],
		Near: [0.18, 2, 15], Starknet: [0.26, 1.5, 18],
		"zkSync Era": [0.24, 1.5, 16], Unichain: [0.18, 1.3, 12],
		Celo: [0.13, 1.5, 12],
		"World Chain": [0.21, 1.5, 12], Ronin: [0.21, 1.7, 15], Sei: [0.18, 1.8, 15],
		Cardano: [0.32, 2.5, 20], "Plume Mainnet": [0.24, 1.7, 16],
		Arc: [0.20, 1.7, 15], Pharos: [0.25, 2, 18], CORE: [0.27, 2.3, 18],
		Bittensor: [0.32, 2.7, 18], BSquared: [0.35, 3, 22],
		Noble: [0.25, 2, 15], Mezo: [0.34, 2.6, 17]
	};
	const FALLBACK_CHAIN = [1.5, 5, 30];

	const MECHANISMS = {
		Lending: [3, 4, 9, "Supply a supported stablecoin to a liquid market without borrowing"],
		Vault: [3, 12, 12, "Check strategy and redemptions, then deposit a supported stablecoin"],
		LP: [4, 30, 14, "Enter a liquid pair with balanced assets and check the LP receipt"],
		Perps: [4, 25, 14, "Post collateral only if unlevered credit qualifies"],
		Staking: [3, 12, 11, "Check withdrawal delays and slashing before staking"],
		RWA: [3, 25, 16, "Check eligibility and redemptions, then subscribe to a liquid share"],
		Stablecoin: [4, 18, 13, "Check collateral and peg liquidity, then use unlevered savings or mint and redeem"],
		Network: [3, 15, 13, "Use a documented deposit or delegation and test withdrawal"],
		Insurance: [3, 25, 14, "Check claim risk and the queue, then use an open pool"],
		Other: [3, 20, 13, "Log a documented, redeemable deposit or leave funds unallocated"]
	};
	const FAMILIES = {
		Lending: "Lending|Uncollateralized Lending|Collateral Markets|Collateral Management",
		Vault: "Yield|Yield Aggregator|Risk Curators|Onchain Capital Allocator|Basis Trading|Leveraged Farming|Farm|Indexes|Options Vault|CeDeFi",
		LP: "Dexs|Liquidity Manager",
		Perps: "Derivatives|Synthetics|Options|Interest Rate Derivatives|Prediction Market",
		Staking: "Liquid Staking|Liquid Restaking|Staking Pool|Restaking|Token Locker|Governance Incentives",
		RWA: "RWA",
		Stablecoin: "CDP|CDP Manager|Algo-Stables|Dual-Token Stablecoin|Stablecoin Wrapper|Stablecoin Issuer|Reserve Currency",
		Network: "Chain|Payments|Decentralized BTC|Anchor BTC|Cross Chain Bridge",
		Insurance: "Insurance"
	};
	const FAMILY_NAMES = Object.keys(FAMILIES).concat("Other");
	const familyByCategory = new Map(Object.entries(FAMILIES).flatMap(([family, categories]) =>
		categories.split("|").map(category => [category, family])));
	const productCategories = new Set(["Bridge", "Canonical Bridge", "Cross Chain Bridge", "Restaked BTC", "CEX"]);
	const liquid = new Set(["Liquid Staking", "Liquid Restaking"]);
	const version = /\s+(?:v\s*\d+(?:\.\d+)*|\d+\.\d+(?:\.\d+)*)$/i;
	const exchange = /^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
	const byText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
	const limit = (value, low, high) => Math.min(high, Math.max(low, value));
	const count = (rows, test) => rows.filter(test).length;
	const firstWord = name => name.toLowerCase().match(/[\p{L}\p{N}]+/u)?.[0];
	const hasToken = p => p.mcap_usd > 0 || Boolean(p.gecko_id || p.symbol);
	const usd = n => "$" + n.toFixed(2);
	const whole = n => "$" + Math.round(n).toLocaleString("en-US");
	const pct = n => (n * 100).toFixed(2) + "%";
	const wage = min => min * A.hourlyUsd / 60;
	const upkeep = Math.floor(A.year / 7) * A.weeklyMinutes;

	function quantile(values, fraction) {
		if (!values.length) return null;
		const sorted = [...values].sort((a, b) => a - b);
		const index = (sorted.length - 1) * fraction;
		return sorted[Math.floor(index)] * (1 - index % 1) + sorted[Math.ceil(index)] * (index % 1);
	}

	function prepare(snapshot) {
		const asOf = Date.parse(snapshot.as_of);
		const watchlist = new Set(snapshot.watchlist);
		const recordedWords = new Set(snapshot.protocols.filter(hasToken).map(p => firstWord(p.name)));
		return snapshot.protocols.map(p => {
			const family = familyByCategory.get(p.category) || "Other";
			const isLiquid = liquid.has(p.category);
			const parsedDate = Date.parse(p.listed_at);
			const date = Number.isFinite(parsedDate) ? parsedDate : null;
			const ageDays = date === null ? null : Math.max(1, Math.floor((asOf - date) / DAY));
			const growth = limit(p.change_7d ?? A.missingGrowth, ...A.growthClip);
			const carriedTvl = p.tvl_usd * (1 + growth / 100);
			const flags = [];
			if (recordedWords.has(firstWord(p.name))) flags.push("First word matches a recorded-token protocol");
			if (isLiquid) flags.push("Liquid staking or restaking issuer");
			if (version.test(p.name)) flags.push("Name ends in a version marker");
			const productReason = productCategories.has(p.category) ? p.category + " product"
				: exchange.test(p.name) ? "Exchange-branded product"
				: /\b(?:wrapped|bridged|staked)\b/i.test(p.name) || (!isLiquid && /\bstaking\b/i.test(p.name))
					? "Wrapped, bridged or staked product wording" : null;
			const isWatchlist = watchlist.has(p.slug);
			const recorded = hasToken(p);
			const status = p.mcap_usd > 0 ? "traded" : recorded ? "recorded" : productReason && !isWatchlist ? "setAside" : "ranked";
			return { ...p, family, date, ageDays, growth, carriedTvl, flags: recorded ? [] : flags,
				productReason, watchlist: isWatchlist, recorded, status,
				size: Math.log(carriedTvl / A.tvlReference), rawSize: Math.log(p.tvl_usd / A.tvlReference) };
		});
	}

	function tokenPoints(records) {
		const tokens = new Map();
		for (const p of records.filter(p => p.status === "traded")
			.sort((a, b) => b.tvl_usd - a.tvl_usd || byText(a.slug, b.slug))) {
			const key = p.gecko_id ? "gecko:" + p.gecko_id : p.symbol ? "symbol:" + p.symbol : p.slug;
			if (!tokens.has(key)) tokens.set(key, { ...p, response: Math.log(p.mcap_usd) });
		}
		return [...tokens.values()].sort((a, b) => byText(a.slug, b.slug));
	}

	function medianAge(records) {
		return quantile(records.flatMap(p => p.ageDays === null ? [] : [p.ageDays]), 0.5) ?? A.missingAgeFallback;
	}

	function ageFeature(p, fallback) {
		return Math.log((p.ageDays ?? fallback) / A.year);
	}

	function solve(matrix, target) {
		const rows = matrix.map((row, i) => [...row, target[i]]);
		const n = rows.length;
		for (let col = 0; col < n; col++) {
			let pivot = col;
			for (let row = col + 1; row < n; row++) {
				if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
			}
			[rows[col], rows[pivot]] = [rows[pivot], rows[col]];
			const scale = rows[col][col];
			for (let j = col; j <= n; j++) rows[col][j] /= scale;
			for (let row = 0; row < n; row++) {
				if (row === col) continue;
				const factor = rows[row][col];
				for (let j = col; j <= n; j++) rows[row][j] -= factor * rows[col][j];
			}
		}
		return rows.map(row => row[n]);
	}

	const dot = (row, coefficients) => row.reduce((sum, x, i) => sum + x * coefficients[i], 0);
	const zero = n => Array(n).fill(0);

	function normalEquations(n, penalties) {
		return {
			target: zero(n),
			matrix: penalties.map((value, i) => zero(n).map((_, j) => i === j ? value : 0))
		};
	}

	function accumulate(system, x, residual, weight = 1) {
		for (let i = 0; i < x.length; i++) {
			system.target[i] += x[i] * residual;
			if (x[i] === 0) continue;
			for (let j = 0; j < x.length; j++) system.matrix[i][j] += x[i] * x[j] * weight;
		}
	}

	function valueFeatures(p, terms, fallback) {
		const features = [1, p.size];
		if (terms.includes("age")) features.push(ageFeature(p, fallback));
		if (terms.includes("growth")) features.push(p.growth / 100);
		if (terms.includes("family")) features.push(...FAMILY_NAMES.map(f => Number(f === p.family)));
		return features;
	}

	function fitValue(points, terms) {
		const medianDays = medianAge(points);
		const names = ["intercept", "logCarriedTvl"];
		if (terms.includes("age")) names.push("logAge");
		if (terms.includes("growth")) names.push("clippedGrowth");
		if (terms.includes("family")) names.push(...FAMILY_NAMES);
		const system = normalEquations(names.length, names.map(name => FAMILY_NAMES.includes(name) ? A.familyPenalty : 1e-8));
		for (const p of points) accumulate(system, valueFeatures(p, terms, medianDays), p.response);
		const coefficients = solve(system.matrix, system.target);
		return { terms, medianDays, coefficients, names };
	}

	const logValue = (fit, p) => dot(valueFeatures(p, fit.terms, fit.medianDays), fit.coefficients);
	const medianRatio = points => Math.log(quantile(points.map(p => p.mcap_usd / p.carriedTvl), 0.5));

	function folds(points, walk, warmup) {
		if (!walk) return points.map((point, i) => ({ train: points.filter((_, j) => j !== i), test: [point] }));
		const dated = points.filter(p => p.date !== null).sort((a, b) => a.date - b.date || byText(a.slug, b.slug));
		const result = [];
		for (let i = 0; i < dated.length;) {
			let next = i + 1;
			while (next < dated.length && dated[next].date === dated[i].date) next++;
			if (i >= warmup) result.push({ train: dated.slice(0, i), test: dated.slice(i, next) });
			i = next;
		}
		return result;
	}

	function valueMiss(splits, terms) {
		const misses = [];
		for (const { train, test } of splits) {
			const fit = terms === null ? null : fitValue(train, terms);
			const flat = fit === null ? medianRatio(train) : 0;
			for (const p of test) {
				const estimate = fit ? logValue(fit, p) : Math.log(p.carriedTvl) + flat;
				misses.push(Math.abs(estimate - p.response));
			}
		}
		return { miss: misses.length ? Math.exp(quantile(misses, 0.5)) : null, n: misses.length };
	}

	function chooseValue(points) {
		const loo = folds(points, false, A.valueWarmup);
		const walk = folds(points, true, A.valueWarmup);
		const assess = terms => ({ terms, loo: valueMiss(loo, terms), walk: valueMiss(walk, terms) });
		const baseline = assess(null);
		const terms = ["age", "family", "growth"];
		const trials = Array.from({ length: 1 << terms.length }, (_, mask) => assess(terms.filter((_, i) => mask & (1 << i))));
		const better = (a, b) => a.loo.miss < b.loo.miss && a.walk.miss < b.walk.miss;
		const candidate = trials.filter((trial, mask) => terms.every((_, i) => {
			const bit = 1 << i;
			return !(mask & bit) || better(trial, trials[mask ^ bit]);
		})).sort((a, b) => a.loo.miss * a.walk.miss - b.loo.miss * b.walk.miss)[0];
		return { fit: fitValue(points, candidate.terms), validation: { baseline, selected: candidate, trials } };
	}

	const sigmoid = x => 1 / (1 + Math.exp(-limit(x, -35, 35)));
	const oddsFeatures = (p, medianDays) => [1, p.rawSize, ageFeature(p, medianDays)];

	// Fit snapshot token status from TVL and listing age.
	function fitTokenOdds(points) {
		const age = medianAge(points);
		const inputs = points.map(p => oddsFeatures(p, age));
		const penalties = [1e-6, A.oddsPenalty, A.oddsPenalty];
		let beta = zero(3);
		for (let i = 0; i < 20; i++) {
			const system = normalEquations(beta.length, penalties);
			system.target = beta.map((c, j) => -c * penalties[j]);
			for (let j = 0; j < points.length; j++) {
				const x = inputs[j], prob = sigmoid(dot(x, beta));
				accumulate(system, x, Number(points[j].recorded) - prob, prob * (1 - prob));
			}
			const delta = solve(system.matrix, system.target);
			beta = beta.map((c, j) => c + delta[j]);
			if (Math.max(...delta.map(Math.abs)) < 1e-8) break;
		}
		return { age, beta };
	}

	const tokenOdds = (fit, p) => sigmoid(dot(oddsFeatures(p, fit.age), fit.beta));

	function auc(scored) {
		const sorted = [...scored].sort((a, b) => a.score - b.score);
		let wins = 0, negative = 0;
		for (let i = 0; i < sorted.length;) {
			let next = i, groupPositive = 0;
			while (next < sorted.length && sorted[next].score === sorted[i].score) {
				groupPositive += Number(sorted[next++].recorded);
			}
			const groupNegative = next - i - groupPositive;
			wins += groupPositive * (negative + groupNegative / 2);
			negative += groupNegative;
			i = next;
		}
		const pairs = (sorted.length - negative) * negative;
		return pairs ? wins / pairs : null;
	}

	function testTokenOdds(points, walk) {
		const scored = [];
		for (const { train, test } of folds(points, walk, A.oddsWarmup)) {
			const fit = fitTokenOdds(train);
			for (const p of test) scored.push({ recorded: p.recorded, score: tokenOdds(fit, p) });
		}
		return { auc: auc(scored), n: scored.length };
	}

	function bootstrap(points, terms) {
		let seed = A.bootstrapSeed;
		return Array.from({ length: A.bootstrapDraws }, () => {
			const sample = points.map(() => {
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
				return points[Math.floor(seed * points.length / 4294967296)];
			});
			return fitValue(sample, terms);
		});
	}

	function nearestPeers(p, points, fit) {
		return points.map(peer => {
			const penalty = peer.category === p.category ? 0 : peer.family === p.family ? A.peerFamilyPenalty : A.peerCategoryPenalty;
			return { peer, distance: Math.abs(peer.rawSize - p.rawSize) + penalty };
		}).sort((a, b) => a.distance - b.distance || byText(a.peer.slug, b.peer.slug))
			.slice(0, A.peerCount).map(({ peer }) => ({ ...peer, launchValue: Math.exp(logValue(fit, peer)) }));
	}

	function cheapestChain(chains, actions) {
		return [...new Set(chains)].map(name => {
			const estimated = !Object.hasOwn(CHAINS, name);
			const [gas, bridge, bridgeMinutes] = estimated ? FALLBACK_CHAIN : CHAINS[name];
			return { name, gas, bridge, bridgeMinutes, estimated, total: bridge + gas * (actions + A.claimActions) };
		}).sort((a, b) => a.total - b.total || a.bridgeMinutes - b.bridgeMinutes || byText(a.name, b.name))[0];
	}

	function evaluateFarm(plan, capital, costMultiplier = 1, shareMultiplier = 1) {
		const share = A.depositorShare * shareMultiplier;
		const ownership = capital / (plan.competingTvl + capital);
		const exposure = plan.impliedValue * ownership;
		const cost = capital > 0 ? (plan.fixedCost + capital * plan.feeRate) * costMultiplier : 0;
		const conditionalGross = plan.conditionalValue * ownership * share;
		const expectedGross = exposure * share;
		const multiple = cost > 0 ? expectedGross / cost : 0;
		const rating = multiple + 1e-10 >= A.farmMultiple ? "FARM" : multiple >= 1 ? "MARGINAL" : "SKIP";
		const verdict = plan.capped && rating === "FARM" ? "MARGINAL" : rating;
		return { capital, cost, expectedGross, conditionalGross, net: expectedGross - cost, verdict, multiple,
			breakEvenShare: exposure > 0 ? cost / exposure : null,
			expectedYield: capital > 0 ? (expectedGross - cost) / capital : null,
			conditionalApr: capital > 0 ? (conditionalGross - cost) / capital : null };
	}

	function sizeFarm(plan, cost, share) {
		const ladder = A.capitalLadder.map(capital => evaluateFarm(plan, capital, cost, share));
		return ladder.find(step => step.multiple + 1e-10 >= A.farmMultiple)
			?? ladder.reduce((best, step) => step.multiple > best.multiple ? step : best);
	}

	const budgetStep = (min, fees = 0) => `${min} min · ${usd(wage(min) + fees)}`;

	function researchPlan(p, plan, result) {
		const [status, terms, review] = A.researchMinutes;
		const revisit = Math.ceil(p.score * A.farmMultiple / result.multiple);
		const steps = [
			`Check ${p.name} for a token announcement or record. Stop on either. ${plan.capped ? "Verify flagged issuer IDs. " : ""}${budgetStep(status)} (time).`,
			`Read ${p.family.toLowerCase()} docs for ${plan.chain.name}. Check rewards, caps and redemptions. Quote gas and fees against the ${usd(result.cost - plan.timeCost)} budget. ${budgetStep(terms)} (time).`,
			`Revisit in ${A.reviewDays} days at ${whole(revisit)} implied for ${whole(result.capital)} capital and ${whole(p.tvl_usd)} TVL. Re-size if costs or TVL change. ${plan.capped ? "Clear issuer flags. " : ""}Stop below ${A.farmMultiple}× cost. ${budgetStep(review)} (time).`
		];
		const researchTime = status + terms + review;
		return { steps, researchTime, researchCost: wage(researchTime), revisit };
	}

	function farmPlan(p) {
		const [actions, feeBps, depositMinutes, depositAction] = MECHANISMS[p.family];
		const chain = cheapestChain(p.chains, actions);
		const { eligibilityMinutes, routeHandsOnMinutes, exitMinutes, claimMinutes, weeklyMinutes, year } = A;
		const handsOnMinutes = eligibilityMinutes + routeHandsOnMinutes + depositMinutes + upkeep + exitMinutes + claimMinutes;
		const timeCost = wage(handsOnMinutes);
		const plan = {
			chain, handsOnMinutes, timeCost, feeRate: feeBps / 10_000,
			competingTvl: p.tvl_usd * A.competingTvlShare, conditionalValue: p.launchValue * p.haircut,
			fixedCost: chain.total + timeCost, capped: Boolean(p.flags.length), impliedValue: p.score
		};
		const result = sizeFarm(plan);
		const stress = { doubleCost: sizeFarm(plan, A.stressCost), halfShare: sizeFarm(plan, 1, A.stressShare) };
		if (result.verdict !== "FARM") return { ...plan, ...result, stress, ...researchPlan(p, plan, result) };
		const exitFloor = p.tvl_usd * A.exitTvlShare;
		const exitGrowth = Math.min(0, p.growth) - A.weeklyLossBuffer;
		const depositCost = chain.gas * actions + result.capital * plan.feeRate;
		const steps = [
			`Check deposit caps, points, KYC, redemptions and stop rules. Break-even at ${whole(result.capital)} needs a ${pct(result.breakEvenShare)} depositor pool. ${budgetStep(eligibilityMinutes)} (time).`,
			`Fund ${chain.name}. ${chain.estimated ? "Verify fallback quote. " : ""}${chain.bridgeMinutes} min elapsed · ${budgetStep(routeHandsOnMinutes, chain.bridge)} with round-trip funding.`,
			`${depositAction} on ${chain.name}. ${budgetStep(depositMinutes, depositCost)} with round-trip gas and fees.`,
			`Log eligibility, position and TVL weekly. ${budgetStep(weeklyMinutes)} per check (time, $0 gas).`,
			`Exit if TVL < ${whole(exitFloor)} or 7d change < ${exitGrowth.toFixed(2)}%, on token announcement or record, or at day ${year}. ${budgetStep(exitMinutes)} (time, gas in deposit budget).`,
			`Claim when eligible. Check liquidity and sell ${pct(A.firstSaleShare)} at ${whole(p.band.low)} circulating cap and the rest near ${whole(p.band.high)}. ${budgetStep(claimMinutes, chain.gas * A.claimActions)} with gas.`
		];
		return { ...plan, ...result, steps, stress };
	}

	function portfolio(rows) {
		const eligible = rows.filter(p => p.watchlist && p.plan.verdict === "FARM");
		const budget = A.portfolioCapital;
		const upkeepCost = wage(upkeep);
		// Share weekly checks.
		for (let n = Math.min(eligible.length, Math.floor(budget / A.capitalLadder[0])); n > 0; n--) {
			const picks = eligible.map(p => {
				const plan = { ...p.plan, fixedCost: p.plan.fixedCost - upkeepCost + upkeepCost / n };
				return { p, plan, ticket: sizeFarm(plan) };
			}).filter(({ ticket }) => ticket.verdict === "FARM")
				.sort((a, b) => a.ticket.capital - b.ticket.capital || a.p.rank - b.p.rank).slice(0, n);
			const minimum = picks.reduce((sum, { ticket }) => sum + ticket.capital, 0);
			if (picks.length < n || minimum > budget) continue;
			const score = picks.reduce((sum, { p }) => sum + p.score, 0);
			let remaining = (budget - minimum) * 100;
			const positions = picks.map(({ p, plan, ticket }, i) => {
				const extra = i === n - 1 ? remaining : Math.floor((budget - minimum) * 100 * p.score / score);
				remaining -= extra;
				return { slug: p.slug, name: p.name, ...evaluateFarm(plan, ticket.capital + extra / 100) };
			});
			const total = key => positions.reduce((sum, p) => sum + p[key], 0);
			return { budget, capital: budget, unallocated: 0, eligible: eligible.length, positions, cost: total("cost"), net: total("net") };
		}
		return { budget, capital: 0, unallocated: budget, eligible: eligible.length, positions: [], cost: 0, net: 0 };
	}

	function boardRows(rows) {
		return rows.map(p => ({ slug: p.slug, name: p.name, rank: p.rank,
			implied_value_usd: p.score, launch_value_usd: p.launchValue, token_odds: p.tokenOdds,
			issuer_factor: p.haircut, farm_steps: p.plan.steps }));
	}

	function digest(rows) {
		const bytes = new TextEncoder().encode(JSON.stringify(rows));
		let hash = 2166136261;
		for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
		return (hash >>> 0).toString(16).padStart(8, "0");
	}

	function boardChecks(board, snapshot, bytes) {
		const rows = Array.isArray(board) ? board : board?.rows;
		if (!Array.isArray(rows)) return [{ name: "board_file", pass: false }];
		const known = new Set(snapshot.protocols.map(p => p.slug));
		const seen = new Set(rows.map(p => p?.slug));
		const distinct = new Set(rows.map(p => p?.implied_value_usd)).size > 1;
		const sorted = [...rows].sort((a, b) => a?.rank - b?.rank);
		const checks = {
			board_file: (bytes ?? new TextEncoder().encode(JSON.stringify(board)).length) <= 8 * 1024 * 1024
				&& rows.length >= 100 && rows.length <= 4000 && seen.size === rows.length && distinct
				&& rows.every(p => p && typeof p.slug === "string" && /^\S{1,128}$/u.test(p.slug) && known.has(p.slug)
					&& typeof p.name === "string" && p.name.trim() && Number.isInteger(p.rank) && p.rank >= 1
					&& Number.isInteger(p.implied_value_usd) && p.implied_value_usd > 0 && p.implied_value_usd <= 100_000_000_000_000
					&& Array.isArray(p.farm_steps)),
			sorted_by_value: distinct && sorted.every((p, i) => p?.rank === i + 1
				&& (!i || p.implied_value_usd <= sorted[i - 1].implied_value_usd)),
			coverage: snapshot.watchlist.every(slug => seen.has(slug)),
			farm_steps: rows.every(p => Array.isArray(p?.farm_steps) && p.farm_steps.length >= 3 && p.farm_steps.length <= 12
				&& p.farm_steps.every(step => typeof step === "string" && step.trim().length >= 20 && step.trim().length <= 600))
		};
		return Object.entries(checks).map(([name, pass]) => ({ name, pass: Boolean(pass) }));
	}

	function selfChecks(model, snapshot, expectedDigest) {
		const { rows, board, counts, stress, portfolio: basket } = model;
		return [...boardChecks(board, snapshot), ...Object.entries({
			"group counts": counts.traded + counts.recorded + counts.setAside + counts.ranked === counts.total
				&& counts.ranked === rows.length && model.calibration.every(p => p.mcap_usd > 0),
			"value factors": rows.every(p => Math.max(1, Math.round(p.launchValue * p.tokenOdds * p.haircut)) === p.score),
			"bootstrap bands": rows.every(p => p.band.low > 0 && p.band.low <= p.band.high && p.tokenOdds > 0 && p.tokenOdds < 1),
			"flagged plans": rows.every(p => p.flags.length ? p.haircut === A.haircut && p.plan.verdict !== "FARM" : p.haircut === 1),
			"stress counts": Object.entries(stress).every(([key, { all, farm }]) =>
				Object.keys(all).every(v => all[v] === count(rows, p => p.plan.stress[key].verdict === v)
					&& farm[v] === count(rows, p => p.plan.verdict === "FARM" && p.plan.stress[key].verdict === v))),
			"portfolio allocation": Math.round((basket.capital + basket.unallocated) * 100) === basket.budget * 100
				&& basket.positions.every(p => p.verdict === "FARM" && rows.some(r => r.slug === p.slug && r.watchlist && r.plan.verdict === "FARM")),
			"board digest": typeof expectedDigest === "string" && digest(boardRows(rows)) === expectedDigest
		}).map(([name, pass]) => ({ name, pass }))];
	}

	function buildModel(snapshot) {
		const records = prepare(snapshot);
		const points = tokenPoints(records);
		if (points.length < 3) throw new Error("The value curve needs at least three positive market caps.");
		const value = chooseValue(points);
		const resamples = bootstrap(points, value.fit.terms);
		const oddsPoints = records.filter(p => !p.productReason);
		const oddsFit = fitTokenOdds(oddsPoints);
		const odds = { validation: { loo: testTokenOdds(oddsPoints, false), walk: testTokenOdds(oddsPoints, true) } };
		const rows = records.filter(p => p.status === "ranked").map(p => {
			const launchValue = Math.exp(logValue(value.fit, p));
			const s = tokenOdds(oddsFit, p);
			const haircut = p.flags.length ? A.haircut : 1;
			const draws = resamples.map(fit => Math.exp(logValue(fit, p)));
			const [low, high] = A.bandQuantiles.map(q => quantile(draws, q));
			const row = { ...p, launchValue, tokenOdds: s, haircut, score: Math.max(1, Math.round(launchValue * s * haircut)),
				band: { low, high, weightedLow: low * s * haircut, weightedHigh: high * s * haircut },
				peers: nearestPeers(p, points, value.fit) };
			return { ...row, plan: farmPlan(row) };
		}).sort((a, b) => b.score - a.score || byText(a.slug, b.slug))
			.map((p, i) => ({ ...p, rank: i + 1 }));
		const groups = Object.fromEntries(["traded", "recorded", "setAside", "ranked"].map(key => [key, count(records, p => p.status === key)]));
		const counts = { total: records.length, ...groups,
			watchlistCovered: count(rows, p => p.watchlist), watchlistTotal: snapshot.watchlist.length,
			valueFit: points.length, oddsFit: oddsPoints.length };
		const tally = (list, get) => Object.fromEntries(["FARM", "MARGINAL", "SKIP"].map(v => [v, count(list, p => get(p) === v)]));
		const verdicts = tally(rows, p => p.plan.verdict);
		const farms = rows.filter(p => p.plan.verdict === "FARM");
		const stress = Object.fromEntries(["doubleCost", "halfShare"].map(key => {
			const get = p => p.plan.stress[key].verdict;
			return [key, { all: tally(rows, get), farm: tally(farms, get) }];
		}));
		const calibration = points.map(p => ({ ...p, launchValue: Math.exp(logValue(value.fit, p)) }));
		const peerRatios = A.bandQuantiles.map(q => quantile(points.map(p => p.mcap_usd / p.carriedTvl), q));
		const audit = rows.slice(0, 20).map(p => {
			const ratio = p.launchValue / p.carriedTvl;
			return { ...p, ratio, outlier: ratio < peerRatios[0] || ratio > peerRatios[1] };
		});
		return { rows, board: { rows: boardRows(rows) }, counts, verdicts, stress, portfolio: portfolio(rows),
			value, odds, calibration, audit, peerRatios, assumptions: assumptions() };
	}

	function assumptions() {
		return { parameters: A,
			chainQuotes: CHAINS, fallbackChain: FALLBACK_CHAIN, mechanisms: MECHANISMS, families: FAMILIES,
			notes: [
				"Positive caps trade. IDs or symbols record tokens. Exclude products.",
				"Fit largest TVL per token. Baseline uses median cap/carried TVL.",
				"Train walk-forward on earlier listings. Terms must improve both tests.",
				"Token odds fit snapshot status by TVL and listing age. No launch dates.",
				"Bootstrap bands show fit uncertainty. Audit uses cap/carried-TVL percentiles.",
				"Use listed chains and estimated quotes. Prorate drop by eligible TVL and deposit. Exclude yield, tax and price moves.",
				"First 2× ticket or best drop/cost. Issuer flags cap verdicts.",
				"Maximize FARM positions, share upkeep, score-weight surplus."
			] };
	}

	return { buildModel, boardChecks, selfChecks, boardRows, digest, evaluateFarm };
});
