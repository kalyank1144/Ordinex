# Step 19: Local Run Export - Implementation Summary

**Completed**: January 19, 2026

## Overview

Implemented comprehensive local run export functionality that allows users to bundle complete mission execution records into shareable .zip archives. This feature enables debugging, audit, and trust verification without requiring cloud storage or external services.

## Implementation Details

### 1. Core Export Logic (`packages/core/src/runExporter.ts`)

**New Module**: `runExporter.ts`

**Key Functions**:
- `exportRun(options: ExportOptions): Promise<ExportResult>` - Main export function
- `generateReadme()` - Deterministic README generator (no LLM)
- `redactSecrets()` - Best-effort secret pattern redaction
- Helper functions for timestamp formatting, hashing, file copying

**Export Structure**:
```
ordinex-run-<task_id>-<yyyy-mm-dd_hhmmss>/
├── meta.json           # Export metadata
├── prompt.json         # Original user prompt
├── plan.json           # Generated plan (if exists)
├── task_state.json     # Final task state
├── events.jsonl        # Complete event stream
├── decisions.json      # Approval decisions (if exists)
├── checkpoints.json    # Checkpoint metadata (if exists)
├── evidence/           # Evidence content files
├── diffs/              # Diff patches
└── README.md           # Human-readable summary
```

**Security Features**:
- Secret redaction for API keys, tokens, passwords
- Workspace path hashing (no absolute paths exposed)
- No environment variables included
- Only evidence excerpts (not full source code)

### 2. Extension Handler (`packages/extension/src/extension.ts`)

**Added**:
- Import `exportRun` and `ExportResult` from core package
- Message handler case for `ordinex:exportRun`
- `handleExportRun()` method with:
  - Event validation
  - Workspace info gathering
  - Progress notification
  - Success/error handling
  - User actions: "Open Folder", "Copy Path"

**User Experience**:
- Progress notification during export
- Success message with action buttons
- Automatic file reveal in OS
- Clipboard path copying option

### 3. Webview UI (`packages/webview/src/index.ts`)

**Added**:
- "Export Run" button in header (📦 icon)
- Button visibility logic (shows only when events exist)
- Click handler that sends `ordinex:exportRun` message
- Button updates on `renderMission()`

**UI Behavior**:
- Hidden by default
- Appears when first event is created
- Updates dynamically as events are added/cleared
- Integrated with existing header layout

### 4. README Generator

**Deterministic Content** (No LLM required):
- Metadata section (task ID, timestamps, versions)
- Run summary (mode, intent, duration, event count)
- Stages encountered
- Approvals summary (requested, resolved, approved, rejected)
- Diffs summary (proposed, applied, files changed)
- Final outcome (success/failure/stopped)
- Evidence files count
- Export contents structure
- Usage instructions
- Privacy & security notice

**Example Output**:
```markdown
# Ordinex Mission Run Export

## Metadata
- **Task ID**: `abc12345`
- **Created**: 2026-01-19T17:30:00Z
- **Mode**: MISSION
- **Total Events**: 47

## Run Summary
- **Start Time**: 2026-01-19T17:30:00Z
- **End Time**: 2026-01-19T17:32:15Z
- **Duration**: 135s

### Approvals
- **Total Requested**: 3
- **Approved**: 2
- **Rejected**: 1

### Final Outcome
- **Status**: ✅ Success
```

## File Changes

### New Files
1. `packages/core/src/runExporter.ts` - Export logic and utilities
2. `EXPORT_RUN_STEP19_SUMMARY.md` - This document

### Modified Files
1. `packages/core/src/index.ts` - Export runExporter functions
2. `packages/extension/src/extension.ts` - Add export handler
3. `packages/webview/src/index.ts` - Add export button and UI logic

## Key Features

### 1. Complete Event Export
- All events for task written to `events.jsonl`
- Chronological order preserved
- Full event payload included

### 2. Evidence Bundling
- Evidence files copied from `.Ordinex/evidence/`
- Supports multiple file formats (.json, .txt, .log, .patch, .diff)
- Diff patches extracted to separate `diffs/` directory

### 3. Metadata Extraction
- Task state derived deterministically from events
- Approval decisions extracted and summarized
- Checkpoint metadata included (no full snapshots)

### 4. Security & Privacy
- Best-effort secret redaction using regex patterns
- Workspace path hashing instead of absolute paths
- No environment variables or full source code
- Only evidence excerpts included

### 5. Archive Creation
- Uses system `zip` command when available
- Falls back to directory export if zip unavailable
- Archive saved to `.Ordinex/exports/`

## Usage Flow

1. **User clicks "Export Run" button** in Mission tab header
2. **Webview sends message**: `{ type: 'ordinex:exportRun', taskId: '...' }`
3. **Extension handler**:
   - Validates events exist
   - Gathers workspace info
   - Calls `exportRun()` with options
   - Shows progress notification
4. **Core export**:
   - Creates temp directory
   - Writes JSON files
   - Copies evidence files
   - Generates README
   - Creates zip archive
5. **Success response**:
   - Shows success message
   - Offers "Open Folder" / "Copy Path"
   - Sends completion message to webview

## Testing

To test the export functionality:

1. Run a mission with events (use the demo mode or real flow)
2. Click the "📦 Export Run" button in the header
3. Wait for progress notification
4. Click "Open Folder" to reveal the zip
5. Extract and inspect contents:
   - Verify all JSON files are present
   - Check events.jsonl contains all events
   - Confirm README is human-readable
   - Validate evidence files were copied

## Future Enhancements (Not in V1)

- [ ] Import/replay from exported runs
- [ ] Cloud storage integration
- [ ] Export filtering (date range, event types)
- [ ] Export compression options
- [ ] Evidence content redaction (beyond secrets)
- [ ] Export format options (JSON, CSV, SQLite)

## Compliance

✅ **No new event types** - Uses existing event stream  
✅ **Deterministic** - Same events produce same README  
✅ **Local-only** - No cloud upload or telemetry  
✅ **No LLM** - README generated via template logic  
✅ **Privacy-safe** - Secrets redacted, paths hashed  
✅ **Trust-enabled** - Complete audit trail included  

## Notes

- Export button is hidden when no events exist (clean initial state)
- Zip creation uses system command (macOS/Linux compatible)
- Secret redaction is best-effort (regex-based patterns)
- Evidence files may not exist (gracefully skipped)
- Export path: `.Ordinex/exports/ordinex-run-<id>-<timestamp>.zip`

---

**Status**: ✅ Complete  
**Step**: 19/19 (V1 Core Features)  
**Next**: System integration testing and V2 planning
