'use strict';
/* /api/admin  — panel master (owner atau staff dengan izin sesuai fitur)
   GET  ?q=summary   → ringkasan       (izin: ringkas)
   GET  ?q=sites     → daftar situs    (izin: ringkas)
   GET  ?q=claims    → daftar klaim    (izin: datalaim)
   POST remove/clearDone                (izin: hapus)
   POST patch / verdict                 (izin: approve)
*/
const L = require('./_lib');

const FINAL = ['INPUT_OK', 'TIDAK_SESUAI', 'INPUT_FAIL', 'ERROR', 'NO_TOKEN', 'APPROVED', 'REJECTED'];

function filterClaims(rows, site, status, q, limit) {
  let out = rows;
  if (site) out = out.filter(function (r) { return r.site === site; });
  if (status) out = out.filter(function (r) { return r.status === status; });
  if (q) {
    q = String(q).toLowerCase();
    out = out.filter(function (r) {
      return String(r.user_id || '').toLowerCase().indexOf(q) >= 0 ||
             String(r.kode_tiket || '').toLowerCase().indexOf(q) >= 0;
    });
  }
  return out.slice(0, limit || 300);
}

function summarize(claims, sites) {
  const today = L.wibDayStartMs();
  const perSite = {};
  const byUser = {};   // sisa kuota user aktif hari ini
  let gToday = 0, gTotal = claims.length;

  claims.forEach(function (c) {
    const s = c.site || '?';
    if (!perSite[s]) perSite[s] = { today: 0, countsT: {}, countsToday: {}, remaining: 0, label: (sites[s] && sites[s].label) || s };
    const ps = perSite[s];
    ps.countsT[c.status || 'PENDING'] = (ps.countsT[c.status || 'PENDING'] || 0) + 1;
    const created = new Date(c.created_at).getTime();
    if (created >= today) {
      ps.today++;
      ps.countsToday[c.status || 'PENDING'] = (ps.countsToday[c.status || 'PENDING'] || 0) + 1;
      gToday++;
      byUser[c.user_id] = (byUser[c.user_id] || 0) + 1;
    }
  });

  const siteArr = Object.keys(perSite).map(function (k) {
    const p = perSite[k];
    return {
      site_id: k, label: p.label, active: !!(sites[k] && sites[k].active),
      today: p.today,
      total: p.countsT,
      todayCount: p.countsToday,
      pending: (p.countsToday.PENDING || 0) + (p.countsToday.QUEUED || 0) +
               (p.countsToday.VERIFYING || 0) + (p.countsToday.INPUTTING || 0),
      done: (p.countsToday.INPUT_OK || 0) + (p.countsToday.APPROVED || 0)
    };
  });

  const quotaUsed = Object.keys(byUser).filter(function (u) { return byUser[u] >= 2; }).length;
  const quotaUser = Object.keys(byUser).length;

  return {
    today: gToday, totalFull: gTotal,
    quota: { usersToday: quotaUser, full: quotaUsed, usedToday: Object.keys(byUser).reduce(function (a, u) { return a + byUser[u]; }, 0) },
    sites: siteArr,
    ts: new Date().toISOString()
  };
}

module.exports = async function (req, res) {
  const ip = L.clientIp(req);
  const ua = String(req.headers['user-agent'] || '');

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://x');
      const q = url.searchParams.get('q') || 'claims';

      if (q === 'summary' || q === 'sites') {
        const acct = await L.requireAccount(req, res, 'ringkas');
        if (!acct) return;
      } else {
        const acct = await L.requireAccount(req, res, 'datalaim');
        if (!acct) return;
      }

      if (q === 'summary') {
        const since = L.iso(new Date(L.wibDayStartMs() - 7 * 86400000));  // seminggu cukup utk ringkasan
        const rows = await L.sbGet('claims', 'select=site,site_label,user_id,status,created_at&created_at=gte.' + encodeURIComponent(since) + '&limit=3000');
        const sitesRows = await L.sbGet('sites', 'select=site_id,label,active');
        const sites = {};
        (Array.isArray(sitesRows) ? sitesRows : []).forEach(function (r) { sites[r.site_id] = { label: r.label, active: !!r.active }; });
        return L.ok(res, { ok: true, summary: summarize(Array.isArray(rows) ? rows : [], sites) });
      }

      if (q === 'sites') {
        const sitesRows = await L.sbGet('sites', 'select=site_id,label,active,bonus_url');
        return L.ok(res, { ok: true, sites: sitesRows || [] });
      }

      /* q === 'claims' */
      return await serveClaims(req, res, url);
    }

    if (req.method === 'POST') {
      const body = await L.readBody(req, 32 * 1024).catch(function () { return null; });
      if (!body || typeof body !== 'object') return L.bad(res, 'BAD_BODY', 'Data tidak terbaca.');

      if (body.action === 'remove' || body.action === 'clearDone') {
        const acct = await L.requireAccount(req, res, 'hapus');
        if (!acct) return;
      } else if (body.action === 'patch' || body.action === 'verdict' || body.action === 'approve' || body.action === 'reject') {
        const acct = await L.requireAccount(req, res, 'approve');
        if (!acct) return;
      }

      if (body.action === 'approve' && body.id) {
        const id = String(body.id).replace(/[^0-9a-f-]/gi, '');
        if (id.length !== 36) return L.bad(res, 'BAD_ID', 'ID tidak valid.');
        await L.sbPatch(id, { status: 'APPROVED', label: 'APPROVE', verdict: 'APPROVED', verdict_at: L.iso(Date.now()) });
        return L.ok(res, { ok: true });
      }

      if (body.action === 'reject' && body.id) {
        const id = String(body.id).replace(/[^0-9a-f-]/gi, '');
        if (id.length !== 36) return L.bad(res, 'BAD_ID', 'ID tidak valid.');
        await L.sbPatch(id, { status: 'REJECTED', label: 'REJECT', verdict: 'REJECTED', verdict_at: L.iso(Date.now()) });
        return L.ok(res, { ok: true });
      }

      if (body.action === 'remove' && body.id) {
        const id = String(body.id).replace(/[^0-9a-f-]/gi, '');
        if (id.length !== 36) return L.bad(res, 'BAD_ID', 'ID tidak valid.');
        const r = await L.sbDelete(id);   // service key → bebas hapus apa saja
        return L.ok(res, { ok: true, removed: r });
      }

      if (body.action === 'patch' && body.id && body.obj && typeof body.obj === 'object') {
        const id = String(body.id).replace(/[^0-9a-f-]/gi, '');
        const allowed = ['user_id', 'kode_tiket', 'status', 'label', 'detail', 'match', 'actual_bet', 'actual_scatter'];
        const obj = {};
        allowed.forEach(function (k) { if (body.obj[k] !== undefined) obj[k] = body.obj[k]; });
        if (!Object.keys(obj).length) return L.bad(res, 'BAD_PATCH', 'Tidak ada kolom yang boleh diubah.');
        await L.sbPatch(id, obj);
        return L.ok(res, { ok: true });
      }

      if (body.action === 'verdict' && body.id) {
        const id = String(body.id).replace(/[^0-9a-f-]/gi, '');
        const v = String(body.verdict || '').toUpperCase();
        if (id.length !== 36) return L.bad(res, 'BAD_ID', 'ID tidak valid.');
        if (v !== 'APPROVED' && v !== 'REJECTED') return L.bad(res, 'BAD_VERDICT', 'Verdict harus APPROVED atau REJECTED.');
        await L.sbPatch(id, { verdict: v, verdict_at: L.iso(Date.now()) });
        return L.ok(res, { ok: true });
      }

      if (body.action === 'clearDone') {
        const rows = await L.sbGet('claims', 'select=id&status=in.(' + FINAL.join(',') + ')&limit=1000');
        const ids = (Array.isArray(rows) ? rows : []).map(function (r) { return r.id; });
        let removed = 0;
        for (const id of ids) { await L.sbDelete(id); removed++; }
        return L.ok(res, { ok: true, removed });
      }

      return L.bad(res, 'BAD_ACTION', 'Aksi tidak dikenal.');
    }

    return L.methodNotAllowed(res);
  } catch (e) {
    return L.fail(res, 'Gagal memproses permintaan admin.');
  }
};

async function serveClaims(req, res, url) {
  const site = url.searchParams.get('site') || '';
  const status = url.searchParams.get('status') || '';
  const s = url.searchParams.get('s') || '';
  const lim = Math.min(parseInt(url.searchParams.get('limit') || '300', 10), 2000);
  const BASE = 'select=id,claim_no,site,site_label,user_id,kode_tiket,betting,scatter,status,label,detail,match,actual_bet,actual_scatter,mode,created_at,updated_at';
  const FULL = BASE + ',verdict,verdict_at';
  const ORDER = 'order=created_at.desc&limit=2000';
  let rows = null;
  try {
    rows = await L.sbGet('claims', FULL + '&' + ORDER);   // kolom verdict ada setelah migrasi
  } catch (e) {
    rows = await L.sbGet('claims', BASE + '&' + ORDER);   // skema lama tanpa verdict
  }
  const out = filterClaims(Array.isArray(rows) ? rows : [], site, status, s, lim);
  return L.ok(res, { ok: true, rows: out, count: out.length, hasVerdict: Array.isArray(rows) && rows.length > 0 && rows[0].hasOwnProperty('verdict') });
}