# Step 37: Attachment System Implementation Progress

## STATUS: PHASES 1-3 COMPLETE ✓

## Completed Phases

### PHASE 1: Webview Attachment UI ✓
**File:** `packages/webview/src/index.ts`

Features implemented:
- **CSS Styles:** Attachment container, upload button, thumbnail grid, progress indicators, error states
- **State Management:** `pendingAttachments` array tracks files before submission
- **File Picker:** Hidden input with accept filter for images/text/JSON/PDF (max 5 files)
- **Validation:** 5MB limit, MIME type whitelist, enforced on frontend
- **Thumbnails:** Canvas-based image resizing to 60x60, file icon fallback for non-images
- **Remove Button:** Click X to remove attachment from queue before sending

### PHASE 2: Webview ↔ Extension Bridge ✓
**Files:** `packages/webview/src/index.ts`, `packages/extension/src/extension.ts`

Features implemented:
- **`uploadAttachment()` function:** Sends base64-encoded file data to extension via postMessage
- **`uploadAllPendingAttachments()` function:** Batch uploads all pending files, returns AttachmentRef[]
- **Upload result handling:** Updates UI state (uploading → uploaded) based on extension response
- **Error handling:** Shows user-friendly error messages on upload failure
- **Extension handler:** `handleUploadAttachment()` receives data, validates, stores, returns evidenceId

### PHASE 3: Extension Evidence Store ✓
**File:** `packages/extension/src/attachmentEvidenceStore.ts`

Features implemented:
- **SHA256 deduplication:** Identical files return same evidenceId (no duplicate storage)
- **Storage path:** `.ordinex/evidence/attachments/{sha_prefix}/{att_xxxxxxxxxxxx}.{ext}`
- **Metadata file:** `.meta.json` with original name, size, MIME type, timestamp, full SHA256
- **Backend validation:** Re-validates size/MIME type even if frontend passes
- **Exported functions:**
  - `storeAttachment(workspaceRoot, AttachmentData) → AttachmentStoreResult`
  - `validateAttachment(AttachmentData) → {valid, error?}`
  - `readAttachment(workspaceRoot, evidencePath) → Buffer | null`
  - `attachmentExists(workspaceRoot, evidencePath) → boolean`
  - `getAttachmentMetadata(workspaceRoot, evidencePath) → object | null`

## Remaining Phases

### PHASE 4: Message Model (NOT STARTED)
- Include `attachments?: AttachmentRef[]` in submitPrompt payload
- Store in `intent_received.payload.attachments`
- AttachmentRef: `{ evidence_id, original_name, mime_type, evidence_path }`

### PHASE 5: Replay/Audit Rendering (NOT STARTED)
- Render thumbnails from evidence_path in MissionFeed
- Handle missing files gracefully (gray placeholder)
- Use stored metadata for display

### PHASE 6: Tests (NOT STARTED)
- Rejection test: File too large
- Rejection test: Unsupported MIME type
- Deduplication test: Same file → same evidenceId
- Event verification: Attachments in intent_received payload
- Replay safety: Missing file renders placeholder

## Files Changed

| File | Changes |
|------|---------|
| `packages/webview/src/index.ts` | Added attachment UI (CSS, state, file picker, thumbnails, upload functions) |
| `packages/webview/tsconfig.json` | Added `"DOM"` to lib array for FileReader/canvas APIs |
| `packages/extension/src/attachmentEvidenceStore.ts` | New file: Evidence store with SHA256 dedup |
| `packages/extension/src/extension.ts` | Added `handleUploadAttachment` handler, imports |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          WEBVIEW                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────────┐  │
│  │ File Picker │→ │ Validation   │→ │ pendingAttachments[] state │  │
│  │ (hidden)    │  │ (5MB, MIME)  │  │ (id, name, mime, data)     │  │
│  └─────────────┘  └──────────────┘  └────────────────────────────┘  │
│                                                  ↓                   │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │              Thumbnail Grid (60x60 canvas)                     │  │
│  │   [📷 photo.png X] [📄 config.json X] [📝 readme.md X]        │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                  ↓                   │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ uploadAllPendingAttachments() → postMessage('uploadAttachment')│  │
│  └────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ↓ postMessage
┌─────────────────────────────────────────────────────────────────────┐
│                         EXTENSION                                    │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ handleUploadAttachment(message, webview)                       │  │
│  │   1. Validate fields                                           │  │
│  │   2. Call storeAttachment(workspaceRoot, attachmentData)       │  │
│  │   3. Return uploadResult via postMessage                       │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                    ↓                                 │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ attachmentEvidenceStore.ts                                     │  │
│  │   - storeAttachment: SHA256 → evidenceId → write file + meta   │  │
│  │   - validateAttachment: size/MIME checks                       │  │
│  │   - readAttachment: retrieve stored file                       │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                    ↓                                 │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ STORAGE: .ordinex/evidence/attachments/                        │  │
│  │   a3/att_a3b4c5d6e7f8.png                                     │  │
│  │   a3/att_a3b4c5d6e7f8.png.meta.json                           │  │
│  │   f2/att_f2g3h4i5j6k7.json                                    │  │
│  └────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Build Status

```
✓ packages/core - Build successful
✓ packages/webview - Build successful  
✓ packages/extension - Build successful
```

## Next Steps

1. **PHASE 4:** Wire attachments into submitPrompt flow
   - Before sending prompt, call `uploadAllPendingAttachments()`
   - Include returned `AttachmentRef[]` in message to extension
   - Store in `intent_received.payload.attachments`

2. **PHASE 5:** Add attachment rendering in MissionFeed
   - Detect `intent_received` events with attachments
   - Render thumbnails inline with message
   - Handle missing files gracefully

3. **PHASE 6:** Write tests
   - Unit tests for validation
   - Integration tests for upload flow
   - Replay safety tests
