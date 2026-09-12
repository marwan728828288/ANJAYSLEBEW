'use strict';
/* Minimal Chrome DevTools Protocol client via native WebSocket (Node ≥22).
   GET /json → find target → WebSocket → Runtime.evaluate. */

let _id = 1;

function reqJSON(port, path) {
  return fetch(`http://127.0.0.1:${port}${path}`).then(r => { if (!r.ok) throw new Error('CDP HTTP ' + r.status); return r.json(); });
}

export async function cdpConnect(port = 9222, urlMatch = '') {
  const targets = await reqJSON(port, '/json');
  const page = targets.find(t => t.type === 'page' && t.url && (!urlMatch || t.url.includes(urlMatch)));
  if (!page) throw new Error('CDP: tab tidak ditemukan — pastikan Chrome buka halaman bonus, cocokkan urlMatch="' + urlMatch + '"');

  const wsUrl = page.webSocketDebuggerUrl;
  if (!wsUrl) throw new Error('CDP: webSocketDebuggerUrl kosong');

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let closed = false;

    function send(method, params) {
      return new Promise((res, rej) => {
        const id = _id++;
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    ws.onopen = () => {
      resolve({
        tabUrl: page.url,
        async evaluate(expression, opts = {}) {
          const r = await send('Runtime.evaluate', {
            expression,
            awaitPromise: opts.awaitPromise !== false,
            returnByValue: opts.returnByValue !== false,
            userGesture: true
          });
          if (r.result && r.result.exceptionDetails) {
            const desc = r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || 'evaluate error';
            throw new Error(desc);
          }
          return r.result && r.result.result && r.result.result.value;
        },
        close() { closed = true; try { ws.close(); } catch (_) {} }
      });
    };

    ws.onmessage = (ev) => {
      const msg = typeof ev.data === 'string' ? JSON.parse(ev.data) : null;
      if (!msg) return;
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        p.res(msg);
      }
    };

    ws.onerror = (e) => { reject(new Error('CDP WS error: ' + (e.message || e))); };
    ws.onclose = () => { if (!closed) reject(new Error('CDP WS closed before ready')); };
  });
}