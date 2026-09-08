import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve, basename } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import obfuscator from 'javascript-obfuscator';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PRESET = {
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,          // WAJIB false: getS/setS dll dipakai lintas file via importScripts
  controlFlowFlattening: false,
  deadCodeInjection: false,
  stringArray: true,
  stringArrayThreshold: 0.7,
  selfDefending: false,          // nonaktif agar tidak menjebak user (loop Pause)
  debugProtection: false,
  disableConsoleOutput: false,
  target: 'node',
  simplify: true,
  transformObjectKeys: false,
  splitStrings: false
};
const PRESET_WEB = { ...PRESET, disableConsoleOutput: true };

function ob(code, preset) {
  return obfuscator.obfuscate(code, preset).getObfuscatedCode();
}
function check(name, outPath) {
  try { execSync(`node --check "${outPath}"`, { stdio: 'pipe' }); console.log(`  OK   ${name}`); return true; }
  catch (e) { console.log(`  FAIL ${name}: ${String(e.stderr || e.message)}`); return false; }
}
function checkHtml(name, html) {
  const scripts = [...html.matchAll(INLINE)].map(m => m[1]).filter(s => s.trim());
  let ok = true;
  scripts.forEach((s, i) => {
    const tmp = join(process.env.TEMP, `_ob_${Date.now()}_${i}.js`);
    writeFileSync(tmp, s, 'utf8');
    try { execSync(`node --check "${tmp}"`, { stdio: 'pipe' }); }
    catch (e) { console.log(`  FAIL inline ${name}[${i}]: ${String(e.stderr || e.message)}`); ok = false; }
    finally { rmSync(tmp, { force: true }); }
  });
  if (ok) console.log(`  OK   inline ${name} (${scripts.length} script)`);
  return ok;
}

/* ============================================================
   1) WEB PUBLIK (deploy/) — form klaim + lacak + API serverless.
   2) WEB MASTER (deploy-master/) — panel owner TERPISAH, situs
      sendiri, terkoneksi ke database yang sama.
   Api serverless disalin VERBATIM (tidak diobfuskasi).
   Kunci Supabase TIDAK diinjeksi ke HTML — hanya dari env di Vercel.
   ============================================================ */
const webSrc = join(root, 'web');
const num = { PUBLIC: 0, MASTER: 0 };

const INLINE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

function copyDir(src, dst) {
  if (!existsSync(src)) return;
  mkdirSync(dst, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const s = join(src, e.name), d = join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

/* Rebuild folder deploy tanpa menghapus link Vercel (.vercel) & .env.local,
   supaya `vercel --prod` berikutnya tetap menuju project yg sama. */
function copyEntry(src, dst) {
  if (!existsSync(src)) return;
  if (!statSync(src).isDirectory()) { mkdirSync(dirname(dst), { recursive: true }); copyFileSync(src, dst); return; }
  copyDir(src, dst);
}
function recreateDir(dir) {
  const tmp = join(root, '.keep-' + (dirname(dir) === root ? basename(dir) : 'out'));
  const keep = ['.vercel', '.env.local'];
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  if (existsSync(dir)) {
    mkdirSync(tmp, { recursive: true });
    for (const k of keep) if (existsSync(join(dir, k))) copyEntry(join(dir, k), join(tmp, k));
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });
  for (const k of keep) if (existsSync(join(tmp, k))) copyEntry(join(tmp, k), join(dir, k));
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
}

function buildWebHtml(name, outName, outDir) {
  const file = join(webSrc, name);
  const html = readFileSync(file, 'utf8');
  const obfHtml = html.replace(INLINE, (match, code) =>
    `<script>${ob(code === undefined ? '' : code, PRESET_WEB)}</script>`);
  writeFileSync(join(outDir, outName), obfHtml, 'utf8');
  console.log('web  ' + name + ' -> ' + outName + ' (inline obfuscated)');
  checkHtml(name, obfHtml);
}

/* --- 1a. SITUS PUBLIK --- */
const outWeb = join(root, 'deploy');
recreateDir(outWeb);

buildWebHtml('index.html', 'index.html', outWeb); num.PUBLIC++;

if (existsSync(join(webSrc, 'sb.js'))) {
  writeFileSync(join(outWeb, 'sb.js'), ob(readFileSync(join(webSrc, 'sb.js'), 'utf8'), PRESET_WEB), 'utf8');
  console.log('web  sb.js (obfuscated)');
}
copyFileSync(join(root, 'messageImage_1787629523742.jpg'), join(outWeb, 'messageImage_1787629523742.jpg'));
copyFileSync(join(root, 'vercel.json'), join(outWeb, 'vercel.json'));
copyFileSync(join(webSrc, 'asset', 'qrcode.js'), join(outWeb, 'qrcode.js'));
copyDir(join(webSrc, 'supabase'), join(outWeb, 'supabase'));
copyDir(join(root, 'api', 'public'), join(outWeb, 'api'));
console.log('web  asset + supabase sql + api/ + vercel.json copied');

/* --- 1b. SITUS MASTER (terpisah) --- */
const outMaster = join(root, 'deploy-master');
recreateDir(outMaster);

buildWebHtml('master.html', 'index.html', outMaster); num.MASTER++;

copyFileSync(join(root, 'messageImage_1787629523742.jpg'), join(outMaster, 'messageImage_1787629523742.jpg'));
copyFileSync(join(root, 'vercel.json'), join(outMaster, 'vercel.json'));
copyFileSync(join(webSrc, 'asset', 'qrcode.js'), join(outMaster, 'qrcode.js'));
copyDir(join(webSrc, 'supabase'), join(outMaster, 'supabase'));
copyDir(join(root, 'api', 'master'), join(outMaster, 'api'));
console.log('master  asset + api/ + vercel.json copied');

/* node --check semua file api yang disalin (harus tetap valid JS server) */
function checkApiDir(dir) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) checkApiDir(p);
    else if (f.name.endsWith('.js')) check('api/' + f.name, p);
  }
}
for (const dir of [join(outWeb, 'api'), join(outMaster, 'api')]) {
  if (!existsSync(dir)) continue;
  checkApiDir(dir);
}

/* ============================================================
   2) EXTENSION (dist-extension/) — versi aman utk dipasang.
   ============================================================ */
const extFiles = [
  'background.js', 'app.js', 'popup.js', 'content.js', 'detail_processor.js',
  'tickets_monitor.js', 'bridge-scatter.js', 'web_claim_bridge.js', 'fill_claim_page.js', 'sb.js',
  'lib/constants.js', 'lib/utils.js', 'lib/parser.js', 'lib/token.js',
  'app.html', 'app.css', 'manifest.json', 'web_claim_dashboard.html',
  'icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png',
  'videos/lofi.mp4', 'messageImage_1787629523742.jpg'
];
const exHtmlObf = ['web_claim_dashboard.html', 'app.html'];
const outExt = join(root, 'dist-extension');
if (existsSync(outExt)) rmSync(outExt, { recursive: true, force: true });
mkdirSync(outExt, { recursive: true });

let failed = 0;
for (const rel of extFiles) {
  const src = join(root, rel);
  if (!existsSync(src)) { console.log('skip (missing) ' + rel); continue; }
  const dst = join(outExt, rel);
  mkdirSync(dirname(dst), { recursive: true });
  if (rel.endsWith('.js')) {
    writeFileSync(dst, ob(readFileSync(src, 'utf8'), PRESET), 'utf8');
    if (!check(rel, dst)) failed++;
  } else if (exHtmlObf.includes(rel)) {
    const obfHtml = readFileSync(src, 'utf8').replace(INLINE, (m, code) => `<script>${ob(code, PRESET)}</script>`);
    writeFileSync(dst, obfHtml, 'utf8');
    if (!checkHtml(rel, obfHtml)) failed++;
  } else {
    copyFileSync(src, dst);
    console.log('copy ' + rel);
  }
}

console.log(failed ? `\n[done] ${failed} file JS PERLU dicek manual` : '\n[done] all good');