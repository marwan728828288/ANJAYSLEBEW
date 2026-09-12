'use strict';
/* Akses Supabase REST (publishable key + RLS). Status yg boleh ditulis worker:
   status, label, detail, match, actual_bet, actual_scatter, verdict, verdict_at, updated_at
   (kolom inti dikunci trigger DB). */

export function sbEnv(cfg) {
  return {
    async getClaims(status, limit) {
      const qs = new URLSearchParams({
        select: 'id,claim_no,site,user_id,kode_tiket,betting,scatter,status,label,detail,updated_at,created_at',
        status: 'eq.' + status,
        order: 'created_at.asc',
        limit: String(limit || 50)
      });
      const r = await fetch(cfg.url + '/rest/v1/claims?' + qs.toString(), {
        headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key }
      });
      if (!r.ok) throw new Error('sb.getClaims ' + r.status + ' ' + (await r.text()));
      return r.json();
    },
    async updateStatus(id, changes) {
      const qs = new URLSearchParams({ id: 'eq.' + id });
      const r = await fetch(cfg.url + '/rest/v1/claims?' + qs.toString(), {
        method: 'PATCH',
        headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(changes)
      });
      if (!r.ok) throw new Error('sb.updateStatus ' + r.status + ' ' + (await r.text()));
      return r.json();
    },
    async setVerdict(id, verdict, extra) {
      const qs = new URLSearchParams({ id: 'eq.' + id });
      const r = await fetch(cfg.url + '/rest/v1/claims?' + qs.toString(), {
        method: 'PATCH',
        headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({
          status: verdict,
          label: verdict === 'APPROVED' ? 'APPROVE' : 'REJECT',
          verdict,
          verdict_at: new Date().toISOString()
        }, extra || {}))
      });
      if (!r.ok) throw new Error('sb.setVerdict ' + r.status + ' ' + (await r.text()));
      return r.json();
    }
  };
}