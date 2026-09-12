'use strict';
/* Kotak kosong. Salin file ini jadi config.local.js, isi nilai asli.
   config.local.js TIDAK boleh masuk git (sudah di-ignore). */
export default {
  mode: 'cdp',   // 'cdp' = injek form ke tab Chrome yang sudah login (no extension API); 'api' = submit via header admin
  cdp: {
    port: 9222,                   // port Chrome --remote-debugging-port
    urlMatch: 'bonussmb.com'      // substring URL tab bonus yang dipakai
  },
  supabase: {
    url: 'https://epzuvadrnzdnyyhwiqyc.supabase.co',
    key: '',        // publishable/anon key — baca antrian + tulis status (via RLS)
    serviceKey: ''  // opsional: service role
  },
  bonus: {
    domain: 'bonussmb.com',   // domain web bonus (contoh)
    // Header admin yang dipakai untuk tiap request ke API bonus.
    headers: {
      'X-Access-Token': '',
      'X-Agent-Pkid': '',
      'X-Agent-Role': '',
      'X-Agent-Suid': '',
      'X-Agent-User': '',
      'X-Agent-UserId': '',
      'X-Agent-Voice': 'false'
    }
  },
  poll: {
    intervalMs: 2500,       // jeda cek antrian baru
    perSiteConcurrent: 2,   // berapa claim berjalan paralel per situs
    maxRetry: 3
  },
  sites: [
    { siteId: 'bandar80', gameId: '74', historyHost: 'public.zmcyu9ypy.com' }
  ]
};