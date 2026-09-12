'use strict';
/* Klien Supabase untuk daemon worker: baca worker_config, baca &
   tandai worker_commands, tulis heartbeat worker_state.
   Menggunakan publishable key + RLS (anon) — pasangan worker_config/
   worker_state/worker_commands yang dibuat web/supabase/worker.sql. */

export function workerControl(env) {
  const url = String(env.url || '').replace(/\/+$/, '');
  const key = env.key || '';

  const H = () => ({ apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' });

  async function req(path, init, okFn) {
    const r = await fetch(url + '/rest/v1/' + path, init);
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      const e = new Error('ctl ' + r.status + ': ' + t);
      e.http = r.status; e.body = t;
      throw e;
    }
    return okFn ? okFn(r) : r.json();
  }

  return {
    async config() {
      const rows = await req('worker_config?select=*&id=eq.1', { headers: H() });
      return (Array.isArray(rows) && rows[0]) || null;
    },
    async commands() {
      return req('worker_commands?select=id,action,payload&status=eq.queued&order=created_at.asc&limit=20', { headers: H() });
    },
    async commandDone(id, ok, result) {
      await req('worker_commands?id=eq.' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: H(),
        body: JSON.stringify({ status: ok ? 'done' : 'failed', result: String(result || '').slice(0, 500) })
      }, () => null);
    },
    async beat(obj, ts) {
      const body = Object.assign({ updated_at: ts || new Date().toISOString() }, obj);
      await req('worker_state?id=eq.1', {
        method: 'PATCH',
        headers: Object.assign(H(), { Prefer: 'return=minimal' }),
        body: JSON.stringify(body)
      }, () => null);
    }
  };
}

export function isSetupError(e) {
  const m = String((e && (e.body || e.message)) || '');
  return m.indexOf('PGRST205') >= 0 || /does not exist/i.test(m) || /relation .* does not exist/i.test(m);
}