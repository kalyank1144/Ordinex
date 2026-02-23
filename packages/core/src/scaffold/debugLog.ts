/**
 * Debug logging for the scaffold pipeline.
 *
 * Gated behind the ORDINEX_DEBUG environment variable.
 * Set ORDINEX_DEBUG=1 (or any truthy value) to enable verbose pipeline logs.
 * Off by default — no sensitive data leaks into production logs.
 */

let _enabled: boolean | null = null;

function isEnabled(): boolean {
  if (_enabled !== null) return _enabled;
  try {
    _enabled = !!process.env.ORDINEX_DEBUG;
  } catch {
    _enabled = false;
  }
  return _enabled;
}

export function debugLog(...args: unknown[]): void {
  if (isEnabled()) {
    console.log('[ORDINEX_DEBUG]', ...args);
  }
}

export function debugWarn(...args: unknown[]): void {
  if (isEnabled()) {
    console.warn('[ORDINEX_DEBUG]', ...args);
  }
}

/** Force enable/disable debug logging (useful for tests). */
export function setDebugEnabled(enabled: boolean): void {
  _enabled = enabled;
}
