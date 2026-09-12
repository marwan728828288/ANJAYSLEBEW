'use strict';
/* POST /api/auth/setup2fa → barcode 2FA + secret utk discan.
   Wajib tahap-A (Google) bila Google dikonfigurasi.
   - action 'reset' (pemilik, setelah step1 user+pass): buat kunci
     baru VALID (32 char base32) lalu simpan aman di master_secret.
   - Kunci selalu divalidasi; jika env OWNER_TOTP_SECRET rusak,
     dikembalikan invalid:true + reason supaya panel memandu reset,
     bukan menampilkan QR yang tidak bisa dienroll. */
const L = require('../_lib');

module.exports = async function (req, res) {
  if (req.method !== 'POST') return L.methodNotAllowed(res);
  const ip = L.clientIp(req);
  const rl = L.rateLimit(ip, 60000, 20);
  if (!rl.ok) return L.send(res, 429, { ok: false, code: 'RATE', message: 'Terlalu sering.' });
  if (!L.originOk(req)) return L.denied(res);

  let body;
  try { body = await L.readBody(req, 8 * 1024); }
  catch (e) { return L.bad(res, 'BAD_BODY', 'Data tidak terbaca.'); }

  const ua = String(req.headers['user-agent'] || '');
  const stage = String((body && body.stage) || '').trim() || L.readCookie(req, 'g_stage');

  if (L.ownerStepConfigured() && !L.verifyStage(stage, ip, ua)) {
    return L.send(res, 401, { ok: false, code: 'NEED_STEP1', message: 'Tahap 1 wajib: masukkan username & password pemilik dulu.' });
  }

  let secret = await L.readTotpSecret();
  let flashed = false;

  if (String((body && body.action) || '').trim() === 'reset') {
    try {
      secret = await L.writeTotpSecret(L.genTotpSecret());
      flashed = true;
    } catch (e) {
      const msg = /TOTP_SECRET_INVALID/.test(String(e.message))
        ? 'Gagal generate kunci valid.'
        : 'Belum bisa simpan kunci baru. Jalankan web/supabase/totp.sql di Supabase SQL Editor, lalu coba lagi.';
      return L.send(res, 502, { ok: false, code: 'TOTP_STORE', message: msg });
    }
  }

  const invalid = !L.validTotp(secret);
  const otpauth = invalid
    ? ''
    : 'otpauth://totp/AutoScater%20Master?secret=' + secret + '&issuer=AutoScater&algorithm=SHA1&digits=6&period=30';

  const reason = invalid
    ? (secret ? 'OWNER_TOTP_SECRET di Vercel tidak valid. Gunakan "Reset Kunci 2FA" untuk kunci baru (32 karakter base32), lalu login ulang.'
              : 'Kunci 2FA belum diatur. Gunakan "Reset Kunci 2FA" untuk membuat kunci baru.')
    : '';

  return L.ok(res, {
    ok: true,
    configured: L.ownerStepConfigured(),
    username: L.userName(),
    secret: invalid ? '' : secret,
    otpauth: otpauth,
    enrolled: !invalid,
    invalid: invalid,
    reason: reason,
    flashed: flashed
  }, { 'Cache-Control': 'no-store' });
};