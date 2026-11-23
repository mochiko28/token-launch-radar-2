import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier, PLAIN_NAME } from "../vendor/makefun-board.ts";
import api from "../dashboard/model.js";

const KIB = 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });
const url = /https?:\/\//i;
const remoteImport = /\b(?:(?:import|require)\s*\(\s*|(?:from|import)\s*)["'`]https?:\/\//i;

function filesUnder(root, dir = root) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    const label = relative(root, file);
    if (entry.isDirectory() && !entry.name.startsWith(".")) files.push(...filesUnder(root, file));
    else if (entry.isFile() && PLAIN_NAME.test(entry.name)) files.push(file);
    else throw new Error(`${label} is not a permitted file or directory`);
  }
  return files;
}

function namesNetworkAddress(file, source) {
  if (/\.css$/i.test(file)) return url.test(source.replace(/\/\*[\s\S]*?\*\//g, ""));
  if (/\.[cm]?js$/i.test(file)) return remoteImport.test(source);
  const html = source.replace(/<!--[\s\S]*?-->/g, "");
  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    if (url.test(match[1].replace(/\/\*[\s\S]*?\*\//g, ""))) return true;
  }
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    if (remoteImport.test(match[1])) return true;
  }
  const markup = html.replace(/(<(?:style|script)\b[^>]*>)[\s\S]*?(<\/(?:style|script)\s*>)/gi, "$1$2");
  for (const match of markup.matchAll(/<[A-Za-z](?:[^>"']|"[^"]*"|'[^']*')*>/g)) {
    for (const attr of match[0].matchAll(/\s[^\s"'<>/=]+\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+))/g)) {
      if (url.test(attr[1] ?? attr[2] ?? attr[3])) return true;
    }
  }
  return false;
}

function checkDashboard(root) {
  const folder = join(root, "dashboard");
  if (!lstatSync(folder).isDirectory()) throw new Error("dashboard/ must be a directory");
  const files = filesUnder(folder);
  if (!files.includes(join(folder, "index.html")) || !files.some(f => f.endsWith(".css")) || !files.some(f => f.endsWith(".js"))) {
    throw new Error("dashboard/ requires index.html, a CSS file and a JavaScript file");
  }
  const bytes = files.reduce((sum, file) => sum + lstatSync(file).size, 0);
  if (files.length > 400 || bytes > 4 * KIB * KIB) {
    throw new Error("dashboard/ exceeds the file count or byte limit");
  }
  if (bytes > 64_000) {
    throw new Error("dashboard/ exceeds the 64,000-byte source budget");
  }
  for (const file of files.filter(f => /\.(?:html?|css|[cm]?js)$/i.test(f))) {
    if (namesNetworkAddress(file, decoder.decode(readFileSync(file)))) {
      throw new Error(`${relative(folder, file)} names a network address`);
    }
  }
}

function imageDimensions(bytes) {
  if (bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") {
    if (bytes.length < 45 || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") return;
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    let hasData = false;
    for (let pos = 33; pos + 12 <= bytes.length;) {
      const size = bytes.readUInt32BE(pos);
      const type = bytes.toString("ascii", pos + 4, pos + 8);
      pos += size + 12;
      if (type === "IDAT" && size > 0) hasData = true;
      if (type === "IEND" && size === 0 && pos === bytes.length && hasData) return [width, height];
    }
  }
  if (bytes.length < 12 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) return;
  let dimensions;
  for (let pos = 2; pos + 4 <= bytes.length;) {
    if (bytes[pos++] !== 0xff) return;
    while (bytes[pos] === 0xff) pos++;
    const marker = bytes[pos++];
    if (pos + 2 > bytes.length) return;
    const size = bytes.readUInt16BE(pos);
    if (size < 2 || pos + size > bytes.length - 2) return;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && size >= 8) {
      dimensions = [bytes.readUInt16BE(pos + 5), bytes.readUInt16BE(pos + 3)];
    }
    if (marker === 0xda) return dimensions;
    pos += size;
  }
}

function checkScreenshots(root) {
  const folder = join(root, "screenshots");
  if (!lstatSync(folder).isDirectory()) throw new Error("screenshots/ must be a directory");
  const files = readdirSync(folder, { withFileTypes: true }).filter(entry => !entry.name.startsWith("."));
  if (files.length < 3 || files.length > 4) throw new Error("screenshots/ must contain three or four images");
  for (const entry of files) {
    const file = join(folder, entry.name);
    if (!entry.isFile() || !PLAIN_NAME.test(entry.name) || lstatSync(file).size > 512 * KIB) {
      throw new Error(`${entry.name} exceeds a name, type or byte limit`);
    }
    const size = imageDimensions(readFileSync(file));
    if (!size || Math.min(...size) < 800 || Math.max(...size) > 1440) {
      throw new Error(`${entry.name} must be a whole PNG or JPEG sized within 800–1440 pixels per side`);
    }
  }
}

function checked(name, run) {
  try {
    run();
    return { name, pass: true };
  } catch (error) {
    return { name, pass: false, detail: error.message };
  }
}

export function assetChecks(output) {
  return [
    checked("dashboard_files", () => checkDashboard(output)),
    checked("screenshots", () => checkScreenshots(output))
  ];
}

function validate(output, snapshot) {
  let boardChecks;
  let actualBoard;
  try {
    const bytes = readFileSync(join(output, "board.json"));
    actualBoard = JSON.parse(decoder.decode(bytes));
    boardChecks = api.boardChecks(actualBoard, snapshot, bytes.length);
  } catch (error) {
    boardChecks = [{ name: "board_file", pass: false, detail: error.message }];
  }
  const dossierCheck = checked("dossier_matches", () => {
    const actual = readFileSync(join(output, "dossier.json"));
    const rebuilt = Buffer.from(buildDossier(output, { text_max_bytes: 65536 }));
    if (actual.length > 1.5 * KIB * KIB || !actual.equals(rebuilt)) throw new Error("wrong bytes or exceeds 1.5 MiB");
  });
  return { actualBoard, checks: [...assetChecks(output), ...boardChecks, dossierCheck] };
}

function report(output, input) {
  const snapshot = JSON.parse(decoder.decode(readFileSync(input)));
  const { actualBoard, checks } = validate(output, snapshot);
  for (const { name, pass, detail } of checks) console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (checks.some(check => !check.pass)) {
    process.exitCode = 1;
    return;
  }

  const model = api.buildModel(snapshot);
  const actualRows = Array.isArray(actualBoard) ? actualBoard : actualBoard.rows;
  const self = api.selfChecks(model, snapshot, api.digest(actualRows));
  const passed = self.filter(check => check.pass).length;
  console.log(`${passed}/${self.length} model self-checks pass (including board digest)`);
  const { traded, recorded, setAside, ranked, watchlistCovered, watchlistTotal, total, valueFit, oddsFit } = model.counts;
  console.log(`${traded} traded with cap + ${recorded} token recorded without cap + ${setAside} products set aside + ${ranked} pre-token ranked = ${total} | watchlist ${watchlistCovered}/${watchlistTotal}`);
  const { fit, validation } = model.value;
  const names = ["intercept", "logCarriedTvl", ...fit.features.map(([, name]) => name)];
  const curve = names.map((name, i) => `${name}=${fit.coefficients[i].toFixed(6)}`).join(", ");
  console.log(`Log market-cap fit (${valueFit} tokens, TVL divided by $100M): ${curve}`);
  for (const [key, label] of [["loo", "LOO"], ["walk", "Walk-forward"], ["family", "Family hold-out"]]) {
    console.log(`${label} median miss ${validation.selected[key].miss.toFixed(3)}x vs ${validation.baseline[key].miss.toFixed(3)}x flat (n=${validation.selected[key].n})`);
    const result = model.odds.validation[key];
    if (result) console.log(`${label} token odds AUC ${result.auc.toFixed(3)} (n=${result.n} of ${oddsFit})`);
  }
  console.log("Token odds are the logistic probability of a snapshot token record given TVL and listing age. The snapshot has no launch dates.");
  console.log(Object.entries(model.verdicts).map(([name, n]) => `${name} ${n}`).join(" | "));
  for (const [scenario, { all, farm }] of Object.entries(model.stress)) {
    console.log(`${scenario}, all rows (base FARM): ${Object.entries(all).map(([verdict, count]) => `${verdict} ${count} (${farm[verdict]})`).join(" | ")}`);
  }
  const { portfolio } = model;
  console.log(`Portfolio: ${portfolio.positions.length} positions, $${portfolio.capital.toFixed(2)} capital, $${portfolio.cost.toFixed(2)} cost, $${portfolio.net.toFixed(2)} expected net`);
  console.table(portfolio.positions.map(({ name, capital, cost, net }) => ({
    name, capital: capital.toFixed(2), cost: cost.toFixed(2), expected_net: net.toFixed(2)
  })));
  console.table(model.rows.slice(0, 10).map(p => ({
    name: p.name, value_usd: p.score, token_odds: p.tokenOdds.toFixed(4), verdict: p.plan.verdict
  })));
  if (passed !== self.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , output = process.env.MAKEFUN_OUTPUT_DIR || "/output", input = "/input/snapshot.json"] = process.argv;
  report(output, input);
}
