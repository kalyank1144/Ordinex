/**
 * Ordinex Version Pinning — Deterministic dependency versions for scaffold.
 *
 * Overlays are version-matched package content (not LLM-generated).
 * The version config determines which overlay package to apply.
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// TYPES
// ============================================================================

export interface WebVersions {
  nextMajor: number;
  shadcn: string;
  tailwind: string;
  typescript: string;
}

export interface MobileVersions {
  expoSdk: number;
  reactNative: string;
}

export interface OrdinexVersionConfig {
  web: WebVersions;
  mobile: MobileVersions;
}

// ============================================================================
// DEFAULT PINNED VERSIONS (bundled fallback)
// ============================================================================

const DEFAULT_VERSIONS: OrdinexVersionConfig = {
  web: {
    nextMajor: 15,
    shadcn: '2.1.0',
    tailwind: '4.0.0',
    typescript: '5.7.0',
  },
  mobile: {
    expoSdk: 52,
    reactNative: '0.76.0',
  },
};

// ============================================================================
// PUBLIC API
// ============================================================================

let _cached: OrdinexVersionConfig | null = null;

/**
 * Load version config from bundled `ordinex-versions.json` next to this module,
 * or fall back to hard-coded defaults.
 */
export function loadVersionConfig(extensionRoot?: string): OrdinexVersionConfig {
  if (_cached) return _cached;

  const searchPaths = [
    extensionRoot ? path.join(extensionRoot, 'ordinex-versions.json') : '',
    path.join(__dirname, '..', '..', 'ordinex-versions.json'),
    path.join(__dirname, '..', 'ordinex-versions.json'),
  ].filter(Boolean);

  for (const p of searchPaths) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<OrdinexVersionConfig>;
        _cached = { ...DEFAULT_VERSIONS, ...parsed, web: { ...DEFAULT_VERSIONS.web, ...parsed.web } };
        return _cached;
      }
    } catch {
      continue;
    }
  }

  _cached = DEFAULT_VERSIONS;
  return _cached;
}

/**
 * Determine the correct overlay directory name for a detected Next.js major version.
 */
export function overlayDirForNextMajor(major: number): string {
  const pinned = loadVersionConfig().web.nextMajor;
  if (major === pinned) return `overlay-next${major}`;
  if (major === pinned - 1) return `overlay-next${major}`;
  return `overlay-next${pinned}`;
}

/**
 * Determine overlay directory for a recipe id.
 * Delegates to recipeConfig for the base overlay dir name.
 */
export function overlayDirForRecipe(recipeId: string): string {
  // Lazy import to avoid circular deps — recipeConfig is leaf-level
  const { getOverlayDir } = require('./recipeConfig');
  try {
    return getOverlayDir(recipeId);
  } catch {
    const cfg = loadVersionConfig();
    return `overlay-next${cfg.web.nextMajor}`;
  }
}

/**
 * Reset cached config (for testing).
 */
export function resetVersionCache(): void {
  _cached = null;
}
