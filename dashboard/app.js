"use strict";

const api = globalThis.LaunchRadar;
const { snapshot, boardDigest } = globalThis.LaunchRadarData;
const model = api.buildModel(snapshot);
const $ = selector => document.querySelector(selector);
const view = $("#view");
const checks = api.selfChecks(model, snapshot, boardDigest);
const passed = checks.filter(check => check.pass).length;
const number = options => new Intl.NumberFormat("en-US", options).format;
const integer = number({ maximumFractionDigits: 0 });
const compact = number({ notation: "compact", maximumFractionDigits: 2 });
const money = number({ style: "currency", currency: "USD" });
const usd = n => "$" + integer(n);
const shortUsd = n => "$" + compact(n);
const pct = (n, places = 2) => (n * 100).toFixed(places) + "%";
const multiple = n => n == null ? "—" : n.toFixed(2) + "×";
const auc = n => n == null ? "—" : n.toFixed(3);
const sign = n => n > 0 ? "+" : "";
const change = n => n == null ? "—" : sign(n) + n.toFixed(2) + "%";
const net = n => sign(n) + money(n);
const tone = n => n > 0 ? "positive" : n < 0 ? "negative" : "";
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
	"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[c]);

const { counts, verdicts, stress, portfolio, value, odds, assumptions } = model;
const { baseline, selected, trials } = value.validation;
const families = [...new Set(model.rows.map(row => row.family))].sort();
const chains = [...new Set(model.rows.flatMap(row => row.chains))].sort();
const verdictOrder = { FARM: 0, MARGINAL: 1, SKIP: 2 };
const ratings = Object.keys(verdictOrder);
const scenarios = [["doubleCost", "2× all-in cost", "2× cost"], ["halfShare", "½ depositor share", "½ share"]];
const columns = {
	rank: ["Rank", row => row.rank, "asc"], name: ["Protocol", row => row.name, "asc"],
	value: ["Implied value", row => row.score, "desc"], odds: ["12m odds", row => row.s, "desc"],
	tvl: ["TVL", row => row.tvl_usd, "desc"], growth: ["7d TVL", row => row.change_7d, "desc"],
	days: ["Days listed", row => row.ageDays, "desc"], verdict: ["Verdict", row => verdictOrder[row.plan.verdict], "asc"],
	net: ["Expected net", row => row.plan.net, "desc"]
};
const filters = [
	["Scope", "scope", ["all", "watchlist"], { all: "All ranked", watchlist: "Watchlist" }],
	["Family", "family", ["", ...families], { "": "All families" }],
	["Verdict", "verdict", ["", ...ratings], { "": "All verdicts" }],
	["Chain", "chain", ["", ...chains], { "": "All chains" }],
	["Min TVL", "tvl", ["", "10000000", "50000000", "100000000", "500000000"], { "": "Any TVL" }],
	["Issuer", "flag", ["", "flagged", "clear"], { "": "Any issuer", flagged: "Flagged", clear: "No flags" }]
];
const defaults = { q: "", sort: "rank", ...Object.fromEntries(filters.map(([, key, [first]]) => [key, first])) };
const routes = { board: "Rankings", calibration: "Calibration", audit: "Top-20 audit", detail: "Protocol" };
const bySlug = new Map(model.rows.map(row => [row.slug, row]));

function readRoute() {
	const [path, query] = location.hash.slice(1).split("?");
	const [route, slug] = path.split("/");
	const params = new URLSearchParams(query);
	const get = (key, options) => options.includes(params.get(key)) ? params.get(key) : defaults[key];
	const sort = get("sort", Object.keys(columns));
	const dir = params.get("dir");
	return {
		route: Object.hasOwn(routes, route) ? route : "board", slug,
		q: params.get("q") || "", ...Object.fromEntries(filters.map(([, key, options]) => [key, get(key, options)])),
		compare: [...new Set(params.getAll("compare"))].filter(slug => bySlug.has(slug)).slice(0, 3),
		sort, dir: ["asc", "desc"].includes(dir) ? dir : columns[sort][2]
	};
}

function link(route, state, slug = "") {
	const params = new URLSearchParams();
	for (const [key, normal] of Object.entries(defaults)) {
		if (state[key] !== normal) params.set(key, state[key]);
	}
	for (const slug of state.compare) params.append("compare", slug);
	if (state.dir !== columns[state.sort][2]) params.set("dir", state.dir);
	return `#${slug ? route + "/" + slug : route}${params.size ? "?" + params : ""}`;
}

const badge = verdict => `<span class="badge ${verdict.toLowerCase()}">${verdict}</span>`;
const taggedLink = (row, state) =>
	`<a class="protocol" href="${esc(link("detail", state, encodeURIComponent(row.slug)))}">${esc(row.name)}</a>`;
const days = row => row.ageDays == null ? "—" : integer(row.ageDays);

const heading = (title, description = "", label = "") => `<div class="heading"><div>${label}<h1>${title}</h1>${description && `<p>${description}</p>`}</div>
	<div class="snapshot">DefiLlama snapshot<time>${esc(snapshot.as_of)} UTC</time></div></div>`;

function kpis() {
	const groups = [[counts.traded, "trade · positive cap"], [counts.recorded, "token recorded · no cap"],
		[counts.setAside, "products set aside"], [counts.ranked, "pre-token ranked"]];
	const tests = get => `<div class="readings">${["loo", "walk"].map((key, i) =>
		`<div>${get(key)}<span>${i ? "Walk-forward" : "Leave-one-out"}</span></div>`).join("")}</div>`;
	return `<section class="kpis" aria-label="Snapshot and model validation">
		<div class="kpi"><h2>Snapshot universe</h2><strong>${counts.total}</strong>
			<div class="group-bar" aria-hidden="true">${groups.map(([n]) => `<span style="flex:${n}"></span>`).join("")}</div>
			<div class="groups">${groups.map(([n, label]) => `<span><b>${n}</b> ${label}</span>`).join("")}</div></div>
		<div class="kpi"><h2>Held-out value miss</h2>
			${tests(key => `<strong>${multiple(selected[key].miss)}</strong><small> vs ${multiple(baseline[key].miss)}</small>`)}
			<p>Median miss vs flat TVL ratio</p></div>
		<div class="kpi"><h2>Token-status AUC</h2>
			${tests(key => {
				const test = odds.validation[key];
				return `<strong>${auc(odds.useHazard ? test.hazardAuc : test.auc)}</strong><small> / ${auc(odds.useHazard ? test.auc : test.hazardAuc)}</small>`;
			})}
		<p>${odds.useHazard ? "Daily hazard / logistic" : `Logistic / hazard trial · ${odds.exposure.toFixed(1)}d exposure`}</p></div>
		<div class="kpi coverage"><h2>Watchlist coverage</h2><strong>${counts.watchlistCovered}<small> / ${counts.watchlistTotal}</small></strong>
			<p>TVL floor ${shortUsd(snapshot.floor_usd)}</p></div></section>`;
}

function filter([label, key, options, titles], state) {
	return `<label>${label}<select id="filter-${key}" name="${key}">${options.map(option =>
		`<option value="${esc(option)}"${option === state[key] ? " selected" : ""}>${esc(titles[option] ?? (key === "tvl" ? shortUsd(option) + "+" : option))}</option>`
	).join("")}</select></label>`;
}

function portfolioStrip(state) {
	const { positions, capital, cost, net: gain, unallocated, eligible, budget } = portfolio;
	return `<section class="portfolio">
		<div><h2>${shortUsd(budget)} watchlist portfolio</h2>
		<p>${positions.length} of ${eligible} FARM funded · Shared upkeep</p>
		<p>${unallocated ? usd(unallocated) + " unallocated" : "Minimum tickets + score-weighted surplus"}</p></div>
		<div class="positions">${positions.map(p => `<div>${taggedLink(p, state)}
			<small>${usd(p.capital)} capital</small><small>${money(p.cost)} cost · ${net(p.net)} net</small></div>`).join("")}</div>
		<dl class="totals">${metric("Capital", usd(capital))}${metric("All-in cost", money(cost))}
		${metric("Expected net", net(gain), "", tone(gain))}</dl></section>`;
}

function board(state) {
	return `${heading("Pre-token rankings", "Token values and 12-month farm plans.")}
		${kpis()}
		${state.scope === "watchlist" ? portfolioStrip(state) : ""}
		<div class="board-grid"><section class="panel">
				<div class="section-head"><h2>Ranked protocols</h2><div id="row-count" role="status"></div></div>
				<div class="filters">
					<label>Search<input id="filter-q" name="q" type="search" value="${esc(state.q)}" placeholder="Name or slug" autocomplete="off"></label>
					${filters.map(spec => filter(spec, state)).join("")}
				</div>
				<div id="comparison"></div>
				<div id="results"></div>
			</section>
			<aside class="board-aside">
				<section class="panel yield-panel">
					<h2>Airdrop yield by age</h2><p>12-month net at chosen capital</p>
					<div id="yield-chart"></div>
					<div class="chart-key"><span class="farm-dot">FARM</span><span class="marginal-dot">MARGINAL</span><span class="skip-dot">SKIP</span></div>
				</section>
				<section class="stress-panel"><h2>Farm sensitivity</h2><p>Capital re-sized on the same ladder</p>
				${facts(["Scenario", ...ratings], [
					["Base", ...Object.values(verdicts)], ...scenarios.map(([key, , label]) =>
						[label, ...ratings.map(v => `${stress[key].all[v]} <small>(${stress[key].farm[v]})</small>`)])
					])}<p>All rows. Counts in parentheses start at FARM.</p></section>
			</aside>
		</div>`;
}

function matchingRows(state) {
	const query = state.q.trim().toLowerCase();
	const key = columns[state.sort][1];
	return model.rows.filter(row => (!query || `${row.name} ${row.slug}`.toLowerCase().includes(query))
		&& (state.scope !== "watchlist" || row.watchlist)
		&& (!state.family || row.family === state.family)
		&& (!state.chain || row.chains.includes(state.chain))
		&& (!state.verdict || row.plan.verdict === state.verdict)
		&& row.tvl_usd >= Number(state.tvl)
		&& (!state.flag || Boolean(row.flags.length) === (state.flag === "flagged"))
	).sort((a, b) => {
		const x = key(a), y = key(b);
		if (x == null || y == null) return Number(x == null) - Number(y == null) || a.rank - b.rank;
		const order = typeof x === "string" ? x.localeCompare(y) : x - y;
		return order * (state.dir === "asc" ? 1 : -1) || a.rank - b.rank;
	});
}

function tableRow(row, state) {
	const plan = row.plan;
	const picked = state.compare.includes(row.slug);
	return `<tr data-slug="${esc(row.slug)}" data-value="${row.score}">
		<td class="rank">${row.rank}</td>
		<th scope="row">${taggedLink(row, state)}${row.flags.length ? ' <span title="Issuer flag">!</span>' : ""}
			<small>${esc(row.category || row.family)}${row.watchlist ? ' <span class="watch-label" title="Watchlist" aria-label="Watchlist">◆</span>' : ""}</small></th>
		<td class="value" title="${usd(row.score)}"><b>${shortUsd(row.score)}</b>
			<small>${shortUsd(row.launchValue)} × ${pct(row.s, 1)}${row.haircut !== 1 ? " × " + row.haircut : ""}</small></td>
		<td>${pct(row.s, 1)}</td><td>${shortUsd(row.tvl_usd)}</td>
		<td class="${tone(row.change_7d)}">${change(row.change_7d)}</td>
		<td>${days(row)}</td>
		<td>${badge(plan.verdict)}</td><td class="${tone(plan.net)}">${net(plan.net)}</td>
		<td><input type="checkbox" data-compare="${esc(row.slug)}" id="pick-${row.rank}" aria-label="Compare ${esc(row.name)}"${picked ? " checked" : state.compare.length === 3 ? " disabled" : ""}></td>
	</tr>`;
}

function comparison(state) {
	const picks = state.compare.map(slug => bySlug.get(slug));
	if (!picks.length) return '<p class="compare-hint">Use the Compare column to select 2–3 protocols.</p>';
	const update = (items, label) => `<a class="button" href="${esc(link("board", { ...state, compare: items }))}">${label}</a>`;
	const headers = picks.map(row => taggedLink(row, state) + " " +
		update(state.compare.filter(slug => slug !== row.slug), `<span title="Remove ${esc(row.name)}">×</span>`));
	const metrics = [
		["Implied value", row => shortUsd(row.score)], ["12-month odds (s)", row => pct(row.s)],
		["TVL", row => shortUsd(row.tvl_usd)], ["7d TVL", row => change(row.change_7d)],
		["Days listed", days], ["Verdict", row => badge(row.plan.verdict)],
		["Capital", row => usd(row.plan.capital)], ["Expected net", row => net(row.plan.net)]
	];
	return `<section class="compare-panel"><div class="section-head"><h2>Compare protocols</h2>${update([], "Clear")}</div>
		${picks.length > 1 ? facts(["Metric", ...headers], metrics.map(([label, read]) => [label, ...picks.map(read)]))
			: `<p class="compare-hint">${headers[0]} · Select another protocol.</p>`}</section>`;
}

function drawRankings(state) {
	const rows = matchingRows(state);
	$("#row-count").textContent = `${rows.length} of ${state.scope === "watchlist" ? counts.watchlistCovered : counts.ranked} shown`;
	$("#results").innerHTML = rows.length ? `
		<div class="scroll" tabindex="0" role="region" aria-label="Rankings">
		<table class="rankings"><thead><tr>${Object.entries(columns).map(([key, [label]]) => {
			const active = key === state.sort;
			const dir = active ? state.dir === "asc" ? "desc" : "asc" : columns[key][2];
			const next = esc(link("board", { ...state, sort: key, dir }));
			return `<th scope="col"${active ? ` aria-sort="${state.dir === "asc" ? "ascending" : "descending"}"` : ""}>
				<a id="sort-${key}" href="${next}">${label}${active ? ` <span aria-hidden="true">${state.dir === "asc" ? "↑" : "↓"}</span>` : ""}</a></th>`;
		}).join("")}<th scope="col">Compare</th></tr></thead>
		<tbody>${rows.map(row => tableRow(row, state)).join("")}</tbody></table></div>`
		: '<p class="empty">No protocols match these filters.</p>';
	$("#yield-chart").innerHTML = yieldChart(rows);
	$("#comparison").innerHTML = comparison(state);
}

function yieldChart(rows) {
	const points = rows.filter(row => row.ageDays != null && Number.isFinite(row.plan.expectedYield));
	if (!points.length) return '<p class="chart-note">No matching rows with a listing date.</p>';
	const left = 36, right = 275, top = 10, bottom = 130;
	const maxDays = Math.ceil(Math.max(...points.map(p => p.ageDays)) / 100) * 100;
	const maxYield = Math.max(0.01, Math.ceil(Math.max(...points.map(p => p.plan.expectedYield)) * 100) / 100);
	const minYield = Math.min(0, Math.floor(Math.min(...points.map(p => p.plan.expectedYield)) * 100) / 100);
	const x = days => left + (right - left) * days / maxDays;
	const y = rate => bottom - (bottom - top) * (rate - minYield) / (maxYield - minYield);
	const interval = Math.ceil((maxYield - minYield) * 100 / 6) / 100;
	const ticks = [];
	for (let rate = minYield; rate <= maxYield + 1e-9; rate += interval) ticks.push(rate);
	return `<svg viewBox="0 0 288 170" role="img" aria-label="Days without a recorded token vs expected net airdrop yield">
		${ticks.map(rate => `<path class="gridline" d="M${left},${y(rate)}H${right}"/>
			<text x="${left - 7}" y="${y(rate) + 4}" text-anchor="end">${pct(rate, 0)}</text>`).join("")}
		${[0, maxDays / 3, maxDays * 2 / 3, maxDays].map(days => `<path class="gridline" d="M${x(days)},${top}V${bottom}"/>
			<text x="${x(days)}" y="148" text-anchor="${days === 0 ? "start" : days === maxDays ? "end" : "middle"}">${integer(days)}</text>`).join("")}
		${[...points].reverse().map(row => `<circle class="point-${row.plan.verdict.toLowerCase()}" cx="${x(row.ageDays)}" cy="${y(row.plan.expectedYield)}" r="3.1">
			<title>${esc(row.name)} · ${row.ageDays} days · ${pct(row.plan.expectedYield)}</title></circle>`).join("")}
		<text x="${(left + right) / 2}" y="167" text-anchor="middle">Days without a recorded token</text>
	</svg><p class="chart-note">${points.length} plotted${rows.length > points.length ? ` · ${rows.length - points.length} listing dates missing` : ""}</p>`;
}

const metric = (label, reading, note = "", style = "") =>
	`<div><dt>${label}</dt><dd class="${style}">${reading}</dd>${note ? `<small>${note}</small>` : ""}</div>`;

function facts(headers, rows) {
	return `<div class="scroll" tabindex="0"><table class="facts">
		<thead><tr>${headers.map(title => `<th scope="col">${title}</th>`).join("")}</tr></thead>
		<tbody>${rows.map(([first, ...cells]) => `<tr><th scope="row">${first}</th>${cells.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
		</table></div>`;
}

const inset = (title, content) => `<section class="panel inset"><h2>${title}</h2>${content}</section>`;

function detail(row, state) {
	const back = `<a class="back-link" href="${esc(link("board", state))}">← Back to rankings</a>`;
	if (!row) return back + heading("Protocol unavailable");
	const plan = row.plan;
	const stepLabels = ["Decision", "Eligibility check", "Fund route", "Deposit", "Weekly upkeep", "Exit rule", "Claim & sell"];
	const summary = [esc(row.category || row.family), shortUsd(row.tvl_usd) + " TVL",
		row.ageDays == null ? "Listing date unavailable" : `${days(row)} days listed`, "No token recorded"];
	const label = `<div class="detail-label">Rank ${row.rank} / ${counts.ranked}${row.watchlist ? " · ◆ Watchlist" : ""}</div>`;
	const stressRows = [["Base", plan], ...scenarios.map(([key, label]) => [label, plan.stress[key]])]
		.map(([label, result]) => [label, usd(result.capital), badge(result.verdict), net(result.net)]);
	const oddsEquation = odds.useHazard
		? `s = 1 − exp(−365 × ${row.rate.toPrecision(4)}) = ${pct(row.s)}`
		: `s = 1 − (1 − ${pct(row.observed)})<sup>365 / ${odds.exposure.toFixed(1)}</sup> = ${pct(row.s)}`;
	const range = (low, high) => `${shortUsd(low)}–${shortUsd(high)}`;
	const factors = [[usd(row.launchValue), "Value if launched"], [pct(row.s), "12-month odds"], [row.haircut.toFixed(2), "Issuer factor"]];
	return `${back}${heading(esc(row.name), summary.join(" · "), label)}
		<div class="detail-grid">
			<section class="panel plan-panel">
				<div class="section-head"><div><h2>Farm plan</h2><p>${row.family} on ${esc(plan.chain.name)} · ${plan.handsOnMinutes} min hands-on</p></div>${badge(plan.verdict)}</div>
				<dl class="metrics">
					${metric("Capital", usd(plan.capital))}${metric("Expected drop", money(plan.expectedGross))}
					${metric("All-in cost", money(plan.cost), `${money(plan.timeCost)} time included`)}
					${metric("Expected net", net(plan.net), `${pct(plan.conditionalApr)} net APR if launched`, tone(plan.net))}
				</dl>
				<ol class="plan-steps">${plan.steps.map((step, i) =>
					`<li><h3>${stepLabels[i]}</h3><p>${esc(step)}</p></li>`).join("")}</ol>
			</section>
			<div class="detail-aside">
				<section class="panel valuation">
					<h2>Implied token value</h2>
					<div class="large-value">${usd(row.score)}</div>
					<div class="equation">${factors.map(([n, label]) => `<div><b>${n}</b><small>${label}</small></div>`).join("<span>×</span>")}</div>
					<p class="odds-equation">${oddsEquation} <small>· ${odds.useHazard ? "TVL hazard/day" : "TVL + listing-age status odds"}</small></p>
					<dl class="band">
						${metric("Launch value · p10–p90", range(row.band.low, row.band.high))}
						${metric("Odds-weighted band", range(row.band.weightedLow, row.band.weightedHigh))}
					</dl>
					<p class="flag-note">${row.flags.length ? row.flags.map(esc).join(" · ") + ". Verdict capped at MARGINAL." : "No issuer flags in the snapshot."}</p>
				</section>
				${inset("Stress · re-sized capital", facts(["Scenario", "Capital", "Verdict", "Expected net"], stressRows))}
				${inset("Nearest traded peers", facts(["Protocol", "TVL", "Market cap"], row.peers.map(peer => [
						esc(peer.name), shortUsd(peer.tvl_usd), shortUsd(peer.mcap_usd)
					])))}
			</div>
		</div>`;
}

function calibration() {
	const terms = ["Log carried TVL", ...value.fit.terms].join(" + ");
	return `${heading("Trading-token calibration")}
		<div class="research-grid">
			${inset(counts.valueFit + " unique trading tokens", facts(["Protocol", "Family", "Carried TVL", "Market cap", "Model fit"],
				[...model.calibration].sort((a, b) => b.mcap_usd - a.mcap_usd)
					.map(p => [esc(p.name), p.family, shortUsd(p.carriedTvl), shortUsd(p.mcap_usd), shortUsd(p.launchValue)])))}
			${inset("Held-out term tests", `<p class="section-note">${terms}</p>` +
				facts(["Terms after TVL", "Leave-one-out", "Walk-forward"], [baseline, ...trials].map(trial => [
					(trial.terms?.join(" + ") || (trial === baseline ? "Flat ratio" : "None")) + (trial === selected ? " · selected" : ""),
					multiple(trial.loo.miss), multiple(trial.walk.miss)
				])))}
		</div>`;
}

function audit(state) {
	const peerRange = model.peerRatios.map(multiple).join("–");
	return `${heading("Top-20 audit", "Highest implied values")}
		<section class="panel inset">
			${facts(["Rank", "Protocol", "Token record", "Raw 7d", "Carried 7d", "Growth treatment", "Value / TVL", "Peer range", "Issuer flags"],
				model.audit.map(row => [
					row.rank, taggedLink(row, state), row.recorded ? "Recorded" : "None recorded",
					change(row.change_7d), change(row.growth),
					row.change_7d == null ? "Imputed" : row.change_7d !== row.growth ? "<b>Clipped</b>" : "As reported",
					multiple(row.ratio), peerRange + (row.outlier ? " · outlier" : ""),
					row.flags.length ? row.flags.map(esc).join(" · ") : "—"
				]))}
		<p class="section-note">Ratios use carried TVL.</p>
		</section>`;
}

function assumptionsDrawer() {
	const labels = { year: "Plan days", growthClip: "Growth clip (%)", missingGrowth: "Missing growth (%)",
		hourlyUsd: "Hands-on time (USD/hour)", haircut: "Flagged issuer factor", capitalLadder: "Capital ladder (USD)" };
	const label = key => labels[key] || key.replace(/[A-Z]/g, c => " " + c.toLowerCase()).replace(/^./, c => c.toUpperCase());
	const display = value => (Array.isArray(value) ? value : [value]).map(n => typeof n === "number" && Number.isInteger(n)
		? integer(n) : esc(n)).join(" · ");
	const { parameters, chainQuotes, fallbackChain, mechanisms, families, notes } = assumptions;
	const blocks = [
		["Parameters", ["Parameter", "Value"], Object.entries(parameters).map(([k, v]) => [label(k), display(v)])],
		["Chain quotes", ["Chain", "Gas / action", "Funding trip", "Elapsed"],
			[...Object.entries(chainQuotes), ["Other chains", fallbackChain]].map(([chain, [gas, fund, min]]) =>
				[chain, money(gas), money(fund), min + " min"])],
		["Mechanisms", ["Family", "Actions", "Fees", "Enter", "Deposit"], Object.entries(mechanisms)
			.map(([family, [actions, bps, min, action]]) => [family, actions, bps + " bps", min + " min", action])],
		["Category families", ["Family", "Categories"], Object.entries(families).map(([f, cats]) => [f, cats.join(", ")])]
	];
	return `<div class="drawer"><ul>${notes.map(note => `<li>${esc(note)}</li>`).join("")}</ul>
		${blocks.map(([title, headers, rows]) => `<h3>${title}</h3>` + facts(headers, rows)).join("")}</div>`;
}

let activeRoute;

function render() {
	const state = readRoute();
	const activeId = document.activeElement?.id;
	const { route, slug } = state;
	const row = route === "detail" ? model.rows.find(p => encodeURIComponent(p.slug) === slug) : null;
	renderNavigation(state);
	document.title = `${row?.name ?? routes[route]} · Launch Radar`;
	view.innerHTML = route === "detail" ? detail(row, state) : route === "audit" ? audit(state)
		: route === "calibration" ? calibration() : board(state);
	if (route === "board") drawRankings(state);
	if (activeId) document.getElementById(activeId)?.focus();
	if (activeRoute !== route) window.scrollTo(0, 0);
	activeRoute = route;
}

$("#source").textContent = `Board digest ${boardDigest}`;
$("#checks").textContent = `${passed}/${checks.length} self-checks pass`;
$("#checks").dataset.pass = String(passed === checks.length);
$("#checks").title = checks.map(check => `${check.name}: ${check.pass ? "pass" : "fail"}`).join("\n");
$("#assumption-content").innerHTML = assumptionsDrawer();
$("#open-assumptions").addEventListener("click", () => $("#assumptions").showModal());

function updateBoard(state) {
	history.replaceState(null, "", link("board", state));
	renderNavigation(state);
	drawRankings(state);
}

view.addEventListener("input", ({ target }) => {
	if (target.id === "filter-q") updateBoard({ ...readRoute(), q: target.value });
});

function renderNavigation(state) {
	$("#home-link").href = link("board", state);
	document.querySelectorAll("#nav a").forEach(a => {
		a.href = link(a.dataset.route, state);
		if (a.dataset.route === (state.route === "detail" ? "board" : state.route)) a.setAttribute("aria-current", "page");
		else a.removeAttribute("aria-current");
	});
}

view.addEventListener("change", ({ target }) => {
	const { compare: slug } = target.dataset;
	const state = readRoute();
	if (slug) {
		state.compare = target.checked ? [...state.compare, slug].slice(0, 3) : state.compare.filter(p => p !== slug);
		const scroll = $("#results .scroll").scrollTop;
		updateBoard(state);
		$("#results .scroll").scrollTop = scroll;
		$("#" + target.id)?.focus({ preventScroll: true });
	} else if (target.matches(".filters select")) {
		location.hash = link("board", { ...state, [target.name]: target.value });
	}
});
window.addEventListener("hashchange", render);
render();
