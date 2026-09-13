'use strict';
/* ============================================================
   railway/bonus-bot.js — Bot Playwright (hosted browser di Railway)
   utk MENYELESAIKAN fase verifikasi manual yang tadinya klik DOM
   di extension: cari baris tiket (kode) lalu klik tombol
   Approve/Reject di halaman bonus.

   HONEST: tidak bisa "asumsi DOM" — pola harus disesuaikan dengan
   HTML situs bonus Anda. Selektor dikonfigurasi via env:
     BONUS_SITE_URL      (wajib) — https://... halaman login bonus
     BONUS_TICKETS_URL   (wajib) — halaman daftar tiket; boleh templat:
                              {{kode}}, {{site}}, {{bonusToken}}
     BONUS_ROW_SELECTOR  default 'table tbody tr'
     BONUS_APPROVE_TEXT  default 'Approve'
     BONUS_REJECT_TEXT   default 'Reject'
     BONUS_STATE_DIR     default '/data' (Railway volume utk simpan sesi)
   Alur: 1) POST /app/bonus/login  → login 1× manual di jendela bot,
   sesi disimpan (+screenshot). 2) POST /app/bonus/click {kode,action}
   → bot buka daftar tiket, temukan baris berisi kode, klik tombol.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const STATE_DIR = process.env.BONUS_STATE_DIR || '/data';
const STATE_FILE = path.join(STATE_DIR, 'bonus-state.json');
const SHOT = path.join(STATE_DIR, 'bonus-session.png');

const SITE_URL = process.env.BONUS_SITE_URL || '';
const TICKETS_URL = process.env.BONUS_TICKETS_URL || '';
const ROW_SEL = process.env.BONUS_ROW_SELECTOR || 'table tbody tr';
const APPROVE_TEXT = process.env.BONUS_APPROVE_TEXT || 'Approve';
const REJECT_TEXT = process.env.BONUS_REJECT_TEXT || 'Reject';

let chromium = null;
let browser = null;
let page = null;
let lastState = null;

function fillTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

async function init() {
  try {
    chromium = require('playwright').chromium;
  } catch (e) {
    throw new Error('playwright tidak terpasang — cek railway/package.json & Dockerfile (ARG PLAYWRIGHT=true).');
  }
  if (!SITE_URL) throw new Error('BONUS_SITE_URL belum diatur.');
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function state() {
  return lastState || { site: SITE_URL, loggedIn: fs.existsSync(STATE_FILE), stateFile: STATE_FILE };
}

async function getPage() {
  if (browser && page && page.isConnected()) return page;
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  if (fs.existsSync(STATE_FILE)) {
    page = await browser.newContext({ storageState: STATE_FILE }).then((c) => c.newPage());
  } else {
    page = await browser.newPage();
  }
  await page.setDefaultTimeout(20000);
  return page;
}

async function login(url) {
  const pg = await getPage();
  const target = String(url || SITE_URL).trim();
  await pg.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
  /* beri waktu login manual / auto-fill; disimpan saat halaman berubah atau timeout */
  await pg.waitForTimeout(15000);
  await pg.context().storageState({ path: STATE_FILE }).catch(() => {});
  try {
    await pg.screenshot({ path: SHOT, fullPage: true });
  } catch (e) { /* nonfatal */ }
  lastState = { site: target, loggedIn: true, stateFile: STATE_FILE, screenshot: fs.existsSync(SHOT) ? SHOT : null };
  return {
    loggedIn: true,
    shot: fs.existsSync(SHOT) ? SHOT : null,
    note: 'Sesi tersimpan. Ulangi POST /app/bonus/login bila SESI kadaluarsa.'
  };
}

async function click(kode, action, body) {
  const pg = await getPage();
  const actionText = action === 'APPROVE' ? APPROVE_TEXT : REJECT_TEXT;
  const tpl = String(body.url || TICKETS_URL || '').trim();
  if (!tpl) throw new Error('BONUS_TICKETS_URL belum diatur (bisa ber-template {{kode}}/{{site}}).');
  const target = fillTemplate(tpl, {
    kode, site: String(body.site || ''), bonusToken: String(body.bonusToken || '')
  });

  await pg.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForTimeout(3000);
  await pg.waitForSelector(ROW_SEL, { timeout: 20000 });

  const rows = await pg.locator(ROW_SEL).evaluateAll((els, findText) => {
    const out = [];
    for (const tr of els) {
      const txt = tr.textContent || '';
      if (txt.indexOf(findText) >= 0) out.push(txt.slice(0, 160));
    }
    return out;
  }, kode);

  let clicked = false;
  for (let i = 0; i < (await pg.locator(ROW_SEL).count()); i++) {
    const row = pg.locator(ROW_SEL).nth(i);
    const txt = (await row.textContent().catch(() => '')) || '';
    if (txt.indexOf(kode) < 0) continue;
    const btn = row.getByText(actionText, { exact: false }).first();
    if (await btn.count().catch(() => 0)) {
      await btn.click({ timeout: 10000 });
      clicked = true;
      break;
    }
  }

  await pg.waitForTimeout(2000);
  return {
    action,
    url: target,
    kode,
    clicked,
    rowsFound: rows.length,
    shot: null,
    note: clicked
      ? 'Tombol ' + actionText + ' diklik. Cek status di panel (fase C / /api/worker/process).'
      : 'Kode tidak ditemukan di halaman — periksa BONUS_ROW_SELECTOR/BONUS_TICKETS_URL.'
  };
}

module.exports = { init, login, click, state };