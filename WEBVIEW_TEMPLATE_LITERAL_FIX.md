# Webview Template Literal Syntax Error Fix

## Issue
The webview is displaying raw JavaScript code instead of rendering the UI. This is caused by **unescaped template literals** inside the `<script>` tag in `packages/webview/src/index.ts`.

## Root Cause
The file uses a template literal (backticks) to generate HTML:
```typescript
export function getWebviewContent(): string {
  return `<!DOCTYPE html>
  <script>
    // JavaScript here that ALSO uses template literals with backticks
    const text = `some ${value}`;  // ❌ SYNTAX ERROR - closes outer template
  </script>
  `;
}
```

When the inner script uses template literals with `${...}`, it conflicts with the outer template string, causing the entire function to fail parsing.

## Solution

**Option 1: Escape inner template literals** (Recommended - Minimal Changes)
Replace all template literals inside the `<script>` tag with escaped versions:
- Change: `` `text ${var}` ``
- To: `` `text \${var}` `` (escape the dollar sign)

**Option 2: Use string concatenation**
Replace template literals with + concatenation:
- Change: `` `text ${var}` ``
- To: `'text ' + var`

## Critical Locations to Fix in `packages/webview/src/index.ts`

Search for these patterns inside the `<script>` tag and escape them:

1. **Line ~130:** `statusPill.className = \`status-pill \${status}\`;`
   - Fix: `statusPill.className = 'status-pill ' + status;`

2. **Line ~700:** `` `\${filesCount} files, \${totalLines} lines` ``
   - Fix: Use string concatenation

3. **Any other template literals** with `${...}` inside the script

## Quick Fix Command

Run this search and replace:
```bash
# In packages/webview/src/index.ts, inside the <script> tag only:
# Find all: `([^`]*)\${
# Replace with: '+ concatenation or \\${
```

## Verification

After fixing, reload the extension and the webview should render properly with:
- Tab bar (Mission, Systems, Logs)
- Input area at bottom
- Proper styling
- No raw JavaScript code visible

## Status
- [ ] Fix template literals in script tag
- [ ] Test webview renders correctly
- [ ] Verify all features work (tabs, buttons, etc.)
