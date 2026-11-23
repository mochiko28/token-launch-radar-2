"use strict";

const api = globalThis.LaunchRadar;
const { snapshot, boardDigest } = globalThis.LaunchRadarData;
const model = api.buildModel(snapshot);
const $ = selector => document.querySelector(selector);
const view = $("#view");
const checks = api.selfChecks(model, snapshot, boardDigest);
const passed = checks.filter(check => check.pass).length;
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usd = n => "$" + integer.format(n);
const shortUsd = n => "$" + compact.format(n);
const money = n => currency.format(n);
const pct = (n, places = 2) => (n * 100).toFixed(places) + "%";
const multiple = n => n == null ? "—" : n.toFixed(2) + "×";
const auc = n => n == null ? "—" : n.toFixed(3);
const sign = n => n > 0 ? "+" : "";
const change = n => n == null ? "—" : sign(n) + n.toFixed(2) + "%";
const net = n => sign(n) + money(n);
const tone = n => n > 0 ? "positive" : n < 0 ? "negative" : "";
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[c]);

const { counts, verdicts, stress, portfolio, value, odds, assumptions } = model;
const { baseline, selected, trials } = value.validation;
const families = [...new Set(model.rows.map(row => row.family))].sort();
const chains = [...new Set(model.rows.flatMap(row => row.chains))].sort();
const verdictOrder = { FARM: 0, MARGINAL: 1, SKIP: 2 };
const scenarios = [["doubleCost", "2× all-in cost"], ["halfShare", "½ depositor share"]];
const columns = {
  rank: ["Rank", row => row.rank, "asc"], name: ["Protocol", row => row.name, "asc"],
  value: ["Implied value", row => row.implied_value_usd, "desc"], odds: ["12m odds", row => row.s, "desc"],
  tvl: ["TVL", row => row.tvl_usd, "desc"], growth: ["7d TVL", row => row.change_7d, "desc"],
  days: ["Days listed", row => row.ageDays, "desc"], verdict: ["Verdict", row => verdictOrder[row.plan.verdict], "asc"],
  net: ["Expected net", row => row.plan.net, "desc"]
};
const defaults = { q: "", scope: "all", family: "", chain: "", verdict: "", sort: "rank" };
const routes = { board: "Rankings", calibration: "Calibration", audit: "Top-20 audit", detail: "Protocol" };

function readRoute() {
  const [path, query] = location.hash.slice(1).split("?");
  const [route, slug] = path.split("/");
  const params = new URLSearchParams(query);
  const get = (key, options) => options.includes(params.get(key)) ? params.get(key) : defaults[key];
  const sort = get("sort", Object.keys(columns));
  const dir = params.get("dir");
  return {
    route: Object.hasOwn(routes, route) ? route : "board", slug,
    q: params.get("q") || "", scope: get("scope", ["all", "watchlist"]),
    family: get("family", families), chain: get("chain", chains), verdict: get("verdict", Object.keys(verdictOrder)),
    sort, dir: ["asc", "desc"].includes(dir) ? dir : columns[sort][2]
  };
}

function link(route, state, slug = "") {
  const params = new URLSearchParams();
  for (const [key, normal] of Object.entries(defaults)) {
    if (state[key] !== normal) params.set(key, state[key]);
  }
  if (state.dir !== columns[state.sort][2]) params.set("dir", state.dir);
  return `#${slug ? route + "/" + slug : route}${params.size ? "?" + params : ""}`;
}

const badge = verdict => `<span class="badge ${verdict.toLowerCase()}">${verdict}</span>`;
const detailLink = (row, state) => escape(link("detail", state, encodeURIComponent(row.slug)));
const taggedLink = (row, state) => `<a class="protocol-link" href="${detailLink(row, state)}">${escape(row.name)}</a>`;

const heading = (title, description, label = "") => `<div class="page-heading"><div>${label}<h1>${title}</h1><p>${description}</p></div>
  <div class="snapshot">DefiLlama snapshot<time>${escape(snapshot.as_of)} UTC</time></div></div>`;

function kpis() {
  const groups = [[counts.ranked, "ranked"], [counts.traded, "traded"], [counts.setAside, "set aside"]];
  const tests = get => `<div class="kpi-readings">${["loo", "walk"].map((key, i) =>
    `<div>${get(key)}<span>${i ? "Walk-forward" : "Leave-one-out"}</span></div>`).join("")}</div>`;
  return `<section class="kpis" aria-label="Snapshot and model validation">
    <div class="kpi"><h2>Snapshot universe</h2><strong>${counts.total}</strong>
      <div class="universe-bar" aria-hidden="true">${groups.map(([n]) => `<span style="flex:${n}"></span>`).join("")}</div>
      <div class="universe-key">${groups.map(([n, label]) => `<span><b>${n}</b> ${label}</span>`).join("")}</div></div>
    <div class="kpi"><h2>Held-out value miss</h2>
      ${tests(key => `<strong>${multiple(selected[key].miss)}</strong><small> vs ${multiple(baseline[key].miss)}</small>`)}
      <p>Median error factor vs flat TVL ratio</p></div>
    <div class="kpi"><h2>Token-status AUC</h2>${tests(key => `<strong>${auc(odds.validation[key].auc)}</strong>`)}
      <p>Held-out discrimination on recorded status</p></div>
    <div class="kpi coverage"><h2>Watchlist coverage</h2><strong>${counts.watchlistCovered}<small> / ${counts.watchlistTotal}</small></strong>
      <p>TVL floor ${shortUsd(snapshot.floor_usd)}</p></div></section>`;
}

function selectFilter(label, key, options, current, titles = {}) {
  return `<label>${label}<select id="filter-${key}" name="${key}">${options.map(option =>
    `<option value="${escape(option)}"${option === current ? " selected" : ""}>${escape(titles[option] ?? option)}</option>`
  ).join("")}</select></label>`;
}

function portfolioStrip(state) {
  const { positions, capital, cost, net: gain, unallocated, eligible, budget } = portfolio;
  return `<section class="portfolio">
    <div><h2>${shortUsd(budget)} watchlist portfolio</h2>
    <p>${positions.length} funded / ${eligible} FARM · Score-weighted</p></div>
    <div>${positions.map(p => `<div>${taggedLink(p, state)} · ${usd(p.capital)}</div>`).join("")}
    ${unallocated ? `<small>${usd(unallocated)} unallocated</small>` : ""}</div>
    <dl class="portfolio-metrics">${metric("Capital", usd(capital))}${metric("All-in cost", money(cost))}
    ${metric("Expected net", net(gain), "", tone(gain))}</dl></section>`;
}

function board(state) {
  return `${heading("Pre-token rankings", "Probability-weighted token values and 12-month farm plans.")}
    ${kpis()}
    ${state.scope === "watchlist" ? portfolioStrip(state) : ""}
    <div class="board-grid">
      <section class="panel">
        <div class="section-head"><h2>Ranked protocols</h2><div id="row-count" role="status"></div></div>
        <div class="filters">
          <label>Search<input id="filter-q" name="q" type="search" value="${escape(state.q)}" placeholder="Name or slug" autocomplete="off"></label>
          ${selectFilter("Scope", "scope", ["all", "watchlist"], state.scope, { all: "All ranked", watchlist: "Watchlist" })}
          ${selectFilter("Family", "family", ["", ...families], state.family, { "": "All families" })}
          ${selectFilter("Verdict", "verdict", ["", ...Object.keys(verdictOrder)], state.verdict, { "": "All verdicts" })}
          ${selectFilter("Chain", "chain", ["", ...chains], state.chain, { "": "All chains" })}
        </div>
        <div id="ranking-results"></div>
      </section>
      <aside class="board-aside">
        <section class="panel yield-panel">
          <h2>Airdrop yield by age</h2><p>12-month net at the selected capital</p>
          <div id="yield-chart"></div>
          <div class="chart-key"><span class="farm-dot">FARM</span><span class="marginal-dot">MARGINAL</span><span class="skip-dot">SKIP</span></div>
        </section>
        <section class="stress-panel">
          <h2>Farm sensitivity</h2>
          <p>All ${counts.ranked} ranked protocols</p>
          <dl class="verdict-counts">${Object.entries(verdicts).map(([label, count]) =>
            `<div><dt>${label}</dt><dd>${count}</dd></div>`).join("")}</dl>
          <div class="stress-counts">${scenarios.map(([key, text]) => `<div>${text}<b>${stress[key]} lose FARM</b></div>`).join("")}</div>
          <p>Stress holds capital fixed.</p>
        </section>
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
  ).sort((a, b) => {
    const x = key(a), y = key(b);
    if (x == null || y == null) return Number(x == null) - Number(y == null) || a.rank - b.rank;
    const order = typeof x === "string" ? x.localeCompare(y) : x - y;
    return order * (state.dir === "asc" ? 1 : -1) || a.rank - b.rank;
  });
}

function tableRow(row, state) {
  const plan = row.plan;
  return `<tr data-slug="${escape(row.slug)}" data-value="${row.implied_value_usd}">
    <td class="rank">${row.rank}</td>
    <th scope="row">${taggedLink(row, state)}${row.flags.length ? ' <span title="Flagged issuer">!</span>' : ""}
      <small>${escape(row.category || row.family)}${row.watchlist ? ' <span class="watch-label" title="Watchlist" aria-label="Watchlist">◆</span>' : ""}</small></th>
    <td class="value" title="${usd(row.implied_value_usd)}"><b>${shortUsd(row.implied_value_usd)}</b>
      <small>${shortUsd(row.valueIfLaunched)} × ${pct(row.s, 1)}${row.haircut !== 1 ? " × " + row.haircut : ""}</small></td>
    <td>${pct(row.s, 1)}</td><td>${shortUsd(row.tvl_usd)}</td>
    <td class="${tone(row.change_7d)}">${change(row.change_7d)}</td>
    <td>${row.ageDays == null ? "—" : integer.format(row.ageDays)}</td>
    <td>${badge(plan.verdict)}</td><td class="${tone(plan.net)}">${net(plan.net)}</td>
  </tr>`;
}

function drawRankings(state) {
  const rows = matchingRows(state);
  $("#row-count").textContent = `${rows.length} of ${state.scope === "watchlist" ? counts.watchlistCovered : counts.ranked} shown`;
  $("#ranking-results").innerHTML = rows.length ? `
    <div class="table-scroll" tabindex="0" role="region" aria-label="Ranked protocols table">
    <table class="rankings"><thead><tr>${Object.entries(columns).map(([key, [label]]) => {
      const active = key === state.sort;
      const dir = active ? state.dir === "asc" ? "desc" : "asc" : columns[key][2];
      const next = escape(link("board", { ...state, sort: key, dir }));
      return `<th scope="col"${active ? ` aria-sort="${state.dir === "asc" ? "ascending" : "descending"}"` : ""}>
        <a id="sort-${key}" href="${next}">${label}${active ? ` <span aria-hidden="true">${state.dir === "asc" ? "↑" : "↓"}</span>` : ""}</a></th>`;
    }).join("")}</tr></thead>
    <tbody>${rows.map(row => tableRow(row, state)).join("")}</tbody></table></div>`
    : '<p class="empty">No protocols match these filters.</p>';
  $("#yield-chart").innerHTML = yieldChart(rows);
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
      <text x="${x(days)}" y="148" text-anchor="${days === 0 ? "start" : days === maxDays ? "end" : "middle"}">${integer.format(days)}</text>`).join("")}
    ${[...points].reverse().map(row => `<circle class="point-${row.plan.verdict.toLowerCase()}" cx="${x(row.ageDays)}" cy="${y(row.plan.expectedYield)}" r="3.1">
      <title>${escape(row.name)} · ${row.ageDays} days · ${pct(row.plan.expectedYield)}</title></circle>`).join("")}
    <text x="${(left + right) / 2}" y="167" text-anchor="middle">Days without a recorded token</text>
  </svg><p class="chart-note">${points.length} plotted${rows.length > points.length ? ` · ${rows.length - points.length} listing dates missing` : ""}</p>`;
}

const metric = (label, reading, note = "", style = "") =>
  `<div><dt>${label}</dt><dd class="${style}">${reading}</dd>${note ? `<small>${note}</small>` : ""}</div>`;

function factsTable(headers, rows) {
  return `<div class="table-scroll" tabindex="0"><table class="facts">
    <thead><tr>${headers.map(title => `<th scope="col">${title}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(([first, ...cells]) => `<tr><th scope="row">${first}</th>${cells.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
}

const inset = (title, content) => `<section class="panel inset-panel"><h2>${title}</h2>${content}</section>`;

function detail(row, state) {
  const back = `<a class="back-link" href="${escape(link("board", state))}">← Back to rankings</a>`;
  if (!row) return back + heading("Protocol unavailable", "This slug is outside the ranked snapshot.");
  const plan = row.plan;
  const stepLabels = ["Decision", "Fund route", "Time budget", "Deposit", "Weekly upkeep", "Exit rule", "Claim & sell"];
  const facts = [escape(row.category || row.family), shortUsd(row.tvl_usd) + " TVL",
    row.ageDays == null ? "Listing date unavailable" : `${integer.format(row.ageDays)} days listed`, "No token recorded"];
  const label = `<div class="detail-label">Rank ${row.rank} / ${counts.ranked}${row.watchlist ? " · ◆ Watchlist" : ""}</div>`;
  const stressRows = scenarios.map(([key, label]) => {
    const result = plan.stress[key];
    return [label, badge(result.verdict), net(result.net), result.flip ? "Yes" : "—"];
  });
  const range = (low, high) => `${shortUsd(low)}–${shortUsd(high)}`;
  const factors = [[usd(row.valueIfLaunched), "Value if launched"], [pct(row.s), "12-month odds"], [row.haircut.toFixed(2), "Issuer factor"]];
  return `${back}${heading(escape(row.name), facts.join(" · "), label)}
    <div class="detail-grid">
      <section class="panel plan-panel">
        <div class="section-head"><div><h2>Farm plan</h2><p>${escape(plan.mechanism)} on ${escape(plan.chain.name)} · ${plan.handsOnMinutes} min hands-on</p></div>${badge(plan.verdict)}</div>
        <dl class="detail-metrics">
          ${metric("Capital", usd(plan.capital))}${metric("Expected drop", money(plan.expectedGross))}
          ${metric("All-in cost", money(plan.cost), `${money(plan.timeCost)} time included`)}
          ${metric("Expected net", net(plan.net), `${pct(plan.conditionalApr)} net APR if launched`, tone(plan.net))}
        </dl>
        <ol class="plan-steps">${plan.steps.map((step, i) =>
          `<li><div><h3>${stepLabels[i] ?? "Step"}</h3><p>${escape(step)}</p></div></li>`).join("")}</ol>
      </section>
      <div class="detail-aside">
        <section class="panel valuation">
          <h2>Implied token value</h2>
          <div class="large-value">${usd(row.implied_value_usd)}</div>
          <div class="equation">${factors.map(([n, label]) => `<div><b>${n}</b><small>${label}</small></div>`).join("<span>×</span>")}</div>
          <dl class="band">
            ${metric("Launch value · p10–p90", range(row.band.low, row.band.high))}
            ${metric("Odds-weighted band", range(row.band.weightedLow, row.band.weightedHigh))}
          </dl>
          <p class="flag-note">${row.flags.length ? row.flags.map(escape).join(" · ") + ". Verdict capped at MARGINAL." : "No issuer flags in the snapshot."}</p>
        </section>
        ${inset("Nearest traded peers", factsTable(["Protocol", "TVL", "Market cap"], row.peers.map(peer => [
            escape(peer.name), shortUsd(peer.tvl_usd), shortUsd(peer.mcap_usd)
          ])))}
        ${inset("Stress at " + usd(plan.capital), factsTable(["Scenario", "Verdict", "Expected net", "Loses FARM"], stressRows))}
      </div>
    </div>`;
}

function calibration() {
  const chosen = value.fit.terms;
  return `${heading("Trading-token calibration", "Fitted launch values beside observed market caps.")}
    <div class="research-grid">
      <section class="panel inset-panel"><h2>${counts.valueFit} unique trading tokens</h2>
        ${factsTable(["Protocol", "Family", "Carried TVL", "Market cap", "Model fit"], [...model.calibration]
          .sort((a, b) => b.mcap_usd - a.mcap_usd)
          .map(p => [escape(p.name), p.family, shortUsd(p.carriedTvl), shortUsd(p.mcap_usd), shortUsd(p.valueIfLaunched)]))}
      </section>
      <section class="panel inset-panel"><h2>Held-out term tests</h2><p class="section-note">Log carried TVL${chosen.length ? " + " + chosen.join(" + ") : ""}</p>
        ${factsTable(["Terms after TVL", "Leave-one-out", "Walk-forward"], [
          ["Flat ratio", multiple(baseline.loo.miss), multiple(baseline.walk.miss)],
          ...trials.map(trial => [
            `${trial.terms.length ? trial.terms.join(" + ") : "None"}${trial === selected ? " · selected" : ""}`,
            multiple(trial.loo.miss), multiple(trial.walk.miss)
          ])
        ])}
      </section>
    </div>`;
}

function audit(state) {
  return `${heading("Top-20 audit", "Token records, growth clipping and valuation outliers for the highest implied values.")}
    <section class="panel inset-panel">
      ${factsTable(["Rank", "Protocol", "Token record", "Raw 7d", "Carried 7d", "Growth treatment", "Value / TVL", "Peer range", "Issuer flags"],
        model.audit.map(row => [
          row.rank, taggedLink(row, state), row.tokenRecorded ? "Recorded" : "None recorded",
          change(row.rawGrowth), change(row.carriedGrowth),
          row.growthClipped ? "<strong>Clipped</strong>" : row.rawGrowth == null ? "Imputed" : "As reported",
          multiple(row.valuationRatio), `${multiple(row.lowerRatio)}–${multiple(row.upperRatio)}${row.valuationOutlier ? " · outlier" : ""}`,
          row.flags.length ? row.flags.map(escape).join(" · ") : "—"
        ]))}
      <p class="section-note">Peer range uses traded cap / carried TVL. Audit uses launch value / carried TVL.</p>
    </section>`;
}

function assumptionsDrawer() {
  const labels = { year: "Plan days", growthClip: "Growth clip (%)", missingGrowth: "Missing growth (%)",
    hourlyUsd: "Hands-on time (USD/hour)", haircut: "Flagged issuer factor", capitalLadder: "Capital ladder (USD)" };
  const label = key => labels[key] || key.replace(/[A-Z]/g, c => " " + c.toLowerCase()).replace(/^./, c => c.toUpperCase());
  const display = value => (Array.isArray(value) ? value : [value]).map(n => typeof n === "number" && Number.isInteger(n)
    ? integer.format(n) : escape(n)).join(" · ");
  return `<div class="drawer-body">
    <ul>${assumptions.notes.map(note => `<li>${escape(note)}</li>`).join("")}</ul>
    <h3>Parameters</h3>
    ${factsTable(["Parameter", "Value"], Object.entries(assumptions.parameters).map(([key, value]) =>
      [label(key), display(value)]))}
    <h3>Chain quotes</h3>
    ${factsTable(["Chain", "Gas / action", "Funding trip", "Elapsed"], [
      ...Object.entries(assumptions.chainQuotes), ["Other chains", assumptions.fallbackChain]
    ].map(([chain, [gas, funding, minutes]]) => [chain, money(gas), money(funding), `${minutes} min`]))}
    <h3>Mechanism assumptions</h3>
    ${factsTable(["Family", "Actions", "Fees", "Enter", "Deposit"], Object.entries(assumptions.mechanisms)
      .map(([family, [actions, bps, minutes, action]]) => [family, actions, `${bps} bps`, `${minutes} min`, action]))}
    <h3>Category families</h3>
    ${factsTable(["Family", "Categories"], Object.entries(assumptions.families)
      .map(([family, categories]) => [family, categories.join(", ")]))}
  </div>`;
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
  if (activeId) document.getElementById(activeId)?.focus({ preventScroll: true });
  if (activeRoute !== route) window.scrollTo(0, 0);
  activeRoute = route;
}

$("#source").textContent = `Board digest ${boardDigest}`;
$("#checks").textContent = `${passed}/${checks.length} self-checks pass`;
$("#checks").dataset.pass = String(passed === checks.length);
$("#checks").title = checks.map(check => `${check.name}: ${check.pass ? "pass" : "fail"}`).join("\n");
$("#assumption-content").innerHTML = assumptionsDrawer();
$("#open-assumptions").addEventListener("click", () => $("#assumptions").showModal());

view.addEventListener("input", event => {
  if (event.target.id !== "filter-q") return;
  const state = { ...readRoute(), q: event.target.value };
  history.replaceState(null, "", link("board", state));
  renderNavigation(state);
  drawRankings(state);
});

function renderNavigation(state) {
  $("#home-link").href = link("board", state);
  document.querySelectorAll("#nav a").forEach(a => {
    a.href = link(a.dataset.route, state);
    if (a.dataset.route === (state.route === "detail" ? "board" : state.route)) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

view.addEventListener("change", event => {
  if (event.target.matches(".filters select")) {
    location.hash = link("board", { ...readRoute(), [event.target.name]: event.target.value });
  }
});
window.addEventListener("hashchange", render);
render();
