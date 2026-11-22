// Launch Radar: a token launch radar entry for make.fun's token-radar-01 (Node 22, standard library only).
//
// Reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), runs the value model in
// dashboard/model.js (the same file the page runs, so board.json and the screenshots cannot disagree),
// checks the board against the gate's rules, and writes to /output (or MAKEFUN_OUTPUT_DIR / --output):
//   board.json    the ranked pre-token board, every row with its implied value and farm steps
//   data.js       the snapshot's figures for the page, which recomputes the board from them
//   dashboard/    the page, copied
//   screenshots/  the three captures, copied
//   dossier.json  written last, with the vendored make.fun library
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

interface Protocol {
  slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number; change_7d: number | null;
  mcap_usd: number | null; listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
interface Snapshot { as_of: string; source: string; floor_usd: number; protocols: Protocol[]; watchlist: string[] }
interface Row { rank: number; slug: string; name: string; implied_value_usd: number; farm_steps: string[] }

const here = fileURLToPath(new URL('.', import.meta.url));
const Radar = createRequire(import.meta.url)('./dashboard/model.js') as {
  build(s: Snapshot): { rows: unknown[]; products: unknown[]; live: unknown[]; fit: { slope: number; n: number } };
  boardRows(r: unknown): Row[];
};

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}
function fail(msg: string): never {
  process.stderr.write(`launch radar: ${msg}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}`);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const raw = JSON.parse(readFileSync(inputFile, 'utf8')) as Snapshot;
if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist) || typeof raw.as_of !== 'string') fail('the snapshot lacks protocols, watchlist or as_of');
// Keep exactly the ten documented fields, typed, so the model and the page read the same record.
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const snapshot: Snapshot = {
  as_of: raw.as_of,
  source: String(raw.source ?? ''),
  floor_usd: Number(raw.floor_usd),
  watchlist: raw.watchlist.filter((s) => typeof s === 'string'),
  protocols: raw.protocols
    .filter((p) => typeof p?.slug === 'string' && typeof p.name === 'string' && num(p.tvl_usd) !== null)
    .map((p) => ({
      slug: p.slug, name: p.name, category: str(p.category), chains: Array.isArray(p.chains) ? p.chains.filter((c) => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd, change_7d: num(p.change_7d), mcap_usd: num(p.mcap_usd), listed_at: str(p.listed_at), gecko_id: str(p.gecko_id), symbol: str(p.symbol),
    })),
};

const radar = Radar.build(snapshot);
const rows = Radar.boardRows(radar);

/** The gate's board rules, checked before anything is written. */
function boardIssue(board: Row[]): string | null {
  if (board.length < 100 || board.length > 4000) return `${board.length} rows, not 100 to 4,000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const [i, r] of board.entries()) {
    if (!known.has(r.slug) || seen.has(r.slug)) return `row ${i + 1} slug ${r.slug} is unknown or repeated`;
    seen.add(r.slug);
    if (r.rank !== i + 1) return `row ${i + 1} has rank ${r.rank}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 1e14) return `${r.slug} implied value ${r.implied_value_usd}`;
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `${r.slug} outranks the row above it`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length) return `watchlist slugs missing: ${missing.join(', ')}`;
  if (board[0]!.implied_value_usd === board.at(-1)!.implied_value_usd) return 'every row has the same implied value';
  return null;
}
const issue = boardIssue(rows);
if (issue !== null) fail(`the board breaks a gate rule: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ as_of: snapshot.as_of, source: snapshot.source, model: 'dashboard/model.js', rows })}\n`);
writeFileSync(join(out, 'data.js'), `window.SNAPSHOT=${JSON.stringify(snapshot)};\n`);

function copyFiles(from: string, to: string): string[] {
  mkdirSync(to, { recursive: true });
  const names = readdirSync(from).filter((n) => !n.startsWith('.') && statSync(join(from, n)).isFile()).sort();
  for (const n of names) copyFileSync(join(from, n), join(to, n));
  return names;
}
const pages = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) fail(`screenshots/ holds ${shots.length} images, not 3 or 4`);

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `launch radar: ${snapshot.protocols.length} protocols; fit on ${radar.fit.n} trading tokens (size elasticity ${(1 + radar.fit.slope).toFixed(2)}); ` +
    `${rows.length} pre-token rows ranked, ${radar.products.length} wrapped/bridged/staked products set aside; watchlist ${snapshot.watchlist.length}/${snapshot.watchlist.length} covered\n` +
    `launch radar: wrote board.json, data.js, dashboard/ (${pages.length} files), screenshots/ (${shots.length}) and dossier.json to ${out}\n`,
);
