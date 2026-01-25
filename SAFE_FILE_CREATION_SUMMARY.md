# SAFE File Creation for Mission Execution

## Summary

Enabled LLM to create new source files during mission execution while maintaining security through path-based fences.

---

## Changes Made

### 1. New File: `packages/core/src/createPathFence.ts`

**Purpose:** Validates file creation paths against allowed/denied patterns

**Key Components:**

```typescript
// Configuration structure
interface CreatePathFenceConfig {
  allowedRoots: string[];      // Glob patterns for allowed paths
  deniedPaths: string[];       // Glob patterns for blocked paths  
  maxNewFileSizeLines: number; // Prevents massive file dumps
  extendedAllowedPaths?: string[]; // Runtime-approved paths
}

// Default allowed roots
- src/**
- packages/**/src/**
- app/**
- components/**
- lib/**, utils/**, hooks/**, contexts/**, services/**, types/**
- pages/**, styles/**
- __tests__/**, tests/**, spec/**

// Default denied paths (security)
- node_modules/**
- dist/**, build/**, out/**
- .git/**
- .env, .env.*, **/.env*
- **/secrets/**, **/keys/**, **/credentials/**
- *.pem, *.key, *.cert
- **/*.min.js, **/*.bundle.js
- coverage/**, .next/**, .vite/**
```

**Exported Functions:**
- `validateCreatesInDiff()` - Validate all creates in touched_files
- `validateCreatePath()` - Validate a single path
- `isPathInAllowedRoots()` - Check if path matches allowed patterns
- `isPathInDeniedPaths()` - Check if path matches denied patterns
- `extendAllowedPaths()` - Add approved paths at runtime
- `getBlockedPathsSummary()` - Human-readable error summary

---

### 2. Updated: `packages/core/src/llmEditTool.ts`

**Constraint Changes:**
```typescript
// BEFORE
{
  max_files: 3,
  max_changed_lines: 100,
  forbid_create: true,  // ❌ Blocked file creation
}

// AFTER
{
  max_files: 5,           // ↑ Increased for component creation
  max_changed_lines: 300, // ↑ Increased for new files
  forbid_create: false,   // ✅ Now allowed!
  forbid_delete: true,    // Still blocked
  forbid_rename: true,    // Still blocked
}
```

**System Prompt Updates:**
- Added detailed file creation guidelines
- Provided example JSON for creating new files
- Listed allowed directories for creation
- Included proper TypeScript/React boilerplate guidance

---

### 3. Added Dependency: `minimatch`

Used for glob pattern matching in path fence validation.

```bash
pnpm add minimatch @types/minimatch
```

---

### 4. Updated: `packages/core/src/index.ts`

Exported all createPathFence components for use across the codebase.

---

## How It Works

### Flow When LLM Proposes File Creation:

1. **LLM generates diff** with `action: "create"` in `touched_files`
2. **Mission executor** calls `validateCreatesInDiff(touched_files, config)`
3. **Path fence validates**:
   - Is path in denied list? → **Block (security)**
   - Is path in allowed roots? → **Allow**
   - Is file size within limits? → **Allow**
   - Otherwise → **Request scope expansion**
4. **If blocked**: Emit `scope_expansion_requested` event
5. **User decides**: Approve (extend paths) or Deny (pause mission)
6. **If allowed**: Show diff for approval → Apply changes

---

## Security Guarantees

| Feature | Status |
|---------|--------|
| File creation approval-gated | ✅ |
| Path fence enforcement | ✅ |
| node_modules blocked | ✅ |
| .env files blocked | ✅ |
| .git directory blocked | ✅ |
| secrets/keys blocked | ✅ |
| File deletion forbidden | ✅ |
| File rename forbidden | ✅ |
| Max file size limit | ✅ (500 lines) |
| Scope expansion flow | ✅ |

---

## Files Modified

1. `packages/core/src/createPathFence.ts` - **NEW**
2. `packages/core/src/llmEditTool.ts` - Modified constraints + prompt
3. `packages/core/src/index.ts` - Added exports
4. `packages/core/package.json` - Added minimatch dependency
5. `packages/extension/src/vscodeWorkspaceWriter.ts` - **FIXED** file creation handling

---

## Testing

To test file creation:
1. Reload extension (F5)
2. Create a plan that requires new files (e.g., "Create a React component for user authentication")
3. Execute the plan
4. Verify the diff shows new file creations
5. Approve and verify files are created

**Expected behavior:**
- Files under `src/**` should be created without issue
- Files under `node_modules/**` should trigger scope expansion request
- Files without proper path should be blocked

---

## Definition of Done ✅

- [x] forbid_create changed to false
- [x] Path fence module created
- [x] Allowed roots configured (src/**, packages/**/src/**, etc.)
- [x] Denied paths configured (node_modules, .env, .git, etc.)
- [x] Max file size limit (500 lines)
- [x] System prompt updated for file creation guidance
- [x] Exports added to index.ts
- [x] Build successful
