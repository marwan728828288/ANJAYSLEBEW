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

/* ---- Klien raw untuk Network sniff & inject halaman ---- */

export async function listPages(port = 9222) {
  const targets = await reqJSON(port, '/json');
  return (targets || []).filter(t => t.type === 'page');
}

/* Ekten ke SEMUA tab yang cocok urlMatch. Handle: send/on/eval/addNewDocScript/close. */
export async function cdpRawAll(port = 9222, urlMatch = '') {
  const pages = await listPages(port);
  const hits = pages.filter(t => t.url && (!urlMatch || t.url.includes(urlMatch)));
  return Promise.all(hits.map(t => connectRaw(t)));
}

export async function cdpRaw(port = 9222, urlMatch = '') {
  const list = await cdpRawAll(port, urlMatch);
  return list[0] || null;
}

function connectRaw(target) {
  const wsUrl = target.webSocketDebuggerUrl;
  if (!wsUrl) throw new Error('CDP: webSocketDebuggerUrl kosong');
  return new Promise((resolve, reject) => {
    let closed = false;
    let opened = false;
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const listeners = new Map();

    function fire(method, params) {
      const arr = listeners.get(method);
      if (arr) arr.slice().forEach((fn) => { try { fn(params); } catch (e) {} });
    }

    ws.onopen = () => {
      opened = true;
      resolve({
        target,
        async send(method, params) {
          return new Promise((res, rej) => {
            const id = _id++;
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params: params || {} }));
          });
        },
        on(method, fn) {
          if (!listeners.has(method)) listeners.set(method, []);
          listeners.get(method).push(fn);
        },
        async eval(expression, awaitPromise = true, returnByValue = true) {
          const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue, userGesture: true });
          if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || 'evaluate error');
          return r.result && r.result.result && r.result.result.value;
        },
        async addNewDocScript(name, source) {
          const r = await this.send('Page.addScriptToEvaluateOnNewDocument', { source, runImmediately: true });
          return r.result && r.result.identifier;
        },
        close() { closed = true; try { ws.close(); } catch (_) {} }
      });
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = typeof ev.data === 'string' ? JSON.parse(ev.data) : null; } catch (e) { return; }
      if (!msg) return;
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.rej(new Error(msg.error.message || 'CDP error'));
        else p.res(msg.result || {});
        return;
      }
      if (msg.method) fire(msg.method, msg.params || {});
    };

    ws.onerror = (e) => { if (!opened) reject(new Error('CDP WS error: ' + (e.message || e))); };
    ws.onclose = () => { if (!opened && !closed) reject(new Error('CDP WS closed before ready')); };
  });
}