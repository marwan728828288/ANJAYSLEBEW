/**
 * Event Handlers - Mengelola semua event listeners dan user interactions
 * Menghubungkan UI dengan data operations
 */

import { showToast } from './shared.js';
import { 
  addNewTicket, 
  fetchDisplayRows, 
  fetchRowStatistics,
  deleteTickets, 
  updateTicketStatus 
} from './data-manager.js';
import {
  renderDataTable,
  updateStatsDisplay,
  updateStatusMessage,
  clearFormInputs,
  getSelectedTicketIds,
  setAllCheckboxes,
  getScanUrlInput,
  updateScanStatus
} from './ui-renderer.js';
import {
  parseUserId,
  cleanTicketCode,
  isValidTicketCodeLength,
  validateFormInputs
} from './validators.js';

/**
 * Initialize semua event listeners
 */
export function initializeEventHandlers() {
  // Form submission
  const btnAdd = document.getElementById('btn-add-ticket');
  if (btnAdd) {
    btnAdd.addEventListener('click', handleAddTicket);
  }

  // Dual mode button
  const btn2x = document.getElementById('btn-2x');
  if (btn2x) {
    btn2x.addEventListener('click', handleDualModeToggle);
  }

  // Scan URL input
  const scanUrl = document.getElementById('scan-url');
  if (scanUrl) {
    scanUrl.addEventListener('input', handleScanUrlInput);
  }

  // Bulk actions
  const selectAll = document.getElementById('select-all');
  if (selectAll) {
    selectAll.addEventListener('change', handleSelectAll);
  }

  const btnCekSelected = document.getElementById('btn-cekbet-selected');
  if (btnCekSelected) {
    btnCekSelected.addEventListener('click', handleBulkRecheck);
  }

  const btnBonusSelected = document.getElementById('btn-bonus-selected');
  if (btnBonusSelected) {
    btnBonusSelected.addEventListener('click', handleBulkBonus);
  }

  const btnDeleteSelected = document.getElementById('btn-delete-selected');
  if (btnDeleteSelected) {
    btnDeleteSelected.addEventListener('click', handleBulkDelete);
  }

  // Table row actions (delegated)
  const tableBody = document.getElementById('lite-table-body');
  if (tableBody) {
    tableBody.addEventListener('click', handleTableRowAction);
  }

  // Checkbox change events (for bulk info update)
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('bulk-cb')) {
      updateBulkInfo();
    }
  });
}

/**
 * Load dan render tabel data saat popup dibuka/di-refresh
 * @async
 */
export async function loadAndRenderData() {
  try {
    const [rows, stats] = await Promise.all([
      fetchDisplayRows(),
      fetchRowStatistics()
    ]);
    
    renderDataTable(rows);
    updateStatsDisplay(stats);
  } catch (error) {
    console.error('Failed to load data:', error);
    showToast('Gagal memuat data', true);
  }
}

// ============ EVENT HANDLERS ============

/**
 * Handle add ticket form submission
 * @async
 * @private
 */
async function handleAddTicket() {
  try {
    // Get form values
    const userInput = document.getElementById('lite-user')?.value || '';
    const codeInput = document.getElementById('lite-kode')?.value || '';
    const code2Input = document.getElementById('lite-kode-2')?.value || '';

    // Validate inputs
    const validation = validateFormInputs({
      user: userInput,
      ticketCode: codeInput,
      secondaryCode: code2Input
    });

    if (!validation.isValid) {
      updateStatusMessage(validation.error, 'error');
      showToast(validation.error, true);
      return;
    }

    // Parse dan clean data
    const parsedUser = parseUserId(userInput);
    const cleanedCode = cleanTicketCode(codeInput);
    const cleanedCode2 = code2Input ? cleanTicketCode(code2Input) : '';

    // Validate code length
    if (!isValidTicketCodeLength(cleanedCode)) {
      updateStatusMessage('Kode Tiket minimal 19 karakter', 'error');
      showToast('Kode Tiket minimal 19 karakter', true);
      return;
    }

    if (cleanedCode2 && !isValidTicketCodeLength(cleanedCode2)) {
      updateStatusMessage('Kode Tiket 2 minimal 19 karakter', 'error');
      showToast('Kode Tiket 2 minimal 19 karakter', true);
      return;
    }

    // Add ticket to storage
    const result = await addNewTicket({
      user: parsedUser.user,
      ticketCode: cleanedCode,
      secondaryCode: cleanedCode2,
      hasTimeSuffix: parsedUser.hasTimeSuffix
    });

    // Success - clear form dan refresh display
    updateStatusMessage('Data tersimpan!', 'success');
    clearFormInputs();
    showToast('Data berhasil ditambahkan');

    // Refresh table
    await loadAndRenderData();

    // Trigger automation for newly added tickets
    if (result.primaryId) {
      // Auto-check history berjalan via countdown 60 detik, tidak langsung.
      const triggerIds = [result.primaryId];
      if (result.secondaryId) triggerIds.push(result.secondaryId);
      
      chrome.runtime.sendMessage({ 
        type: 'TRIGGER_MANUAL', 
        priorityIds: triggerIds 
      }).catch(err => console.log('Manual trigger message failed:', err));
    }
  } catch (error) {
    console.error('Error adding ticket:', error);
    
    if (error.code === 'DUPLICATE_TICKET') {
      updateStatusMessage(`${error.ticketCode} sudah ada!`, 'dup');
      showToast(`Kode tiket sudah ada dalam data`, true);
    } else {
      updateStatusMessage(error.message || 'Gagal menambah data', 'error');
      showToast(error.message || 'Gagal menambah data', true);
    }
  }
}

/**
 * Handle dual mode (2x) button
 * @private
 */
function handleDualModeToggle() {
  // TODO: Implement dual mode logic
  console.log('Dual mode toggle clicked');
}

/**
 * Handle scan URL input change
 * @private
 */
function handleScanUrlInput(e) {
  const url = e.target.value.trim();
  if (!url) {
    updateScanStatus('', '');
    return;
  }

  // TODO: Trigger OCR detection
  console.log('Scan URL entered:', url);
}

/**
 * Handle select all checkboxes
 * @private
 */
function handleSelectAll(e) {
  setAllCheckboxes(e.target.checked);
}

/**
 * Handle bulk recheck operation
 * @async
 * @private
 */
async function handleBulkRecheck() {
  const selectedIds = getSelectedTicketIds();
  if (selectedIds.length === 0) {
    showToast('Pilih data terlebih dahulu', true);
    return;
  }

  try {
    // TODO: Implement bulk recheck logic
    showToast(`Recheck untuk ${selectedIds.length} data`);
  } catch (error) {
    console.error('Bulk recheck error:', error);
    showToast('Gagal melakukan recheck', true);
  }
}

/**
 * Handle bulk bonus operation
 * @async
 * @private
 */
async function handleBulkBonus() {
  const selectedIds = getSelectedTicketIds();
  if (selectedIds.length === 0) {
    showToast('Pilih data terlebih dahulu', true);
    return;
  }

  try {
    // TODO: Implement bulk bonus input logic
    showToast(`Input bonus untuk ${selectedIds.length} data`);
  } catch (error) {
    console.error('Bulk bonus error:', error);
    showToast('Gagal input bonus', true);
  }
}

/**
 * Handle bulk delete operation
 * @async
 * @private
 */
async function handleBulkDelete() {
  const selectedIds = getSelectedTicketIds();
  if (selectedIds.length === 0) {
    showToast('Pilih data terlebih dahulu', true);
    return;
  }

  if (!confirm(`Yakin hapus ${selectedIds.length} data?`)) {
    return;
  }

  try {
    const deletedCount = await deleteTickets(selectedIds);
    showToast(`${deletedCount} data berhasil dihapus`);
    await loadAndRenderData();
  } catch (error) {
    console.error('Bulk delete error:', error);
    showToast('Gagal menghapus data', true);
  }
}

/**
 * Handle table row action buttons (delegated)
 * @async
 * @private
 */
async function handleTableRowAction(e) {
  const btn = e.target.closest('button');
  if (!btn) return;

  const rowId = parseInt(btn.dataset.id);
  if (isNaN(rowId)) return;

  if (btn.classList.contains('btn-edit')) {
    handleEditTicket(rowId);
  } else if (btn.classList.contains('btn-retry-cekbet')) {
    handleRetryCheck(rowId);
  } else if (btn.classList.contains('btn-retry-bonus')) {
    handleRetryBonus(rowId);
  } else if (btn.classList.contains('btn-delete')) {
    handleDeleteTicket(rowId);
  }
}

/**
 * Handle edit ticket
 * @private
 */
function handleEditTicket(rowId) {
  // TODO: Implement edit modal/dialog
  console.log('Edit ticket:', rowId);
}

/**
 * Handle retry check
 * @private
 */
function handleRetryCheck(rowId) {
  // TODO: Implement retry check
  console.log('Retry check:', rowId);
}

/**
 * Handle retry bonus
 * @private
 */
function handleRetryBonus(rowId) {
  // TODO: Implement retry bonus
  console.log('Retry bonus:', rowId);
}

/**
 * Handle delete single ticket
 * @async
 * @private
 */
async function handleDeleteTicket(rowId) {
  if (!confirm('Yakin hapus data ini?')) {
    return;
  }

  try {
    await deleteTickets(rowId);
    showToast('Data berhasil dihapus');
    await loadAndRenderData();
  } catch (error) {
    console.error('Delete error:', error);
    showToast('Gagal menghapus data', true);
  }
}

/**
 * Update bulk action info text
 * @private
 */
function updateBulkInfo() {
  const selectedIds = getSelectedTicketIds();
  const bulkInfo = document.getElementById('bulk-info');
  if (bulkInfo) {
    bulkInfo.textContent = selectedIds.length > 0 
      ? `${selectedIds.length} dipilih` 
      : '';
  }
}
