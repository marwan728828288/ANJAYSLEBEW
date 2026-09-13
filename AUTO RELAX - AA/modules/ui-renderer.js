/**
 * UI Renderer - Mengelola semua rendering HTML dan DOM updates
 * Bertanggung jawab atas presentasi data dan visual updates
 */

import { $, escapeHtml } from './shared.js';

// Status badge styling constants
const STATUS_STYLES = {
  APPROVED: 'badge-success',
  REJECTED: 'badge-danger',
  PENDING: 'badge-warning'
};

const REJECTION_STATUSES = ['Ticket Not Found', 'Session Timeout', 'Tidak Ditemukan Scatter', 'Scatter Not Found'];

/**
 * Render tabel data dengan list of tickets
 * @param {Array<Object>} rows - Array of ticket objects to render
 */
export function renderDataTable(rows) {
  const tbody = $('#lite-table-body');
  
  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr class="empty"><td colspan="7">Belum ada data</td></tr>';
    return;
  }

  const html = rows.map(row => createTableRow(row)).join('');
  tbody.innerHTML = html;
}

/**
 * Update statistics display
 * @param {Object} stats - Statistics object
 * @param {number} stats.total - Total tickets
 * @param {number} stats.approved - Approved count
 * @param {number} stats.rejected - Rejected count
 * @param {number} stats.pending - Pending count
 */
export function updateStatsDisplay(stats) {
  const { total, approved, rejected, pending } = stats;
  
  $('#stat-total').textContent = total;
  $('#stat-approved').textContent = approved;
  $('#stat-rejected').textContent = rejected;
  $('#stat-pending').textContent = pending;
}

/**
 * Update status message di form area
 * @param {string} message - Message to display
 * @param {string} className - CSS class name (empty string, 'dup', 'success', 'error')
 */
export function updateStatusMessage(message, className = '') {
  const statusEl = $('#status-text');
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.className = className;
  }
}

/**
 * Display scan result message
 * @param {string} message - Message to show
 * @param {string} status - Status type: 'ok', 'err', 'warn', or ''
 */
export function updateScanStatus(message, status = '') {
  const scanStatus = $('#scan-status');
  if (scanStatus) {
    scanStatus.textContent = message;
    scanStatus.className = status ? `scan-${status}` : '';
  }
}

/**
 * Clear form inputs dan reset state
 */
export function clearFormInputs() {
  const inputs = ['#lite-user', '#lite-kode', '#lite-kode-2'];
  inputs.forEach(selector => {
    const el = $(selector);
    if (el) el.value = '';
  });

  // Clear scan inputs
  const scanStatus = $('#scan-status');
  if (scanStatus) {
    scanStatus.textContent = '';
    scanStatus.className = '';
  }

  const scanUrl = $('#scan-url');
  if (scanUrl) {
    scanUrl.value = '';
    scanUrl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  updateStatusMessage('');
}

/**
 * Show/hide secondary ticket code input
 * @param {boolean} show - Whether to show or hide
 */
export function toggleSecondaryCodeInput(show) {
  const wrapper = $('#kode-2-wrap');
  if (wrapper) {
    wrapper.style.display = show ? 'block' : 'none';
  }
}

/**
 * Update gen-result area dengan generated passwords
 * @param {Array<Object>} passwords - Array of password objects
 * @param {string} passwords[].label - Label (e.g., "User 1")
 * @param {string} passwords[].value - Generated password
 */
export function displayGeneratedPasswords(passwords) {
  const genResult = $('#gen-result');
  if (!genResult) return;

  if (!passwords || passwords.length === 0) {
    genResult.style.display = 'none';
    return;
  }

  const html = passwords
    .map(pw => `
      <div class="pw-line">
        <span class="pw-label">${escapeHtml(pw.label)}:</span>
        <span class="pw-value">${escapeHtml(pw.value)}</span>
        <button class="pw-copy-btn" data-value="${escapeHtml(pw.value)}">Copy</button>
      </div>
    `)
    .join('');

  genResult.innerHTML = html;
  genResult.style.display = 'block';
}

/**
 * Update bulk action info text
 * @param {number} selectedCount - Number of items selected
 */
export function updateBulkActionInfo(selectedCount) {
  const bulkInfo = $('#bulk-info');
  if (bulkInfo) {
    bulkInfo.textContent = selectedCount > 0 ? `${selectedCount} dipilih` : '';
  }
}

/**
 * Get list of selected checkbox values
 * @returns {Array<string>} Array of selected IDs
 */
export function getSelectedTicketIds() {
  const checkboxes = document.querySelectorAll('.bulk-cb:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

/**
 * Check all checkboxes in table
 * @param {boolean} checked - Whether to check or uncheck all
 */
export function setAllCheckboxes(checked) {
  const checkboxes = document.querySelectorAll('.bulk-cb');
  checkboxes.forEach(cb => { cb.checked = checked; });
  
  updateBulkActionInfo(checked ? checkboxes.length : 0);
}

/**
 * Get scan URL input value
 * @returns {string} Scan URL
 */
export function getScanUrlInput() {
  const scanUrl = $('#scan-url');
  return scanUrl ? scanUrl.value.trim() : '';
}

/**
 * Set OCR Next button visibility
 * @param {boolean} visible - Whether to show
 */
export function setOCRNextButtonVisible(visible) {
  const btn = $('#btn-next-ocr');
  if (btn) {
    btn.style.display = visible ? 'block' : 'none';
  }
}

/**
 * Set OCR info indicator visibility
 * @param {boolean} visible - Whether to show
 */
export function setOCRInfoVisible(visible) {
  const info = $('#scan-info');
  if (info) {
    info.style.display = visible ? 'block' : 'none';
  }
}

// ============ PRIVATE FUNCTIONS ============

/**
 * Create single table row HTML untuk ticket
 * @private
 * @param {Object} row - Ticket object
 * @returns {string} HTML row string
 */
function createTableRow(row) {
  const displayStatus = getDisplayStatus(row);
  const rowClass = getRowClass(displayStatus);
  const bonusDisplay = getBonusDisplay(row.secureStatus);
  const ticketCodeDisplay = escapeHtml(row.ticketCode || row.kode || row.kode2 || '');
  const userDisplay = escapeHtml(row.user) + (row.hasTimeSuffix ? ' <span style="color:#fcd34d;font-size:8px;">TS</span>' : '');

  return `
    <tr class="${rowClass}" data-id="${row.id}">
      <td>
        <input type="checkbox" class="bulk-cb" value="${row.id}" 
               style="width:12px;height:12px;accent-color:#818cf8;" tabindex="-1">
      </td>
      <td>${userDisplay}</td>
      <td style="font-family:monospace;font-size:9px;">${ticketCodeDisplay}</td>
      <td>${createStatusBadge(displayStatus)}</td>
      <td style="font-size:9px;color:#9ca3af;max-width:120px;overflow:hidden;text-overflow:ellipsis;">
        ${escapeHtml(row.description || row.betting || '')}
      </td>
      <td style="font-size:11px;">${bonusDisplay}</td>
      <td>
        <div class="actions">
          <button class="btn btn-sm btn-info btn-edit" data-id="${row.id}" tabindex="-1">Edit</button>
          <button class="btn btn-sm btn-warning btn-retry-cekbet" data-id="${row.id}" tabindex="-1">Cek</button>
          <button class="btn btn-sm btn-success btn-retry-bonus" data-id="${row.id}" tabindex="-1">Bonus</button>
          <button class="btn btn-sm btn-danger btn-delete" data-id="${row.id}" tabindex="-1">Hapus</button>
        </div>
      </td>
    </tr>
  `;
}

/**
 * Get display status string untuk row
 * @private
 * @param {Object} row - Ticket object
 * @returns {string} Status untuk display
 */
function getDisplayStatus(row) {
  return row.autoStatus || row.manualStatus || '';
}

/**
 * Get row CSS class berdasarkan status
 * @private
 * @param {string} status - Status string
 * @returns {string} CSS class name
 */
function getRowClass(status) {
  if (REJECTION_STATUSES.includes(status)) {
    return 'row-notfound';
  }
  if (status === 'Approved') {
    return 'row-approved';
  }
  return '';
}

/**
 * Create status badge HTML
 * @private
 * @param {string} status - Status string
 * @returns {string} HTML badge element
 */
function createStatusBadge(status) {
  if (!status) {
    return '<span class="badge badge-muted">Baru</span>';
  }

  let badgeClass = STATUS_STYLES.PENDING;
  if (status === 'Approved') {
    badgeClass = STATUS_STYLES.APPROVED;
  } else if (REJECTION_STATUSES.includes(status)) {
    badgeClass = STATUS_STYLES.REJECTED;
  }

  return `<span class="badge ${badgeClass}">${escapeHtml(status)}</span>`;
}

/**
 * Get bonus display text/symbol
 * @private
 * @param {string} secureStatus - Secure status value
 * @returns {string} Display symbol
 */
function getBonusDisplay(secureStatus) {
  if (secureStatus === 'SUCCESS') return '✔';
  if (secureStatus === 'FAILED') return '✖';
  return secureStatus || '-';
}
