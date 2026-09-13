import { $, getData, setData, showToast, escapeHtml } from './shared.js';

export async function renderLogs() {
  const result = await getData('logs');
  const logs = result.logs || [];
  const container = $('#log-container');
  if (!logs.length) {
    container.innerHTML = '<div class="empty"><p>Belum ada aktivitas.</p></div>';
    return;
  }
  container.innerHTML = logs.slice().reverse().map(l => {
    const d = new Date(l.time);
    const time = d.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    return '<div class="log-entry"><span class="time">[' + time + ']</span>' + escapeHtml(l.message) + '</div>';
  }).join('');
  container.scrollTop = 0;
}

export function initLogs() {
  $('#btn-clear-logs').addEventListener('click', async () => {
    if (confirm('Hapus semua logs?')) {
      await setData({ logs: [] });
      renderLogs();
      showToast('Logs dihapus');
    }
  });
  return { renderLogs };
}
