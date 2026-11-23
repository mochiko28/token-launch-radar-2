// Capture the dashboard's three screenshots from a built output directory, with headless Chromium over
// the DevTools protocol (Node's own WebSocket, nothing installed). Each capture is the page at
// 1440 wide by SHOT_H (default 1340; the gate takes a long side up to 1440, a short side from 800) at a URL hash, saved as PNG when that lands in 300-350 KB, else as the JPEG quality that does.
//   node tools/shoot.mjs <chrome binary> <output dir> <screenshots dir>
import { spawn } from 'node:child_process';
import { writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [chrome, outDir, shotDir] = process.argv.slice(2);
// An optional fourth argument, name=hash pairs split by spaces, captures other views for review.
const SHOTS = process.argv[5] ? process.argv[5].split(' ').map((s) => [s.split('=')[0], s.slice(s.indexOf('=') + 1)]) : [
  ['1-board', '', 1440],
  ['2-detail', '#p=nonce-capital', 1280],
  ['3-filtered', '#dep=10000&verdict=farm&sort=plan&dir=desc', 1340],
];
const H = Number(process.env.SHOT_H || 1340);
const LO = 300 * 1024, HI = 350 * 1000; // inside 300-350 KB whether a KB is 1,000 or 1,024 bytes

// A port nobody answers on: a leftover browser on a reused port would hand back its own stale page.
let port;
for (let i = 0; i < 20 && !port; i++) {
  const p = 9300 + Math.floor(Math.random() * 500);
  try { await fetch(`http://127.0.0.1:${p}/json`); } catch { port = p; }
}
if (!port) throw new Error('no free debugging port');
const proc = spawn(chrome, ['--headless', `--remote-debugging-port=${port}`, `--window-size=1440,${H}`, '--hide-scrollbars', '--force-device-scale-factor=1', '--no-sandbox', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => proc.kill());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const waiting = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const n = ++id; waiting.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });

await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: H, deviceScaleFactor: 1, mobile: false });
for (const name of readdirSync(shotDir)) if (/\.(png|jpe?g)$/.test(name)) unlinkSync(join(shotDir, name));
const page = 'file://' + resolve(outDir, 'dashboard/index.html');
for (const [name, hash, h] of SHOTS) {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: h || H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: page + hash });
  await sleep(900);
  const at = (await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true })).result.result.value;
  if (at !== page + hash) throw new Error(`${name}: browser shows ${at}, not ${page + hash}`);
  const png = Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64');
  let file = name + '.png', bytes = png;
  if (!process.argv[5] && (png.length < LO || png.length > HI)) {
    let lo = 30, hi = 100, best = null, bestQ = 0;
    while (lo <= hi) {
      const q = (lo + hi) >> 1;
      const jpg = Buffer.from((await send('Page.captureScreenshot', { format: 'jpeg', quality: q })).result.data, 'base64');
      if (jpg.length > HI) hi = q - 1; else { if (jpg.length >= LO) { best = jpg; bestQ = q; } lo = q + 1; }
    }
    if (!best) throw new Error(`${name}: no PNG or JPEG quality lands in 300-350 KB (png ${png.length})`);
    file = name + '.jpg'; bytes = best; console.log(`${name}: jpeg quality ${bestQ}`);
  }
  writeFileSync(join(shotDir, file), bytes);
  console.log(`${file} ${bytes.length} bytes`);
}
ws.close(); proc.kill();
