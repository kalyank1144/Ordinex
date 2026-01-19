# Ordinex

Deterministic, event-driven VS Code extension.

## Structure

```
ordinex/
├── packages/
│   ├── extension/   # VS Code extension host
│   ├── webview/     # Webview UI components
│   └── core/        # Core business logic
```

## Requirements

- Node.js >= 18.0.0
- pnpm >= 8.0.0

## Setup

Install dependencies:

```bash
pnpm install
```

## Development

Run the extension in VS Code Extension Development Host:

```bash
pnpm dev
```

This will:
1. Compile all packages
2. Launch VS Code with the extension loaded
3. Use Command Palette (Cmd+Shift+P) and run "Ordinex: Open Panel"

## Build

Build all packages:

```bash
pnpm build
```

## Test

Run tests for all packages:

```bash
pnpm test
```

## Clean

Remove build artifacts:

```bash
pnpm clean
```

## Status

**Step 0 - Scaffold**: ✅ Complete
- Monorepo structure with pnpm workspaces
- Extension package with placeholder webview
- Webview package with "Scaffold OK" message
- Core package (placeholder)
- No business logic, model calls, tools, or autonomy
