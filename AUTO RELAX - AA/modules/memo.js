import { $, showToast } from './shared.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

var THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
var ADMIN_EMAILS = ['fibiogenio121@gmail.com'];

export function initMemo() {
  loadMemos();
  updateBadge();
  var tabBtn = document.querySelector('.tab-btn[data-tab="memo"]');
  if (tabBtn) {
    tabBtn.addEventListener('click', function () {
      updateBadge();
      setTimeout(function () { markAsRead(); loadMemos(); cleanupOldMemos(); }, 300);
    });
  }
  var sendBtn = $('#memo-send-btn');
  var input = $('#memo-input');
  if (sendBtn) sendBtn.addEventListener('click', sendMemo);
  if (input) {
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMemo(); }
    });
  }
}

async function cleanupOldMemos() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  var cutoff = new Date(Date.now() - THREE_DAYS_MS).toISOString();
  try {
    await fetch(SUPABASE_URL + '/rest/v1/memos?created_at=lt.' + encodeURIComponent(cutoff), {
      method: 'DELETE',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY
      }
    });
  } catch (_) {}
}

async function sendMemo() {
  const input = $('#memo-input');
  if (!input) return;
  const message = input.value.trim();
  if (!message) { showToast('Pesan kosong', true); return; }
  const btn = $('#memo-send-btn');
  if (btn) btn.disabled = true;
  try {
    const result = await new Promise(function (r) { chrome.storage.local.get('userEmail', r); });
    const email = result.userEmail;
    if (!email) { showToast('Login dulu', true); return; }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { showToast('Supabase tidak dikonfigurasi', true); return; }
    const res = await fetch(SUPABASE_URL + '/rest/v1/memos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ message: message, author_email: email })
    });
    if (!res.ok) { showToast('Gagal kirim memo (' + res.status + ')', true); return; }
    input.value = '';
    showToast('Memo terkirim');
    loadMemos();
    updateBadge();
  } catch (err) {
    showToast('Gagal kirim memo', true);
    console.error('Memo send error:', err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function loadMemos() {
  const list = $('#memo-list');
  if (!list) return;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    list.innerHTML = '<div class="empty"><p>Supabase tidak dikonfigurasi</p></div>';
    return;
  }
  try {
    var cutoff = new Date(Date.now() - THREE_DAYS_MS).toISOString();
    const res = await fetch(SUPABASE_URL + '/rest/v1/memos?select=*&order=id.desc&created_at=gt.' + encodeURIComponent(cutoff) + '&limit=100', {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY
      }
    });
    if (!res.ok) {
      if (res.status === 404) {
        list.innerHTML = '<div class="empty"><p>Table <b>memos</b> belum ada. Buat dulu di Supabase dashboard.</p></div>';
      } else {
        list.innerHTML = '<div class="empty"><p>Gagal load memo (status ' + res.status + ')</p></div>';
      }
      return;
    }
    var memos = await res.json();
    if (!memos || !memos.length) {
      list.innerHTML = '<div class="empty"><p>Belum ada memo</p></div>';
      return;
    }
    var userResult = await new Promise(function (r) { chrome.storage.local.get('userEmail', r); });
    var userEmail = userResult.userEmail;
    var readResult = await new Promise(function (r) { chrome.storage.local.get('lastReadMemoId', r); });
    var lastReadId = readResult.lastReadMemoId || 0;
    list.innerHTML = memos.map(function (m) {
      var isUnread = m.id > lastReadId && m.author_email !== userEmail;
      var isMe = m.author_email === userEmail;
      var isAdmin = ADMIN_EMAILS.includes(userEmail);
      var time = new Date(m.created_at).toLocaleString('id-ID');
      var shortEmail = (m.author_email || '').split('@')[0] || '?';
      var initial = shortEmail.charAt(0).toUpperCase();
      return '<div class="memo-item' + (isUnread ? ' unread' : '') + '">' +
        '<div class="memo-header">' +
        '<div class="memo-avatar ' + (isMe ? 'self' : 'other') + '">' + esc(initial) + '</div>' +
        '<span class="memo-author ' + (isMe ? 'self' : 'other') + '">' + esc(m.author_email) + '</span>' +
        '<span class="memo-time">' + time + '</span>' +
        (isUnread ? '<span class="memo-badge-new">Baru</span>' : '') +
        '</div>' +
        '<div class="memo-body">' + esc(m.message) + '</div>' +
        (isMe || isAdmin ? '<button class="memo-del-btn" data-id="' + m.id + '" title="Hapus memo">&times;</button>' : '') +
        '</div>';
    }).join('');
    list.querySelectorAll('.memo-del-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) { e.stopPropagation(); deleteMemo(parseInt(this.dataset.id)); });
    });
  } catch (err) {
    console.error('Memo load error:', err);
    list.innerHTML = '<div class="empty"><p>Error load memo</p></div>';
  }
}

async function updateBadge() {
  var badge = $('#memo-badge');
  if (!badge) return;
  try {
    var result = await new Promise(function (r) { chrome.storage.local.get(['userEmail', 'lastReadMemoId'], r); });
    var email = result.userEmail;
    if (!email) { badge.style.display = 'none'; return; }
    var lastReadId = result.lastReadMemoId || 0;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { badge.style.display = 'none'; return; }
    var res = await fetch(SUPABASE_URL + '/rest/v1/memos?select=id&author_email=neq.' + encodeURIComponent(email) + '&id=gt.' + lastReadId + '&limit=100', {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY
      }
    });
    if (!res.ok) { badge.style.display = 'none'; return; }
    var rows = await res.json();
    var count = (rows || []).length;
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'inline';
    } else {
      badge.style.display = 'none';
    }
  } catch (err) {
    badge.style.display = 'none';
  }
}

async function markAsRead() {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    var res = await fetch(SUPABASE_URL + '/rest/v1/memos?select=id&order=id.desc&limit=1', {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY
      }
    });
    if (!res.ok) return;
    var rows = await res.json();
    if (rows && rows.length && rows[0].id) {
      await new Promise(function (r) { chrome.storage.local.set({ lastReadMemoId: rows[0].id }, r); });
      updateBadge();
    }
  } catch (err) {
    console.error('Memo markAsRead error:', err);
  }
}

async function deleteMemo(id) {
  if (!confirm('Hapus memo ini?')) return;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  try {
    var res = await fetch(SUPABASE_URL + '/rest/v1/memos?id=eq.' + id, {
      method: 'DELETE',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY
      }
    });
    if (!res.ok) { showToast('Gagal hapus memo', true); return; }
    showToast('Memo dihapus');
    loadMemos();
    updateBadge();
  } catch (err) {
    showToast('Gagal hapus memo', true);
    console.error('Memo delete error:', err);
  }
}

function esc(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
