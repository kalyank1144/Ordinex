/**
 * Deterministic AutoFix — Non-LLM fixes applied before bounded LLM repair.
 *
 * Cheap, fast, reliable fixes that don't require an LLM call:
 *   1. Normalize shadcn import paths (e.g. @/components/ui/*)
 *   2. Detect and install missing dependencies
 *   3. Fix trivial JSX syntax issues
 *   4. Ensure tsconfig alias alignment
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ============================================================================
// TYPES
// ============================================================================

export interface AutofixResult {
  applied: boolean;
  fixes: AutofixAction[];
  errors: string[];
}

export interface AutofixAction {
  type: 'import_normalize' | 'missing_dep' | 'jsx_syntax' | 'tsconfig_alias' | 'next_config';
  file?: string;
  description: string;
}

// ============================================================================
// IMPORT PATH NORMALIZATION
// ============================================================================

/**
 * Scan project files for broken shadcn import paths and normalize them.
 * Ensures imports use `@/components/ui/` prefix consistently.
 */
async function fixShadcnImports(projectDir: string): Promise<AutofixAction[]> {
  const fixes: AutofixAction[] = [];
  const srcDirs = ['src', 'app', 'components', 'lib'].map(d => path.join(projectDir, d));

  for (const dir of srcDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = await collectTsxFiles(dir);

    for (const file of files) {
      try {
        let content = await fs.promises.readFile(file, 'utf-8');
        let modified = false;

        // Fix relative imports to shadcn components: ../components/ui/ → @/components/ui/
        const relativePattern = /from\s+['"]\.\.\/(?:\.\.\/)*components\/ui\/([^'"]+)['"]/g;
        const replaced = content.replace(relativePattern, (_, comp) => {
          modified = true;
          return `from "@/components/ui/${comp}"`;
        });

        // Fix missing @/ prefix for components/ui paths
        const barePattern = /from\s+['"]components\/ui\/([^'"]+)['"]/g;
        const replaced2 = replaced.replace(barePattern, (_, comp) => {
          modified = true;
          return `from "@/components/ui/${comp}"`;
        });

        if (modified) {
          await fs.promises.writeFile(file, replaced2, 'utf-8');
          fixes.push({
            type: 'import_normalize',
            file: path.relative(projectDir, file),
            description: `Normalized shadcn import paths`,
          });
        }
      } catch { /* skip unreadable files */ }
    }
  }

  return fixes;
}

// ============================================================================
// MISSING DEPENDENCY DETECTION
// ============================================================================

/**
 * Detect commonly missing deps and install them.
 */
async function fixMissingDeps(projectDir: string): Promise<AutofixAction[]> {
  const fixes: AutofixAction[] = [];
  const pkgPath = path.join(projectDir, 'package.json');

  if (!fs.existsSync(pkgPath)) return fixes;

  try {
    const pkg = JSON.parse(await fs.promises.readFile(pkgPath, 'utf-8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    const requiredDeps: Record<string, string> = {};

    // Check for common shadcn peer deps
    const shadcnPeers = [
      'class-variance-authority',
      'clsx',
      'tailwind-merge',
      'lucide-react',
    ];

    for (const dep of shadcnPeers) {
      if (!allDeps[dep]) requiredDeps[dep] = 'latest';
    }

    // Check if tailwindcss-animate is needed (common with shadcn, v3 only)
    const twVer = allDeps['tailwindcss'] || '';
    const twVerMatch = twVer.match(/(\d+)/);
    const isTwV4 = twVerMatch && parseInt(twVerMatch[1], 10) >= 4;
    if (!isTwV4 && !allDeps['tailwindcss-animate'] && allDeps['tailwindcss']) {
      requiredDeps['tailwindcss-animate'] = 'latest';
    }

    if (Object.keys(requiredDeps).length > 0) {
      const depList = Object.keys(requiredDeps).join(' ');
      const pm = detectPackageManager(projectDir);

      try {
        const installCmd = pm === 'pnpm' ? `pnpm add ${depList}` :
          pm === 'yarn' ? `yarn add ${depList}` :
            `npm install ${depList}`;

        await execAsync(installCmd, { cwd: projectDir, encoding: 'utf-8', timeout: 120_000 });

        fixes.push({
          type: 'missing_dep',
          description: `Installed missing dependencies: ${depList}`,
        });
      } catch (err: any) {
        // Non-fatal — quality gates will catch it
      }
    }
  } catch { /* skip if package.json unreadable */ }

  return fixes;
}

// ============================================================================
// TSCONFIG ALIAS FIX
// ============================================================================

/**
 * Ensure @/ alias exists in tsconfig.json paths.
 */
async function fixTsconfigAlias(projectDir: string): Promise<AutofixAction[]> {
  const fixes: AutofixAction[] = [];
  const tsconfigPath = path.join(projectDir, 'tsconfig.json');

  if (!fs.existsSync(tsconfigPath)) return fixes;

  try {
    let raw = await fs.promises.readFile(tsconfigPath, 'utf-8');
    // Strip comments for parsing (simple single-line comment removal)
    const stripped = raw.replace(/\/\/.*$/gm, '');
    const tsconfig = JSON.parse(stripped);

    const compilerOptions = tsconfig.compilerOptions || {};
    const paths = compilerOptions.paths || {};

    if (!paths['@/*']) {
      compilerOptions.paths = { ...paths, '@/*': ['./*'] };

      // Also check for src directory
      if (fs.existsSync(path.join(projectDir, 'src'))) {
        compilerOptions.paths['@/*'] = ['./src/*'];
      }

      compilerOptions.baseUrl = compilerOptions.baseUrl || '.';
      tsconfig.compilerOptions = compilerOptions;

      await fs.promises.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2), 'utf-8');
      fixes.push({
        type: 'tsconfig_alias',
        file: 'tsconfig.json',
        description: 'Added @/* path alias to tsconfig.json',
      });
    }
  } catch { /* skip if tsconfig unparseable */ }

  return fixes;
}

// ============================================================================
// NEXT.JS CONFIG FIX
// ============================================================================

/**
 * Ensure next.config has `eslint.ignoreDuringBuilds` and `typescript.ignoreBuildErrors`
 * set to `true`. These are essential for generated apps where tsc/eslint errors
 * don't prevent the dev server from running.
 *
 * Strategy: check for the actual property assignments (not just substrings).
 * If missing, rewrite the file to a known-good format that preserves any
 * other settings (like images, redirects, etc.).
 */
async function fixNextConfig(projectDir: string): Promise<AutofixAction[]> {
  const fixes: AutofixAction[] = [];
  const configPaths = [
    path.join(projectDir, 'next.config.ts'),
    path.join(projectDir, 'next.config.mjs'),
    path.join(projectDir, 'next.config.js'),
  ];

  const existing = configPaths.find(p => fs.existsSync(p));
  if (!existing) return fixes;

  try {
    const content = await fs.promises.readFile(existing, 'utf-8');

    // Check for actual property assignments, not just substring presence.
    // Match: `ignoreBuildErrors: true` or `ignoreBuildErrors:true` (with optional whitespace)
    const hasBuildErrorsSetting = /ignoreBuildErrors\s*:\s*true/.test(content);
    const hasEslintSetting = /ignoreDuringBuilds\s*:\s*true/.test(content);

    if (hasBuildErrorsSetting && hasEslintSetting) return fixes;

    // Need to add/fix settings. Try injection first, then full rewrite.
    let updatedContent = content;
    let changed = false;

    if (!hasBuildErrorsSetting) {
      // Try to find existing `typescript: { ... }` block and add to it
      const tsBlockMatch = updatedContent.match(/typescript\s*:\s*\{[^}]*\}/);
      if (tsBlockMatch) {
        updatedContent = updatedContent.replace(
          /typescript\s*:\s*\{/,
          'typescript: { ignoreBuildErrors: true,',
        );
        changed = true;
      }
    }
    if (!hasEslintSetting) {
      const eslintBlockMatch = updatedContent.match(/eslint\s*:\s*\{[^}]*\}/);
      if (eslintBlockMatch) {
        updatedContent = updatedContent.replace(
          /eslint\s*:\s*\{/,
          'eslint: { ignoreDuringBuilds: true,',
        );
        changed = true;
      }
    }

    // If blocks didn't exist, inject both properties into the config object
    if (!changed || !(/ignoreBuildErrors\s*:\s*true/.test(updatedContent) && /ignoreDuringBuilds\s*:\s*true/.test(updatedContent))) {
      // Try to inject after the opening brace of the config object
      const configObjPatterns = [
        /const\s+nextConfig(?:\s*:\s*[^=]+)?\s*=\s*\{/,
        /export\s+default\s*\{/,
        /module\.exports\s*=\s*\{/,
      ];

      let injected = false;
      for (const pattern of configObjPatterns) {
        if (pattern.test(content)) {
          updatedContent = content.replace(pattern, (match) =>
            `${match}\n  eslint: { ignoreDuringBuilds: true },\n  typescript: { ignoreBuildErrors: true },`,
          );
          injected = true;
          break;
        }
      }

      // Last resort: full rewrite preserving no other settings
      if (!injected) {
        const isTs = existing.endsWith('.ts');
        const isMjs = existing.endsWith('.mjs');
        if (isTs) {
          updatedContent = `import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {\n  eslint: { ignoreDuringBuilds: true },\n  typescript: { ignoreBuildErrors: true },\n};\n\nexport default nextConfig;\n`;
        } else if (isMjs) {
          updatedContent = `/** @type {import('next').NextConfig} */\nconst nextConfig = {\n  eslint: { ignoreDuringBuilds: true },\n  typescript: { ignoreBuildErrors: true },\n};\n\nexport default nextConfig;\n`;
        } else {
          updatedContent = `/** @type {import('next').NextConfig} */\nconst nextConfig = {\n  eslint: { ignoreDuringBuilds: true },\n  typescript: { ignoreBuildErrors: true },\n};\n\nmodule.exports = nextConfig;\n`;
        }
      }
    }

    if (updatedContent !== content) {
      await fs.promises.writeFile(existing, updatedContent, 'utf-8');
      fixes.push({
        type: 'next_config',
        file: path.basename(existing),
        description: 'Ensured eslint.ignoreDuringBuilds and typescript.ignoreBuildErrors are true',
      });
    }
  } catch { /* skip */ }

  return fixes;
}

// ============================================================================
// USE CLIENT DIRECTIVE FIX
// ============================================================================

/**
 * Add 'use client' to files that use React hooks or browser APIs but lack the directive.
 * This is a very common issue with Next.js App Router generated code.
 */
async function fixUseClientDirective(projectDir: string): Promise<AutofixAction[]> {
  const fixes: AutofixAction[] = [];
  const srcDirs = ['src', 'app', 'components', 'lib'].map(d => path.join(projectDir, d));

  const hookPatterns = [
    /\buseState\b/, /\buseEffect\b/, /\buseRef\b/, /\buseCallback\b/,
    /\buseMemo\b/, /\buseContext\b/, /\buseReducer\b/, /\buseLayoutEffect\b/,
    /\bonClick\b/, /\bonChange\b/, /\bonSubmit\b/, /\bonKeyDown\b/,
    /\bonBlur\b/, /\bonFocus\b/, /\bonMouseEnter\b/,
    /\bwindow\b/, /\bdocument\b/, /\blocalStorage\b/,
  ];

  for (const dir of srcDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = await collectTsxFiles(dir);

    for (const file of files) {
      try {
        const content = await fs.promises.readFile(file, 'utf-8');
        const firstLine = content.trimStart().split('\n')[0];

        if (firstLine.includes("'use client'") || firstLine.includes('"use client"')) continue;

        const needsUseClient = hookPatterns.some(p => p.test(content));
        if (needsUseClient) {
          await fs.promises.writeFile(file, `'use client';\n\n${content}`, 'utf-8');
          fixes.push({
            type: 'jsx_syntax' as AutofixAction['type'],
            file: path.relative(projectDir, file),
            description: `Added 'use client' directive (uses hooks/event handlers)`,
          });
        }
      } catch { /* skip */ }
    }
  }

  return fixes;
}

// ============================================================================
// MISSING cn() UTILITY FIX
// ============================================================================

/**
 * Ensure the cn() utility exists at lib/utils.ts (required by shadcn components).
 */
async function fixCnUtility(projectDir: string): Promise<AutofixAction[]> {
  const fixes: AutofixAction[] = [];
  const utilPaths = [
    path.join(projectDir, 'src', 'lib', 'utils.ts'),
    path.join(projectDir, 'lib', 'utils.ts'),
  ];

  const hasSrc = fs.existsSync(path.join(projectDir, 'src'));
  const targetPath = hasSrc ? utilPaths[0] : utilPaths[1];

  if (utilPaths.some(p => fs.existsSync(p))) return fixes;

  const cnContent = `import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;

  try {
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.promises.writeFile(targetPath, cnContent, 'utf-8');
    fixes.push({
      type: 'missing_dep' as AutofixAction['type'],
      file: path.relative(projectDir, targetPath),
      description: 'Created cn() utility (lib/utils.ts) for shadcn components',
    });
  } catch { /* skip */ }

  return fixes;
}

// ============================================================================
// TAILWIND V4 CSS FIX
// ============================================================================

/**
 * Fix @apply usage in globals.css for Tailwind v4 projects.
 * In v4, `@apply border-border` and similar custom theme utilities
 * can fail. Replace with raw CSS equivalents.
 */
async function fixTailwindV4Css(projectDir: string): Promise<AutofixAction[]> {
  const fixes: AutofixAction[] = [];

  // Detect Tailwind version from package.json
  const pkgPath = path.join(projectDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return fixes;

  try {
    const pkg = JSON.parse(await fs.promises.readFile(pkgPath, 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const twVersion = deps?.tailwindcss || '';
    const match = twVersion.match(/(\d+)/);
    const isV4 = match && parseInt(match[1], 10) >= 4;
    if (!isV4) return fixes;

    // Find globals.css
    const cssCandidates = [
      path.join(projectDir, 'src', 'app', 'globals.css'),
      path.join(projectDir, 'app', 'globals.css'),
      path.join(projectDir, 'src', 'index.css'),
    ];

    for (const cssPath of cssCandidates) {
      if (!fs.existsSync(cssPath)) continue;

      let content = await fs.promises.readFile(cssPath, 'utf-8');
      let modified = false;

      // Detect the color function used in the CSS (oklch or hsl)
      const colorFn = content.includes('oklch(') ? 'oklch' : 'hsl';

      // Replace @apply border-border with raw CSS
      if (content.includes('@apply border-border')) {
        content = content.replace(/@apply border-border;?/g, `border-color: ${colorFn}(var(--border));`);
        modified = true;
      }

      // Replace @apply bg-background text-foreground with raw CSS
      if (content.includes('@apply bg-background text-foreground')) {
        content = content.replace(
          /@apply bg-background text-foreground;?/g,
          `background-color: ${colorFn}(var(--background));\n    color: ${colorFn}(var(--foreground));`
        );
        modified = true;
      }

      // Replace @apply bg-background with raw CSS (standalone)
      if (content.includes('@apply bg-background;')) {
        content = content.replace(/@apply bg-background;/g, `background-color: ${colorFn}(var(--background));`);
        modified = true;
      }

      // Ensure @import "tailwindcss" exists (v4 requires this instead of @tailwind directives)
      if (!content.includes('@import "tailwindcss"') && !content.includes("@import 'tailwindcss'")) {
        if (content.includes('@tailwind base')) {
          // Replace v3 directives with v4 import
          content = content.replace(/@tailwind base;\s*\n?@tailwind components;\s*\n?@tailwind utilities;\s*\n?/,
            '@import "tailwindcss";\n\n');
          modified = true;
        }
      }

      if (modified) {
        await fs.promises.writeFile(cssPath, content, 'utf-8');
        fixes.push({
          type: 'jsx_syntax' as AutofixAction['type'],
          file: path.relative(projectDir, cssPath),
          description: 'Fixed Tailwind v4 CSS compatibility (@apply → raw CSS)',
        });
      }
    }
  } catch { /* skip */ }

  return fixes;
}

// ============================================================================
// BROKEN IMPORT CLEANUP
// ============================================================================

/**
 * Scan for imports that reference non-existent local files and either
 * fix the path or comment them out to prevent build failures.
 */
async function fixBrokenLocalImports(projectDir: string): Promise<AutofixAction[]> {
  const fixes: AutofixAction[] = [];
  const srcDirs = ['src', 'app', 'components', 'lib', 'hooks', 'types'].map(d => path.join(projectDir, d));

  for (const dir of srcDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = await collectTsxFiles(dir);

    for (const file of files) {
      try {
        let content = await fs.promises.readFile(file, 'utf-8');
        let modified = false;

        // Fix imports from @/components/ that reference non-existent custom components
        // but don't touch @/components/ui/* (those are shadcn)
        const importRegex = /^(import\s+.*?\s+from\s+['"]@\/components\/(?!ui\/)([^'"]+)['"];?)$/gm;
        const replaced = content.replace(importRegex, (fullMatch, _importLine, compPath) => {
          const hasSrc = fs.existsSync(path.join(projectDir, 'src'));
          const prefix = hasSrc ? 'src/' : '';
          const targetPath = path.join(projectDir, prefix, 'components', compPath);
          const candidates = [targetPath, targetPath + '.tsx', targetPath + '.ts', targetPath + '/index.tsx'];

          if (candidates.some(c => fs.existsSync(c))) return fullMatch;

          modified = true;
          return `// ${fullMatch} // TODO: Component not found — create or fix import`;
        });

        if (modified) {
          await fs.promises.writeFile(file, replaced, 'utf-8');
          fixes.push({
            type: 'import_normalize',
            file: path.relative(projectDir, file),
            description: 'Commented out broken component imports',
          });
        }
      } catch { /* skip */ }
    }
  }

  return fixes;
}

// ============================================================================
// TYPESCRIPT STRICT MODE FIXES
// ============================================================================

/**
 * Fix common TypeScript strict-mode issues that trip up generated code:
 * - Implicit 'any' on event handler params
 * - Missing return types on components
 */
async function fixTypeScriptStrictIssues(projectDir: string): Promise<AutofixAction[]> {
  const fixes: AutofixAction[] = [];
  const srcDirs = ['src', 'app', 'components'].map(d => path.join(projectDir, d));

  for (const dir of srcDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = await collectTsxFiles(dir);

    for (const file of files) {
      try {
        let content = await fs.promises.readFile(file, 'utf-8');
        let modified = false;

        // Fix common pattern: (e) => in event handlers → (e: React.ChangeEvent<...>) etc.
        // Only fix obvious cases: onChange={(e) => and onSubmit={(e) =>
        const onChangeReplace = content.replace(
          /onChange=\{\(e\)\s*=>/g,
          (match) => { modified = true; return 'onChange={(e: React.ChangeEvent<HTMLInputElement>) =>'; },
        );
        const onSubmitReplace = onChangeReplace.replace(
          /onSubmit=\{\(e\)\s*=>/g,
          (match) => { modified = true; return 'onSubmit={(e: React.FormEvent<HTMLFormElement>) =>'; },
        );

        if (modified) {
          await fs.promises.writeFile(file, onSubmitReplace, 'utf-8');
          fixes.push({
            type: 'jsx_syntax' as AutofixAction['type'],
            file: path.relative(projectDir, file),
            description: 'Added type annotations to event handlers',
          });
        }
      } catch { /* skip */ }
    }
  }

  return fixes;
}

// ============================================================================
// MISSING COMPONENT STUB GENERATOR
// ============================================================================

/**
 * Find imports that reference local components which don't exist and create
 * minimal stubs so the project compiles and the dev server starts.
 */
async function fixMissingComponentStubs(projectDir: string): Promise<AutofixAction[]> {
  const fixes: AutofixAction[] = [];
  const srcDirs = ['src', 'app', 'components', 'lib', 'hooks'].map(d => path.join(projectDir, d));
  const hasSrc = fs.existsSync(path.join(projectDir, 'src'));
  const prefix = hasSrc ? 'src/' : '';

  const missingModules = new Map<string, { importedNames: string[]; isDefault: boolean }>();

  for (const dir of srcDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = await collectTsxFiles(dir);

    for (const file of files) {
      try {
        const content = await fs.promises.readFile(file, 'utf-8');

        // Match: import { Foo, Bar } from "@/components/something"
        // Match: import Something from "@/components/something"
        // Match: import { Foo } from "@/lib/something"
        const importRegex = /^import\s+(?:(\w+)|{([^}]+)})\s+from\s+['"]@\/((?:components|lib|hooks)\/[^'"]+)['"]/gm;
        let match;
        while ((match = importRegex.exec(content)) !== null) {
          const defaultImport = match[1];
          const namedImports = match[2];
          const modulePath = match[3];

          // Check if the file exists
          const fullBase = path.join(projectDir, prefix, modulePath);
          const candidates = [
            fullBase + '.tsx', fullBase + '.ts', fullBase + '.jsx', fullBase + '.js',
            fullBase + '/index.tsx', fullBase + '/index.ts',
            fullBase, // exact path
          ];

          if (candidates.some(c => fs.existsSync(c))) continue;

          const names = namedImports
            ? namedImports.split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)
            : [];

          missingModules.set(modulePath, {
            importedNames: names,
            isDefault: !!defaultImport,
          });
        }
      } catch { /* skip */ }
    }
  }

  for (const [modulePath, info] of missingModules) {
    const targetFile = path.join(projectDir, prefix, modulePath + '.tsx');
    const targetDir = path.dirname(targetFile);

    try {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const componentName = path.basename(modulePath)
        .replace(/[-_](\w)/g, (_, c) => c.toUpperCase())
        .replace(/^\w/, c => c.toUpperCase());

      let stubContent = '';
      if (info.isDefault) {
        stubContent = `export default function ${componentName}() {\n  return <div className="p-4">TODO: ${componentName}</div>;\n}\n`;
      } else if (info.importedNames.length > 0) {
        const exports = info.importedNames.map(name => {
          if (/^[A-Z]/.test(name)) {
            return `export function ${name}({ children, ...props }: { children?: React.ReactNode; [key: string]: any }) {\n  return <div {...props}>{children || '${name}'}</div>;\n}`;
          }
          return `export const ${name} = {} as any;`;
        });
        stubContent = exports.join('\n\n') + '\n';
      } else {
        stubContent = `export default function ${componentName}() {\n  return <div className="p-4">TODO: ${componentName}</div>;\n}\n`;
      }

      await fs.promises.writeFile(targetFile, stubContent, 'utf-8');
      fixes.push({
        type: 'missing_dep' as AutofixAction['type'],
        file: path.relative(projectDir, targetFile),
        description: `Created stub for missing component: ${modulePath}`,
      });
    } catch { /* skip */ }
  }

  return fixes;
}

// ============================================================================
// FIX IMPLICIT ANY PARAMETERS
// ============================================================================

/**
 * Fix common implicit 'any' parameter errors that tsc catches.
 * Handles: function params, arrow function params, map/filter callbacks.
 */
async function fixImplicitAnyParams(projectDir: string): Promise<AutofixAction[]> {
  const fixes: AutofixAction[] = [];
  const srcDirs = ['src', 'app', 'components', 'lib'].map(d => path.join(projectDir, d));

  for (const dir of srcDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = await collectTsxFiles(dir);

    for (const file of files) {
      try {
        let content = await fs.promises.readFile(file, 'utf-8');
        let modified = false;

        // Fix .map((item) => with .map((item: any) =>
        content = content.replace(
          /\.(map|filter|find|forEach|reduce|some|every)\(\((\w+)\)\s*=>/g,
          (match, method, param) => {
            modified = true;
            return `.${method}((${param}: any) =>`;
          },
        );

        // Fix .map((item, index) => with .map((item: any, index: number) =>
        content = content.replace(
          /\.(map|filter|forEach)\(\((\w+),\s*(\w+)\)\s*=>/g,
          (match, method, param1, param2) => {
            modified = true;
            return `.${method}((${param1}: any, ${param2}: number) =>`;
          },
        );

        // Fix standalone arrow functions with single untyped params: (e) =>
        // Only in JSX event handler context: onX={(e) =>
        content = content.replace(
          /on(\w+)=\{\((\w+)\)\s*=>/g,
          (match, eventName, param) => {
            modified = true;
            return `on${eventName}={(${param}: any) =>`;
          },
        );

        if (modified) {
          await fs.promises.writeFile(file, content, 'utf-8');
          fixes.push({
            type: 'jsx_syntax' as AutofixAction['type'],
            file: path.relative(projectDir, file),
            description: 'Added type annotations to implicit any parameters',
          });
        }
      } catch { /* skip */ }
    }
  }

  return fixes;
}

// ============================================================================
// COMPREHENSIVE IMPORT RESOLUTION
// ============================================================================

/**
 * Scan ALL source files and ensure every `@/` import resolves to a real file.
 * This is the single most impactful fix: `next build` fails on unresolvable
 * imports regardless of `ignoreBuildErrors`. By creating stubs for missing
 * files, we guarantee the build succeeds.
 *
 * Handles:
 *   - @/components/ui/* (shadcn stubs)
 *   - @/components/* (custom component stubs)
 *   - @/lib/*, @/hooks/*, @/types/* (utility/type stubs)
 */
async function ensureAllImportsResolve(projectDir: string): Promise<AutofixAction[]> {
  const fixes: AutofixAction[] = [];
  const hasSrc = fs.existsSync(path.join(projectDir, 'src'));
  const baseDir = hasSrc ? path.join(projectDir, 'src') : projectDir;
  const scanDirs = ['app', 'components', 'lib', 'hooks', 'types'].map(d => path.join(baseDir, d));

  const missingModules = new Map<string, { importedNames: string[]; isDefault: boolean; isNamespace: boolean }>();

  for (const dir of scanDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = await collectTsxFiles(dir);

    for (const file of files) {
      try {
        const content = await fs.promises.readFile(file, 'utf-8');
        const importRegex = /^import\s+(?:(\w+)|(\*\s+as\s+\w+)|\{([^}]+)\})\s+from\s+['"]@\/([^'"]+)['"]/gm;
        let match;
        while ((match = importRegex.exec(content)) !== null) {
          const defaultImport = match[1];
          const namespaceImport = match[2];
          const namedImports = match[3];
          const modulePath = match[4]; // e.g. "components/ui/button" or "lib/utils"

          const fullBase = path.join(baseDir, modulePath);
          const candidates = [
            fullBase + '.tsx', fullBase + '.ts', fullBase + '.jsx', fullBase + '.js',
            fullBase + '/index.tsx', fullBase + '/index.ts',
            fullBase,
          ];
          if (candidates.some(c => fs.existsSync(c))) continue;

          const names = namedImports
            ? namedImports.split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)
            : [];

          if (!missingModules.has(modulePath)) {
            missingModules.set(modulePath, {
              importedNames: names,
              isDefault: !!defaultImport,
              isNamespace: !!namespaceImport,
            });
          } else {
            const existing = missingModules.get(modulePath)!;
            for (const n of names) {
              if (!existing.importedNames.includes(n)) existing.importedNames.push(n);
            }
            if (defaultImport) existing.isDefault = true;
          }
        }
      } catch { /* skip */ }
    }
  }

  for (const [modulePath, info] of missingModules) {
    const targetFile = path.join(baseDir, modulePath + '.tsx');
    const targetDir = path.dirname(targetFile);

    try {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      let stubContent: string;

      if (modulePath.startsWith('components/ui/')) {
        // Shadcn component stub — matches shadcn's export pattern
        stubContent = generateShadcnStub(modulePath, info.importedNames);
      } else if (modulePath.startsWith('types/') || modulePath.startsWith('types')) {
        // Type stubs
        stubContent = generateTypeStub(info.importedNames);
      } else if (modulePath.startsWith('hooks/')) {
        // Hook stubs
        stubContent = generateHookStub(modulePath, info.importedNames, info.isDefault);
      } else {
        // Generic component/utility stub
        stubContent = generateGenericStub(modulePath, info.importedNames, info.isDefault);
      }

      await fs.promises.writeFile(targetFile, stubContent, 'utf-8');
      fixes.push({
        type: 'missing_dep' as AutofixAction['type'],
        file: (hasSrc ? 'src/' : '') + modulePath + '.tsx',
        description: `Created stub for missing import: @/${modulePath}`,
      });
    } catch { /* skip */ }
  }

  return fixes;
}

function generateShadcnStub(modulePath: string, namedExports: string[]): string {
  const componentName = path.basename(modulePath)
    .replace(/[-_](\w)/g, (_, c: string) => c.toUpperCase())
    .replace(/^\w/, (c: string) => c.toUpperCase());

  if (namedExports.length === 0) {
    namedExports = [componentName];
  }

  const exports = namedExports.map(name => {
    if (/^[A-Z]/.test(name)) {
      return `export const ${name} = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={className} {...props}>{children}</div>
  )
);
${name}.displayName = "${name}";`;
    }
    return `export const ${name} = {} as any;`;
  });

  return `import * as React from "react";\n\n${exports.join('\n\n')}\n`;
}

function generateTypeStub(namedExports: string[]): string {
  const types = namedExports.map(name => {
    if (/^[A-Z]/.test(name)) {
      return `export interface ${name} { [key: string]: any; }`;
    }
    return `export type ${name} = any;`;
  });
  return types.length > 0 ? types.join('\n\n') + '\n' : 'export {};\n';
}

function generateHookStub(modulePath: string, namedExports: string[], isDefault: boolean): string {
  const hookName = path.basename(modulePath)
    .replace(/[-_](\w)/g, (_, c: string) => c.toUpperCase());
  if (isDefault) {
    return `export default function ${hookName}() {\n  return {} as any;\n}\n`;
  }
  const exports = namedExports.map(name =>
    `export function ${name}() {\n  return {} as any;\n}`
  );
  return exports.length > 0 ? exports.join('\n\n') + '\n' : `export function ${hookName}() {\n  return {} as any;\n}\n`;
}

function generateGenericStub(modulePath: string, namedExports: string[], isDefault: boolean): string {
  const componentName = path.basename(modulePath)
    .replace(/[-_](\w)/g, (_, c: string) => c.toUpperCase())
    .replace(/^\w/, (c: string) => c.toUpperCase());

  const parts: string[] = [];
  if (isDefault) {
    parts.push(`export default function ${componentName}({ children, ...props }: { children?: React.ReactNode; [key: string]: any }) {\n  return <div {...props}>{children || "${componentName}"}</div>;\n}`);
  }
  for (const name of namedExports) {
    if (/^[A-Z]/.test(name)) {
      parts.push(`export function ${name}({ children, ...props }: { children?: React.ReactNode; [key: string]: any }) {\n  return <div {...props}>{children || "${name}"}</div>;\n}`);
    } else {
      parts.push(`export const ${name} = {} as any;`);
    }
  }
  if (parts.length === 0) {
    parts.push(`export default function ${componentName}() {\n  return <div className="p-4">${componentName}</div>;\n}`);
  }
  return `import * as React from "react";\n\n${parts.join('\n\n')}\n`;
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Run all deterministic autofixes on a project directory.
 * Returns a summary of what was fixed.
 *
 * Fix order matters:
 *   1. Config/alias fixes (next.config, tsconfig)
 *   2. Dependency fixes (missing packages, cn utility)
 *   3. Import normalization (shadcn paths)
 *   4. Comprehensive import resolution (ALL missing @/ imports)
 *   5. Code fixes (use client, types, implicit any)
 *   6. CSS fixes (Tailwind v4)
 */
export async function runDeterministicAutofix(projectDir: string): Promise<AutofixResult> {
  const allFixes: AutofixAction[] = [];
  const errors: string[] = [];

  const fixers = [
    fixNextConfig,
    fixTsconfigAlias,
    fixMissingDeps,
    fixCnUtility,
    fixShadcnImports,
    ensureAllImportsResolve,
    fixUseClientDirective,
    fixImplicitAnyParams,
    fixTypeScriptStrictIssues,
    fixTailwindV4Css,
  ];

  for (const fixer of fixers) {
    try {
      const fixes = await fixer(projectDir);
      allFixes.push(...fixes);
    } catch (err: any) {
      errors.push(`${fixer.name}: ${err.message}`);
    }
  }

  return {
    applied: allFixes.length > 0,
    fixes: allFixes,
    errors,
  };
}

// ============================================================================
// UTILITIES
// ============================================================================

async function collectTsxFiles(dir: string, maxDepth = 6): Promise<string[]> {
  if (maxDepth <= 0) return [];
  const results: string[] = [];

  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;

      if (entry.isDirectory()) {
        results.push(...await collectTsxFiles(full, maxDepth - 1));
      } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
        results.push(full);
      }
    }
  } catch { /* skip unreadable dirs */ }

  return results;
}

function detectPackageManager(dir: string): 'npm' | 'pnpm' | 'yarn' {
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}
