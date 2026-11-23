import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const width = 1440;
const height = 980;
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

const fits = bytes => bytes.length >= minimum && bytes.length <= maximum;

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
  throw new Error(`No JPEG met the byte budget. ${candidates.join(", ")}`);
}

const shots = [
  { name: "1-board.jpg", hash: "#board" },
  { name: "2-detail.jpg", hash: "#detail/upshift" },
  { name: "3-filtered.jpg", hash: "#board?scope=watchlist&verdict=FARM" }
];

function readPage() {
  const read = selector => document.querySelector(selector)?.textContent.trim();
  const rows = [...document.querySelectorAll("tr[data-slug]")];
  const watchlist = new Set(globalThis.LaunchRadarData.snapshot.watchlist);
  return {
    checks: read("#checks"), title: read("h1"), count: read("#row-count"), first: read("tbody tr th a"),
    portfolio: read(".portfolio h2"), verdict: read(".plan-panel .badge"),
    positions: document.querySelectorAll(".positions > div").length,
    steps: document.querySelectorAll(".plan-steps li").length,
    eligibility: read(".plan-steps li:nth-child(2)"), stress: read(".detail-aside .facts"),
    chart: read(".chart-note"), scope: document.querySelector("#filter-scope")?.value,
    filter: document.querySelector("#filter-verdict")?.value,
    rows: rows.map(row => [row.dataset.slug, Number(row.dataset.value), row.querySelector(".badge").textContent, watchlist.has(row.dataset.slug)]),
    width: innerWidth, height: innerHeight, dpr: devicePixelRatio
  };
}

function startFirefox(work, args, prefs = "") {
  const profile = mkdtempSync(join(work, "profile-"));
  if (prefs) writeFileSync(join(profile, "user.js"), prefs);
  const child = spawn("/usr/bin/firefox", ["--headless", "--no-remote", "--profile", profile, ...args], {
    env: {
      ...process.env, MOZ_CRASHREPORTER_DISABLE: "1",
      XDG_CONFIG_HOME: join(work, "config"), XDG_CACHE_HOME: join(work, "cache"), XDG_DATA_HOME: join(work, "data")
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
    await call("browsingContext.setViewport", { context, viewport: { width, height }, devicePixelRatio: 1 });
    async function evaluate(expression) {
      const answer = await call("script.evaluate", { expression, target: { context }, awaitPromise: true });
      if (answer.type === "exception") throw new Error(answer.exceptionDetails.text);
      return JSON.parse(answer.result.value);
    }
    const images = [];
    for (const { name, hash } of shots) {
      await call("browsingContext.navigate", { context, url: url + hash, wait: "complete" });
      const info = await evaluate(`(async () => {
        await document.fonts.ready;
        await new Promise(ready => requestAnimationFrame(() => requestAnimationFrame(ready)));
        return JSON.stringify((${readPage})());
      })()`);
      if (errors.length) throw new Error(errors.join("\n"));
      verify(name, info);
      images.push({ name, info, ...await captureJpeg(call, context, work) });
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
  const html = readFileSync(page, "utf8").replace("<head>", '<head>\n<script src="capture-probe.js"></script>');
  writeFileSync(page, html);
  writeFileSync(join(dashboard, "capture-probe.js"), `${readPage}\n(${installProbe})();\n`);
  const url = pathToFileURL(page).href;
  const images = [];
  for (const { name, hash } of shots) {
    const png = join(work, name + ".png");
    const browser = startFirefox(work, ["--window-size", `${width},${height}`, "--screenshot", png, url + hash],
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
      images.push({ name, info, ...encodeJpeg(png, work) });
    } finally {
      await browser.stop();
    }
  }
  return images;
}

async function shoot(output, destination) {
  const board = JSON.parse(readFileSync(join(output, "board.json"), "utf8")).rows;
  const boardValues = new Map(board.map(row => [row.slug, row.implied_value_usd]));
  const url = pathToFileURL(join(output, "dashboard", "index.html")).href;
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
      const check = /^(\d+)\/(\d+) self-checks pass$/.exec(info.checks);
      if (!check || check[1] !== check[2] || Number(check[1]) === 0) throw new Error(`${name}: ${info.checks}`);
      if (info.width !== width || info.height !== height || info.dpr !== 1) {
        throw new Error(`Unexpected Firefox viewport ${info.width}×${info.height} at DPR ${info.dpr}.`);
      }
      const slugs = new Set(info.rows.map(([slug]) => slug));
      if (slugs.size !== info.rows.length || info.rows.some(([slug, value]) => boardValues.get(slug) !== value)) {
        throw new Error(`${name}: page values differ from board.json`);
      }
      if (name === "1-board.jpg" && (info.rows.length !== board.length || !info.chart)) throw new Error("The full board did not render.");
      if (name === "2-detail.jpg" && (!["FARM", "MARGINAL"].includes(info.verdict) || info.steps < 3
        || !info.eligibility?.includes("deposit caps") || !info.stress?.includes("depositor share"))) {
        throw new Error("The detail route must show a farm plan, eligibility and resized stress.");
      }
      if (name === "3-filtered.jpg" && (!info.portfolio || info.positions < 3 || info.scope !== "watchlist" || info.filter !== "FARM"
        || !info.rows.length || info.rows.some(([, , verdict, watchlist]) => verdict !== "FARM" || !watchlist))) {
        throw new Error("The filtered watchlist did not render.");
      }
    };
    const images = port ? await shootBidi(url, work, port, verify) : await shootCli(output, work, verify);
    mkdirSync(destination, { recursive: true });
    for (const { name, info, bytes, encoder } of images) {
      const dimensions = jpegSize(bytes);
      if (dimensions[0] !== width || dimensions[1] !== height) throw new Error("Unexpected screenshot dimensions.");
      writeFileSync(join(destination, name), bytes);
      const content = [info.title, info.count, info.first, info.chart, info.verdict, info.portfolio].filter(Boolean).join(" · ");
      console.log(`${name} · ${dimensions.join("×")} · ${bytes.length} bytes · ${encoder} · ${info.checks}\n  ${content}`);
    }
    console.log("Firefox reported no console errors or uncaught exceptions.");
  } finally {
    spawnSync("find", [work, "-mindepth", "1", "-delete"]);
    rmdirSync(work);
  }
}

const [output, destination] = process.argv.slice(2);
if (!output) throw new Error("Usage: node tools/shoot.mjs <build dir> [screenshot dir]");
await shoot(resolve(output), destination ? resolve(destination) : join(resolve(output), "screenshots"));
