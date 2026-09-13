import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  OAUTH_CLIENT_ID,
  OAUTH_REDIRECT_URL
} from '../config.js';
import { getData, setData } from './shared.js';
import { updateOnlineStats } from './deco.js';
export function generateDeviceId() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

export default async function initAuth() {
  const overlay = document.getElementById('loginOverlay');
  if (!overlay) return;

  const btn = document.getElementById('loginBtn');
  const error = document.getElementById('loginError');

  const { loginSession, userEmail } = await getData(['loginSession', 'userEmail']);
  if (loginSession && Date.now() - loginSession < 86400000 && userEmail) {
    overlay.classList.add('hidden');
    return;
  }

  overlay.classList.remove('hidden');
  if (error) error.classList.remove('show');

  const doLogin = async () => {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Memproses...';
    }
    if (error) error.classList.remove('show');

    try {
      const extId = chrome.runtime.id;
      const state = Math.random().toString(36).slice(2) + '_' + extId;
      const oauthUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: OAUTH_CLIENT_ID,
        redirect_uri: OAUTH_REDIRECT_URL,
        response_type: 'code',
        scope: 'openid email',
        state,
      });

      const responseUrl = await new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow({
          url: oauthUrl,
          interactive: true
        }, function(url) {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(url);
        });
      });

      const params = new URLSearchParams(new URL(responseUrl).search);
      const email = params.get('email');

      if (email) {
        await setData({ userEmail: email, loginSession: Date.now() });
        overlay.classList.add('hidden');

        const el = document.getElementById('sessionEmail');
        if (el) el.textContent = '\uD83D\uDCE7 ' + email;

        try {
          let { deviceId } = await getData('deviceId');
          if (!deviceId) {
            deviceId = generateDeviceId();
            await setData({ deviceId });
          }
          if (deviceId && SUPABASE_URL && SUPABASE_ANON_KEY) {
            fetch(SUPABASE_URL + '/rest/v1/devices?on_conflict=device_id', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_ANON_KEY,
                Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
                Prefer: 'resolution=merge-duplicates'
              },
              body: JSON.stringify({
                device_id: deviceId,
                email,
                last_ping: Date.now()
              })
            });
          }
        } catch {}

        if (typeof updateOnlineStats === 'function') updateOnlineStats();
      } else {
        if (error) {
          error.textContent = 'Gagal mendapatkan email';
          error.classList.add('show');
        }
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Login dengan Google';
        }
      }
    } catch (e) {
      const msg = typeof e === 'object' && e.message ? e.message : String(e);
      if (msg.includes('canceled') || msg.includes('cancelled')) {
        if (error) {
          error.textContent = 'Login dibatalkan';
          error.classList.add('show');
        }
      } else {
        console.error('OAuth error:', e);
        if (error) {
          error.textContent = 'Gagal login: ' + msg;
          error.classList.add('show');
        }
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Login dengan Google';
      }
    }
  };

  if (btn) btn.addEventListener('click', doLogin);
}
