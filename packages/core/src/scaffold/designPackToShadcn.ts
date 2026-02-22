/**
 * Design Pack to shadcn — Maps hex design tokens to shadcn CSS variables (HSL).
 *
 * Also handles shadcn initialization commands and component installation.
 */

import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);
import type { DesignTokens } from './tokenValidator';
import { hexToHsl } from './tokenValidator';

// ============================================================================
// TYPES
// ============================================================================

export interface ShadcnInitResult {
  success: boolean;
  componentsInstalled: string[];
  errors: string[];
}

// ============================================================================
// shadcn CSS VARIABLE MAPPING
// ============================================================================

/**
 * Generate the full shadcn globals.css :root block from design tokens.
 */
export function generateShadcnCssBlock(tokens: DesignTokens): string {
  const lines: string[] = [];

  const coreMap: Record<string, keyof DesignTokens> = {
    '--background': 'background',
    '--foreground': 'foreground',
    '--card': 'card',
    '--card-foreground': 'card_foreground',
    '--primary': 'primary',
    '--primary-foreground': 'primary_foreground',
    '--secondary': 'secondary',
    '--secondary-foreground': 'secondary_foreground',
    '--muted': 'muted',
    '--muted-foreground': 'muted_foreground',
    '--accent': 'accent',
    '--accent-foreground': 'accent_foreground',
    '--destructive': 'destructive',
    '--destructive-foreground': 'destructive_foreground',
    '--border': 'border',
    '--input': 'input',
    '--ring': 'ring',
  };

  for (const [cssVar, tokenKey] of Object.entries(coreMap)) {
    lines.push(`    ${cssVar}: ${hexToHsl(tokens[tokenKey] as string)};`);
  }

  // Popover (falls back to card)
  lines.push(`    --popover: ${hexToHsl(tokens.popover || tokens.card)};`);
  lines.push(`    --popover-foreground: ${hexToHsl(tokens.popover_foreground || tokens.card_foreground)};`);

  // Chart colors (falls back to primary/secondary/accent)
  const chartFallbacks: Array<[string, keyof DesignTokens, keyof DesignTokens]> = [
    ['--chart-1', 'chart_1', 'primary'],
    ['--chart-2', 'chart_2', 'secondary'],
    ['--chart-3', 'chart_3', 'accent'],
    ['--chart-4', 'chart_4', 'accent'],
    ['--chart-5', 'chart_5', 'secondary'],
  ];
  for (const [cssVar, key, fallback] of chartFallbacks) {
    lines.push(`    ${cssVar}: ${hexToHsl(tokens[key] || tokens[fallback] || '#000000')};`);
  }

  // Sidebar tokens
  const sidebarMap: Array<[string, keyof DesignTokens, keyof DesignTokens]> = [
    ['--sidebar-background', 'sidebar', 'card'],
    ['--sidebar-foreground', 'sidebar_foreground', 'card_foreground'],
    ['--sidebar-primary', 'sidebar_primary', 'primary'],
    ['--sidebar-primary-foreground', 'sidebar_primary_foreground', 'primary_foreground'],
    ['--sidebar-accent', 'sidebar_accent', 'accent'],
    ['--sidebar-accent-foreground', 'sidebar_accent_foreground', 'accent_foreground'],
    ['--sidebar-border', 'sidebar_border', 'border'],
    ['--sidebar-ring', 'sidebar_ring', 'ring'],
  ];
  for (const [cssVar, key, fallback] of sidebarMap) {
    lines.push(`    ${cssVar}: ${hexToHsl(tokens[key] || tokens[fallback] || '#000000')};`);
  }

  return lines.join('\n');
}

// ============================================================================
// shadcn INIT + COMPONENT INSTALL
// ============================================================================

/**
 * Initialize shadcn/ui in a project and install base components.
 * Uses `npx shadcn@latest init` with `--yes` flag for non-interactive mode.
 */
export async function initShadcn(
  projectDir: string,
  components: string[],
): Promise<ShadcnInitResult> {
  const installed: string[] = [];
  const errors: string[] = [];

  // Detect package manager
  const pm = fs.existsSync(path.join(projectDir, 'pnpm-lock.yaml')) ? 'pnpm' :
    fs.existsSync(path.join(projectDir, 'yarn.lock')) ? 'yarn' : 'npm';
  const npxCmd = pm === 'pnpm' ? 'pnpm dlx' : pm === 'yarn' ? 'npx' : 'npx';

  // Check globals.css BEFORE shadcn init
  const globalsCheck = [
    path.join(projectDir, 'src', 'app', 'globals.css'),
    path.join(projectDir, 'app', 'globals.css'),
  ].find(p => fs.existsSync(p));
  if (globalsCheck) {
    const before = fs.readFileSync(globalsCheck, 'utf-8');
    console.log(`[initShadcn] globals.css BEFORE init: ${before.length} chars, has oklch=${before.includes('oklch(')}, path=${globalsCheck}`);
  }

  // Init shadcn (async — does NOT block the extension host thread)
  try {
    console.log(`[initShadcn] Running: ${npxCmd} shadcn@latest init --yes --defaults (cwd: ${projectDir})`);
    await execAsync(`${npxCmd} shadcn@latest init --yes --defaults`, {
      cwd: projectDir,
      encoding: 'utf-8',
      timeout: 120_000,
    });
    console.log('[initShadcn] ✓ shadcn init completed');
  } catch (err: any) {
    const msg = err.stderr || err.message || '';
    console.warn(`[initShadcn] shadcn init error: ${msg.slice(0, 500)}`);
    if (!msg.includes('already') && !msg.includes('exist')) {
      errors.push(`shadcn init: ${msg.slice(0, 1000)}`);
    }
  }

  // Check globals.css AFTER shadcn init to see if it was overwritten
  if (globalsCheck) {
    const after = fs.readFileSync(globalsCheck, 'utf-8');
    console.log(`[initShadcn] globals.css AFTER init: ${after.length} chars, has oklch=${after.includes('oklch(')}`);
    const primaryMatch = after.match(/--primary:\s*([^;]+);/);
    console.log(`[initShadcn] AFTER --primary value: ${primaryMatch?.[1]?.trim() || '(not found)'}`);
  }

  // Install components in batches (async)
  const BATCH_SIZE = 5;
  for (let i = 0; i < components.length; i += BATCH_SIZE) {
    const batch = components.slice(i, i + BATCH_SIZE);
    const compList = batch.join(' ');

    try {
      await execAsync(`${npxCmd} shadcn@latest add ${compList} --yes`, {
        cwd: projectDir,
        encoding: 'utf-8',
        timeout: 120_000,
      });
      installed.push(...batch);
    } catch (err: any) {
      for (const comp of batch) {
        try {
          await execAsync(`${npxCmd} shadcn@latest add ${comp} --yes`, {
            cwd: projectDir,
            encoding: 'utf-8',
            timeout: 60_000,
          });
          installed.push(comp);
        } catch (e: any) {
          errors.push(`${comp}: ${(e.stderr || e.message || '').slice(0, 500)}`);
        }
      }
    }
  }

  return {
    success: errors.length === 0,
    componentsInstalled: installed,
    errors,
  };
}

/**
 * Generate the @theme inline block for Tailwind v4 that maps CSS custom
 * properties to Tailwind utility classes.
 *
 * @param colorFn - Color function to wrap CSS variables with ('hsl' or 'oklch').
 *                  Must match the format used in :root variable definitions.
 */
export function generateShadcnThemeBlock(colorFn: 'hsl' | 'oklch' = 'hsl'): string {
  const colorVars = [
    'background', 'foreground', 'card', 'card-foreground',
    'popover', 'popover-foreground', 'primary', 'primary-foreground',
    'secondary', 'secondary-foreground', 'muted', 'muted-foreground',
    'accent', 'accent-foreground', 'destructive', 'destructive-foreground',
    'border', 'input', 'ring',
    'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5',
    'sidebar-background', 'sidebar-foreground',
    'sidebar-primary', 'sidebar-primary-foreground',
    'sidebar-accent', 'sidebar-accent-foreground',
    'sidebar-border', 'sidebar-ring',
  ];
  const mappings = [
    ...colorVars.map(name => `--color-${name}: ${colorFn}(var(--${name}))`),
    '--radius-sm: calc(var(--radius) - 4px)',
    '--radius-md: calc(var(--radius) - 2px)',
    '--radius-lg: var(--radius)',
    '--radius-xl: calc(var(--radius) + 4px)',
  ];
  return `@theme inline {\n${mappings.map(m => `  ${m};`).join('\n')}\n}`;
}

/**
 * Update globals.css in a project with new token values.
 * Handles both Tailwind v3 (:root block) and v4 (@theme inline + :root) formats.
 */
export async function updateGlobalsCssTokens(
  projectDir: string,
  tokens: DesignTokens,
): Promise<boolean> {
  const candidates = [
    path.join(projectDir, 'src', 'app', 'globals.css'),
    path.join(projectDir, 'app', 'globals.css'),
    path.join(projectDir, 'src', 'index.css'),
    path.join(projectDir, 'src', 'styles', 'globals.css'),
  ];

  const existing = candidates.find(p => fs.existsSync(p));
  if (!existing) return false;

  try {
    let content = await fs.promises.readFile(existing, 'utf-8');
    const isV4 = content.includes('@import "tailwindcss"') || content.includes("@import 'tailwindcss'");
    const newVars = generateShadcnCssBlock(tokens);

    // Replace ALL existing :root block variables (shadcn v2 can create multiple)
    const rootRegex = /:root\s*\{[^}]*\}/g;
    const rootMatches = content.match(rootRegex);
    if (rootMatches && rootMatches.length > 0) {
      const replacement = `:root {\n${newVars}\n    --radius: 0.5rem;\n  }`;
      // Replace first with our tokens, remove subsequent duplicates
      let replaced = false;
      content = content.replace(rootRegex, (match) => {
        if (!replaced) {
          replaced = true;
          return replacement;
        }
        return '';
      });
    }

    // For v4: ensure @theme inline block exists and is up to date
    if (isV4) {
      const detectedColorFn: 'hsl' | 'oklch' = content.includes('oklch(') ? 'oklch' : 'hsl';
      const themeBlock = generateShadcnThemeBlock(detectedColorFn);
      const themeRegex = /@theme\s+inline\s*\{[^}]*\}/;
      if (themeRegex.test(content)) {
        content = content.replace(themeRegex, themeBlock);
      } else {
        content = content.replace(
          /(@import\s+["']tailwindcss["'];?\s*\n?)/,
          `$1\n${themeBlock}\n\n`,
        );
      }
    }

    await fs.promises.writeFile(existing, content, 'utf-8');
    console.log(`[DesignPackToShadcn] Updated tokens in ${existing} (tailwind ${isV4 ? 'v4' : 'v3'})`);
    return true;
  } catch (err) {
    console.error(`[DesignPackToShadcn] Failed to update globals.css at ${existing}:`, err);
    return false;
  }
}
