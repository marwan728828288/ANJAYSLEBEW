'use strict';
/* POST /api/auth {pin, code} → 2FA + token sesi owner
   Keamanan: rate-limit per IP, lockout 5× gagal (15 menit),
   PIN dibandingkan timing-safe, 2FA TOTP (authenticator),
   token HMAC cookie HttpOnly + Secure + SameSite=Strict. */
const L = require('./_lib');

module.exports = async function (req, res) {
  if (req.method !== 'POST') return L.methodNotAllowed(res);
  if (!L.ownerOk()) return L.denied(res);

  const ip = L.clientIp(req);
  if (!L.originOk(req)) return L.denied(res);

  let rl = L.rateLimit(ip, 60000, 10);
  if (!rl.ok) return L.send(res, 429, { ok: false, code: 'RATE', message: 'Terlalu sering mencoba. Tunggu sebentar.' });

  const gate = L.loginGate(ip);
  if (gate.block) {
    return L.send(res, 429, { ok: false, code: 'LOCKED', message: 'Terlalu banyak percobaan gagal. Coba lagi ' + Math.ceil(gate.retryAfterMs / 60000) + ' menit lagi.' });
  }

  let body;
  try { body = await L.readBody(req, 8 * 1024); }
  catch (e) { return L.bad(res, 'BAD_BODY', 'Data tidak terbaca.'); }

  const ua = String(req.headers['user-agent'] || '');
  const stage = String((body && body.stage) || '').trim() || L.readCookie(req, 'g_stage');

  /* Tahap 1: username + password owner. Diwajibkan bila sudah dikonfigurasi. */
  if (L.ownerStepConfigured()) {
    if (!L.verifyStage(stage, ip, ua)) {
      return L.send(res, 401, { ok: false, code: 'NEED_STEP1', message: 'Tahap 1 wajib: masukkan username & password pemilik dulu.' });
    }
  }

  const pinOk = L.pinMatches(body && body.pin);
  const code  = String((body && body.code) || '').trim();
  const twoFaOk = L.totpLocked() ? true : L.verifyTotp(process.env.OWNER_TOTP_SECRET, code);

  if (!pinOk || !twoFaOk) {
    L.loginFail(ip);
    return L.denied(res); // pesan generik demi keamanan
  }

  L.loginOk(ip);
  const token = L.signSession(ip, String(req.headers['user-agent'] || ''));
  const cookie =
    'owner_tok=' + encodeURIComponent(token) +
    '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + Math.floor(12 * 3600);
  const clearStage = 'g_stage=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict';

  return L.ok(res, { ok: true, token }, {
    'Set-Cookie': [cookie, clearStage],
    'Cache-Control': 'no-store'
  });
};