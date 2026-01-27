# Workspace Targeting + File Existence Safety - Implementation Summary

## ✅ Phase 1: Core Components (COMPLETE)

### 1. Workspace Resolver (`packages/core/src/workspaceResolver.ts`)
**Status:** ✅ IMPLEMENTED

**Features:**
- Scores workspace candidates using heuristics
- Excludes Ordinex dev repo automatically (checks for packages/extension/package.json)
- Prioritizes workspaces with project markers (package.json, src/, etc.)
- Returns confidence levels (high/medium/low)
- Selection priority:
  1. Stored selection for task
  2. Active editor's workspace
  3. Heuristic-based scoring
  4. Returns null if ambiguous (triggers user prompt)

**API:**
```typescript
resolveTargetWorkspace(
  candidates: Array<{ path: string; name: string }>,
  activeEditorPath?: string,
  storedSelection?: string
): WorkspaceSelection | null

scoreWorkspaceCandidate(path, name): WorkspaceCandidate
getWorkspaceCandidateInfo(path, name): DisplayInfo
```

### 2. File Operation Classifier (`packages/core/src/fileOperationClassifier.ts`)
**Status:** ✅ IMPLEMENTED

**Features:**
- Classifies each file as 'create' or 'modify' based on fs.existsSync()
- Validates paths (no traversal, must be under workspace)
- Checks parent directories exist
- Detects permission issues
- Returns detailed diagnostics

**API:**
```typescript
classifyFileOperation(workspaceRoot, relativePath): FileOperationClass
classifyFileOperations(workspaceRoot, paths): FileOperationClass[]
validateFileOperations(workspaceRoot, paths): FileOperationIssue[]
generateSafePatches(workspaceRoot, files): SafePatch[]
```

### 3. Core Exports (`packages/core/src/index.ts`)
**Status:** ✅ UPDATED

Both new modules exported and available for use in extension.

---

## 🔧 Phase 2: Extension Integration (TODO)

### What Needs to Be Wired Up

#### A. Store Selected Workspace in Extension State

In `extension.ts`, add:
```typescript
class MissionControlViewProvider {
  private selectedWorkspaceRoot: string | null = null;
  
  // Call this before execution starts
  private async resolveAndConfirmWorkspace(
    webview: vscode.Webview,
    taskId: string
  ): Promise<string | null> {
    const LOG_PREFIX = '[WorkspaceResolver]';
    
    // Get all workspace folders
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      throw new Error('No workspace folder open');
    }
    
    if (folders.length === 1) {
      // Single workspace - use it
      this.selectedWorkspaceRoot = folders[0].uri.fsPath;
      return this.selectedWorkspaceRoot;
    }
    
    // Multi-root: resolve target
    const candidates = folders.map(f => ({
      path: f.uri.fsPath,
      name: f.name
    }));
    
    const activeEditor = vscode.window.activeTextEditor;
    const activeEditorPath = activeEditor?.document.uri.fsPath;
    
    const selection = resolveTargetWorkspace(
      candidates,
      activeEditorPath,
      this.selectedWorkspaceRoot || undefined
    );
    
    if (!selection) {
      // Ambiguous - prompt user
      const picked = await this.promptUserForWorkspace(candidates);
      if (!picked) {
        return null; // User cancelled
      }
      this.selectedWorkspaceRoot = picked;
      console.log(`${LOG_PREFIX} User selected: ${picked}`);
    } else {
      this.selectedWorkspaceRoot = selection.path;
      console.log(`${LOG_PREFIX} Auto-resolved: ${selection.path} (${selection.method}, ${selection.confidence})`);
    }
    
    // Show confirmation with [Change] [Continue] buttons
    const confirmed = await this.confirmWorkspaceSelection(this.selectedWorkspaceRoot);
    if (!confirmed) {
      this.selectedWorkspaceRoot = null;
      return null;
    }
    
    // Emit workspace_selected event
    await this.emitEvent({
      event_id: this.generateId(),
      task_id: taskId,
      timestamp: new Date().toISOString(),
      type: 'workspace_selected',
      mode: this.currentMode,
      stage: this.currentStage,
      payload: {
        workspace_root: this.selectedWorkspaceRoot,
        selection_method: selection?.method || 'user_prompt',
        confidence: selection?.confidence || 'low'
      },
      evidence_ids: [],
      parent_event_id: null,
    });
    
    return this.selectedWorkspaceRoot;
  }
  
  private async promptUserForWorkspace(
    candidates: Array<{ path: string; name: string }>
  ): Promise<string | null> {
    const items = candidates.map(c => {
      const info = getWorkspaceCandidateInfo(c.path, c.name);
      return {
        label: info.displayName,
        description: info.details,
        detail: c.path,
        workspace: c
      };
    });
    
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select target workspace for file operations',
      title: 'Ordinex: Choose Target Workspace'
    });
    
    return picked?.workspace.path || null;
  }
  
  private async confirmWorkspaceSelection(workspaceRoot: string): Promise<boolean> {
    const action = await vscode.window.showInformationMessage(
      `Target workspace: ${workspaceRoot}`,
      { modal: true },
      'Continue',
      'Change'
    );
    
    if (action === 'Change') {
      // Let user pick again
      const folders = vscode.workspace.workspaceFolders!;
      const candidates = folders.map(f => ({ path: f.uri.fsPath, name: f.name }));
      const picked = await this.promptUserForWorkspace(candidates);
      if (!picked) {
        return false;
      }
      this.selectedWorkspaceRoot = picked;
      return true;
    }
    
    return action === 'Continue';
  }
}
```

#### B. Call Workspace Resolution Before Execution

In `handleExecutePlan`:
```typescript
// BEFORE this line:
// const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

// ADD:
const workspaceRoot = await this.resolveAndConfirmWorkspace(webview, taskId);
if (!workspaceRoot) {
  vscode.window.showErrorMessage('Workspace selection cancelled');
  return;
}
```

#### C. Validate File Operations Before Writing

Before calling `workspaceWriter.applyPatches()`, add validation:

```typescript
import { validateFileOperations, classifyFileOperations } from 'core';

// In missionExecutor or wherever patches are applied:
const relativePaths = patches.map(p => p.path);

// 1. Validate paths
const issues = validateFileOperations(workspaceRoot, relativePaths);
const errors = issues.filter(i => i.severity === 'error');

if (errors.length > 0) {
  // Emit failure_detected with actionable info
  await eventBus.emit({
    event_id: generateId(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: 'failure_detected',
    mode,
    stage: 'edit',
    payload: {
      kind: 'invalid_file_paths',
      errors: errors.map(e => ({
        path: e.path,
        code: e.code,
        message: e.message,
        suggestion: e.suggestion
      }))
    },
    evidence_ids: [],
    parent_event_id: null
  });
  
  throw new Error(`File validation failed: ${errors.map(e => e.message).join('; ')}`);
}

// 2. Classify operations (create vs modify)
const classified = classifyFileOperations(workspaceRoot, relativePaths);

// 3. Check for modify attempts on non-existent files
const missingModifies = classified.filter(c => 
  c.operation === 'modify' && !c.exists
);

if (missingModifies.length > 0) {
  // Emit decision_point_needed
  await eventBus.emit({
    event_id: generateId(),
    task_id: taskId,
    timestamp: new Date().toISOString(),
    type: 'decision_point_needed',
    mode,
    stage: 'edit',
    payload: {
      decision_id: generateId(),
      reason: 'file_not_found_for_modify',
      context: {
        missing_files: missingModifies.map(c => ({
          path: c.relativePath,
          attempted_operation: 'modify'
        }))
      },
      options: [
        {
          id: 'create_files',
          label: 'Create files instead',
          description: 'Change operation from modify to create'
        },
        {
          id: 'retry_generate',
          label: 'Regenerate with correct paths',
          description: 'Ask LLM to generate code for existing files only'
        },
        {
          id: 'abort',
          label: 'Abort mission',
          description: 'Stop execution'
        }
      ]
    },
    evidence_ids: [],
    parent_event_id: null
  });
  
  // Pause execution - wait for user decision
  return;
}

// 4. Update patches with correct operations
for (const patch of patches) {
  const classification = classified.find(c => c.relativePath === patch.path);
  if (classification) {
    patch.action = classification.operation; // Set to 'create' or 'modify'
  }
}

// Now safe to apply
await workspaceWriter.applyPatches(patches);
```

---

## 📋 Integration Checklist

### Phase 1: Workspace Selection ✅
- [x] Implement `workspaceResolver.ts`
- [x] Implement `fileOperationClassifier.ts`
- [x] Export from core/index.ts
- [ ] Add `resolveAndConfirmWorkspace()` to extension.ts
- [ ] Wire up before `handleExecutePlan`
- [ ] Store selection in class property
- [ ] Emit `workspace_selected` event
- [ ] Test with multi-root workspace

### Phase 2: File Validation ✅ (Core)
- [x] Implement file existence checks
- [x] Implement path validation
- [x] Implement permission checks
- [ ] Wire validation into execution flow
- [ ] Emit `decision_point_needed` for missing files
- [ ] Update patches with correct create/modify ops
- [ ] Test with missing parent directories
- [ ] Test with non-existent files

---

## 🧪 Testing Plan

### Test Case 1: Multi-Root Workspace Safety
**Setup:** Open 2 workspaces:
1. Target project (e.g., my-app/)
2. Ordinex dev repo

**Expected:**
- ✅ Ordinex repo excluded automatically
- ✅ Target project selected
- ✅ Confirmation shown: "Target workspace: /path/to/my-app"
- ✅ All files created in my-app/, NOT in Ordinex/

### Test Case 2: File Existence Detection
**Setup:** 
- Plan includes: `src/server/auth.ts` (doesn't exist)
- LLM generates full file content

**Expected:**
- ✅ Operation classified as 'create'
- ✅ Parent dir `src/server/` created if needed
- ✅ File created successfully
- ❌ NO modify attempts on non-existent file

### Test Case 3: Modify Existing File
**Setup:**
- File `src/utils/helpers.ts` already exists
- LLM generates updated content

**Expected:**
- ✅ Operation classified as 'modify'
- ✅ Existing file updated
- ✅ No unnecessary recreation

### Test Case 4: Missing File Error Handling
**Setup:**
- LLM tries to modify `src/missing.ts` (doesn't exist)

**Expected:**
- ✅ Validation detects file missing
- ✅ `decision_point_needed` event emitted
- ✅ User sees options: [Create instead] [Retry] [Abort]
- ❌ NO blind retries

---

## 🎯 Success Criteria

1. **Workspace Safety:**
   - ✅ Never writes to Ordinex dev repo
   - ✅ Always confirms target before writes
   - ✅ Selection persists for task duration

2. **File Operation Safety:**
   - ✅ Correctly classifies create vs modify
   - ✅ Creates parent directories as needed
   - ✅ Never modifies non-existent files
   - ✅ Emits actionable decision points on errors

3. **User Experience:**
   - ✅ Clear confirmation: "Target workspace: X"
   - ✅ Option to change before execution
   - ✅ Helpful error messages with suggestions
   - ✅ No silent failures or infinite retries

---

## 🚀 Next Steps

1. **Wire up workspace resolution** in extension.ts (10 min)
2. **Add validation calls** before applyPatches (15 min)
3. **Build and test** with multi-root workspace (10 min)
4. **Test file operations** with missing/existing files (10 min)

**Total Remaining:** ~45 minutes

After this is done:
- Mission execution will be **safe** in multi-root setups
- File operations will be **deterministic** (no guessing)
- Errors will be **actionable** (no blind retries)
