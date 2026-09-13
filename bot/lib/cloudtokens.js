import * as T from './tokens.js';

/* Dedup push: hindari POST berulang token sama (host|token). */
const sent = new Map();
const PUSH_COOLDOWN_MS = 30 * 1000;

/* Kirim headers fresh sebuah host ke tabel worker_tokens (pengganti extension
   background.js). Kembalikan true bila POST berhasil, false bila dilewati/gagal. */
export async function push(cfg, host) {
  const h = T.forHost(host);
  const tok = h && h['X-Access-Token'];
  if (!tok || String(tok).length < 10) return false;
  const exp = T.headerExpiryMs(h);
  if (exp !== null && exp < Date.now() - 60000) return false;
  const key = host + '|' + tok;
  const last = sent.get(key);
  if (last && Date.now() - last < PUSH_COOLDOWN_MS) return false;
  const base = T.baseFor(host);
  try {
    const r = await fetch(cfg.url + '/rest/v1/worker_tokens', {
      method: 'POST',
      headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ host, base, headers: h })
    });
    if (r.ok) { sent.set(key, Date.now()); return true; }
  } catch (e) { /* abaikan — daemon tetap jalan */ }
  return false;
}

/* Push semua host yang punya token segar (dipanggil tiap siklus sniffer). */
export async function pushAll(cfg) {
  let n = 0;
  for (const host of T.allHosts()) {
    if (T.hasToken(T.forHost(host))) {
      try { if (await push(cfg, host)) n++; } catch (e) {}
    }
  }
  return n;
}

export async function pull(cfg) {
  const qs = new URLSearchParams({ select: 'host,base,headers', order: 'captured_at.desc', limit: '200' });
  const r = await fetch(cfg.url + '/rest/v1/worker_tokens?' + qs.toString(), {
    headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key }
  });
  if (!r.ok) return 0;
  const rows = await r.json();
  let n = 0;
  const seen = new Set();
  for (const row of rows || []) {
    if (!row || !row.host || seen.has(row.host)) continue;
    seen.add(row.host);
    const exp = T.headerExpiryMs(row.headers || {});
    if (exp !== null && exp < Date.now() - 60000) continue;
    if (T.saveForHost(row.host, row.headers || {}, row.base)) n++;
  }
  return n;
}