import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import api from "../dashboard/model.js";

const width = 1440;
const height = 980;
const detailHeight = 1340;
const minimum = 300 * 1024;
const maximum = 350_000;

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

async function captureJpeg(call, context, work) {
  const capture = async format => {
    const { data } = await call("browsingContext.captureScreenshot", { context, origin: "viewport", format });
    return Buffer.from(data, "base64");
  };
  const candidates = [];
  try {
    let low = 1;
    let high = 100;
    while (low <= high) {
      const quality = Math.ceil((low + high) / 2);
      const bytes = await capture({ type: "image/jpeg", quality: quality / 100 });
      if (bytes.readUInt16BE(0) !== 0xffd8) break;
      if (fits(bytes)) return { bytes, encoder: `BiDi quality ${quality / 100}` };
      candidates.push(`BiDi ${quality}: ${bytes.length}`);
      if (bytes.length < minimum) low = quality + 1;
      else high = quality - 1;
    }
  } catch (error) {
    candidates.push(error.message);
  }

  const png = join(work, "bidi.png");
  writeFileSync(png, await capture({ type: "image/png" }));
  return encodeJpeg(png, work, candidates);
}

function encodeJpeg(png, work, candidates = []) {
  const jpeg = join(work, "candidate.jpg");
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
      if (fits(bytes)) return { bytes, encoder: `ffmpeg -q:v ${quality} ${format} (${huffman} Huffman)` };
      candidates.push(`${format}/${huffman} q${quality}: ${bytes.length}`);
      if (bytes.length < minimum) break;
    }
  }
  for (const mode of [[], ["-optimize"]]) {
    for (let quality = 100; quality >= 85; quality--) {
      const result = spawnSync("/usr/bin/cjpeg", [
        "-quality", String(quality), "-sample", "1x1", ...mode, png
      ], { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
      if (result.error?.code === "ENOENT") break;
      if (result.status !== 0) throw new Error(String(result.error || result.stderr));
      const bytes = result.stdout;
      const encoder = `cjpeg quality ${quality}${mode.length ? " optimized" : ""}`;
      if (fits(bytes)) return { bytes, encoder };
      candidates.push(`${encoder}: ${bytes.length}`);
      if (bytes.length < minimum) break;
    }
  }
  throw new Error(`No JPEG met the byte budget. ${candidates.join(", ")}`);
}

const shots = [
  { name: "1-board.jpg", hash: "#board" },
  { name: "2-detail.jpg", hash: "#detail/upshift", viewHeight: detailHeight },
  { name: "3-filtered.jpg", hash: "#board?scope=watchlist&verdict=SKIP" }
];
const pages = [...shots, { name: "calibration", hash: "#calibration", probeOnly: true }];

function readPage() {
  const read = selector => document.querySelector(selector)?.textContent.trim();
  const rows = [...document.querySelectorAll("tr[data-slug]")];
  const tableBottom = document.querySelector("#results .scroll")?.getBoundingClientRect().bottom;
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
  const halfOdds = () => read(".half-q");
  let quotePass, defaultHalfOdds;
  if (form) {
    const initial = read("#quote-result");
    defaultHalfOdds = halfOdds();
    const inputs = [...form.querySelectorAll("input")];
    const horizon = form.elements.horizon;
    const defaulted = () => inputs.every(input => input.nextElementSibling.textContent === "Default");
    const fieldsValid = inputs.map(input => input.name).join() === "entryGas,exitGas,slippage,delay,lockup";
    quotePass = fieldsValid && defaulted() && initial.includes("No token") && initial.includes("Break-even p*")
      && horizon?.value === "0" && [...horizon.options].map(option => option.value).join() === "0,30,90,180,365"
      && visible("#quote select");
    if (quotePass) {
      const update = control => control.dispatchEvent(new Event("input", { bubbles: true }));
      const metrics = () => Object.fromEntries([...document.querySelectorAll("#quote-result dt")]
        .map(node => [node.textContent, node.nextElementSibling.textContent]));
      const select = h => { horizon.value = h; update(horizon); };
      const best = [...horizon.options].slice(1).map(option => {
        select(option.value);
        const result = metrics();
        quotePass &&= Boolean(result[`Launch within ${option.value} d (q)`])
          && read("#quote-result").includes(`${option.value}d at`);
        return result;
      }).sort((a, b) => Number(b["Expected net"].replace(/[^\d.-]/g, ""))
        - Number(a["Expected net"].replace(/[^\d.-]/g, "")))[0];
      select(0);
      quotePass &&= read("#quote-result") === initial && JSON.stringify(metrics()) === JSON.stringify(best);
      const values = [10000, 7, 1, 12, 45];
      select(30);
      const before = metrics();
      inputs.forEach((input, i) => { input.value = values[i]; });
      update(inputs[0]);
      const after = metrics();
      quotePass &&= after["Break-even p*"] !== before["Break-even p*"]
        && after["Launch within 30 d (q)"] === before["Launch within 30 d (q)"]
        && after["Expected net"] !== before["Expected net"] && after["Quote verdict"] === "SKIP"
        && read("#quote-result").includes("57d at")
        && read(".gas").startsWith("Quoted gas = $")
        && halfOdds() !== defaultHalfOdds && halfOdds().includes("SKIP")
        && inputs.every(input => input.nextElementSibling.textContent === "Quoted");
      inputs.forEach(input => { input.value = ""; });
      select(0);
      quotePass &&= read("#quote-result") === initial && defaulted();
      inputs[0].value = "-1";
      update(inputs[0]);
      quotePass &&= read("#quote-result") === initial && defaulted();
      inputs[0].value = "";
    }
  }
  const stepItems = [...document.querySelectorAll(".steps li")];
  const labels = stepItems.map(li => li.querySelector("h3").textContent);
  const steps = [];
  for (const li of stepItems) {
    const copy = li.querySelector("p");
    const parts = [copy.firstChild.textContent.trim(), li.querySelector("small").textContent];
    const follow = copy.querySelector("span")?.textContent;
    if (follow) parts.push(follow);
    if (li.querySelector("h3").textContent === "3c Wait") steps[steps.length - 1] += " " + parts.join(" ");
    else steps.push(parts.join(" "));
  }
  const chips = [...document.querySelectorAll(".integrity button")];
  const help = document.querySelector("#check-help");
  const integrity = chips.map(chip => chip.textContent);
  const integrityLines = new Set(chips.map(chip => chip.offsetTop)).size;
  const integrityWidth = chips.length ? [chips[0].parentElement.clientWidth, chips.reduce((sum, chip) => sum + chip.offsetWidth, 0)] : [];
  const integrityPass = chips.length === 12 && visible(".integrity")
    && integrityLines === 1
    && chips.every(chip => chip.dataset.pass === "true" && chip.textContent.startsWith("✓ "));
  const helpPass = chips.every(chip => {
    chip.click();
    const opened = help.open && document.activeElement === help.querySelector("summary");
    help.open = false;
    return opened;
  });
  if (chips.length) {
    document.activeElement.blur();
    window.scrollTo(0, 0);
  }
  return {
    loadMs: performance.getEntriesByType("navigation")[0].domContentLoadedEventEnd,
    checks: read("#checks"), checksPass: document.querySelector("#checks")?.dataset.pass,
    integrity, integrityPass, integrityLines, integrityWidth, helpPass, title: read("h1"), count: read("#shown"), first: read("tbody tr th a"),
    portfolio: read(".portfolio"),
    summary: read(".verdict"), defaultHalfOdds,
    coverage: read(".coverage"), nested: read(".nested"),
    valueRange: read(".value-range"), rangeFarm: read(".range-net"),
    oddsNote: read(".pay + p"), pay: read(".pay"), payVisible: visible(".pay"),
    farms: read(".plans"), farmsVisible: visible(".plans"),
    farmLinks: [...document.querySelectorAll(".plans a")].map(a => a.getAttribute("href")),
    farmBadges: [...document.querySelectorAll(".plans .badge")].map(chip => chip.textContent),
    positions: document.querySelectorAll(".positions > div").length,
    labels, steps,
    gas: document.querySelector(".gas")?.innerText.replace("\n", " · "), gasVisible: visible(".gas"),
    exits: [...document.querySelectorAll(".exits li")].map(li => li.textContent),
    exitsVisible: visible(".exits"),
    planVisible: visible(".steps"),
    quoteVisible: visible(".quote"), quotePass,
    attribution: read(".drivers"), attributionVisible: visible(".drivers"),
    peersVisible: visible(".detail > :last-child > :last-child"),
    curve: read(".curve"), heldOut: read(".misses"), timing: read(".research") && read("#view .inset p"),
    capMisses: [...document.querySelectorAll(".misses strong")].map(node => node.textContent),
    oddsMisses: read(".odds-misses")?.match(/[\d.]+×/g),
    termRows: [...document.querySelectorAll("#term-tests tbody tr")].map(tr => [...tr.cells].map(cell => cell.textContent.trim())),
    assumptions: read("#assumptions .drawer ul"),
    assumptionTables: [...document.querySelectorAll("#assumptions table")].map(table => table.textContent),
    stress: read(".detail .facts"), stressVisible: visible(".detail .facts"), rowCheck: chips[0]?.textContent,
    rowPass: chips[0]?.dataset.pass,
    chart: read("#yield p"), scope: document.querySelector("#filter-scope")?.value,
    filter: document.querySelector("#filter-verdict")?.value,
    rows: rows.map(row => {
      const { slug, factors } = row.dataset;
      return [slug, Number(row.cells[0].textContent), ...factors.split(",").map(Number), row.querySelector(".badge").textContent, watchlist.has(slug)];
    }),
    completeRows, width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
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
  const { snapshot } = JSON.parse(data.slice("globalThis.LaunchRadarData = ".length, -1));
  const { value, odds, rows } = api.buildModel(snapshot);
  const { exits, gas, chain, cost, transactions } = rows.find(row => row.slug === "upshift").plan;
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format;
  const gasLine = `${transactions} tx x ${money(chain.gas)} on ${chain.name} = ${money(gas)} · ${(100 * (gas / cost)).toFixed(1)}% of all-in cost`;
  const { selected, baseline, evidence, search } = value.validation;
  const termRows = [...evidence, ...odds.evidence,
    { term: "Flat cap / TVL ratio", withTerm: selected, without: baseline, verdict: "Baseline" }, ...search
  ].map(({ term, withTerm, without, verdict }) => [term,
    ...["loo", "walk", "family"].flatMap(key => [withTerm[key], without[key]].map(sample => sample?.n
      ? `${sample.miss.toFixed(withTerm.family ? 3 : 2)}× / ${(sample.hits[1] * 100).toFixed(0)}%` : "—")), verdict]);
  const work = mkdtempSync("/work/.tmp/rw-firefox-");
  try {
    let port;
    try {
      port = await freePort();
    } catch (error) {
      if (!["EPERM", "EACCES"].includes(error.code)) throw error;
      console.log("Loopback TCP unavailable. Using Firefox headless PNG capture with page diagnostics.");
    }
    const verify = (name, info) => {
      const check = /^(\d+)\/(\d+) self-checks pass(?: · 1\/1 rows match)?$/.exec(info.checks);
      if (!check || check[1] !== check[2] || Number(check[1]) === 0 || info.checksPass !== "true") {
        throw new Error(`${name}: ${info.checks}`);
      }
      if (name === "2-detail.jpg" && !info.checks.endsWith(" · 1/1 rows match")) throw new Error(`${name}: missing row check`);
      if (["1-board.jpg", "3-filtered.jpg"].includes(name) && (!info.integrityPass || !info.helpPass)) {
        throw new Error(`${name}: integrity strip or explanation failed (${info.integrityLines} lines, widths ${info.integrityWidth}, help ${info.helpPass}): ${info.integrity.join(" · ")}`);
      }
      if (info.width !== width || info.height !== (name === "2-detail.jpg" ? detailHeight : height) || info.dpr !== 1) {
        throw new Error(`Unexpected Firefox viewport ${info.width}×${info.height} at DPR ${info.dpr}.`);
      }
      if (info.scrollbar) throw new Error(`${name}: page scrollbar occupies ${info.scrollbar}px`);
      const slugs = new Set(info.rows.map(([slug]) => slug));
      if (slugs.size !== info.rows.length || info.rows.some(([slug, rank, value, launch, odds, issuer], i) => {
        const row = boardBySlug.get(slug);
        return row?.rank !== rank || row.implied_value_usd !== value || row.launch_value_usd !== launch
          || row.token_odds !== odds || row.issuer_factor !== issuer || (i > 0 && info.rows[i - 1][1] >= rank);
      })) {
        throw new Error(`${name}: page order or values differ from board.json`);
      }
      if (info.rows.length && (info.rowPass !== "true" || info.rowCheck !== `✓ Rows match board.json ${info.rows.length}/${info.rows.length}`)) {
        throw new Error(`${name}: ${info.rowCheck}`);
      }
      if (["1-board.jpg", "calibration"].includes(name) && (!/carried TVL.*n=\d+/.test(info.curve)
        || !["Leave-one-out", "Walk-forward", "Family hold-out"].every(label => info.heldOut?.includes(label))
        || ![80, 50].every(level => info.coverage?.includes(`${level}% range ${(value.ranges.heldOut[level] * 100).toFixed(0)}%`))
        || !info.nested?.includes(`Nested walk-forward ${value.nested.miss.toFixed(2)}×`))) {
        throw new Error(`${name}: calibration summary is incomplete.`);
      }
      if (name === "1-board.jpg" && (info.rows.length !== board.length || info.completeRows < 10 || !info.chart)) {
        throw new Error(`The full board did not render with 10 complete rows in view (${info.completeRows}).`);
      }
      if (name === "1-board.jpg" && (!info.farmsVisible || !info.farms?.includes("Best plans that clear break-even")
        || info.farmLinks.length !== 5 || new Set(info.farmLinks).size !== 5
        || info.farmBadges.length !== 5 || info.farmBadges.some(badge => badge !== "MARGINAL")
        || info.farmLinks.some(href => !href.startsWith("#detail/") || !boardBySlug.has(decodeURIComponent(href.slice(8)))))) {
        throw new Error("The break-even panel did not render five linked MARGINAL plans.");
      }
      if (name === "calibration") {
        if (!info.timing?.includes("F walk-forward AUC")) throw new Error("Missing launch calibration.");
        const cap = ["loo", "walk", "family"].map(key => `${selected[key].miss.toFixed(3)}×`);
        const oddsMiss = ["loo", "walk"].map(key => `${odds.validation[key].miss.toFixed(2)}×`);
        if (info.capMisses.join() !== cap.join() || info.oddsMisses?.join() !== oddsMiss.join()) {
          throw new Error("Headline misses differ from the fitted model.");
        }
        if (JSON.stringify(info.termRows) !== JSON.stringify(termRows)) throw new Error("Calibration rows differ from the fitted model.");
        if (!info.assumptions?.includes("untested assumption (no traded rows carry the flag)")) {
          throw new Error("Missing issuer haircut note in Assumptions.");
        }
        if (!info.assumptionTables.some(table => table.includes("Gas/tx") && /Other chains\$1\.50/.test(table))) {
          throw new Error("Missing chain gas assumptions or fallback.");
        }
        console.log("Calibration terms (median miss / within 3×):");
        for (const row of info.termRows) console.log(`  ${row.join(" | ")}`);
      }
      if (name === "2-detail.jpg" && (info.steps.length < 3
        || !/^80% \$.*–\$.* · 50% \$.*–\$/u.test(info.valueRange)
        || !/Expected net.*(robust across 80% range|flips to .+ at the (low|high) end)/iu.test(info.rangeFarm)
        || info.labels.map(label => label.split(" ")[0]).join() !== "1,2a,2b,2c,3a,3b,3c,4,5,6,7"
        || !/Launch within (30|90|180|365) d: [\d.]+% \(q\) vs p\*/.test(info.summary)
        || !info.oddsNote?.includes("no launch dates") || !info.oddsNote.includes("F walk-forward AUC")
        || !info.steps.every(step => /\d+ min/.test(step) && /\$\d/.test(step))
        || !info.steps[0].includes("deposit caps") || !info.steps.some(step => step.startsWith("If TVL"))
        || !info.gasVisible || info.gas !== gasLine || !info.exitsVisible
        || JSON.stringify(info.exits) !== JSON.stringify(exits) || !info.steps.some(step => step.startsWith("If " + exits[0]))
        || JSON.stringify(info.steps) !== JSON.stringify(boardBySlug.get("upshift")?.farm_steps)
        || !info.attributionVisible || !info.planVisible || !info.quoteVisible || !info.quotePass || !info.peersVisible
        || !["TVL size", "7d carry", "Age on odds", "Issuer"].every(label => info.attribution?.includes(label))
        || !info.steps.some(step => step.includes("p*") && /Gas \+ slip cap \$[\d.]+/.test(step))
        || !info.steps.some(step => step.includes("deposit $80 USDC and withdraw it"))
        || !info.payVisible || !info.pay?.includes("What would make it pay")
        || !info.steps.at(-1).startsWith("Revisit if a points program or snapshot is announced:")
        || !info.stressVisible || !info.stress?.includes("½ share"))) {
        throw new Error(`Detail checks failed: ${JSON.stringify(info)}`);
      }
      if (name === "3-filtered.jpg" && (!info.portfolio?.includes("watchlist portfolio") || info.scope !== "watchlist" || info.filter !== "SKIP"
        || !info.rows.length || info.rows.some(row => row[6] !== "SKIP" || !row[7]))) {
        throw new Error("The filtered watchlist did not render.");
      }
    };
    const images = port ? await shootBidi(url, work, port, verify) : await shootCli(output, work, verify);
    mkdirSync(destination, { recursive: true });
    for (const { name, info, bytes, encoder } of images) {
      const dimensions = jpegSize(bytes);
      if (dimensions[0] !== width || dimensions[1] !== info.height) throw new Error("Unexpected screenshot dimensions.");
      writeFileSync(join(destination, name), bytes);
      const content = [info.title, info.count, info.rowCheck, info.first, info.chart, info.summary, info.defaultHalfOdds, info.portfolio].filter(Boolean).join(" · ");
      console.log(`${name} · ${dimensions.join("×")} · ${bytes.length} bytes · ${encoder} · ${info.checks}\n  ${content}`);
      if (name === "1-board.jpg") console.log(`  ${info.completeRows} complete rows in view · DOM ready in ${info.loadMs} ms · ${info.coverage} · ${info.nested}`);
      if (name === "2-detail.jpg") console.log(`  ${info.gas}\n  ${info.exits.join("\n  ")}`);
      if (info.valueRange) console.log(`  ${info.valueRange} · ${info.rangeFarm}`);
      if (info.integrity.length) console.log(`  ${info.integrityLines} integrity line · ${info.integrity.join(" · ")}`);
    }
    console.log("Firefox reported no console errors or uncaught exceptions.");
    console.log("Calibration, detail attribution, board-matched decision tree, and live quote horizon selection, update and reset pass.");
  } finally {
    spawnSync("find", [work, "-mindepth", "1", "-delete"]);
    rmdirSync(work);
  }
}

const [output, destination] = process.argv.slice(2);
if (!output) throw new Error("Usage: node tools/shoot.mjs <build dir> [screenshot dir]");
await shoot(resolve(output), destination ? resolve(destination) : join(resolve(output), "screenshots"));
