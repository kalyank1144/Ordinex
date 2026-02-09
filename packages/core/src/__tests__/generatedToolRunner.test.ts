/**
 * GeneratedToolRunner Static Scan Tests
 *
 * Tests the scanForBlockedPatterns function.
 * We can't easily test the full runner (needs child_process spawn) in unit tests,
 * but we can verify the blocklist works correctly.
 */

import { describe, it, expect } from 'vitest';

// Import the scan function directly from the extension package source
// In a real build, this would be tested in the extension package.
// For now, we inline the blocklist patterns to test them here.

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /require\s*\(\s*['"]child_process['"]\s*\)/, reason: 'child_process import via require' },
  { pattern: /from\s+['"]child_process['"]/, reason: 'child_process import via ESM' },
  { pattern: /require\s*\(\s*['"]node:child_process['"]\s*\)/, reason: 'node:child_process import via require' },
  { pattern: /from\s+['"]node:child_process['"]/, reason: 'node:child_process import via ESM' },
  { pattern: /process\.env\b/, reason: 'direct process.env access' },
  { pattern: /\bimport\s*\(\s*[^'"`\s]/, reason: 'dynamic import() with non-literal argument' },
  { pattern: /require\s*\(\s*[^'"`\s]/, reason: 'dynamic require() with non-literal argument' },
  { pattern: /\beval\s*\(/, reason: 'eval() usage' },
  { pattern: /new\s+Function\s*\(/, reason: 'new Function() constructor' },
];

function scanForBlockedPatterns(code: string): string | null {
  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(code)) {
      return reason;
    }
  }
  return null;
}

describe('scanForBlockedPatterns', () => {
  // --------------------------------------------------------------------------
  // child_process
  // --------------------------------------------------------------------------

  it('should block require("child_process")', () => {
    const code = `const cp = require('child_process');`;
    expect(scanForBlockedPatterns(code)).toContain('child_process');
  });

  it('should block require("child_process") with double quotes', () => {
    const code = `const cp = require("child_process");`;
    expect(scanForBlockedPatterns(code)).toContain('child_process');
  });

  it('should block import from "child_process"', () => {
    const code = `import { exec } from 'child_process';`;
    expect(scanForBlockedPatterns(code)).toContain('child_process');
  });

  it('should block require("node:child_process")', () => {
    const code = `const cp = require("node:child_process");`;
    expect(scanForBlockedPatterns(code)).toContain('node:child_process');
  });

  it('should block import from "node:child_process"', () => {
    const code = `import { execSync } from "node:child_process";`;
    expect(scanForBlockedPatterns(code)).toContain('node:child_process');
  });

  // --------------------------------------------------------------------------
  // process.env
  // --------------------------------------------------------------------------

  it('should block process.env access', () => {
    const code = `const key = process.env.API_KEY;`;
    expect(scanForBlockedPatterns(code)).toContain('process.env');
  });

  it('should block process.env in template literal', () => {
    const code = 'const url = `https://api.example.com?key=${process.env.KEY}`;';
    expect(scanForBlockedPatterns(code)).toContain('process.env');
  });

  // --------------------------------------------------------------------------
  // Dynamic imports/requires
  // --------------------------------------------------------------------------

  it('should block dynamic import(variable)', () => {
    const code = `const mod = await import(moduleName);`;
    expect(scanForBlockedPatterns(code)).toContain('dynamic import');
  });

  it('should block dynamic require(variable)', () => {
    const code = `const mod = require(moduleName);`;
    expect(scanForBlockedPatterns(code)).toContain('dynamic require');
  });

  it('should allow static require("fs")', () => {
    const code = `const fs = require("fs");`;
    expect(scanForBlockedPatterns(code)).toBeNull();
  });

  it('should allow static import("fs")', () => {
    const code = `const fs = await import("fs");`;
    expect(scanForBlockedPatterns(code)).toBeNull();
  });

  // --------------------------------------------------------------------------
  // eval / new Function
  // --------------------------------------------------------------------------

  it('should block eval()', () => {
    const code = `eval("console.log('hello')");`;
    expect(scanForBlockedPatterns(code)).toContain('eval');
  });

  it('should block new Function()', () => {
    const code = `const fn = new Function('return 42');`;
    expect(scanForBlockedPatterns(code)).toContain('Function');
  });

  // --------------------------------------------------------------------------
  // Clean code
  // --------------------------------------------------------------------------

  it('should allow clean code', () => {
    const code = `
      const fs = require("fs");
      const input = JSON.parse(fs.readFileSync(0, "utf-8"));
      const result = input.date ? new Date(input.date).toISOString() : null;
      console.log(JSON.stringify({ result }));
    `;
    expect(scanForBlockedPatterns(code)).toBeNull();
  });

  it('should allow static imports of standard modules', () => {
    const code = `
      const path = require("path");
      const https = require("https");
      const util = require("util");
    `;
    expect(scanForBlockedPatterns(code)).toBeNull();
  });
});
