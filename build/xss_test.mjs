import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '"><svg/onload=alert(1)>',
  "';alert(String.fromCharCode(88,83,83))//",
  'javascript:alert(1)',
  '<iframe src=javascript:alert(1)></iframe>',
  '<svg><animate/onbegin=alert(1)></animate></svg>',
  '<style>@import url(javascript:alert(1))</style>',
  '<input autofocus onfocus=alert(1)>',
  '<marquee onstart=alert(1)></marquee>',
  '<math><mtext><table><mglyph><style></math><img src onerror=alert(1)>',
  '{{$on.constructor.constructor("alert(1)")()}}',
  '${7*7}',
  'a*{background:url(https://evil/)}x',
  '<details open ontoggle=alert(1)>'
];

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
}

function stub(claimsRows, log) {
  return {
    listActiveSites: () => Promise.resolve([{ site_id: 'bandar80', label: 'BANDAR80' }]),
    list: () => Promise.resolve(claimsRows),
    insert: () => { if (log) log.push('INSERT'); return Promise.resolve({}); }
  };
}

/* ============ DASHBOARD: renderArsip terhadap XSS payload ============ */
console.log('[1] DASHBOARD arsip — payload di user_id & detail');
{
  const html = readFileSync(resolve(root, 'web/dashboard.html'), 'utf8');
  const rows = PAYLOADS.map((p, i) => ({
    id: 't' + i, site: 'bandar80', user_id: p, kode_tiket: '2081' + i,
    betting: '50000', scatter: 3, status: 'INPUT_OK', detail: p,
    actual_bet: null, actual_scatter: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  }));
  const dom = new JSDOM(html, { runScripts: 'dangerously', beforeParse(w) { w.SB = stub(rows); } });
  const doc = dom.window.document;
  await new Promise((r) => setTimeout(r, 400));
  doc.querySelector('nav button[data-tab="arsip"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  const box = doc.getElementById('rows');
  assert(box.querySelectorAll('script').length === 0, 'tidak ada elemen <script> hasil render');
  assert(box.querySelectorAll('img').length === 0, 'tidak ada elemen <img> hasil render');
  assert(box.querySelectorAll('iframe,svg,object,embed,audio,video,source,style,input,marquee,math,details').length === 0, 'tidak ada elemen aktif lain');
  const ih = box.innerHTML;
  assert(ih.includes('&lt;') || ih.includes('&amp;'), 'payload ter-escape di HTML');
  assert(box.querySelectorAll('.row').length === PAYLOADS.length, 'semua baris payload ter-render');
  dom.window.close();
}

/* ============ INDEX: renderTrack terhadap XSS payload ============ */
console.log('[2] INDEX lacak — payload di user_id & detail');
{
  const html = readFileSync(resolve(root, 'web/index.html'), 'utf8');
  const rows = PAYLOADS.map((p, i) => ({
    id: 'x' + i, site: 'bandar80', user_id: p, kode_tiket: 'T' + i,
    betting: '25000', scatter: 3, status: 'PENDING', detail: p,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  }));
  const dom = new JSDOM(html, { runScripts: 'dangerously', beforeParse(w) { w.SB = stub(rows); } });
  const doc = dom.window.document;
  await new Promise((r) => setTimeout(r, 300));
  doc.getElementById('goTrack').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  doc.getElementById('t_user').value = 'u';
  doc.getElementById('btnTrack').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  const box = doc.getElementById('trackRows');
  assert(box.querySelectorAll('script').length === 0, 'tidak ada <script>');
  assert(box.querySelectorAll('img').length === 0, 'tidak ada <img>');
  assert(box.querySelectorAll('iframe,svg,object,embed,style,input,marquee,math,details').length === 0, 'tidak ada elemen aktif lain');
  assert(box.querySelectorAll('.row').length === PAYLOADS.length, 'semua baris payload ter-render');
  dom.window.close();
}

/* ============ INDEX: rate-limit klien + honeypot ============ */
console.log('[3] INDEX anti-spam klien (rate-limit + honeypot)');
{
  const html = readFileSync(resolve(root, 'web/index.html'), 'utf8');
  const log = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', beforeParse(w) { w.SB = stub([], log); } });
  const doc = dom.window.document;
  await new Promise((r) => setTimeout(r, 300));
  doc.getElementById('f_site').innerHTML = '<option value="bandar80">BANDAR80</option>';
  doc.getElementById('f_user').value = 'ujites';
  doc.getElementById('f_tx').value = '1';
  doc.getElementById('f_bet').value = '1000';
  doc.getElementById('btnSubmit').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 100));
  doc.getElementById('btnSubmit').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
  const t = doc.getElementById('toast');
  assert(log.filter(x => x === 'INSERT').length === 1, 'klaim dikirim tepat 1x');
  assert(String(t.textContent).includes('Terlalu cepat'), 'klik kedua diblok rate-limit');

  const dom2 = new JSDOM(html, { runScripts: 'dangerously', beforeParse(w) { w.SB = stub([], log); } });
  await new Promise((r) => setTimeout(r, 300));
  const d2 = dom2.window.document;
  d2.getElementById('f_site').innerHTML = '<option value="bandar80">BANDAR80</option>';
  d2.getElementById('f_user').value = 'ujibot';
  d2.getElementById('f_tx').value = '2';
  d2.getElementById('f_bet').value = '1000';
  d2.getElementById('f_bot').value = 'spam';
  d2.getElementById('btnSubmit').dispatchEvent(new dom2.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
  assert(log.filter(x => x === 'INSERT').length === 1, 'honeypot: tidak ada INSERT klaim');
  dom.window.close(); dom2.window.close();
}

console.log(`\nHASIL: ${pass} pass, ${fail} fail`);