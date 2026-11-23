import { cpSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildDossier } from "./vendor/makefun-board.ts";
import modelApi from "./dashboard/model.js";
import { assetChecks } from "./tools/check-board.mjs";

function options(args: string[]) {
  let input = "/input/snapshot.json";
  let output = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  for (let i = 0; i < args.length; i += 2) {
    const [key, value] = args.slice(i, i + 2);
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    if (key === "--input") input = value;
    else if (key === "--output") output = value;
    else throw new Error(`Unknown option ${key}`);
  }
  return { input, output };
}

function run() {
  const { input, output } = options(process.argv.slice(2));
  const inputFile = statSync(input).isDirectory() ? join(input, "snapshot.json") : input;
  const snapshot = readSnapshot(inputFile);
  const model = modelApi.buildModel(snapshot);
  const boardDigest = modelApi.digest(model.board.rows);
  const boardText = JSON.stringify(model.board, null, 2) + "\n";
  requirePass(modelApi.boardChecks(model.board, snapshot, Buffer.byteLength(boardText)), "Board gate");
  requirePass(modelApi.selfChecks(model, snapshot, boardDigest), "Model checks");
  mkdirSync(output, { recursive: true });
  for (const dir of ["dashboard", "screenshots"]) {
    cpSync(join(import.meta.dirname, dir), join(output, dir), { recursive: true });
  }
  compactDashboard(join(output, "dashboard"));
  requirePass(assetChecks(output), "Asset gate");
  const dossier = buildDossier(output, { text_max_bytes: 65536 });
  if (dossier.byteLength > 1.5 * 1024 * 1024) throw new Error("Dossier exceeds the gate's 1.5 MiB limit.");
  const dossierText = JSON.parse(new TextDecoder().decode(dossier)).text;
  if (/^\[Cut at 65536 bytes:/m.test(dossierText)) throw new Error("Dashboard source exceeds the dossier text budget.");
  const data = JSON.stringify({ snapshot, boardDigest });
  writeFileSync(join(output, "board.json"), boardText);
  writeFileSync(join(output, "data.js"), `globalThis.LaunchRadarData = ${data};\n`);
  writeFileSync(join(output, "dossier.json"), dossier);
  console.log(`Wrote ${model.counts.ranked} ranked rows with board digest ${boardDigest}.`);
}

function compactDashboard(dir: string) {
  const write = (file: string, format: (source: string) => string) => {
    const path = join(dir, file);
    writeFileSync(path, format(readFileSync(path, "utf8")));
  };
  // Keep statement boundaries and the unindented template data intact.
  for (const file of ["app.js", "model.js"]) write(file, source => source
    .replace(/(?<=[({[,]|=>)\n\t+|\n\t*(?=[\]})])/g, "")
    .replace(/^\t+|\n(?=\n)/gm, ""));
  write("style.css", source => source.replace(/(?<=[{};])\n\t*(?=\S)/g, ""));
  write("index.html", source => source.replace(/(?<=>)\n(?=<)/g, ""));
}

function readSnapshot(file: string) {
  const snapshot = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(file)));
  if (!snapshot || !Number.isFinite(Date.parse(snapshot.as_of)) || !Array.isArray(snapshot.protocols) || !Array.isArray(snapshot.watchlist)) {
    throw new Error("Snapshot must contain as_of, protocols and watchlist.");
  }
  const slugs = new Set<string>();
  for (const p of snapshot.protocols) {
    if (!p || typeof p.slug !== "string" || !/^\S{1,128}$/u.test(p.slug) || typeof p.name !== "string" || !p.name.trim()
      || !Number.isFinite(p.tvl_usd) || p.tvl_usd <= 0 || !Array.isArray(p.chains) || !p.chains.length
      || p.chains.some((chain: unknown) => typeof chain !== "string" || !chain.trim())
      || (p.change_7d != null && !Number.isFinite(p.change_7d))
      || (p.mcap_usd != null && !Number.isFinite(p.mcap_usd))) {
      throw new Error(`Invalid protocol record: ${p?.slug ?? "(missing slug)"}.`);
    }
    if (slugs.has(p.slug)) throw new Error(`Duplicate protocol slug: ${p.slug}.`);
    slugs.add(p.slug);
  }
  if (new Set(snapshot.watchlist).size !== snapshot.watchlist.length || snapshot.watchlist.some((slug: string) => !slugs.has(slug))) {
    throw new Error("Watchlist slugs must be known and unique.");
  }
  return snapshot;
}

function requirePass(checks: { name: string; pass: boolean; detail?: string }[], context: string) {
  const failures = checks.filter(check => !check.pass).map(check => check.detail ? `${check.name} (${check.detail})` : check.name);
  if (failures.length) throw new Error(`${context} failed: ${failures.join(", ")}`);
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
