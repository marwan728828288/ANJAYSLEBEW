/**
 * Data Manager - Mengelola semua operasi data (read/write/delete)
 * Bertanggung jawab atas komunikasi dengan Chrome Storage API
 */

import { getData, setData } from './shared.js';

/**
 * Fetch semua rows dari storage
 * @async
 * @returns {Promise<Array>} Array of ticket data objects
 * @throws {Error} Jika storage access gagal
 */
export async function fetchAllRows() {
  try {
    const result = await getData('rows');
    return result.rows || [];
  } catch (error) {
    const err = new Error(`Failed to fetch rows from storage: ${error.message}`);
    err.code = 'STORAGE_FETCH_ERROR';
    throw err;
  }
}

/**
 * Fetch row count metadata (total, approved, rejected, pending)
 * @async
 * @returns {Promise<Object>} Object dengan keys: total, approved, rejected, pending
 */
export async function fetchRowStatistics() {
  try {
    const rows = await fetchAllRows();
    
    const total = rows.length;
    const approved = rows.filter(isRowApproved).length;
    const rejected = rows.filter(isRowRejected).length;
    const pending = total - approved - rejected;
    
    return { total, approved, rejected, pending };
  } catch (error) {
    const err = new Error(`Failed to calculate statistics: ${error.message}`);
    err.code = 'STATS_CALCULATION_ERROR';
    throw err;
  }
}

/**
 * Tambah ticket baru ke storage
 * @async
 * @param {Object} ticketData - Ticket data to add
 * @param {string} ticketData.user - User ID
 * @param {string} ticketData.ticketCode - Ticket code (kode tiket)
 * @param {string} [ticketData.secondaryCode] - Optional secondary ticket code
 * @returns {Promise<number>} ID dari ticket baru yang ditambahkan
 * @throws {Error} Jika validasi gagal atau duplicate ditemukan
 */
export async function addNewTicket(ticketData) {
  const { user, ticketCode, secondaryCode = '' } = ticketData;

  // Validasi input
  if (!user || !ticketCode) {
    const err = new Error('User ID dan Kode Tiket wajib diisi');
    err.code = 'VALIDATION_ERROR';
    err.field = 'user_or_ticket';
    throw err;
  }

  try {
    const result = await getData(['rows', 'nextRowId']);
    const rows = result.rows || [];
    const nextId = result.nextRowId || 1;

    // Check duplicate
    if (isTicketCodeDuplicate(rows, ticketCode)) {
      const err = new Error(`Kode Tiket sudah ada dalam database`);
      err.code = 'DUPLICATE_TICKET';
      err.ticketCode = ticketCode;
      throw err;
    }

    if (secondaryCode && isTicketCodeDuplicate(rows, secondaryCode)) {
      const err = new Error(`Kode Tiket 2 sudah ada dalam database`);
      err.code = 'DUPLICATE_TICKET';
      err.ticketCode = secondaryCode;
      throw err;
    }

    // Create base ticket object
    const baseTicket = createBaseTicketObject(ticketData);
    const newTickets = [];

    // Add primary ticket
    newTickets.push({
      id: nextId,
      ticketCode: ticketCode,
      ...baseTicket
    });

    // Add secondary ticket jika ada
    let secondaryId = null;
    if (secondaryCode) {
      secondaryId = nextId + 1;
      newTickets.push({
        id: secondaryId,
        ticketCode: secondaryCode,
        ...baseTicket
      });
    }

    // Save to storage
    rows.push(...newTickets);
    await setData({
      rows: rows,
      nextRowId: nextId + (secondaryCode ? 2 : 1)
    });

    return { primaryId: nextId, secondaryId };
  } catch (error) {
    if (error.code) throw error; // Re-throw known errors
    const err = new Error(`Failed to add ticket: ${error.message}`);
    err.code = 'ADD_TICKET_ERROR';
    throw err;
  }
}

/**
 * Delete ticket(s) by ID
 * @async
 * @param {number|Array<number>} ids - Single ID or array of IDs to delete
 * @returns {Promise<number>} Jumlah tickets yang berhasil dihapus
 * @throws {Error} Jika delete gagal
 */
export async function deleteTickets(ids) {
  const idsArray = Array.isArray(ids) ? ids : [ids];

  if (!idsArray.length) {
    const err = new Error('No ticket IDs provided for deletion');
    err.code = 'INVALID_INPUT';
    throw err;
  }

  try {
    const result = await getData('rows');
    const rows = result.rows || [];
    const idsSet = new Set(idsArray);
    
    const filteredRows = rows.filter(row => !idsSet.has(row.id));
    const deletedCount = rows.length - filteredRows.length;

    await setData({ rows: filteredRows });
    return deletedCount;
  } catch (error) {
    const err = new Error(`Failed to delete tickets: ${error.message}`);
    err.code = 'DELETE_ERROR';
    throw err;
  }
}

/**
 * Update ticket status
 * @async
 * @param {number} id - Ticket ID
 * @param {Object} updateData - Fields to update
 * @returns {Promise<Object>} Updated ticket object
 * @throws {Error} Jika update gagal
 */
export async function updateTicketStatus(id, updateData) {
  try {
    const result = await getData('rows');
    const rows = result.rows || [];
    
    const ticket = rows.find(r => r.id === id);
    if (!ticket) {
      const err = new Error(`Ticket with ID ${id} not found`);
      err.code = 'TICKET_NOT_FOUND';
      err.ticketId = id;
      throw err;
    }

    // Merge update data
    const updated = { ...ticket, ...updateData, updatedAt: Date.now() };
    const rowIndex = rows.findIndex(r => r.id === id);
    rows[rowIndex] = updated;

    await setData({ rows });
    return updated;
  } catch (error) {
    if (error.code) throw error;
    const err = new Error(`Failed to update ticket: ${error.message}`);
    err.code = 'UPDATE_ERROR';
    throw err;
  }
}

/**
 * Get tickets untuk display (latest 50, reversed)
 * @async
 * @returns {Promise<Array>} Array of tickets untuk rendering
 */
export async function fetchDisplayRows() {
  const rows = await fetchAllRows();
  return rows.slice().reverse().slice(0, 50);
}

// ============ HELPER FUNCTIONS ============

/**
 * Check apakah row sudah approved
 * @param {Object} row - Ticket object
 * @returns {boolean}
 */
function isRowApproved(row) {
  return row.autoStatus === 'Approved' || row.manualStatus === 'Approved';
}

/**
 * Check apakah row sudah rejected
 * @param {Object} row - Ticket object
 * @returns {boolean}
 */
function isRowRejected(row) {
  const rejectionStatuses = ['Ticket Not Found', 'Session Timeout', 'Tidak Ditemukan Scatter', 'Scatter Not Found'];
  return rejectionStatuses.includes(row.autoStatus) || 
         rejectionStatuses.includes(row.manualStatus) ||
         rejectionStatuses.includes(row.autoCol10);
}

/**
 * Check duplicate ticket code dalam rows
 * @param {Array} rows - Array of tickets
 * @param {string} ticketCode - Code to check
 * @returns {boolean}
 */
function isTicketCodeDuplicate(rows, ticketCode) {
  return rows.some(r => (r.ticketCode || r.kode || r.kode2) === ticketCode);
}

/**
 * Create base ticket object template
 * @param {Object} data - Input data
 * @returns {Object} Base ticket object
 */
function createBaseTicketObject(data) {
  return {
    user: data.user || '',
    hasTimeSuffix: data.hasTimeSuffix || false,
    autoStatus: '',
    manualStatus: '',
    betting: '',
    payout: '',
    description: '', // keterangan
    secureStatus: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    source: 'lite'
  };
}
