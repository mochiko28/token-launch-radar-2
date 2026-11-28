import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import api from "../dashboard/model.js";

const width = 1440;
const height = 980;
const boardHeight = 1120;
const detailHeight = 1440;
const minimum = 300_000;
const maximum = 320_000;
const targetSize = 305_000;

async function freePort() {
  const server = createServer();
  await new Promise((ready, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", ready);
  });
  const { port } = server.address();
  await new Promise(ready => server.close(ready));
  return port;
}

async function connect(port, browser) {
  const url = `ws://127.0.0.1:${port}/session`;
  for (let attempt = 0; attempt < 80 && browser.exitCode === null; attempt++) {
    try {
      return await new Promise((ready, reject) => {
        const socket = new WebSocket(url);
        socket.addEventListener("open", () => ready(socket), { once: true });
        socket.addEventListener("error", () => reject(new Error("Firefox socket not ready")), { once: true });
      });
    } catch {
      await delay(125);
    }
  }
  throw new Error("Firefox did not open the WebDriver BiDi socket.");
}

function bidi(socket) {
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.method === "log.entryAdded") {
      const entry = message.params;
      if (entry.level === "error" || entry.type === "javascript") errors.push(entry.text);
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.type === "error") request.reject(new Error(`${request.method}: ${message.error} · ${message.message}`));
    else request.ready(message.result);
  });
  return {
    errors,
    call(method, params) {
      return new Promise((ready, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out during ${method}`));
        }, 20_000);
        pending.set(id, { ready, reject, timer, method });
        socket.send(JSON.stringify({ id, method, params }));
      });
    }
  };
}

function jpegSize(bytes) {
  if (bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) {
    throw new Error("Capture is not a whole JPEG.");
  }
  for (let offset = 2; offset + 8 < bytes.length;) {
    const marker = bytes.readUInt16BE(offset);
    if (marker === 0xffc0 || marker === 0xffc2) {
      return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
    }
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  throw new Error("Could not find JPEG dimensions.");
}

const fits = bytes => bytes.length >= minimum && bytes.length < maximum;
const sizeMiss = bytes => Math.abs(bytes.length - targetSize);
const displaySigns = text => text.replace(/(^|[\s$(,])-(?=\$?\d)/g, "$1−");
const displayStep = text => displaySigns(text).replaceAll(/ p10\)(?= two weeks)/g, ", bottom 10% cutoff)")
  .replaceAll(" + carry ", " + capital cost ");

function provesValue(line, score, displayed, clipped) {
  const marks = line.match(/ \(clipped\)/g)?.length ?? 0;
  if (clipped ? marks !== 1 || !/ × growth [\d.e+-]+ \(clipped\) × /.test(line) : marks) return false;
  line = line.replace(" (clipped)", "");
  const [product, result] = line.split(" = ");
  const [base, scale, ...factors] = product.split(" × ");
  const [, tvl, reference, exponent] = /^\((.+)M\/(.+)M\)\^(.+)$/.exec(scale) ?? [];
  const initial = Number(base.slice(1, -1)) * 1e6 * (Number(tvl) / Number(reference)) ** Number(exponent);
  const total = factors.reduce((value, factor) => value * Number(factor.split(" ").at(-1)), initial);
  return Math.max(1, Math.round(total)) === score && result === displayed;
}

async function captureJpeg(call, context, work) {
  const capture = async format => {
    const { data } = await call("browsingContext.captureScreenshot", { context, origin: "viewport", format });
    return Buffer.from(data, "base64");
  };
  const candidates = [];
  let best;
  try {
    let low = 1;
    let high = 1000;
    while (low <= high) {
      const quality = Math.ceil((low + high) / 2);
      const bytes = await capture({ type: "image/jpeg", quality: quality / 1000 });
      if (bytes.readUInt16BE(0) !== 0xffd8) break;
      if (fits(bytes) && (!best || sizeMiss(bytes) < sizeMiss(best.bytes))) {
        best = { bytes, encoder: `BiDi quality ${quality / 1000}` };
      }
      candidates.push(`BiDi ${quality}: ${bytes.length}`);
      if (bytes.length < targetSize) low = quality + 1;
      else high = quality - 1;
    }
  } catch (error) {
    candidates.push(error.message);
  }

  if (best) return best;
  const png = join(work, "bidi.png");
  writeFileSync(png, await capture({ type: "image/png" }));
  return encodeJpeg(png, work, candidates);
}

function encodeJpeg(png, work, candidates = []) {
  const jpeg = join(work, "candidate.jpg");
  let best;
  const consider = (bytes, encoder) => {
    if (fits(bytes) && (!best || sizeMiss(bytes) < sizeMiss(best.bytes))) best = { bytes, encoder };
    return best && sizeMiss(best.bytes) <= 3000;
  };
  for (const mode of [[], ["-optimize"]]) {
    let low = 1;
    let high = 100;
    while (low <= high) {
      const quality = Math.ceil((low + high) / 2);
      const result = spawnSync("/usr/bin/cjpeg", [
        "-quality", String(quality), "-sample", "1x1", ...mode, png
      ], { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
      if (result.error?.code === "ENOENT") break;
      if (result.status !== 0) throw new Error(String(result.error || result.stderr));
      const bytes = result.stdout;
      const encoder = `cjpeg quality ${quality}${mode.length ? " optimized" : ""}`;
      if (consider(bytes, encoder)) return best;
      candidates.push(`${encoder}: ${bytes.length}`);
      if (bytes.length < targetSize) low = quality + 1;
      else high = quality - 1;
    }
  }
  for (const [format, huffman] of [
    ["yuvj444p", "optimal"], ["yuvj444p", "default"], ["yuvj422p", "default"], ["yuvj420p", "default"]
  ]) {
    for (const quality of [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 7, 10]) {
      const ffmpeg = spawnSync("/usr/bin/ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y", "-i", png, "-frames:v", "1",
        "-c:v", "mjpeg", "-pix_fmt", format, "-huffman", huffman, "-qmin", "1",
        "-q:v", String(quality), "-update", "1", jpeg
      ], { timeout: 10_000 });
      if (ffmpeg.status !== 0) throw new Error(String(ffmpeg.error || ffmpeg.stderr));
      const bytes = readFileSync(jpeg);
      if (consider(bytes, `ffmpeg -q:v ${quality} ${format} (${huffman} Huffman)`)) return best;
      candidates.push(`${format}/${huffman} q${quality}: ${bytes.length}`);
      if (bytes.length < minimum) break;
    }
  }
  if (best) return best;
  throw new Error(`No JPEG met the byte budget. ${candidates.join(", ")}`);
}

const shots = [
  { name: "1-board.jpg", hash: "#board", viewHeight: boardHeight },
  { name: "2-detail.jpg", hash: "#detail/upshift", viewHeight: detailHeight },
  { name: "3-filtered.jpg", hash: "#board?chain=Ethereum&verdict=MARGINAL", viewHeight: boardHeight }
];
const pages = [...shots,
  { name: "mezzanine", hash: "#detail/mezzanine", viewHeight: detailHeight, probeOnly: true },
  { name: "alphagrowth", hash: "#detail/alphagrowth", viewHeight: detailHeight, probeOnly: true },
  { name: "liquid-collective", hash: "#detail/liquid-collective", viewHeight: detailHeight, probeOnly: true },
  { name: "calibration", hash: "#calibration", probeOnly: true },
  { name: "ethereum", hash: "#board?chain=Ethereum", probeOnly: true },
  { name: "net-desc", hash: "#board?sort=net", probeOnly: true },
  { name: "net-asc", hash: "#board?sort=net&dir=asc", probeOnly: true },
  { name: "watchlist-skip", hash: "#board?scope=watchlist&verdict=SKIP", probeOnly: true },
  { name: "empty-board", hash: "#board?q=__no_protocol__", probeOnly: true },
  ...["", "traded", "setAside", "recorded", "ranked"].map(group => ({
    name: "tokens-" + group, hash: "#tokens" + (group ? "/" + group : ""), probeOnly: true
  }))
];

function readPage() {
  const read = selector => document.querySelector(selector)?.textContent.trim();
  const picked = () => [...document.querySelectorAll("#compare input")];
  while (picked().length) picked()[0].click();
  let comparePass;
  if (location.hash === "#board") {
    const inputs = [...document.querySelectorAll("#results input[name=compare]")];
    inputs.slice(0, 4).forEach(input => input.click());
    comparePass = read("#compare-count") === "Compare 3/3" && picked().map(input => input.value).join() === "1,2,3"
      && inputs[3].disabled && !inputs[3].checked;
    const comparedNets = [...document.querySelectorAll("#compare tr:nth-child(4) td")];
    comparePass &&= comparedNets.length === 3 && comparedNets.every((cell, i) => cell.innerText === inputs[i].closest("tr").lastElementChild.innerText);
    const search = document.querySelector("#search");
    const searchFor = value => {
      search.value = value;
      search.dispatchEvent(new Event("input", { bubbles: true }));
    };
    searchFor("__no_protocol__");
    comparePass &&= picked().length === 3 && !document.querySelector("#results input");
    searchFor("");
    picked().at(-1).click();
    comparePass &&= read("#compare-count") === "Compare 2/3"
      && !document.querySelector('#results input[value="3"]').checked && !document.querySelector('#results input[value="4"]').disabled;
    document.querySelectorAll("#results input:checked").forEach(input => input.click());
    comparePass &&= read("#compare-count") === "Compare 0/3" && !picked().length;
  }
  if (location.hash === "#board?chain=Ethereum&verdict=MARGINAL") {
    [...document.querySelectorAll("#results input")].slice(0, 2).forEach(input => input.click());
  }
  const rows = [...document.querySelectorAll("tr[data-slug]")];
  const tableBottom = document.querySelector("#results .scroll")?.getBoundingClientRect().bottom;
  const rangesInline = rows.every(row => {
    const value = row.cells[2].querySelector("b")?.getBoundingClientRect();
    const range = row.cells[2].querySelector(".range")?.getBoundingClientRect();
    return value && range && range.left >= value.right && range.top >= value.top && range.bottom <= value.bottom;
  });
  const equationOverflow = rows.flatMap(row => {
    const cell = row.cells[2];
    const value = cell.querySelector("b").getBoundingClientRect();
    const line = cell.querySelector(".equation");
    const box = line.getBoundingClientRect(), bounds = row.getBoundingClientRect();
    const fontSize = parseFloat(getComputedStyle(line).fontSize);
    return box.top >= value.bottom && box.bottom <= bounds.bottom && box.right <= bounds.right && fontSize >= 11.25
      ? [] : [{ slug: row.dataset.slug, gap: box.top - value.bottom, right: bounds.right - box.right,
        bottom: bounds.bottom - box.bottom, left: box.left - bounds.left, width: box.width,
        row: bounds.width, height: bounds.height, fontSize }];
  }).slice(0, 3);
  const completeRows = rows.filter(row => {
    const box = row.getBoundingClientRect();
    return box.top >= 0 && box.bottom <= Math.min(tableBottom, innerHeight);
  }).length;
  const watchlist = new Set(globalThis.LaunchRadarData.snapshot.watchlist);
  const visible = selector => {
    const box = document.querySelector(selector)?.getBoundingClientRect();
    return Boolean(box && box.height && box.top >= 0 && box.bottom <= innerHeight && box.right <= innerWidth);
  };
  const form = document.querySelector("#quote");
  const graph = document.querySelector(".age");
  const drop = document.querySelector(".drop");
  const decision = () => [...document.querySelectorAll(".decision p")].map(p => p.textContent.trim());
  const halfOdds = () => read(".half-q");
  let quotePass, defaultHalfOdds;
  const quotes = [];
  if (form) {
    defaultHalfOdds = halfOdds();
    const inputs = [...form.querySelectorAll("input")];
    const horizon = form.elements.horizon;
    const quoteState = () => ({
      horizon: Number(horizon.value),
      overrides: Object.fromEntries(inputs.filter(input => input.validity.valid && input.value)
        .map(input => [input.name, input.valueAsNumber])),
      decision: decision(),
      headline: read(".route"),
      editedAction: read(".quote-action"),
      watchTerms: document.querySelector(".watch-terms")?.innerText,
      conditional: read(".conditional"),
      pay: read(".pay"),
      gas: read(".gas"),
      halfChance: halfOdds(),
      age: {
        title: read(".age h3"), caption: read(".age figcaption"),
        scale: read(".age span"), current: read(".age b"), threshold: read(".age div span+span"),
        height: graph.getBoundingClientRect().height, visible: visible(".age"),
        dot: ["cx", "cy"].map(key => graph.querySelector("circle")?.getAttribute(key)).join(","),
        curve: graph.querySelector("polyline")?.getAttribute("points"),
        line: graph.querySelector("path")?.getAttribute("d")
      },
      context: [document.querySelector(".steps").closest("section").textContent, read(".stress")]
    });
    const initial = quoteState();
    quotes.push(initial);
    const defaulted = () => inputs.every(input => input.nextElementSibling.textContent === "Default");
    const fieldsValid = inputs.map(input => input.name).join() === "entryGas,exitGas,slippage,delay,lockup";
    quotePass = fieldsValid && defaulted()
      && horizon?.value === "0" && [...horizon.options].map(option => option.value).join() === "0,30,90,180,365"
      && visible("#quote select");
    if (quotePass) {
      const update = control => control.dispatchEvent(new Event("input", { bubbles: true }));
      const select = h => { horizon.value = h; update(horizon); };
      for (const option of [...horizon.options].slice(1)) {
        select(option.value);
        quotes.push(quoteState());
      }
      const values = [10000, 7, 1, 12, 45];
      select(30);
      inputs.forEach((input, i) => {
        input.value = values[i];
        update(input);
        quotes.push(quoteState());
        quotePass &&= input.nextElementSibling.textContent === "Quoted";
      });
      inputs.forEach(input => { input.value = ""; });
      select(0);
      const restored = () => JSON.stringify(quoteState()) === JSON.stringify(initial) && defaulted();
      quotePass &&= restored();
      inputs[0].value = "-1";
      update(inputs[0]);
      quotePass &&= restored();
      inputs[0].value = "";
    }
  }
  const stepItems = [...document.querySelectorAll(".steps li")];
  const labels = stepItems.map(li => li.querySelector("h3").textContent);
  const steps = stepItems.map(li => li.querySelector("p").textContent + " " + li.querySelector("small").textContent);
  const chips = [...document.querySelectorAll(".integrity .chip")];
  const railCards = [...document.querySelectorAll(".plans div")].map(card =>
    [...card.querySelectorAll("small")].map(line => line.textContent));
  const integrity = chips.map(chip => chip.textContent);
  const integrityLines = new Set(chips.map(chip => chip.offsetTop)).size;
  const integrityPass = chips.length === 3 && visible(".integrity") && integrityLines === 1
    && chips.every(chip => chip.dataset.pass === "true" && chip.textContent.startsWith("✓ "));
  const tokenLinks = [...document.querySelectorAll("#token-groups a")].map(a => [a.textContent, a.getAttribute("href")]);
  const tokenTable = () => [...document.querySelectorAll("#results tbody tr")].map(tr => [...tr.cells].map(cell => cell.textContent));
  let tokenRows, tokenSearch;
  if (location.hash.startsWith("#tokens")) {
    tokenRows = tokenTable();
    if (location.hash === "#tokens/ranked") {
      const search = document.querySelector("#search");
      search.value = "uPsHiFt";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      tokenSearch = [location.hash, read("#shown"), tokenTable().map(row => row[0])];
      search.value = "";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  return {
    loadMs: performance.getEntriesByType("navigation")[0].domContentLoadedEventEnd,
    checks: read("#checks"), checksPass: document.querySelector("#checks")?.dataset.pass,
    integrity, integrityPass, integrityLines, title: read("h1"), count: read("#shown"), first: read("tbody tr th a"),
    tokenLinks, tokenRows, tokenSearch, tokenDetail: read("#token-reason"), tokenDetailVisible: visible("#token-reason"),
    activeFilters: [...document.querySelectorAll("#active-filters .chip")].map(node => node.textContent),
    reset: document.querySelector("#active-filters a")?.getAttribute("href"),
    rankLabel: read("#sort-rank"),
    jargon: (`${document.querySelector("#view").textContent}\n${read("#assumptions .drawer")}`
      .match(/\bp\*|\bx\d+(?:\.\d+)?\s+q\b|\bq\s*(?:=|\(|≥|\d)|½\s*q\b|F walk-forward|\bp10\b|circ\. cap|gecko_id|\bcarry\b|Board F\/M\/S/giu) ?? []),
    summary: read(".route"), route: read(".plan-route"), defaultHalfOdds,
    decision: decision(), decisionVisible: visible(".decision"),
    coverage: read(".coverage"), nested: read(".nested"),
    valueRange: read(".value-range"), edgePlans: read(".range-net"),
    oddsNote: read(".timing"), ageVisible: Boolean(graph), familyCoverage: read(".value-range+small"),
    pay: read(".pay"), payVisible: visible(".pay"),
    farms: read(".plans"), farmsVisible: visible(".plans"), farmBounds: document.querySelector(".plans")?.getBoundingClientRect().toJSON(),
    farmHeading: read(".plans h2"),
    farmLinks: [...document.querySelectorAll(".plans a")].map(a => a.getAttribute("href")),
    farmActions: railCards.map(([action]) => action),
    farmRoutes: railCards.map(([, route]) => route),
    farmTimes: railCards.map(([,, time]) => time),
    farmCosts: railCards.map(([,,, cost]) => cost),
    farmNets: [...document.querySelectorAll(".plans .pos")].map(line => line.textContent),
    labels, steps,
    gas: document.querySelector(".gas")?.innerText.replace("\n", " · "), gasVisible: visible(".gas"),
    exits: [...document.querySelectorAll(".exits li")].map(li => li.textContent),
    exitsVisible: visible(".exits"),
    planVisible: visible(".steps"),
    quoteVisible: visible(".quote"), quotePass, quotes,
    equation: read(".valuation .equation"), amount: read(".amount"),
    sources: read(".sources"), sourcesVisible: visible(".sources"),
    peersVisible: visible(".peers"), peersBounds: document.querySelector(".peers")?.getBoundingClientRect().toJSON(),
    heldOut: read(".misses"), dropLine: read(".drop"), likeness: read(".likeness"),
    dropVisible: visible(".drop") && drop.offsetHeight <= Math.ceil(parseFloat(getComputedStyle(drop).lineHeight)),
    candidateHeading: read(".candidates h2"),
    candidateRows: [...document.querySelectorAll(".candidates tbody tr")]
      .map(tr => [...tr.cells].map(cell => cell.textContent.trim())),
    termRows: [...document.querySelectorAll(".ablation tr")]
      .map(tr => [...tr.cells].map(cell => cell.textContent.trim())),
    bandRows: [...document.querySelectorAll(".bands tbody tr")]
      .map(tr => [...tr.cells].map(cell => cell.textContent.trim())),
    comparePass, compareVisible: visible("#compare"), compareRanks: picked().map(input => Number(input.value)),
    compareRows: [...document.querySelectorAll("#compare tbody tr")]
      .map(tr => [...tr.cells].map(cell => cell.textContent.trim())),
    assumptions: read("#assumptions .drawer ul"),
    assumptionTables: [...document.querySelectorAll("#assumptions table")].map(table => table.textContent),
    coverCounts: read(".kpi:last-child b"),
    detailCounts: read(".route~small"),
    coverHeading: read(".kpi:last-child h2"),
    expectedNetSort: document.querySelector("#sort-net")?.parentElement.ariaSort,
    listingNote: read(".chain-note"),
    gridKey: read(".grid-key"), gridKeyVisible: visible(".grid-key"),
    stress: read(".stress"), stressVisible: visible(".stress"), rowCheck: chips[0]?.textContent,
    rowPass: chips[0]?.dataset.pass,
    rows: rows.map(row => {
      const value = row.cells[2];
      return [row.dataset.slug, Number(row.cells[0].textContent), value.querySelector("b").textContent,
        value.querySelector(".equation").textContent, row.querySelector(".badge").textContent, watchlist.has(row.dataset.slug),
        row.lastElementChild.querySelector("b")?.textContent, row.lastElementChild.innerText];
    }),
    completeRows, rangesInline, equationOverflow, width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    scrollbar: innerWidth - document.documentElement.clientWidth
  };
}

function startFirefox(work, args, prefs = "") {
  const profile = mkdtempSync(join(work, "profile-"));
  if (prefs) writeFileSync(join(profile, "user.js"), prefs);
  const child = spawn("/usr/bin/firefox", ["--headless", "--no-remote", "--profile", profile, ...args], {
    env: {
      ...process.env, MOZ_CRASHREPORTER_DISABLE: "1",
      XDG_CONFIG_HOME: join(work, "config"), XDG_DATA_HOME: join(work, "data"),
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || "/work/.tmp/cache"
    }, stdio: ["ignore", "pipe", "pipe"], detached: true
  });
  const output = { stdout: "", stderr: "" };
  child.stdout.on("data", chunk => { output.stdout += chunk; });
  child.stderr.on("data", chunk => { output.stderr = (output.stderr + chunk).slice(-4000); });
  child.on("error", error => { output.stderr += error.message; });
  const stopped = new Promise(ready => {
    child.once("exit", ready);
    child.once("error", ready);
  });
  function signal(name) {
    try {
      if (child.pid) process.kill(-child.pid, name);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  async function stop() {
    signal("SIGTERM");
    const timeout = setTimeout(() => signal("SIGKILL"), 1_000);
    await stopped;
    clearTimeout(timeout);
    signal("SIGKILL");
    child.stdout.destroy();
    child.stderr.destroy();
  }
  return { child, output, stop };
}

async function shootBidi(url, work, port, verify) {
  const browser = startFirefox(work, ["--remote-debugging-port", String(port)]);
  let socket;
  try {
    socket = await connect(port, browser.child);
    const { call, errors } = bidi(socket);
    await call("session.new", { capabilities: {} });
    await call("session.subscribe", { events: ["log.entryAdded"] });
    const { context } = await call("browsingContext.create", { type: "tab" });
    async function evaluate(expression) {
      const answer = await call("script.evaluate", { expression, target: { context }, awaitPromise: true });
      if (answer.type === "exception") throw new Error(answer.exceptionDetails.text);
      return JSON.parse(answer.result.value);
    }
    const images = [];
    for (const { name, hash, probeOnly, viewHeight = height } of pages) {
      await call("browsingContext.setViewport", { context, viewport: { width, height: viewHeight }, devicePixelRatio: 1 });
      await call("browsingContext.navigate", { context, url: url + hash, wait: "complete" });
      const info = await evaluate(`(async () => {
        document.documentElement.style.scrollbarWidth = "none";
        await document.fonts.ready;
        await new Promise(ready => requestAnimationFrame(() => requestAnimationFrame(ready)));
        return JSON.stringify((${readPage})());
      })()`);
      if (errors.length) throw new Error(errors.join("\n"));
      verify(name, info);
      if (!probeOnly) images.push({ name, info, ...await captureJpeg(call, context, work) });
    }
    await call("session.end", {});
    if (errors.length) throw new Error(errors.join("\n"));
    return images;
  } catch (error) {
    if (!socket && browser.output.stderr) console.error(browser.output.stderr.trim());
    throw error;
  } finally {
    socket?.close();
    await browser.stop();
  }
}

function installProbe() {
  const report = (type, value) => dump(`RADAR ${type} ${JSON.stringify(value)}\n`);
  window.addEventListener("error", event => report("error", event.message || event.target?.src || event.target?.href), true);
  window.addEventListener("unhandledrejection", event => report("error", String(event.reason)));
  const error = console.error.bind(console);
  console.error = (...args) => {
    report("error", args.map(String).join(" "));
    error(...args);
  };
  window.addEventListener("load", async () => {
    await document.fonts.ready;
    report("info", readPage());
  });
}

async function shootCli(output, work, verify) {
  const dashboard = join(work, "dashboard");
  cpSync(join(output, "dashboard"), dashboard, { recursive: true });
  cpSync(join(output, "data.js"), join(work, "data.js"));
  const page = join(dashboard, "index.html");
  const html = readFileSync(page, "utf8").replace("<head>", '<head>\n<style>html{scrollbar-width:none}</style>\n<script src="capture-probe.js"></script>');
  writeFileSync(page, html);
  writeFileSync(join(dashboard, "capture-probe.js"), `${readPage}\n(${installProbe})();\n`);
  const url = pathToFileURL(page).href;
  const images = [];
  for (const { name, hash, probeOnly, viewHeight = height } of pages) {
    const png = join(work, name + ".png");
    const browser = startFirefox(work, ["--window-size", `${width},${viewHeight}`, "--screenshot", png, url + hash],
      'user_pref("browser.dom.window.dump.enabled", true);\n');
    try {
      for (let attempt = 0; attempt < 150; attempt++) {
        if (/^RADAR error /m.test(browser.output.stdout)) break;
        if (/^RADAR info .*\n/m.test(browser.output.stdout) && existsSync(png)) break;
        if (browser.child.exitCode != null) break;
        await delay(100);
      }
      const log = browser.output.stdout;
      const errors = [...log.matchAll(/^RADAR error (.*)$/gm)].map(match => JSON.parse(match[1]));
      if (errors.length) throw new Error(errors.join("\n"));
      const result = /^RADAR info (.*)$/m.exec(log);
      if (!result || !existsSync(png)) throw new Error(`Firefox did not return diagnostics and a PNG for ${name}.\n${browser.output.stderr}`);
      const info = JSON.parse(result[1]);
      verify(name, info);
      if (!probeOnly) images.push({ name, info, ...encodeJpeg(png, work) });
    } finally {
      await browser.stop();
    }
  }
  return images;
}

async function shoot(output, destination) {
  const board = JSON.parse(readFileSync(join(output, "board.json"), "utf8")).rows;
  const boardBySlug = new Map(board.map(row => [row.slug, row]));
  const url = pathToFileURL(join(output, "dashboard", "index.html")).href;
  const data = readFileSync(join(output, "data.js"), "utf8").trim();
  const { snapshot, boardDigest, manifest } = JSON.parse(data.slice("globalThis.LaunchRadarData = ".length, -1));
  if (api.digest(board) !== boardDigest || JSON.stringify(api.exportManifest(board)) !== JSON.stringify(manifest)) {
    throw new Error("Offline payload digest or manifest differs from board.json.");
  }
  const model = api.buildModel(snapshot);
  const { value, odds, rows, recs, counts, verdicts, assumptions } = model;
  const checks = api.selfChecks(model, snapshot, boardDigest);
  const checkCount = `${checks.filter(check => check.pass).length}/${checks.length}`;
  const exportedWatchlist = snapshot.watchlist.filter(slug => boardBySlug.has(slug)).length;
  const [lowGrowth, highGrowth] = assumptions.parameters.clip;
  const clipped = ({ change_7d: growth }) => growth < lowGrowth || growth > highGrowth;
  const actionNames = { SKIP: "Watch", MARGINAL: "Test", FARM: "Farm" };
  const actionBySlug = new Map(manifest.map(([, slug, , verdict]) => [slug, actionNames[verdict]]));
  const upshift = rows.find(row => row.slug === "upshift");
  const { exits: rawExits, trial: { gas }, chain, tx } = upshift.plan;
  const exits = rawExits.map(displayStep);
  const modelBySlug = new Map(rows.map(row => [row.slug, row]));
  for (const { slug, chains, plan } of rows) {
    const { name } = plan.chain;
    const steps = boardBySlug.get(slug).farm_steps;
    const chainCount = new Set(chains).size;
    if (!chains.includes(name) || !steps[0].includes(`Plan route: ${name} (cheapest priced of ${chainCount} listed)`)
      || !steps.some(step => step.includes(`fund ${name},`)) || !steps.some(step => step.includes(`position opens on ${name}, exit`))
      || JSON.stringify(steps) !== JSON.stringify(plan.steps.map(([, body, terms]) => body + " " + terms))) {
      throw new Error(`${slug}: checklist differs from priced chain ${name}.`);
    }
  }
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format;
  const compact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD",
    notation: "compact", maximumFractionDigits: 2 }).format;
  const signedMoney = value => {
    const rounded = Number(value.toFixed(2));
    return (rounded > 0 ? "+" : "") + displaySigns(money(rounded));
  };
  const totalTime = p => `${p.mins} min hands-on (${p.prepMins} setup + ${p.exitMins} exit + ${p.checkMins} weekly checks)`;
  const totalCost = p => `${money(p.cost)} total (gas ${money(p.gas)} + funding ${money(p.funding)} + slippage ${money(p.slip)} + time ${money(p.labor)} + capital cost ${money(p.carry)})`;
  const actionLine = p => api.firstAction(p) + (p.trial ? "" : ` · Expected net ${signedMoney(p.net)}`);
  const aprBasis = trial => {
    const contribution = trial.q * (trial.drop - trial.claimCost);
    return contribution === 0 ? "cash APR alone" : contribution > 0 ? "includes token upside" : "includes token costs";
  };
  const watchTerms = (p, format = compact) => {
    const { capital, horizon, net } = p.trial;
    const apr = Math.ceil((-net / (capital * horizon / assumptions.parameters.year) * 100) * 10) / 10;
    return [`Watch · needs ${apr.toFixed(1)}% APR`, aprBasis(p.trial), `${signedMoney(net)} at ${format(capital)}, ${horizon} d`];
  };
  const actionCounts = api.actionCounts(verdicts);
  const chance = value => `${(100 * value).toFixed(1)}%`;
  const threshold = (value, top = 1) => value == null || value > 1
    ? "No launch chance breaks even at this ticket" : `Break-even ${value > top ? "↑ " : ""}${chance(value)}`;
  const needed = (value, q) => value == null || value > 1 ? `unreachable at ${chance(q)}` : `needs ${chance(value)} vs ${chance(q)}`;
  const gasLine = `${tx} tx × ${money(chain.gas)} on ${chain.name} = ${money(gas)}`;
  const likenessTest = `Token-screen ranking accuracy (AUC) ${odds.validation.walk.auc.toFixed(3)} walk-forward`;
  const mult = miss => miss == null ? "—" : `${miss.toFixed(3)}×`;
  const { headline, ranges, candidates, form } = value;
  const countsByFamily = Object.groupBy(model.calibration, p => p.family);
  const foldCoverage = Object.fromEntries(Object.entries(value.tests).map(([scheme, folds]) => {
    const tallies = { Pooled: { hits: 0, n: 0 } };
    for (const { inner, rows, bounds } of folds) {
      if (!inner.length) continue;
      for (const { family, shipped } of rows) {
        const key = countsByFamily[family]?.length >= 8 ? family : "Other";
        const [low, high] = bounds[family] ?? bounds.Pooled;
        const hit = low <= shipped && shipped <= high;
        for (const bucket of [tallies.Pooled, tallies[key] ??= { hits: 0, n: 0 }]) {
          bucket.hits += Number(hit);
          bucket.n++;
        }
      }
    }
    return [scheme, tallies];
  }));
  const verifyAgeGraph = (graph, row, { horizon, q, pStar }) => {
    const age = row.ageDays ?? odds.fit.age;
    const end = Math.max(1000, Math.ceil(age / 80) * 100);
    const days = [...new Set([...Array.from({ length: 41 }, (_, i) => 1 + (end - 1) * (i / 40) ** 2), age])]
      .sort((a, b) => a - b);
    const [intercept, tvl, listingAge] = odds.fit.beta;
    const score = day => {
      const logit = intercept + row.rawSize * tvl + Math.log(day / assumptions.parameters.year) * listingAge;
      return 1 / (1 + Math.exp(-Math.min(35, Math.max(-35, logit))));
    };
    const probabilities = days.map(day => Math.max(0, (score(day + horizon) - score(day)) / (1 - score(day))));
    const top = Math.ceil(10 * Math.max(.1, ...probabilities)) / 10;
    const x = day => (2 + 296 * (day - 1) / (end - 1)).toFixed(2);
    const y = chance => (44 - 40 * chance / top).toFixed(2);
    const dot = `${x(age)},${y(q)}`;
    const curve = days.map((day, i) => `${x(day)},${y(probabilities[i])}`).join(" ");
    return graph.visible && graph.height <= 140
      && graph.title === `${horizon}-day launch chance by days without a token`
      && graph.caption === assumptions.timing
      && graph.current === `${Math.round(age).toLocaleString("en-US")} d${row.ageDays == null ? " (median)" : ""} · ${chance(q)}`
      && graph.scale.startsWith(`0–${Math.round(top * 100)}% · `)
      && graph.threshold === threshold(pStar, top)
      && graph.dot === dot && graph.curve === curve && curve.split(" ").includes(dot)
      && graph.line === (pStar != null && pStar <= top ? `M2 ${y(pStar)}H298` : undefined);
  };
  const scheme = { walk: "Walk-forward", family: "Leave-one-family-out" };
  const coveragePct = ({ hits, n } = {}) => n ? `${(100 * hits / n).toFixed(0)}%` : "—";
  const rangeLabel = foldCoverage.family.Pooled.n ? "80% range" : "Uncalibrated range";
  const coverage = `${rangeLabel} · Coverage ${coveragePct(foldCoverage.walk.Pooled)} date / ${coveragePct(foldCoverage.family.Pooled)} family`;
  const bandRows = Object.keys(ranges.coverage.family).map(family => [family, ...["walk", "family"].map(scheme => {
    const bucket = foldCoverage[scheme][family];
    return bucket?.n ? `${coveragePct(bucket)} (${bucket.hits}/${bucket.n})` : "—";
  })]);
  const comparisons = ["walk", "family", "pooled"];
  const candidateRows = Object.entries(api.forms).map(([key, label]) => [
    label + (key === form ? " · deployed" : ""), ...comparisons.map(test => mult(candidates[key][test]))
  ]);
  const tests = Object.keys(scheme);
  const dropPairs = Object.entries(api.outerTerms).map(([term, label]) =>
    [label, ...tests.map(key => mult(value.ablation[term][key].miss))]);
  const kept = Object.keys(api.outerTerms).map(term =>
    tests.every(key => value.ablation[term][key].miss < headline[key].miss) ? "dropped" : "kept");
  const dropLine = "Held out without · " + dropPairs.map(([label, ...miss]) => `${label} ${miss.join("/")}`).join(" · ");
  const termRows = [
    ["Model", ...tests.map(key => `${scheme[key]} · n=${headline[key].n}`), "Both tests improve?"],
    ["Full model", ...tests.map(key => mult(headline[key].miss)), "—"],
    ...dropPairs.map(([label, ...miss], i) => [`Without ${label}`, ...miss, kept[i]])
  ];
  const work = mkdtempSync("/work/.tmp/rw-firefox-");
  try {
    let port;
    try {
      port = await freePort();
    } catch (error) {
      if (!["EPERM", "EACCES"].includes(error.code)) throw error;
      console.log("Loopback TCP unavailable. Using Firefox headless PNG capture with page diagnostics.");
    }
    const rowProof = "ranks and values match board.json";
    const groupNames = { traded: "traded", setAside: "set aside", recorded: "token, no cap", ranked: "ranked" };
    const reasonNames = {
      cap: "Positive market cap", id: "Token ID or symbol recorded", product: "Wrapped, staked or bridged product",
      exchange: "Exchange category or name", pre: "Pre-token", watch: "Watchlist exception"
    };
    const verify = (name, info) => {
      const check = /^(\d+)\/(\d+) self-checks pass(?: · .+)?$/.exec(info.checks);
      if (!check || `${check[1]}/${check[2]}` !== checkCount || check[1] !== check[2] || info.checksPass !== "true") {
        throw new Error(`${name}: ${info.checks}`);
      }
      if (info.jargon.length) throw new Error(`${name}: jargon rendered: ${info.jargon.join(", ")}`);
      if (["1-board.jpg", "3-filtered.jpg", "watchlist-skip"].includes(name)) {
        if (!info.integrityPass || info.integrity[1] !== `✓ ${exportedWatchlist}/${snapshot.watchlist.length} watchlist rows exported`
          || info.integrity[2] !== `✓ ${checkCount} self-checks pass`) {
          throw new Error(`${name}: integrity strip failed: ${info.integrity.join(" · ")}`);
        }
        if (!info.gridKeyVisible || info.gridKey !== "Amber bar = value range · Tick = estimate · ◆ Watchlist · Status adj. = factor from token-likeness") {
          throw new Error(`${name}: the grid key is missing or out of view.`);
        }
      }
      if (name === "1-board.jpg" && JSON.stringify(info.tokenLinks) !== JSON.stringify(Object.entries(groupNames)
        .map(([group, label]) => [`${counts[group]} ${label}`, `#tokens/${group}`]))) {
        throw new Error("Snapshot counts do not link to their token filters.");
      }
      if (name.startsWith("tokens-")) {
        const group = name.slice(7);
        const field = value => String(value ?? "—") || "—";
        const expected = recs.filter(row => !group || row.status === group).map(p =>
          [p.name, reasonNames[p.reason], ...[p.mcap_usd, p.gecko_id, p.symbol, p.category, p.nameRule].map(field)]);
        if (JSON.stringify(info.tokenRows) !== JSON.stringify(expected)
          || info.count !== `${expected.length}/${expected.length} shown`
          || (group === "ranked" && JSON.stringify(info.tokenSearch) !== JSON.stringify(
            ["#tokens/ranked?q=uPsHiFt", `1/${counts.ranked} shown`, ["Upshift"]]))) {
          throw new Error(`${name}: token evidence, filter or search differs from the snapshot.`);
        }
        console.log(`Token screen ${group || "all"} · ${info.count} · evidence and search pass`);
      }
      if (name === "empty-board" && (info.rowCheck !== "No rows to verify" || info.rowPass !== "null" || info.rows.length)) {
        throw new Error("Empty results show an export match.");
      }
      const page = pages.find(page => page.name === name);
      if (info.ageVisible !== page.hash.startsWith("#detail/") || (!info.ageVisible && info.familyCoverage)) {
        throw new Error(`${name}: age chart and family coverage belong only on the detail page.`);
      }
      if (info.width !== width || info.height !== (page.viewHeight ?? height) || info.dpr !== 1) {
        throw new Error(`Unexpected Firefox viewport ${info.width}×${info.height} at DPR ${info.dpr}.`);
      }
      if (info.scrollbar) throw new Error(`${name}: page scrollbar occupies ${info.scrollbar}px`);
      const slugs = new Set(info.rows.map(([slug]) => slug));
      const netOrder = name === "net-asc" ? 1 : name === "net-desc" ? -1 : 0;
      const displayedNet = ([,,,,,, net, ticket]) => Number(
        (net ?? ticket.split("\n").at(-1).match(/[+−-]?\$[\d,.]+/)?.[0]).replace(/[$,]/g, "").replace("−", "-"));
      if (slugs.size !== info.rows.length || info.rows.some(([slug, rank, value, equation, verdict, , net, ticket], i) => {
        const row = boardBySlug.get(slug), modelRow = modelBySlug.get(slug), { plan } = modelRow;
        const first = api.firstAction(plan);
        const checklist = plan.trial ? watchTerms(plan, capital => `$${capital.toLocaleString("en-US")}`).join(" · ")
          : `${first} · expected net ${net}`;
        const terms = plan.trial ? watchTerms(plan).join("\n")
          : `${first.split(" · ")[0]} ${compact(plan.capital)} ${net}\n${plan.horizon} d`;
        const previous = info.rows[i - 1];
        const order = previous && netOrder * (displayedNet(info.rows[i]) - displayedNet(previous));
        return row?.rank !== rank || value !== compact(row.implied_value_usd)
          || !provesValue(equation, row.implied_value_usd, value, clipped(modelRow)) || actionBySlug.get(slug) !== verdict
          || (!plan.trial && net !== signedMoney(plan.net)) || ticket !== terms
          || !row.farm_steps[0].startsWith(`${checklist}.`)
          || (previous && (order < 0 || (!order && previous[1] >= rank)));
      })) {
        throw new Error(`${name}: page order, values or equation differ from board.json`);
      }
      if (info.rows.length && (info.rowPass !== "true" || info.rowCheck !== `✓ ${info.rows.length}/${info.rows.length} ${rowProof}`)) {
        throw new Error(`${name}: ${info.rowCheck}`);
      }
      if (info.rows.length) {
        if (!info.rangesInline) throw new Error(`${name}: implied-value range moved off the figure's line`);
        if (info.equationOverflow.length) throw new Error(`${name}: board equation layout ${JSON.stringify(info.equationOverflow)}`);
        console.log(`${name} · ${info.rowCheck} · equations and first actions pass`);
      }
      if (["1-board.jpg", "calibration"].includes(name) && (
        !Object.entries(scheme).every(([key, label]) => {
          const { miss, flat, n } = headline[key];
          const outcome = miss !== null && miss >= flat ? "Flat ratio ties or wins." : "";
          return info.heldOut?.includes(`${label} · n=${n}${mult(miss)} / ${mult(flat)}${outcome}`);
        })
        || info.coverage !== coverage || info.nested !== "Form chosen inside training only")) {
        throw new Error(`${name}: calibration summary is incomplete.`);
      }
      if (name === "1-board.jpg") {
        if (info.rows.length !== board.length || info.completeRows < 10) {
          throw new Error(`The full board did not render with 10 complete rows in view (${info.completeRows}).`);
        }
        if (info.dropLine !== dropLine || !info.dropVisible) throw new Error("Drop-one results are missing from the board KPI.");
        if (!(info.loadMs > 0)) throw new Error("Missing DOM ready timing.");
        if (info.loadMs >= 3000) console.log(`DOM ready in ${Math.round(info.loadMs)} ms, above the 3000 ms target.`);
      }
      if (name === "1-board.jpg" && !info.comparePass) throw new Error("Compare limit, filtering or removal failed.");
      if (netOrder) {
        if (info.rows.length !== board.length || info.expectedNetSort !== (netOrder > 0 ? "ascending" : "descending")) {
          throw new Error(`${name}: missing sorted results or sort direction.`);
        }
        console.log(`${name} · displayed cents, including Watch trials, sort correctly`);
      }
      if (info.farms) {
        const visibleRows = info.rows.map(([slug]) => modelBySlug.get(slug));
        const scopedCounts = api.actionCounts(Object.fromEntries(Object.keys(actionNames).map(key =>
          [key, visibleRows.filter(({ plan }) => plan.verdict === key).length])));
        const best = visibleRows.filter(row => row.plan.capital)
          .sort((a, b) => b.plan.net - a.plan.net).slice(0, 5);
        if (!info.farmsVisible || info.farmHeading !== `Top plans ${scopedCounts} in this view`
          || info.coverCounts !== actionCounts || info.coverHeading !== `First actions · all ${board.length}`
          || info.listingNote !== "Plan route uses the cheapest priced listed chain."
          || info.farmLinks.length !== best.length || new Set(info.farmLinks).size !== best.length
          || info.farmActions.join() !== best.map(({ plan }) => api.firstAction(plan)).join()
          || info.farmLinks.some((href, i) => href.split("?")[0] !== `#detail/${encodeURIComponent(best[i].slug)}`)
          || info.farmNets.join() !== best.map(({ plan }) => `${signedMoney(plan.net)} net`).join()
          || info.farmTimes.join() !== best.map(({ plan }) => `${plan.mins} min hands-on`).join()
          || info.farmCosts.join() !== best.map(({ plan }) => `${money(plan.cost)} total cost`).join()
          || info.farmRoutes.join() !== best.map(row => row.plan.route).join()
          || (!best.length && !info.farms.includes("No funded plans."))) {
          throw new Error(`${name}: the break-even panel differs from the visible rows. ${JSON.stringify({
            visible: info.farmsVisible, bounds: info.farmBounds, links: info.farmLinks, expected: best.map(row => row.slug),
            actions: info.farmActions, nets: info.farmNets
          })}`);
        }
      }
      if (page.hash.startsWith("#detail/")) {
        const slug = page.hash.slice(8);
        const row = modelBySlug.get(slug);
        const { name: protocol, plan, score, launchCap, haircut, family } = row;
        const rate = (100 * assumptions.parameters.riskFreeRate).toFixed(0);
        const hourly = assumptions.parameters.hourlyUsd;
        if (!info.decisionVisible || !info.quotePass || info.quotes.length !== 10 || info.route !== plan.route
          || info.summary !== actionLine(plan) || info.detailCounts !== `All ${board.length} · ${actionCounts}`
          || !info.checks.endsWith(" · Rank, value, range and checklist match board.json")
          || JSON.stringify(info.steps) !== JSON.stringify(boardBySlug.get(slug).farm_steps.map(displayStep))) {
          throw new Error(`${name}: Decision mismatch or out of view (${info.decision.join(" | ")}).`);
        }
        if (plan.trigger) {
          const [minimum, basis] = watchTerms(plan);
          if (!info.steps[1].includes(`≥ ${minimum.replace("Watch · needs ", "")}`)
            || !info.steps[1].includes(`(${basis})`)) {
            throw new Error(`${name}: checklist APR threshold differs from the priced trial.`);
          }
        }
        const launch = compact(launchCap * haircut);
        const relation = `Value at launch ${launch} (traded-peer fit${haircut === 1 ? "" : " × issuer factor"}) · Ranked value ${compact(score)} = that × status adj. (rounded${score === 1 ? ", min $1" : ""})`;
        if (!provesValue(info.equation, score, info.amount, clipped(row)) || !info.sourcesVisible
          || ![relation, "7-day growth", "d listed",
            "Issuer factor", "Calibration →"].every(label => info.sources.includes(label))) {
          throw new Error(`${name}: value equation or held-out evidence is incomplete.`);
        }
        const key = foldCoverage.family[family] ? family : "Other";
        const { hits, n } = foldCoverage.family[key] ?? { hits: 0, n: 0 };
        if (info.familyCoverage !== `${key}: ${hits}/${n} held-out values in range`) {
          throw new Error(`${name}: family coverage differs from the held-out family rows.`);
        }
        if (plan.capital) {
          const extremes = row.ranges[80].map(value => api.priceFarm(plan, plan.capital, { share: value / row.score }));
          const flips = extremes.flatMap(({ verdict }, i) => verdict === plan.verdict ? [] :
            [`flips to ${actionNames[verdict]} at ${i ? "high" : "low"} end`]);
          const expected = `Expected net ${extremes.map(plan => signedMoney(plan.net)).join(" / ")} · `
            + (flips.join(" · ") || `same action at both ends of ${rangeLabel}`);
          if (info.edgePlans !== expected) throw new Error(`${name}: the valuation range verdict differs from the plan.`);
        }
        for (const state of info.quotes) {
          const quote = { ...plan.quote, ...state.overrides };
          const action = api.chooseFarm(plan, quote, state.horizon);
          const result = action.trial ?? action;
          const edited = state.horizon || Object.keys(state.overrides).length;
          const { tokenNet, noToken, q, pStar, verdict, gas, hold, net, horizon, capital, drop, claimCost } = result;
          const { chain, tx } = plan;
          const half = api.priceFarm(plan, capital, { quote, horizon, q: q / 2 });
          const quotedGas = quote.entryGas !== plan.quote.entryGas || quote.exitGas !== plan.quote.exitGas;
          const gasLabel = quotedGas ? "Quoted gas" : `${tx} tx × ${money(chain.gas)}`;
          const expected = [
            `Launch chance (${horizon} d) ${chance(q)} · Token outcome ${signedMoney(tokenNet)}`,
            `No-token outcome ${signedMoney(noToken)}`,
            totalCost(result),
            `${totalTime(result)} at $${hourly}/h · capital cost at ${rate}%/yr for ${hold} d`,
            `${threshold(pStar)} · ${actionNames[verdict]}`,
            `${action.trial ? "Net before cash reward" : "Expected net"} ${signedMoney(net)} = launch chance × token outcome + chance of no token × no-token outcome.`
          ];
          if (!verifyAgeGraph(state.age, row, result)) {
            throw new Error(`${name}: age chart differs from its ${horizon}-day Decision readout: ${JSON.stringify(state.age)}`);
          }
          if (state.decision.join("\n") !== expected.join("\n")
            || state.headline !== actionLine(plan)
            || state.editedAction !== (edited ? `With edited inputs · ${actionLine(action)}` : undefined)
            || state.watchTerms !== (action.trial ? watchTerms(action).join("\n") : undefined)
            || state.conditional !== (action.trial
              ? `Conditional ticket · ${plan.ticketFor(capital)} · ${horizon} d`
              : undefined)
            || !state.pay.includes(`What would make it pay · ${chain.name} · ${horizon} d`)
            || !state.pay.includes(`Test ${needed(pStar, q)}`)
            || !state.pay.includes(`Farm ${needed(pStar == null ? null : 2 * pStar, q)}`)
            || !state.pay.includes(`all-in cost ≤ ${q * (drop - claimCost) < 0 ? "unreachable" : money(q * (drop - claimCost))}`)
            || state.gas !== `${gasLabel} on ${chain.name} = ${money(gas)}`
            || state.halfChance !== `Launch chance halved (${chance(q / 2)}) · ${signedMoney(half.net)} · ${actionNames[half.verdict]}`
            || state.context.join() !== info.quotes[0].context.join()
            || state.context.filter(Boolean).some(text => !text.includes("snapshot defaults"))) {
            const { age, context, ...readouts } = state;
            throw new Error(`${name}: inconsistent quote at ${horizon} d. ${JSON.stringify({
              readouts, expected, action: actionLine(action), watch: action.trial && watchTerms(action),
              gasLabel, half, ticket: plan.ticketFor(capital), snapshotContext: context.join() === info.quotes[0].context.join()
            })}`);
          }
        }
        console.log(`${protocol} · ${info.checks}\n${info.summary}\n${plan.trigger ? info.steps[1] : info.steps[0]}\n${info.decision.join("\n")}`);
      }
      if (name === "calibration") {
        if (!info.likeness?.includes(likenessTest)) throw new Error("Missing token-screen ranking accuracy.");
        if (JSON.stringify(info.candidateRows) !== JSON.stringify(candidateRows)
          || info.candidateHeading !== "Reference scores on outer folds") {
          throw new Error("Reference candidate rows differ from the outer tests.");
        }
        if (JSON.stringify(info.termRows) !== JSON.stringify(termRows)) throw new Error("Ablation rows differ from the outer tests.");
        if (JSON.stringify(info.bandRows) !== JSON.stringify(bandRows)) throw new Error("Range coverage differs from the outer tests.");
        if (!info.assumptions?.includes("Issuer haircut is fixed.")) throw new Error("Missing issuer rule in Assumptions.");
        if (info.assumptionTables.length) {
          throw new Error("Assumptions unexpectedly include a quote table.");
        }
        console.log(info.candidateHeading);
        for (const row of info.candidateRows) console.log(`  ${row.join(" | ")}`);
        console.log("Held-out median miss by omitted term:");
        for (const row of info.termRows) console.log(`  ${row.join(" | ")}`);
      }
      if (name === "2-detail.jpg" && (info.steps.length < 3
        || !info.tokenDetailVisible
        || info.tokenDetail !== "Token screen · no CoinGecko ID, token symbol or market cap in the snapshot"
        || !info.valueRange.startsWith(`${rangeLabel} $`) || info.valueRange.includes(" · ")
        || info.labels.join() !== "First action,Entry trigger,Verify,Rehearse,Entry,Monitor,Exit,Sale assumption"
        || !info.quotes[0]?.age.caption.includes("no launch dates") || !info.oddsNote?.includes(likenessTest)
        || !info.steps.every(step => /\d+ min/.test(step) && /\$\d/.test(step))
        || !info.steps.some(step => step.includes(upshift.name) && step.includes("KYC, caps and withdrawals"))
        || !info.steps.some(step => step.includes(`${upshift.category}, bottom 10% cutoff`))
        || !info.steps.some(step => step.includes("allocator vault. Hold shares"))
        || !info.gasVisible || info.gas !== gasLine || !info.exitsVisible
        || JSON.stringify(info.exits) !== JSON.stringify(exits) || !info.steps.some(step => step.includes(exits[0]))
        || JSON.stringify(info.steps) !== JSON.stringify(boardBySlug.get("upshift")?.farm_steps.map(displayStep))
        || !info.planVisible || !info.quoteVisible || !info.quotePass || !info.peersVisible
        || !info.steps[1].startsWith(`Enter only if ${upshift.plan.trigger.rule}.`)
        || !info.steps[3].includes("put in $80 USDC and withdraw it")
        || !info.steps[4].startsWith("If entry trigger is met and rehearsal passes")
        || !info.steps.at(-1).includes("the model assumes sale at ~$26,591,080 implied circulating cap")
        || !info.payVisible || !info.pay?.includes(`What would make it pay · ${chain.name} ·`))) {
        const { quotes, ...detail } = info;
        throw new Error(`Upshift detail checks failed: ${JSON.stringify(detail)}`);
      }
      if (name === "3-filtered.jpg") {
        const expected = rows.filter(row => row.chains.includes("Ethereum") && row.plan.verdict === "MARGINAL");
        const compared = expected.slice(0, 2);
        const [values, actions, verdicts, nets, plans] = info.compareRows;
        if (!info.compareVisible || info.compareRanks.join() !== compared.map(row => row.rank).join()
          || info.compareRows.length !== 5 || compared.some(({ rank, plan }, i) => {
            const score = board[rank - 1].implied_value_usd, formatted = `$${score.toLocaleString("en-US")}`, col = i + 1;
            return values[col] !== formatted || actions[col] !== api.firstAction(plan)
              || verdicts[col] !== actionNames[plan.verdict] || nets[col] !== signedMoney(plan.net)
              || plans[col] !== `${plan.mins} min hands-on · ${money(plan.cost)}`;
          })) throw new Error("The side-by-side comparison differs from the ranked rows.");
        console.log("Compare selection limit, filtering, removal and displayed values pass.");
        if (info.completeRows < 5 || expected.length >= board.length || info.rows.length !== expected.length
          || expected.some(row => !slugs.has(row.slug)) || !info.rankLabel.startsWith(`Rank (of ${board.length})`)
          || info.activeFilters.join() !== "Action: Test,Listed on: Ethereum" || info.reset !== "#board") {
          throw new Error("The filtered board did not render with five complete rows, global ranks, and active filters.");
        }
      }
      if (name === "watchlist-skip" && (!info.rows.length || info.rows.some(row => row[4] !== "Watch" || !row[5]))) {
        throw new Error("The Watch-only rail check did not use the selected watchlist rows.");
      }
      if (name === "ethereum") {
        const expected = rows.filter(row => row.chains.includes("Ethereum"));
        if (info.rows.length !== expected.length || expected.some(row => !slugs.has(row.slug))) {
          throw new Error("The Ethereum rail check did not use the selected rows.");
        }
        console.log(info.farmHeading);
      }
    };
    const images = port ? await shootBidi(url, work, port, verify) : await shootCli(output, work, verify);
    mkdirSync(destination, { recursive: true });
    for (const { name, info, bytes, encoder } of images) {
      const dimensions = jpegSize(bytes);
      if (dimensions[0] !== width || dimensions[1] !== info.height) throw new Error("Unexpected screenshot dimensions.");
      writeFileSync(join(destination, name), bytes);
      const content = [info.title, info.count, info.rowCheck, info.first, info.farmHeading, info.summary, info.defaultHalfOdds, ...info.activeFilters].filter(Boolean).join(" · ");
      console.log(`${name} · ${dimensions.join("×")} · ${bytes.length} bytes · ${encoder} · ${info.checks}\n  ${content}`);
      if (name === "1-board.jpg") console.log(`  ${info.completeRows} complete rows in view · DOM ready in ${info.loadMs} ms · ${info.coverage} · ${info.nested}\n  ${info.rows[0][3]}`);
      if (name === "3-filtered.jpg") console.log(`  ${info.completeRows} complete rows in view`);
      if (name === "2-detail.jpg") console.log(`  ${info.tokenDetail}\n  ${info.equation}\n  ${info.gas}\n  ${info.exits.join("\n  ")}`);
      if (info.valueRange) console.log(`  ${[info.valueRange, info.familyCoverage, info.edgePlans].filter(Boolean).join(" · ")}
  ${info.quotes[0].age.title} · ${info.quotes[0].age.current} · ${info.quotes[0].age.height}px`);
      if (info.integrity.length) console.log(`  ${info.integrityLines} integrity line · ${info.integrity.join(" · ")}`);
    }
    console.log("Firefox reported no console errors or uncaught exceptions.");
    console.log("Calibration, value equations, board-matched checklist, age chart and family coverage, live quote edits and reset, and filtered rail pass.");
  } finally {
    spawnSync("find", [work, "-mindepth", "1", "-delete"]);
    rmdirSync(work);
  }
}

const [output, destination] = process.argv.slice(2);
if (!output) throw new Error("Usage: node tools/shoot.mjs <build dir> [screenshot dir]");
await shoot(resolve(output), destination ? resolve(destination) : join(resolve(output), "screenshots"));
