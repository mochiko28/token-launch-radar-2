(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LaunchRadar = factory();
})(globalThis, function () {
  "use strict";

  const DAY = 86_400_000;
  const A = {
    growthClip: [-30, 30], missingGrowth: 0, haircut: 0.65, year: 365,
    tvlReference: 100_000_000, missingAgeFallback: 365, annualizationFloor: 365,
    familyPenalty: 2, oddsPenalty: 1, valueWarmup: 25, oddsWarmup: 60,
    bootstrapDraws: 192, bootstrapSeed: 918273, bandQuantiles: [0.1, 0.9],
    hourlyUsd: 20, depositorShare: 0.05, competingTvlShare: 0.20,
    minCapital: 100, maxCapital: 10_000, portfolioCapital: 10_000,
    farmMultiple: 2, stressCost: 2, stressShare: 0.5, weeklyMinutes: 2,
    routeHandsOnMinutes: 6, eligibilityMinutes: 2, exitTvlShare: 0.75, exitMinutes: 10,
    claimMinutes: 8, claimActions: 2,
    firstSaleShare: 0.5, peerCount: 3,
    peerCategoryPenalty: 1, peerFamilyPenalty: 0.45
  };

  // Gas USD per action, round-trip funding USD and elapsed minutes.
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

  // Round-trip protocol actions, fee bps, deposit minutes and action.
  const MECHANISMS = {
    Lending: [3, 4, 9, "Supply a supported stablecoin to a liquid lending market and leave borrowing disabled"],
    Vault: [3, 12, 12, "Deposit a supported stablecoin into an open vault after checking its strategy and redemption terms"],
    LP: [4, 30, 14, "Enter a liquid pair with balanced assets and verify the received LP position"],
    Perps: [4, 25, 14, "Post collateral only if it earns credit without an open leveraged position"],
    Staking: [3, 12, 11, "Stake a supported asset only after confirming withdrawal delay and slashing terms"],
    RWA: [3, 25, 16, "Check eligibility and redemption windows, then subscribe to a liquid share if available"],
    Stablecoin: [4, 18, 13, "Enter an unlevered savings or mint-and-redeem route after checking collateral and peg liquidity"],
    Network: [3, 15, 13, "Use a documented native deposit or delegation and test that a small withdrawal clears"],
    Insurance: [3, 25, 14, "Use an open liquidity pool only after checking claim exposure and the withdrawal queue"],
    Other: [3, 20, 13, "Use a documented deposit with withdrawal access and record its receipt, or keep funds unallocated"]
  };
  const FAMILIES = {
    Lending: ["Lending", "Uncollateralized Lending", "Collateral Markets", "Collateral Management"],
    Vault: ["Yield", "Yield Aggregator", "Risk Curators", "Onchain Capital Allocator", "Basis Trading", "Leveraged Farming", "Farm", "Indexes", "Options Vault", "CeDeFi"],
    LP: ["Dexs", "Liquidity Manager"],
    Perps: ["Derivatives", "Synthetics", "Options", "Interest Rate Derivatives", "Prediction Market"],
    Staking: ["Liquid Staking", "Liquid Restaking", "Staking Pool", "Restaking", "Token Locker", "Governance Incentives"],
    RWA: ["RWA"],
    Stablecoin: ["CDP", "CDP Manager", "Algo-Stables", "Dual-Token Stablecoin", "Stablecoin Wrapper", "Stablecoin Issuer", "Reserve Currency"],
    Network: ["Chain", "Payments", "Decentralized BTC", "Anchor BTC", "Cross Chain Bridge"],
    Insurance: ["Insurance"]
  };
  const FAMILY_NAMES = Object.keys(FAMILIES).concat("Other");
  const familyByCategory = new Map(Object.entries(FAMILIES).flatMap(([family, categories]) =>
    categories.map(category => [category, family])));
  const productCategories = new Set(["Bridge", "Canonical Bridge", "Cross Chain Bridge", "Restaked BTC", "CEX"]);
  const liquid = new Set(["Liquid Staking", "Liquid Restaking"]);
  const version = /\s+(?:v\s*\d+(?:\.\d+)*|\d+\.\d+(?:\.\d+)*)$/i;
  const exchange = /^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
  const byText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const limit = (value, low, high) => Math.min(high, Math.max(low, value));
  const firstWord = name => name.toLowerCase().match(/[\p{L}\p{N}]+/u)?.[0];
  const hasToken = p => p.mcap_usd != null || Boolean(p.gecko_id || p.symbol);
  const dollars = n => "$" + n.toFixed(2);
  const whole = n => "$" + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const percent = n => (n * 100).toFixed(2) + "%";

  function quantile(values, fraction) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = (sorted.length - 1) * fraction;
    return sorted[Math.floor(index)] * (1 - index % 1) + sorted[Math.ceil(index)] * (index % 1);
  }

  function prepare(snapshot) {
    const asOf = Date.parse(snapshot.as_of);
    const watchlist = new Set(snapshot.watchlist);
    const tradedWords = new Set(snapshot.protocols.filter(hasToken).map(p => firstWord(p.name)));
    return snapshot.protocols.map(p => {
      const family = familyByCategory.get(p.category) || "Other";
      const isLiquid = liquid.has(p.category);
      const date = Number.isFinite(Date.parse(p.listed_at)) ? Date.parse(p.listed_at) : null;
      const ageDays = date === null ? null : Math.max(1, Math.floor((asOf - date) / DAY));
      const growth = limit(p.change_7d ?? A.missingGrowth, ...A.growthClip);
      const carriedTvl = p.tvl_usd * (1 + growth / 100);
      const flags = [];
      if (tradedWords.has(firstWord(p.name))) flags.push("First name word matches a protocol with a recorded token");
      if (isLiquid) flags.push("Liquid staking or liquid restaking issuer");
      if (version.test(p.name)) flags.push("Version marker at the end of the protocol name");
      const productReason = productCategories.has(p.category) ? p.category + " product"
        : exchange.test(p.name) ? "Exchange-branded product"
        : /\b(?:wrapped|bridged|staked)\b/i.test(p.name) || (!isLiquid && /\bstaking\b/i.test(p.name))
          ? "Wrapped, bridged or staked product wording" : null;
      const isWatchlist = watchlist.has(p.slug);
      const tokenRecorded = hasToken(p);
      const status = tokenRecorded ? "traded" : productReason && !isWatchlist ? "setAside" : "ranked";
      return { ...p, family, date, ageDays, growth, carriedTvl, flags: tokenRecorded ? [] : flags,
        productReason, watchlist: isWatchlist, tokenRecorded, status,
        size: Math.log(carriedTvl / A.tvlReference), rawSize: Math.log(p.tvl_usd / A.tvlReference) };
    });
  }

  function tokenPoints(records) {
    const tokens = new Map();
    for (const p of records.filter(p => p.tokenRecorded && p.mcap_usd > 0)
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
    const ageFallback = medianAge(points);
    const names = ["intercept", "logCarriedTvl"];
    if (terms.includes("age")) names.push("logAge");
    if (terms.includes("growth")) names.push("clippedGrowth");
    if (terms.includes("family")) names.push(...FAMILY_NAMES);
    const system = normalEquations(names.length, names.map(name => FAMILY_NAMES.includes(name) ? A.familyPenalty : 1e-8));
    for (const p of points) accumulate(system, valueFeatures(p, terms, ageFallback), p.response);
    const coefficients = solve(system.matrix, system.target);
    return { terms, ageFallback, coefficients, names };
  }

  const predictValue = (fit, p) => dot(valueFeatures(p, fit.terms, fit.ageFallback), fit.coefficients);
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
        const estimate = fit ? predictValue(fit, p) : Math.log(p.carriedTvl) + flat;
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
  const oddsFeatures = (p, ageFallback) => [1, p.rawSize, ageFeature(p, ageFallback)];

  function fitOdds(points) {
    const ageFallback = medianAge(points);
    const inputs = points.map(p => oddsFeatures(p, ageFallback));
    let coefficients = zero(3);
    const penalties = [1e-6, A.oddsPenalty, A.oddsPenalty];
    for (let iteration = 0; iteration < 20; iteration++) {
      const system = normalEquations(3, penalties);
      system.target = coefficients.map((c, i) => -c * penalties[i]);
      for (let i = 0; i < points.length; i++) {
        const probability = sigmoid(dot(inputs[i], coefficients));
        accumulate(system, inputs[i], Number(points[i].tokenRecorded) - probability, probability * (1 - probability));
      }
      const delta = solve(system.matrix, system.target);
      coefficients = coefficients.map((c, i) => c + delta[i]);
      if (Math.max(...delta.map(Math.abs)) < 1e-8) break;
    }
    return { coefficients, ageFallback };
  }

  function launchOdds(fit, p) {
    const observed = sigmoid(dot(oddsFeatures(p, fit.ageFallback), fit.coefficients));
    const exposure = Math.max(A.annualizationFloor, p.ageDays ?? fit.ageFallback);
    return { observed, s: -Math.expm1(Math.log1p(-observed) * A.year / exposure) };
  }

  function auc(scored, key) {
    const sorted = [...scored].sort((a, b) => a[key] - b[key]);
    let wins = 0, positive = 0, negative = 0;
    for (let i = 0; i < sorted.length;) {
      let next = i, groupPositive = 0;
      while (next < sorted.length && sorted[next][key] === sorted[i][key]) {
        groupPositive += Number(sorted[next++].tokenRecorded);
      }
      const groupNegative = next - i - groupPositive;
      wins += groupPositive * (negative + groupNegative / 2);
      positive += groupPositive;
      negative += groupNegative;
      i = next;
    }
    return positive && negative ? wins / (positive * negative) : null;
  }

  function testOdds(points, walk) {
    const scored = [];
    for (const { train, test } of folds(points, walk, A.oddsWarmup)) {
      const fit = fitOdds(train);
      for (const p of test) scored.push({ tokenRecorded: p.tokenRecorded, ...launchOdds(fit, p) });
    }
    return { auc: auc(scored, "s"), statusAuc: auc(scored, "observed"), n: scored.length };
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
      .slice(0, A.peerCount).map(({ peer, distance }) => ({
        slug: peer.slug, name: peer.name, category: peer.category, tvl_usd: peer.tvl_usd,
        mcap_usd: peer.mcap_usd, valueIfLaunched: Math.exp(predictValue(fit, peer)), distance
      }));
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
    const exposure = plan.conditionalValue * ownership;
    const cost = capital > 0 ? (plan.fixedCost + capital * plan.feeRate) * costMultiplier : 0;
    const conditionalGross = exposure * share;
    const expectedGross = conditionalGross * plan.s;
    const multiple = cost > 0 ? expectedGross / cost : 0;
    const rating = multiple + 1e-10 >= A.farmMultiple ? "FARM" : multiple >= 1 ? "MARGINAL" : "SKIP";
    const verdict = plan.capped && rating === "FARM" ? "MARGINAL" : rating;
    return { capital, cost, expectedGross, conditionalGross, net: expectedGross - cost, verdict, multiple,
      breakEvenShare: exposure * plan.s > 0 ? cost / (exposure * plan.s) : null,
      expectedYield: capital > 0 ? (expectedGross - cost) / capital : null,
      conditionalApr: capital > 0 ? (conditionalGross - cost) / capital : null };
  }

  function sizeCapital(plan, multiple, peak) {
    const target = size => evaluateFarm(plan, size).multiple >= multiple;
    if (!target(peak)) return null;
    let low = A.minCapital, high = peak;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (target(mid)) high = mid;
      else low = mid + 1;
    }
    return low;
  }

  function farmPlan(p) {
    const [actions, feeBps, depositMinutes, depositAction] = MECHANISMS[p.family];
    const chain = cheapestChain(p.chains, actions);
    const upkeepWeeks = Math.floor(A.year / 7);
    const handsOnMinutes = A.eligibilityMinutes + A.routeHandsOnMinutes + depositMinutes
      + upkeepWeeks * A.weeklyMinutes + A.exitMinutes + A.claimMinutes;
    const timeCost = handsOnMinutes * A.hourlyUsd / 60;
    const plan = {
      mechanism: p.family, chain, handsOnMinutes, timeCost, feeBps, feeRate: feeBps / 10_000,
      competingTvl: p.tvl_usd * A.competingTvlShare, conditionalValue: p.valueIfLaunched * p.haircut,
      fixedCost: chain.total + timeCost, capped: Boolean(p.flags.length), s: p.s
    };
    // Gross/cost peaks where feeRate * capital² equals competingTvl * fixedCost.
    const peak = limit(Math.round(Math.sqrt(plan.competingTvl * plan.fixedCost / plan.feeRate)), A.minCapital, A.maxCapital);
    const minimumCapital = sizeCapital(plan, A.farmMultiple, peak);
    const stressTarget = A.farmMultiple * Math.max(A.stressCost, 1 / A.stressShare);
    const bufferedCapital = plan.capped ? null : sizeCapital(plan, stressTarget, peak);
    const result = evaluateFarm(plan, bufferedCapital ?? minimumCapital ?? peak);
    const doubleCost = evaluateFarm(plan, result.capital, A.stressCost);
    const halfShare = evaluateFarm(plan, result.capital, 1, A.stressShare);
    const baseFarm = result.verdict === "FARM";
    const exitFloor = p.tvl_usd * A.exitTvlShare;
    const depositCost = chain.gas * actions + result.capital * plan.feeRate;
    const routeCheck = chain.estimated ? "Confirm the fallback quote." : "Verify the route.";
    const decision = baseFarm ? "Require documented eligibility and redemptions."
      : result.verdict === "MARGINAL" ? "Wait for eligibility terms." : "Keep funds unallocated.";
    const steps = [
      `${result.verdict} · Check ${p.name} eligibility (${dollars(A.eligibilityMinutes * A.hourlyUsd / 60)} labor, ${A.eligibilityMinutes} minutes). ${decision} Break-even depositor share is ${percent(result.breakEvenShare)} of launched value.`,
      `Fund ${chain.name} after checks. Allow ${dollars(chain.bridge)} round trip, ${chain.bridgeMinutes} minutes elapsed and ${A.routeHandsOnMinutes} minutes hands-on. ${routeCheck}`,
      `Model ${whole(result.capital)} for ${A.year} days at ${dollars(result.cost)} all-in and ${handsOnMinutes} minutes of work. Expect ${dollars(result.expectedGross)} against a ${dollars(A.farmMultiple * result.cost)} target.`,
      `${p.family} · ${depositAction} on ${chain.name} through ${p.name}. Budget ${dollars(depositCost)} in round-trip gas and fees and ${depositMinutes} minutes to enter.`,
      `Log position, eligibility and TVL weekly. Budget ${dollars(A.weeklyMinutes * A.hourlyUsd / 60)} for ${A.weeklyMinutes} minutes per check and $0 gas.`,
      `Exit below ${whole(exitFloor)} TVL or after ${A.year} days. Allow ${A.exitMinutes} minutes to check queues and redeem. Gas is in the ${dollars(depositCost)} round trip.`,
      `If claimable, allow ${A.claimMinutes} minutes and ${dollars(chain.gas * A.claimActions)} for claim and sale. Check liquidity. Sell ${percent(A.firstSaleShare)} at ${whole(p.band.low)} circulating cap and the rest near ${whole(p.band.high)}.`
    ];
    return { ...plan, ...result, minimumCapital, exitFloor, depositCost, upkeepWeeks, steps, stress: {
      doubleCost: { ...doubleCost, flip: baseFarm && doubleCost.verdict !== "FARM" },
      halfShare: { ...halfShare, flip: baseFarm && halfShare.verdict !== "FARM" }
    } };
  }

  function portfolio(rows) {
    const minimumWeight = p => p.plan.minimumCapital / p.implied_value_usd;
    const eligible = rows.filter(p => p.watchlist && p.plan.verdict === "FARM")
      .sort((a, b) => minimumWeight(a) - minimumWeight(b) || a.rank - b.rank);
    const budget = A.portfolioCapital * 100;
    const picks = [];
    let scores = 0;
    for (const p of eligible) {
      if (Math.floor(budget * p.implied_value_usd / (scores + p.implied_value_usd)) < p.plan.minimumCapital * 100) break;
      scores += p.implied_value_usd;
      picks.push(p);
    }
    let assigned = 0;
    const positions = picks.map((p, i) => {
      const cents = i === picks.length - 1 ? budget - assigned : Math.floor(budget * p.implied_value_usd / scores);
      assigned += cents;
      return { slug: p.slug, name: p.name, score: p.implied_value_usd, ...evaluateFarm(p.plan, cents / 100) };
    });
    return { budget: A.portfolioCapital, capital: assigned / 100, unallocated: (budget - assigned) / 100, eligible: eligible.length, positions,
      cost: positions.reduce((sum, p) => sum + p.cost, 0), net: positions.reduce((sum, p) => sum + p.net, 0) };
  }

  function boardRows(rows) {
    return rows.map(p => ({ slug: p.slug, name: p.name, rank: p.rank,
      implied_value_usd: p.implied_value_usd, farm_steps: p.plan.steps }));
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
      "group counts": counts.traded + counts.setAside + counts.ranked === counts.total && counts.ranked === rows.length,
      "value factors": rows.every(p => Math.max(1, Math.round(p.valueIfLaunched * p.s * p.haircut)) === p.implied_value_usd),
      "bootstrap bands": rows.every(p => p.band.low > 0 && p.band.low <= p.band.high && p.s > 0 && p.s < 1),
      "flagged plans": rows.every(p => p.flags.length ? p.haircut === A.haircut && p.plan.verdict !== "FARM" : p.haircut === 1),
      "stress counts": ["doubleCost", "halfShare"].every(key => stress[key] === rows.filter(p => p.plan.stress[key].flip).length),
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
    const odds = { fit: fitOdds(oddsPoints), validation: { loo: testOdds(oddsPoints, false), walk: testOdds(oddsPoints, true) } };
    const rows = records.filter(p => p.status === "ranked").map(p => {
      const valueIfLaunched = Math.exp(predictValue(value.fit, p));
      const { s } = launchOdds(odds.fit, p);
      const haircut = p.flags.length ? A.haircut : 1;
      const draws = resamples.map(fit => Math.exp(predictValue(fit, p)));
      const [low, high] = A.bandQuantiles.map(q => quantile(draws, q));
      const row = { ...p, valueIfLaunched, s, haircut, implied_value_usd: Math.max(1, Math.round(valueIfLaunched * s * haircut)),
        band: { low, high, weightedLow: low * s * haircut, weightedHigh: high * s * haircut },
        peers: nearestPeers(p, points, value.fit) };
      return { ...row, plan: farmPlan(row) };
    }).sort((a, b) => b.implied_value_usd - a.implied_value_usd || byText(a.slug, b.slug))
      .map((p, i) => ({ ...p, rank: i + 1 }));
    const counts = { total: records.length, traded: records.filter(p => p.status === "traded").length,
      setAside: records.filter(p => p.status === "setAside").length, ranked: rows.length,
      watchlistCovered: rows.filter(p => p.watchlist).length, watchlistTotal: snapshot.watchlist.length,
      valueFit: points.length, oddsFit: oddsPoints.length };
    const verdicts = Object.fromEntries(["FARM", "MARGINAL", "SKIP"].map(v => [v, rows.filter(p => p.plan.verdict === v).length]));
    const stress = Object.fromEntries(["doubleCost", "halfShare"].map(key => [key, rows.filter(p => p.plan.stress[key].flip).length]));
    const calibration = points.map(p => ({ ...p, valueIfLaunched: Math.exp(predictValue(value.fit, p)) }));
    const ratios = points.map(p => p.mcap_usd / p.carriedTvl);
    const [lowerRatio, upperRatio] = A.bandQuantiles.map(q => quantile(ratios, q));
    const audit = rows.slice(0, 20).map(p => ({
      slug: p.slug, rank: p.rank, name: p.name, tokenRecorded: p.tokenRecorded, flags: p.flags,
      rawGrowth: p.change_7d, carriedGrowth: p.growth, growthClipped: p.change_7d != null && p.change_7d !== p.growth,
      valuationRatio: p.valueIfLaunched / p.carriedTvl, lowerRatio, upperRatio,
      valuationOutlier: p.valueIfLaunched < lowerRatio * p.carriedTvl || p.valueIfLaunched > upperRatio * p.carriedTvl
    }));
    return { rows, board: { rows: boardRows(rows) }, records, counts, verdicts, stress, portfolio: portfolio(rows),
      value, odds, calibration, audit, assumptions: assumptions() };
  }

  function assumptions() {
    return { parameters: A, chainQuotes: CHAINS, fallbackChain: FALLBACK_CHAIN, mechanisms: MECHANISMS, families: FAMILIES,
      notes: [
        "Status uses token fields. Parent records are absent. Exchange and wrapper evidence outranks issuer flags.",
        "Value uses positive caps, choosing the largest TVL per token ID.",
        "The flat baseline is median cap/carried TVL. Walk-forward trains on strictly earlier listings.",
        "A term must improve both tests when added. Reported misses also guide selection.",
        "Constant hazard annualizes token prevalence. AUC tests recorded status because launch dates are absent.",
        "Bootstrap bands show curve uncertainty. Audit thresholds use traded cap/carried-TVL percentiles.",
        "Route costs are USD estimates. All listed chains qualify.",
        "Drop prorates a hypothetical pool by capital. Returns exclude base yield, taxes and principal moves.",
        "Sizing seeks twice cost under stress within the cap, then twice base cost.",
        "The portfolio score-weights viable watchlist tickets and prices each separately."
      ] };
  }

  return { buildModel, boardChecks, selfChecks, boardRows, digest, evaluateFarm };
});
