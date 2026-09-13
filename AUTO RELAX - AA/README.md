# 🎰 AUTO RELAX - Chrome Extension

Professional lottery ticket management extension untuk LiveChat integration. Dokumentasi lengkap tentang arsitektur, module breakdown, dan setup instructions.

---

## 📋 Table of Contents

- [Fitur Utama](#fitur-utama)
- [Struktur Folder](#struktur-folder)
- [Module Documentation](#module-documentation)
- [Setup & Development](#setup--development)
- [API Reference](#api-reference)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)

---

## ✨ Fitur Utama

### 1. **Lite Dashboard**
- Dashboard kompak untuk quick entry data tiket
- Display real-time statistics (Total, Approved, Rejected, Pending)
- Bulk operations (Edit, Recheck, Delete)

### 2. **OCR Image Scanning**
- Deteksi otomatis kode tiket dari gambar
- Multiple OCR variants untuk accuracy tinggi
- Image preprocessing (adaptive binarization, contrast enhancement)

### 3. **Password Generator**
- Generate secure passwords dari User ID
- Copy-to-clipboard functionality

### 4. **Automated Checking**
- Auto-trigger checking saat data ditambahkan
- Manual trigger untuk re-checking
- LiveChat status monitoring

### 5. **Data Persistence**
- Chrome Storage API untuk persistent storage
- Unlimited storage quota
- Local-only (tidak cloud sync)

---

## 📁 Struktur Folder

```
AUTO RELAX/
├── 📄 manifest.json          # Extension configuration (v2.5)
├── 📄 config.js              # ⚠️ DEPRECATED: Move to .env
│
├── 📂 background/            # Service worker
│   └── 📄 background.js      # Service worker entry (import ../modules/*)
│
├── 📂 content/               # Content scripts (terdaftar di manifest)
│   ├── 📄 livechat-bg.js     # LiveChat background styling (document_start)
│   ├── 📄 livechat-indicator.js  # LiveChat indicator
│   ├── 📄 livechat-ocr.js    # LiveChat OCR trigger + iframe
│   ├── 📄 livechat-ss.js     # LiveChat screenshot panel
│   ├── 📄 content.js         # Bet logger (injected via chrome.scripting)
│   └── 📄 assist-detector.js # Chat monitoring (standalone)
│
├── 📂 pages/                 # Halaman extension
│   ├── 📄 dashboard.html     # Dashboard page
│   ├── 📄 dashboard.js       # Dashboard logic (import ../modules/*)
│   ├── 📄 popup.html         # Main popup interface
│   ├── 📄 popup.js           # Popup logic
│   ├── 📄 ocr-frame.html     # OCR iframe (web_accessible)
│   ├── 📄 ocr-frame.js       # OCR iframe logic
│   ├── 📄 offscreen.html     # Offscreen OCR document
│   ├── 📄 offscreen-ocr.js   # Offscreen OCR entry
│   ├── 📄 mimpi.html         # Buku Mimpi
│   └── 📄 mimpi.js           # Buku Mimpi logic
│
├── 📂 modules/               # Shared modules (dipanggil ../modules/*)
│   ├── 📄 shared.js          # Common utilities
│   ├── 📄 ocr-common.js      # OCR utilities + calculateOptimalScale (5MP cap)
│   ├── 📄 ocr-engine.js      # OCR engine (PSM 11 sparse, tanpa chunking)
│   ├── 📄 ocr-bridge.js      # OCR bridge NAMA/RRN
│   ├── 📄 bg-*.js            # Background modules
│   ├── 📄 auth.js / ai-chat.js / deco.js / hadiah.js / ...
│   └── ... (utility modules)
│
├── 📂 lib/                   # Third-party libraries
│   ├── tesseract.min.js
│   └── best/                 # Model Tesseract 'best' (akurasi tertinggi)
│
├── 📂 icons/                 # Extension icons
│   ├── icon16.png
│   ├── icon32.png
│   └── icon48.png
│
├── 📂 deploy/                # Artifact deploy (Cloudflare Worker OAuth)
│   └── 📄 worker.js
│
├── 📂 legacy/                # File lama yang tidak dipakai
│   └── 📄 popup.js.refactored
│
└── 📄 .gitignore             # TODO: Add secrets exclusion
```

---

## 🔧 Module Documentation

### 1. **data-manager.js** - Data Operations

Mengelola semua komunikasi dengan Chrome Storage API.

#### Exported Functions:

```javascript
// Fetch operations
fetchAllRows()                  // Get all tickets
fetchDisplayRows()              // Get latest 50 (reversed)
fetchRowStatistics()            // Get stats object
  ↓ Returns { total, approved, rejected, pending }

// Create operations
addNewTicket(data)              // Add single/dual tickets
  ↓ Input: { user, ticketCode, secondaryCode, hasTimeSuffix }
  ↓ Returns: { primaryId, secondaryId }
  ↓ Throws: Error with .code property

// Update operations
updateTicketStatus(id, updates) // Update ticket fields
  ↓ Returns: Updated ticket object

// Delete operations
deleteTickets(ids)              // Delete one or many
  ↓ Input: number | Array<number>
  ↓ Returns: Count deleted
```

#### Error Handling:

Semua functions throw Error objects dengan `.code` property:

```javascript
try {
  await addNewTicket(data);
} catch (error) {
  switch(error.code) {
    case 'VALIDATION_ERROR':
      console.log(error.field);      // 'user_or_ticket'
      break;
    case 'DUPLICATE_TICKET':
      console.log(error.ticketCode);
      break;
    case 'STORAGE_FETCH_ERROR':
      // Handle storage API failure
      break;
  }
}
```

#### Storage Schema:

```javascript
// Chrome Storage (local)
{
  rows: [
    {
      id: 1,
      user: "USER123",
      hasTimeSuffix: false,
      ticketCode: "1234567890123456789",
      autoStatus: "Approved",
      manualStatus: "",
      betting: "10000",
      payout: "50000",
      description: "Win jackpot",
      secureStatus: "SUCCESS",
      createdAt: 1690000000000,
      updatedAt: 1690001000000,
      source: "lite"
    }
  ],
  nextRowId: 2
}
```

---

### 2. **ui-renderer.js** - DOM Rendering

Pure presentational functions untuk render HTML dan update DOM.

#### Exported Functions:

```javascript
// Rendering
renderDataTable(rows)           // Render table dari rows array
displayGeneratedPasswords(pws)  // Show generated passwords

// Status updates
updateStatsDisplay(stats)       // Update stat numbers
updateStatusMessage(msg, class) // Update form status text
updateScanStatus(msg, status)   // Update scan result

// Form state
clearFormInputs()               // Reset all form fields
toggleSecondaryCodeInput(show)  // Show/hide kode-2
updateBulkActionInfo(count)     // Update selection count

// Input retrieval
getScanUrlInput()               // Get scan URL value
getSelectedTicketIds()          // Get checked box values

// Visibility
setOCRNextButtonVisible(bool)
setOCRInfoVisible(bool)

// Helper
setAllCheckboxes(checked)       // Toggle select all
```

#### Styling Constants:

Functions menggunakan CSS classes yang didefinisikan di `popup.html`:

```css
.badge-success, .badge-danger, .badge-warning, .badge-muted
.row-approved, .row-notfound
```

---

### 3. **event-handlers.js** - Event Management

Menghubungkan UI interactions dengan data operations dan rendering.

#### Main Functions:

```javascript
// Initialization
initializeEventHandlers()       // Setup all listeners
loadAndRenderData()             // Initial load + render
```

#### Event Handlers (Internal):

```javascript
handleAddTicket()               // Form submit
handleDualModeToggle()          // 2x button
handleSelectAll()               // Select all checkbox
handleBulkRecheck()             // Recheck selected
handleBulkBonus()               // Bonus input selected
handleBulkDelete()              // Delete selected
handleTableRowAction(e)         // Delegated row actions
  ↓ Edit, Recheck, Bonus, Delete
```

#### Pattern - Flow:

```
User clicks button
  ↓
Event listener triggers
  ↓
Handler validates input (using validators.js)
  ↓
Handler calls data-manager.js function
  ↓
Handler updates UI via ui-renderer.js
  ↓
Handler shows toast notification
```

#### Example Usage:

```javascript
// In popup.js
import { initializeEventHandlers, loadAndRenderData } from './modules/event-handlers.js';

document.addEventListener('DOMContentLoaded', () => {
  initializeEventHandlers();
  loadAndRenderData();
});
```

---

### 4. **validators.js** - Input Validation

Centralized validation functions untuk prevent garbage data.

#### Functions:

```javascript
// High-level validation
validateFormInputs(input)       // Check required fields
validateCompleteFormData(data)  // Comprehensive validation

// Field-level validation
isValidTicketCodeLength(code)
validateTicketCodeFormat(code)
isValidImageUrl(url)
isValidTicketId(id)
isValidBulkSelection(ids)
isValidStatus(status)

// Data transformation
parseUserId(input)              // Extract + hasTimeSuffix
cleanTicketCode(code)           // Normalize to uppercase, remove spaces
escapeHtml(text)                // Prevent XSS
```

#### Validation Results:

```javascript
// validateFormInputs returns:
{ isValid: boolean, error: string }

// validateCompleteFormData returns:
{
  isValid: boolean,
  errors: {
    user: "User ID wajib diisi",
    ticketCode: "Kode Tiket minimal 19 karakter",
    secondaryCode: undefined
  }
}
```

#### Constants:

```javascript
VALIDATION_CONSTANTS = {
  MIN_TICKET_CODE_LENGTH: 19,
  MAX_TICKET_CODE_LENGTH: 50,
  MIN_USER_LENGTH: 1,
  MAX_USER_LENGTH: 100,
  ALLOWED_CHARS: /^[0-9+\-\s]+$/
}
```

---

### 5. **shared.js** - Common Utilities

Existing utilities yang digunakan across modules.

```javascript
// DOM helpers
$()         // querySelector
$$()        // querySelectorAll

// Storage
getData()   // Get from Chrome Storage
setData()   // Set to Chrome Storage

// UI
showToast(msg, isError)         // Show notification
parseUser(input)                // (deprecated - use validators.js)
cleanKode(code)                 // (deprecated - use validators.js)

// Text
escapeHtml(text)                // XSS prevention
generatePassword()              // Password generation

// State
state                           // Global app state (if needed)
```

---

## 🚀 Setup & Development

### Prerequisites

- Chrome browser (Manifest V3 compatible)
- No external dependencies (pure JS + built-in APIs)

### Installation

1. Clone repository
2. Open `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" → Select folder
5. Extension appears in toolbar

### Development Workflow

#### For Popup Changes:

1. Edit files di `modules/`
2. Update `popup.js` imports if adding new modules
3. Save file
4. Reload extension (click reload icon in chrome://extensions/)
5. Test in popup

#### For Background Changes:

1. Edit files di `modules/` dan `background.js`
2. Save file
3. Reload extension
4. Check browser console for errors

#### For Content Script Changes:

1. Edit `content.js` atau files di `modules/`
2. Save file
3. Reload extension
4. Reload target website
5. Check console

### Testing Checklist

- [ ] Add single ticket
- [ ] Add dual tickets
- [ ] Duplicate detection works
- [ ] Delete operations
- [ ] Bulk select/deselect
- [ ] Stats update correctly
- [ ] Form validation catches errors
- [ ] Error toasts display

---

## 📚 API Reference

### New `popup.js` Structure

```javascript
// File: popup.js (refactored)
import { $ } from './modules/shared.js';
import { initializeEventHandlers, loadAndRenderData } from './modules/event-handlers.js';

document.addEventListener('DOMContentLoaded', async () => {
  try {
    initializeEventHandlers();
    await loadAndRenderData();
  } catch (error) {
    console.error('Popup initialization failed:', error);
  }
});
```

### Background Service Worker

```javascript
// File: background.js (existing)
import './modules/bg-messages.js';
import { initAlarms } from './modules/bg-messages.js';
import { startManualTimer } from './modules/bg-manual.js';
import { pingDevice } from './modules/bg-shared.js';
import { initScreenshot } from './modules/bg-screenshot.js';

initAlarms();
startManualTimer();
pingDevice();
initScreenshot();
```

### Message Format

```javascript
// Add ticket trigger
chrome.runtime.sendMessage({
  type: 'TRIGGER_AUTO_ROW',
  rowId: 123
});

// Bulk trigger
chrome.runtime.sendMessage({
  type: 'TRIGGER_MANUAL',
  priorityIds: [123, 124, 125]
});
```

---

## ⚠️ Error Handling

### Error Objects

Semua errors di-throw dengan structure:

```javascript
new Error(message)
// Plus custom properties:
// .code       - Error type identifier
// .field      - Related field (validation)
// .ticketId   - Related ticket ID
// .ticketCode - Related ticket code
```

### Error Codes

| Code | Context | Resolution |
|------|---------|-----------|
| `VALIDATION_ERROR` | Input validation failed | Check `.field` property |
| `DUPLICATE_TICKET` | Ticket code sudah ada | Show duplicate message |
| `TICKET_NOT_FOUND` | Update target tidak ada | Refresh data |
| `STORAGE_FETCH_ERROR` | Chrome Storage API fail | Check browser storage |
| `ADD_TICKET_ERROR` | Generic add failure | Check logs |
| `DELETE_ERROR` | Delete operation failed | Check storage state |
| `STATS_CALCULATION_ERROR` | Stats computation failed | Check data integrity |

### Try-Catch Pattern

```javascript
try {
  const result = await addNewTicket(ticketData);
  // Success - update UI
} catch (error) {
  if (error.code === 'DUPLICATE_TICKET') {
    showToast(`Code ${error.ticketCode} sudah ada`, true);
  } else {
    showToast(error.message, true);
    console.error('Unexpected error:', error);
  }
}
```

---

## ✅ Best Practices

### 1. **Always Use Data Manager untuk Storage**

```javascript
// ✅ GOOD
const rows = await fetchAllRows();

// ❌ BAD - Direct Chrome Storage
const result = await chrome.storage.local.get(['rows']);
```

### 2. **Separate Data & Presentation**

```javascript
// ✅ GOOD - Data-driven rendering
const rows = await fetchDisplayRows();
renderDataTable(rows);

// ❌ BAD - Logic mixed with DOM
const tbody = $('#table');
tbody.innerHTML = rows.map(r => `<tr>...</tr>`).join('');
```

### 3. **Validate Input Early**

```javascript
// ✅ GOOD - Fail fast
const validation = validateFormInputs(input);
if (!validation.isValid) {
  showToast(validation.error, true);
  return;
}

// ❌ BAD - Check during processing
try {
  const cleaned = cleanTicketCode(input);
  if (cleaned.length < 19) throw new Error(...);
}
```

### 4. **Use Proper Error Objects**

```javascript
// ✅ GOOD
const err = new Error('Failed to update');
err.code = 'UPDATE_ERROR';
err.ticketId = id;
throw err;

// ❌ BAD - String errors
throw 'Failed to update ticket ' + id;
```

### 5. **Event Delegation untuk Dynamic Content**

```javascript
// ✅ GOOD - Single listener, handles all current + future rows
document.getElementById('table-body').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (btn?.classList.contains('btn-delete')) { /* handle */ }
});

// ❌ BAD - Individual listeners per row
rows.forEach(row => {
  document.getElementById(`btn-${row.id}`).addEventListener('click', () => {});
});
```

### 6. **Document Complex Functions**

```javascript
// ✅ GOOD - JSDoc comment
/**
 * Validate dan clean ticket code untuk storage
 * @param {string} code - Raw input code
 * @returns {string} Cleaned code (uppercase, no spaces)
 * @throws {Error} If validation fails
 */
export function validateTicketCode(code) { }

// ❌ BAD - No documentation
function validateTicketCode(code) { }
```

---

## 🔄 Migration from Old popup.js

Jika masih ada kode dari `popup.js` original yang tidak di-refactor:

1. **Identify** fungsi yang masih standalone
2. **Categorize** sebagai data/ui/event/validator
3. **Create/Update** appropriate module
4. **Import** di popup.js
5. **Test** sebelum commit

---

## 📞 Troubleshooting

### Extension Tidak Load
- Check manifest.json syntax
- Verify all file paths ada
- Check Chrome console for errors

### Popup Blank
- Check popup.html path di manifest
- Check popup.js imports
- Open console (F12 → Console tab)

### Data Tidak Tersimpan
- Check Chrome Storage quota
- Verify getData/setData calls
- Check background service worker logs

### OCR Tidak Jalan
- Verify Tesseract library loaded
- Check CORS untuk image fetch
- Check console untuk OCR errors

---

## 📝 Changelog

### v2.2 (Refactoring - In Progress)
- ✅ Split popup.js menjadi 4 modules
- ✅ Add comprehensive JSDoc
- ✅ Improve error handling
- ✅ Add validators module
- ⏳ Add unit tests
- ⏳ Move credentials ke .env

### v2.0 (Previous)
- Original monolithic popup.js
- Basic error handling
- Manual status tracking

---

## 📖 Additional Resources

- [Chrome Extension Docs](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 Migration](https://developer.chrome.com/docs/extensions/migrating/)
- [Tesseract.js Docs](https://tesseract.projectnaphthalene.com/)

---

**Last Updated:** 2026-07-30  
**Maintainer:** AA  
**Status:** Refactoring in progress
