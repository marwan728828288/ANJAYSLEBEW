/**
 * Validators - Input validation dan data cleaning functions
 * Centralized validation logic untuk mencegah duplikasi
 */

const MIN_TICKET_CODE_LENGTH = 19;
const TICKET_CODE_ALLOWED_CHARS = /^[0-9+\-\s]+$/;

/**
 * Validate form inputs untuk add ticket
 * @param {Object} input - Form input values
 * @param {string} input.user - User ID input
 * @param {string} input.ticketCode - Primary ticket code
 * @param {string} [input.secondaryCode] - Secondary ticket code
 * @returns {Object} Validation result { isValid: boolean, error: string }
 */
export function validateFormInputs(input) {
  const { user, ticketCode, secondaryCode } = input;

  if (!user || !user.trim()) {
    return {
      isValid: false,
      error: 'User ID wajib diisi'
    };
  }

  if (!ticketCode || !ticketCode.trim()) {
    return {
      isValid: false,
      error: 'Kode Tiket wajib diisi'
    };
  }

  return { isValid: true, error: '' };
}

/**
 * Validate ticket code length
 * @param {string} code - Ticket code to validate
 * @returns {boolean} True jika panjang valid
 */
export function isValidTicketCodeLength(code) {
  const cleaned = cleanTicketCode(code);
  return cleaned.length >= MIN_TICKET_CODE_LENGTH;
}

/**
 * Parse user input dan extract metadata
 * @param {string} userInput - User ID input (dapat memiliki "TS" suffix)
 * @returns {Object} { user: string, hasTimeSuffix: boolean }
 * @example
 * parseUserId("USER123TS") // { user: "USER123", hasTimeSuffix: true }
 * parseUserId("USER123") // { user: "USER123", hasTimeSuffix: false }
 */
export function parseUserId(userInput) {
  if (!userInput) {
    return { user: '', hasTimeSuffix: false };
  }

  const input = String(userInput).trim();
  const hasTimeSuffix = input.toUpperCase().endsWith('TS');
  const user = hasTimeSuffix 
    ? input.slice(0, -2).trim() 
    : input;

  return { user, hasTimeSuffix };
}

/**
 * Clean dan normalize ticket code
 * - Remove extra spaces
 * - Trim whitespace
 * - Keep only valid characters (0-9, +, -)
 * @param {string} code - Raw ticket code input
 * @returns {string} Cleaned ticket code
 * @example
 * cleanTicketCode("  1234  5678  ") // "12345678"
 * cleanTicketCode("1234-5678+90") // "1234-5678+90"
 */
export function cleanTicketCode(code) {
  if (!code) return '';

  return String(code)
    .trim()
    .replace(/\s+/g, '') // Remove all spaces
    .toUpperCase(); // Normalize to uppercase
}

/**
 * Validate ticket code format
 * @param {string} code - Cleaned ticket code
 * @returns {Object} { isValid: boolean, reason: string }
 */
export function validateTicketCodeFormat(code) {
  if (!code) {
    return { isValid: false, reason: 'Kode Tiket tidak boleh kosong' };
  }

  if (!TICKET_CODE_ALLOWED_CHARS.test(code)) {
    return {
      isValid: false,
      reason: 'Kode Tiket hanya boleh berisi angka, +, dan -'
    };
  }

  if (code.length < MIN_TICKET_CODE_LENGTH) {
    return {
      isValid: false,
      reason: `Kode Tiket minimal ${MIN_TICKET_CODE_LENGTH} karakter`
    };
  }

  return { isValid: true, reason: '' };
}

/**
 * Validate URL format untuk scan feature
 * @param {string} url - URL to validate
 * @returns {boolean} True jika valid URL
 */
export function isValidImageUrl(url) {
  if (!url) return false;

  try {
    const urlObj = new URL(url);
    // Only allow http/https
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate ticket ID
 * @param {any} id - Value to check if it's a valid ticket ID
 * @returns {boolean}
 */
export function isValidTicketId(id) {
  return Number.isInteger(id) && id > 0;
}

/**
 * Validate selected ticket IDs untuk bulk operations
 * @param {any} ids - Value to check
 * @returns {boolean}
 */
export function isValidBulkSelection(ids) {
  if (!Array.isArray(ids)) return false;
  if (ids.length === 0) return false;
  return ids.every(id => isValidTicketId(parseInt(id)));
}

/**
 * Validate status value
 * @param {string} status - Status string to validate
 * @returns {boolean}
 */
export function isValidStatus(status) {
  const validStatuses = [
    'Approved',
    'Ticket Not Found',
    'Session Timeout',
    'Tidak Ditemukan Scatter',
    'Scatter Not Found',
    'Pending',
    ''
  ];
  return validStatuses.includes(status);
}

/**
 * Escape HTML special characters untuk prevent XSS
 * (Note: ini duplicate dari shared.js, tapi di-include untuk completeness)
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 * @internal
 */
export function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validate dan extract metadata dari form
 * Combine semua validation menjadi satu comprehensive check
 * @param {Object} formData - Complete form data
 * @returns {Object} { isValid: boolean, errors: Object }
 */
export function validateCompleteFormData(formData) {
  const errors = {};

  // Validate user
  const userValidation = validateFormInputs({ user: formData.user });
  if (!userValidation.isValid) {
    errors.user = userValidation.error;
  }

  // Validate primary code
  if (!formData.ticketCode || !formData.ticketCode.trim()) {
    errors.ticketCode = 'Kode Tiket wajib diisi';
  } else {
    const codeValidation = validateTicketCodeFormat(
      cleanTicketCode(formData.ticketCode)
    );
    if (!codeValidation.isValid) {
      errors.ticketCode = codeValidation.reason;
    }
  }

  // Validate secondary code (optional)
  if (formData.secondaryCode && formData.secondaryCode.trim()) {
    const codeValidation = validateTicketCodeFormat(
      cleanTicketCode(formData.secondaryCode)
    );
    if (!codeValidation.isValid) {
      errors.secondaryCode = codeValidation.reason;
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Constants untuk validation
 * @readonly
 */
export const VALIDATION_CONSTANTS = {
  MIN_TICKET_CODE_LENGTH,
  MAX_TICKET_CODE_LENGTH: 50,
  MIN_USER_LENGTH: 1,
  MAX_USER_LENGTH: 100,
  ALLOWED_CHARS: TICKET_CODE_ALLOWED_CHARS
};
