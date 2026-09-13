'use strict';
/* ============================================================
   relax-lib.js — PORT server (Vercel) si AUTO RELAX "AA"
   (penerima klaim + isi form bonus) tanpa chrome.* / DOM:
     - baris RELAX : makeRow / toClaimRow / parseUser / parseKodeTiket
     - kelaikan    : validForCek / validForInput
     - klasifikasi : classifySecureStatus (teks toast) &
                     classifyHistoryStatus (field status ambil verdict)
     - request     : buildBonusPayload + buildSubmitRequest
                     (template {{placeholder}} — termasuk {{bonusToken}}).
   ============================================================ */

const TOSTA_OK = [
  /berhasil diajukan/i, /berhasil dikirim/i, /berhasil/i, /success/i,
  /successfully/i, /terkirim/i, /diajukan/i, /nomor antrean/i,
  /antrean anda/i, /antrian anda/i, /diproses/i, /tersimpan/i
];
const TOSTA_FAIL = [
  /sudah pernah/i, /sudah digunakan/i, /sudah diajukan/i, /duplikat/i,
  /tidak ditemukan/i, /tidak valid/i, /tidak sesuai/i, /invalid/i,
  /gagal/i, /error/i, /tolak/i, /ditolak/i, /coba lagi/i,
  /terlalu banyak/i, /timeout/i, /expired/i, /kadaluwarsa/i,
  /sesi.*(habis|invalid|kadaluwarsa)/i, /limit/i, /maksimal/i,
  /sistem sibuk/i, /sedang ramai/i, /belum siap/i
];

/* ---------- parser (port modules/shared.js + popup.js) ---------- */
function parseUser(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/\s+(ts\s*.*)$/i);
  const user = s.replace(/\s+ts\s*.*/i, '').replace(/\s+/g, '').trim();
  return { user, hasTS: !!m, tsPart: m ? m[1] : '' };
}

function parseKodeTiket(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(.*?)\s+ts\s*$/i);
  const kode = (m ? m[1] : s).replace(/[^a-zA-Z0-9]/g, '').trim();
  return { kode, hasTS: !!m, valid: kode.length >= 19 };
}

function parseAmount(v) {
  if (v === undefined || v === null) return 0;
  return Number(String(v).replace(/[^\d]/g, '')) || 0;
}

function normalizeScatter(v) {
  const n = Number(String(v === undefined || v === null ? '' : v).replace(/[^\d]/g, ''));
  return [3, 4, 5].includes(n) ? n : null;
}

/* ---------- baris RELAX ---------- */
/* Normalisasi input mentah (userId/user, kode/kodeTiket, betting, scatter, site)
   menjadi baris RELAX: { id, user, kodeTiket, betting, scatter, site, hasTS }. */
function makeRow(input) {
  const i = input || {};
  const pu = parseUser(i.user !== undefined ? i.user : (i.userId !== undefined ? i.userId : ''));
  const pk = parseKodeTiket(i.kodeTiket !== undefined ? i.kodeTiket : (i.kode !== undefined ? i.kode : ''));
  const site = String(i.site || '').replace(/^https?:\/\//, '').split('/')[0];
  const scatter = i.scatter !== undefined && i.scatter !== null ? normalizeScatter(i.scatter) : null;
  return {
    id: i.id !== undefined ? i.id : null,
    user: pu.user,
    kodeTiket: pk.kode,
    betting: parseAmount(i.betting),
    scatter,
    site,
    hasTS: i.hasTS !== undefined ? !!i.hasTS : pu.hasTS || pk.hasTS
  };
}

/* Kolom claims → baris RELAX: user_id→user, kode_tiket→kodeTiket, site→site,
   betting→betting, scatter→scatter, has_ts→hasTS (bila kolom ada). */
function toClaimRow(claim) {
  const c = claim || {};
  const pu = parseUser((c.user_id !== undefined && c.user_id !== null) ? c.user_id : (c.user || ''));
  const pk = parseKodeTiket((c.kode_tiket !== undefined && c.kode_tiket !== null) ? c.kode_tiket : (c.kodeTiket || ''));
  const hasTS = c.has_ts !== undefined ? !!c.has_ts : (pu.hasTS || pk.hasTS);
  return {
    user: pu.user,
    kodeTiket: pk.kode,
    betting: parseAmount(c.betting),
    scatter: c.scatter !== undefined && c.scatter !== null ? Number(c.scatter) : null,
    site: String(c.site || '').replace(/^https?:\/\//, '').split('/')[0],
    hasTS,
    claim_no: c.claim_no !== undefined ? c.claim_no : null
  };
}

/* ---------- kelaikan (cek bisa jalan, input bisa jalan) ---------- */
/* Cek bet (AUTO RELAX "cek ulang"): butuh user, kode tiket valid, betting. */
function validForCek(row) {
  const r = row || {};
  const user = String(r.user || '');
  const kode = String(r.kodeTiket || '');
  return user.length >= 2 && kode.length >= 19 && (parseAmount(r.betting) > 0);
}

/* Input bonus (bg-secure filter): user + kode + betting + scatter sah 3-5. */
function validForInput(row) {
  const r = row || {};
  const user = String(r.user || '');
  const kode = String(r.kodeTiket || '');
  return user.length >= 2 && kode.length >= 19 && parseAmount(r.betting) > 0 && normalizeScatter(r.scatter) !== null;
}

/* ---------- klasifikasi toast (input bonus) ---------- */
function classifySecureStatus(input) {
  let txt = String(input === undefined || input === null ? '' : input);
  let json = null;
  try { json = JSON.parse(txt); } catch (e) { /* teks biasa */ }
  if (json && typeof json === 'object') {
    if (json.success === true) return 'OK';
    if (json.success === false) return 'GAGAL';
    const code = String(json.code ?? json.cd ?? json.status ?? '');
    if (/^[45]\d\d$/.test(code)) return 'GAGAL';
    const msg = String(json.message || json.msg || json.detail || json.error || json.description || json.desc || '');
    if (msg) txt = msg;
  }
  const plain = txt.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!plain) return 'UNKNOWN';
  if (TOSTA_FAIL.some((re) => re.test(plain))) return 'GAGAL';
  if (TOSTA_OK.some((re) => re.test(plain))) return 'OK';
  return 'UNKNOWN';
}

/* ---------- klasifikasi status ambil verdict (Phase C) ---------- */
function classifyHistoryStatus(input) {
  let root = input;
  if (typeof root === 'string') {
    try { root = JSON.parse(root); } catch (e) { /* bukan JSON */ }
  }
  const found = [];
  const dig = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 8) return;
    if (Array.isArray(v)) { for (let i = 0; i < v.length && i < 5; i++) dig(v[i], depth + 1); return; }
    for (const k of Object.keys(v)) {
      const val = v[k];
      if ((/status|state|verdict|result|checkstatus|ticketstatus|approvestatus/i.test(k) || k === 'code' || k === 'cd') && val !== undefined && val !== null) {
        found.push(String(val));
      }
      if (val && typeof val === 'object') dig(val, depth + 1);
    }
  };
  dig(root, 0);
  if (typeof input === 'string') found.push(input);
  for (const s of found) {
    const u = String(s).toUpperCase();
    if (/(APPROVE|SUCCESS|SESUAI|BERHASIL|SELESAI|OK\b|CAIR|LUNAS)/.test(u)) return 'APPROVED';
    if (/(REJECT|FAIL|GAGAL|TIDAK|INVALID|DITOLAK|SALAH)/.test(u)) return 'REJECTED';
  }
  return '';
}

/* ---------- template {{placeholder}} ---------- */
function fillTemplate(text, vars, encode) {
  return String(text === undefined || text === null ? '' : text).replace(/{{([A-Za-z0-9_]+)}}/g, (m, k) => {
    const v = vars !== null && vars !== undefined ? vars[k] : undefined;
    if (v === undefined || v === null) return m;
    const s = String(v);
    return encode ? encodeURIComponent(s) : s;
  });
}

/* ---------- payload & request input bonus ---------- */
/* Baris RELAX + default dari payload.bonus_submit → map variabel template.
   {{user}} sudah berbentuk "id TS" saat hasTS (ala bg-secure automateForm). */
function buildBonusPayload(payload, defaults) {
  const p = payload || {};
  const d = (defaults && typeof defaults === 'object') ? defaults : {};
  const user = String(p.user !== undefined ? p.user : '');
  const kodeTiket = String(p.kodeTiket !== undefined ? p.kodeTiket : '');
  const hasTS = !!p.hasTS;
  const site = String(p.site !== undefined ? p.site : (d.site || ''));
  const formUser = hasTS && user && !/\s+ts\s*$/i.test(user) ? user + ' TS' : user;
  const out = Object.assign(
    {
      userId: user,
      user: formUser,
      userRaw: user,
      kodeTiket,
      kode: kodeTiket,
      betting: p.betting !== undefined ? p.betting : (d.betting || ''),
      scatter: p.scatter !== undefined ? p.scatter : (d.scatter || ''),
      site,
      situs: site,
      hasTS,
      ts: hasTS ? 'TS' : ''
    },
    typeof d === 'object' ? d : {}
  );
  out.userId = user;
  out.user = formUser;
  out.kodeTiket = kodeTiket;
  return out;
}

/* Bangun request HTTP dari template config payload.bonus_submit.
   submitCfg = { url, method, contentType, headers, body|bodyJson|fields, max_retry }.
   {{bonusToken}} diisi dari header admin X-Access-Token (situs klaim). */
function buildSubmitRequest(payload, submitCfg, bonusHeaders) {
  const cfg = (submitCfg && typeof submitCfg === 'object') ? submitCfg : {};
  const bh = (bonusHeaders && typeof bonusHeaders === 'object') ? bonusHeaders : {};
  const vars = Object.assign({}, payload || {});
  if (!vars.bonusToken) vars.bonusToken = String(bh['X-Access-Token'] || bh['x-access-token'] || '').trim();

  const method = String(cfg.method || 'POST').toUpperCase();
  const url = fillTemplate(cfg.url || '', vars, true);
  const headers = {};
  if (cfg.headers && typeof cfg.headers === 'object') {
    for (const k of Object.keys(cfg.headers)) headers[k] = fillTemplate(String(cfg.headers[k] || ''), vars, false);
  }

  let body = null;
  let contentType = String(cfg.contentType || '');
  if (typeof cfg.body === 'string') {
    body = fillTemplate(cfg.body, vars, false);
    contentType = contentType || 'application/x-www-form-urlencoded';
  } else if (cfg.body && typeof cfg.body === 'object') {
    body = fillTemplate(JSON.stringify(cfg.body), vars, false);
    contentType = contentType || 'application/json';
  } else if (cfg.fields && typeof cfg.fields === 'object') {
    const params = [];
    for (const k of Object.keys(cfg.fields)) params.push(k + '=' + encodeURIComponent(fillTemplate(String(cfg.fields[k] || ''), vars, false)));
    body = params.join('&');
    contentType = contentType || 'application/x-www-form-urlencoded';
  } else if (method === 'POST' || method === 'PUT') {
    const params = [];
    for (const k of ['userId', 'user', 'kodeTiket', 'kode', 'betting', 'scatter', 'site', 'situs', 'ts', 'bonusToken']) {
      const v = vars[k];
      if (v !== undefined && v !== null && String(v) !== '') params.push(k + '=' + encodeURIComponent(String(v)));
    }
    body = params.join('&');
    contentType = contentType || 'application/x-www-form-urlencoded';
  }
  if (contentType) headers['Content-Type'] = contentType;
  return { url, method, headers, body, contentType };
}

module.exports = {
  TOSTA_OK, TOSTA_FAIL,
  parseUser, parseKodeTiket, parseAmount, normalizeScatter,
  makeRow, toClaimRow, validForCek, validForInput,
  classifySecureStatus, classifyHistoryStatus,
  fillTemplate, buildBonusPayload, buildSubmitRequest
};