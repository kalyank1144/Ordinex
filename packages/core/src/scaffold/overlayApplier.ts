/**
 * Overlay Applier — Applies deterministic premium shell overlays.
 *
 * Overlays are version-matched directory packages (not LLM-generated):
 *   overlay-next15/   — Next.js 15 App Router shell
 *   overlay-vite/     — Vite React shell
 *   overlay-expo/     — Expo mobile shell
 *
 * The overlay provides:
 *   - app/layout.tsx with responsive sidebar + header shell
 *   - lib/utils.ts (cn helper)
 *   - components/ui/ scaffolding directories
 *   - globals.css with shadcn base tokens
 *   - Proper font + metadata setup
 *
 * LLM fills product-specific content; overlay provides architecture.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DesignTokens } from './tokenValidator';
import { hexToHsl } from './tokenValidator';

// ============================================================================
// TAILWIND VERSION DETECTION
// ============================================================================

/**
 * Detect whether the project uses Tailwind CSS v4+.
 * Checks package.json for tailwindcss version; v4 uses `@import "tailwindcss"` syntax.
 */
export function detectTailwindVersion(projectDir: string): 3 | 4 {
  try {
    const pkgPath = path.join(projectDir, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      console.log(`[detectTailwindVersion] No package.json at ${pkgPath}, defaulting to v3`);
      return 3;
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const twVersion = deps?.tailwindcss || '';
    console.log(`[detectTailwindVersion] tailwindcss version in package.json: "${twVersion}"`);
    const match = twVersion.match(/(\d+)/);
    if (match && parseInt(match[1], 10) >= 4) {
      console.log(`[detectTailwindVersion] → Detected v4 from package.json`);
      return 4;
    }

    // Also check if globals.css already has v4 syntax (post-create-next-app)
    const cssFiles = [
      path.join(projectDir, 'src', 'app', 'globals.css'),
      path.join(projectDir, 'app', 'globals.css'),
    ];
    for (const cssFile of cssFiles) {
      if (fs.existsSync(cssFile)) {
        const content = fs.readFileSync(cssFile, 'utf-8');
        if (content.includes('@import "tailwindcss"') || content.includes("@import 'tailwindcss'")) {
          return 4;
        }
      }
    }
  } catch {
    // Default to v3 on error
  }
  return 3;
}

// ============================================================================
// TYPES
// ============================================================================

export interface OverlayPageInfo {
  name: string;
  path: string;
}

export interface OverlayConfig {
  recipeId: string;
  appName: string;
  tokens: DesignTokens;
  primaryLayout: 'sidebar' | 'header_only' | 'full_width' | 'centered' | 'split';
  designVibe?: string;
  tailwindVersion?: 3 | 4;
  pages?: OverlayPageInfo[];
  oklchVars?: Record<string, string>;
  darkTokens?: DesignTokens;
  darkOklchVars?: Record<string, string>;
}

export interface OverlayResult {
  filesCreated: string[];
  filesModified: string[];
}

// ============================================================================
// OVERLAY TEMPLATES
// ============================================================================

function getVibeRadius(vibe?: string): string {
  if (vibe === 'glass' || vibe === 'gradient') return '0.75rem';
  if (vibe === 'neo') return '0.25rem';
  return '0.5rem';
}

function getVibeSpecificCss(vibe?: string, colorFn: 'hsl' | 'oklch' = 'hsl'): string {
  if (vibe === 'glass') {
    return `
@layer components {
  .glass-card {
    @apply bg-white/60 backdrop-blur-xl border border-white/30 shadow-lg;
  }
  .glass-card-dark {
    @apply bg-black/20 backdrop-blur-xl border border-white/10 shadow-lg;
  }
  .glass-surface {
    @apply bg-white/40 backdrop-blur-md border border-white/20;
  }
  .glass-input {
    @apply bg-white/50 backdrop-blur-sm border border-white/30 focus:bg-white/70;
  }
  .glass-sidebar {
    @apply bg-white/30 backdrop-blur-2xl border-r border-white/20;
  }
  .glass-header {
    @apply bg-white/60 backdrop-blur-xl border-b border-white/30 sticky top-0 z-50;
  }
  .glass-button {
    @apply bg-white/20 backdrop-blur-sm border border-white/30 hover:bg-white/40 transition-all;
  }
}

@layer base {
  body {
    background: linear-gradient(135deg, ${colorFn}(var(--background)) 0%, ${colorFn}(var(--secondary)) 50%, ${colorFn}(var(--accent)) 100%);
    min-height: 100vh;
  }
}
`;
  }
  if (vibe === 'neo') {
    return `
@layer components {
  .neo-glow {
    @apply shadow-[0_0_15px_rgba(34,211,238,0.3)];
  }
  .neo-border {
    @apply border border-cyan-500/30;
  }
  .neo-text-glow {
    text-shadow: 0 0 10px rgba(34, 211, 238, 0.5);
  }
}

@layer base {
  body {
    background: radial-gradient(ellipse at top, ${colorFn}(var(--secondary)) 0%, ${colorFn}(var(--background)) 60%);
    min-height: 100vh;
  }
}
`;
  }
  if (vibe === 'gradient') {
    return `
@layer components {
  .gradient-card {
    @apply bg-gradient-to-br from-white/80 to-white/60 backdrop-blur-sm border border-white/20 shadow-lg;
  }
  .gradient-accent {
    @apply bg-gradient-to-r from-primary to-accent;
  }
  .gradient-text {
    @apply bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent;
  }
}

@layer base {
  body {
    background: linear-gradient(135deg, ${colorFn}(var(--background)) 0%, ${colorFn}(var(--accent)) 100%);
    min-height: 100vh;
  }
}
`;
  }
  if (vibe === 'dark') {
    return `
@layer base {
  body {
    background: linear-gradient(180deg, ${colorFn}(var(--background)) 0%, ${colorFn}(var(--secondary)) 100%);
    min-height: 100vh;
  }
}
`;
  }
  return '';
}

function generateGlobalsCssV3(tokens: DesignTokens, vibe?: string): string {
  const toVar = (key: keyof DesignTokens) => hexToHsl(tokens[key] || '#000000');
  const sidebarBg = tokens.sidebar || tokens.card || tokens.background;
  const sidebarFg = tokens.sidebar_foreground || tokens.card_foreground || tokens.foreground;
  const radius = tokens.radius || getVibeRadius(vibe);

  return `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: ${toVar('background')};
    --foreground: ${toVar('foreground')};
    --card: ${toVar('card')};
    --card-foreground: ${toVar('card_foreground')};
    --popover: ${hexToHsl(tokens.popover || tokens.card || tokens.background)};
    --popover-foreground: ${hexToHsl(tokens.popover_foreground || tokens.card_foreground || tokens.foreground)};
    --primary: ${toVar('primary')};
    --primary-foreground: ${toVar('primary_foreground')};
    --secondary: ${toVar('secondary')};
    --secondary-foreground: ${toVar('secondary_foreground')};
    --muted: ${toVar('muted')};
    --muted-foreground: ${toVar('muted_foreground')};
    --accent: ${toVar('accent')};
    --accent-foreground: ${toVar('accent_foreground')};
    --destructive: ${toVar('destructive')};
    --destructive-foreground: ${toVar('destructive_foreground')};
    --border: ${toVar('border')};
    --input: ${toVar('input')};
    --ring: ${toVar('ring')};
    --chart-1: ${hexToHsl(tokens.chart_1 || tokens.primary)};
    --chart-2: ${hexToHsl(tokens.chart_2 || tokens.secondary)};
    --chart-3: ${hexToHsl(tokens.chart_3 || tokens.accent)};
    --chart-4: ${hexToHsl(tokens.chart_4 || tokens.accent)};
    --chart-5: ${hexToHsl(tokens.chart_5 || tokens.secondary)};
    --sidebar-background: ${hexToHsl(sidebarBg)};
    --sidebar-foreground: ${hexToHsl(sidebarFg)};
    --sidebar-primary: ${hexToHsl(tokens.sidebar_primary || tokens.primary)};
    --sidebar-primary-foreground: ${hexToHsl(tokens.sidebar_primary_foreground || tokens.primary_foreground)};
    --sidebar-accent: ${hexToHsl(tokens.sidebar_accent || tokens.accent)};
    --sidebar-accent-foreground: ${hexToHsl(tokens.sidebar_accent_foreground || tokens.accent_foreground)};
    --sidebar-border: ${hexToHsl(tokens.sidebar_border || tokens.border)};
    --sidebar-ring: ${hexToHsl(tokens.sidebar_ring || tokens.ring)};
    --radius: ${radius};
  }

  .dark {
    --background: ${toVar('background')};
    --foreground: ${toVar('foreground')};
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
${getVibeSpecificCss(vibe)}`;
}

function generateGlobalsCssV4(
  tokens: DesignTokens,
  vibe?: string,
  oklchVars?: Record<string, string>,
  darkTokens?: DesignTokens,
  darkOklchVars?: Record<string, string>,
): string {
  const useOklch = !!oklchVars && Object.keys(oklchVars).length > 0;
  const toVar = (key: keyof DesignTokens) => hexToHsl(tokens[key] || '#000000');
  const sidebarBg = tokens.sidebar || tokens.card || tokens.background;
  const sidebarFg = tokens.sidebar_foreground || tokens.card_foreground || tokens.foreground;
  const radius = tokens.radius || getVibeRadius(vibe);

  const varFn = useOklch ? 'oklch' : 'hsl';
  const getVal = (cssVarName: string, fallbackKey: keyof DesignTokens) => {
    if (useOklch && oklchVars[cssVarName]) return oklchVars[cssVarName];
    return toVar(fallbackKey);
  };
  const getSidebar = (cssVarName: string, fallbackHex: string) => {
    if (useOklch && oklchVars[cssVarName]) return oklchVars[cssVarName];
    return hexToHsl(fallbackHex);
  };

  const colorMappings = [
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
  const themeFn = useOklch ? 'oklch' : 'hsl';
  const themeLines = colorMappings.map(name =>
    `  --color-${name}: ${themeFn}(var(--${name}));`
  ).join('\n');

  const rootVarMap: Array<[string, keyof DesignTokens]> = [
    ['--background', 'background'], ['--foreground', 'foreground'],
    ['--card', 'card'], ['--card-foreground', 'card_foreground'],
    ['--primary', 'primary'], ['--primary-foreground', 'primary_foreground'],
    ['--secondary', 'secondary'], ['--secondary-foreground', 'secondary_foreground'],
    ['--muted', 'muted'], ['--muted-foreground', 'muted_foreground'],
    ['--accent', 'accent'], ['--accent-foreground', 'accent_foreground'],
    ['--destructive', 'destructive'], ['--destructive-foreground', 'destructive_foreground'],
    ['--border', 'border'], ['--input', 'input'], ['--ring', 'ring'],
  ];

  const rootLines = rootVarMap
    .map(([cssVar, key]) => `  ${cssVar}: ${getVal(cssVar, key)};`)
    .join('\n');

  const getPopover = (cssVar: string, fallbackKey: keyof DesignTokens, cardFallbackKey: keyof DesignTokens) => {
    if (useOklch && oklchVars[cssVar]) return oklchVars[cssVar];
    return hexToHsl(tokens[fallbackKey] || tokens[cardFallbackKey] || '#000000');
  };
  const getOptional = (cssVar: string, tokenKey: keyof DesignTokens, fallbackKey: keyof DesignTokens) => {
    if (useOklch && oklchVars[cssVar]) return oklchVars[cssVar];
    return hexToHsl(tokens[tokenKey] || tokens[fallbackKey] || '#000000');
  };

  const extendedRootLines = [
    `  --popover: ${getPopover('--popover', 'popover', 'card')};`,
    `  --popover-foreground: ${getPopover('--popover-foreground', 'popover_foreground', 'card_foreground')};`,
    `  --chart-1: ${getOptional('--chart-1', 'chart_1', 'primary')};`,
    `  --chart-2: ${getOptional('--chart-2', 'chart_2', 'secondary')};`,
    `  --chart-3: ${getOptional('--chart-3', 'chart_3', 'accent')};`,
    `  --chart-4: ${getOptional('--chart-4', 'chart_4', 'accent')};`,
    `  --chart-5: ${getOptional('--chart-5', 'chart_5', 'secondary')};`,
    `  --sidebar-background: ${getSidebar('--sidebar-background', sidebarBg)};`,
    `  --sidebar-foreground: ${getSidebar('--sidebar-foreground', sidebarFg)};`,
    `  --sidebar-primary: ${getOptional('--sidebar-primary', 'sidebar_primary', 'primary')};`,
    `  --sidebar-primary-foreground: ${getOptional('--sidebar-primary-foreground', 'sidebar_primary_foreground', 'primary_foreground')};`,
    `  --sidebar-accent: ${getOptional('--sidebar-accent', 'sidebar_accent', 'accent')};`,
    `  --sidebar-accent-foreground: ${getOptional('--sidebar-accent-foreground', 'sidebar_accent_foreground', 'accent_foreground')};`,
    `  --sidebar-border: ${getOptional('--sidebar-border', 'sidebar_border', 'border')};`,
    `  --sidebar-ring: ${getOptional('--sidebar-ring', 'sidebar_ring', 'ring')};`,
  ].join('\n');

  // Helper to build the extended block for dark mode
  const buildDarkExtended = (dt: DesignTokens, dOklch?: Record<string, string>) => {
    const dGet = (cssVar: string, tokenKey: keyof DesignTokens, fallbackKey: keyof DesignTokens) => {
      if (dOklch && dOklch[cssVar]) return dOklch[cssVar];
      return hexToHsl(dt[tokenKey] || dt[fallbackKey] || '#000000');
    };
    return [
      `    --popover: ${dGet('--popover', 'popover', 'card')};`,
      `    --popover-foreground: ${dGet('--popover-foreground', 'popover_foreground', 'card_foreground')};`,
      `    --chart-1: ${dGet('--chart-1', 'chart_1', 'primary')};`,
      `    --chart-2: ${dGet('--chart-2', 'chart_2', 'secondary')};`,
      `    --chart-3: ${dGet('--chart-3', 'chart_3', 'accent')};`,
      `    --chart-4: ${dGet('--chart-4', 'chart_4', 'accent')};`,
      `    --chart-5: ${dGet('--chart-5', 'chart_5', 'secondary')};`,
      `    --sidebar-background: ${dGet('--sidebar-background', 'sidebar', 'background')};`,
      `    --sidebar-foreground: ${dGet('--sidebar-foreground', 'sidebar_foreground', 'foreground')};`,
      `    --sidebar-primary: ${dGet('--sidebar-primary', 'sidebar_primary', 'primary')};`,
      `    --sidebar-primary-foreground: ${dGet('--sidebar-primary-foreground', 'sidebar_primary_foreground', 'primary_foreground')};`,
      `    --sidebar-accent: ${dGet('--sidebar-accent', 'sidebar_accent', 'accent')};`,
      `    --sidebar-accent-foreground: ${dGet('--sidebar-accent-foreground', 'sidebar_accent_foreground', 'accent_foreground')};`,
      `    --sidebar-border: ${dGet('--sidebar-border', 'sidebar_border', 'border')};`,
      `    --sidebar-ring: ${dGet('--sidebar-ring', 'sidebar_ring', 'ring')};`,
      `    --radius: ${dt.radius || radius};`,
    ].join('\n');
  };

  // Dark mode: use computed dark tokens or fall back to copying light values
  // Placed outside @layer base to match shadcn v2 pattern and ensure correct CSS cascade
  let darkBlock: string;
  if (darkTokens && darkOklchVars && useOklch) {
    const darkLines = rootVarMap
      .map(([cssVar, key]) => `  ${cssVar}: ${darkOklchVars[cssVar] || hexToHsl(darkTokens[key] || '#000000')};`)
      .join('\n');
    const darkExtended = buildDarkExtended(darkTokens, darkOklchVars).replace(/^    /gm, '  ');
    darkBlock = `.dark {\n${darkLines}\n${darkExtended}\n}`;
  } else if (darkTokens) {
    const darkToVar = (key: keyof DesignTokens) => hexToHsl(darkTokens[key] || '#000000');
    const darkLines = rootVarMap
      .map(([cssVar, key]) => `  ${cssVar}: ${darkToVar(key)};`)
      .join('\n');
    const darkExtended = buildDarkExtended(darkTokens).replace(/^    /gm, '  ');
    darkBlock = `.dark {\n${darkLines}\n${darkExtended}\n}`;
  } else {
    darkBlock = `.dark {\n  --background: ${toVar('background')};\n  --foreground: ${toVar('foreground')};\n}`;
  }

  const colorFn = useOklch ? 'oklch' : 'hsl';

  return `@import "tailwindcss";

@theme inline {
${themeLines}
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

:root {
${rootLines}
${extendedRootLines}
  --radius: ${radius};
}

${darkBlock}

@layer base {
  * {
    border-color: ${colorFn}(var(--border));
  }
  body {
    background-color: ${colorFn}(var(--background));
    color: ${colorFn}(var(--foreground));
  }
}
${getVibeSpecificCss(vibe, useOklch ? 'oklch' : 'hsl')}`;
}

export interface CssGenOptions {
  tokens: DesignTokens;
  vibe?: string;
  twVersion?: 3 | 4;
  oklchVars?: Record<string, string>;
  darkTokens?: DesignTokens;
  darkOklchVars?: Record<string, string>;
}

function generateGlobalsCss(opts: CssGenOptions): string {
  const { tokens, vibe, twVersion = 3, oklchVars, darkTokens, darkOklchVars } = opts;
  return twVersion === 4
    ? generateGlobalsCssV4(tokens, vibe, oklchVars, darkTokens, darkOklchVars)
    : generateGlobalsCssV3(tokens, vibe);
}

/**
 * Rewrite globals.css in a project with the complete token set.
 * Call this AFTER shadcn init to restore our OKLCH tokens, dark mode,
 * and vibe-specific CSS that shadcn init overwrites.
 */
export async function rewriteGlobalsCss(
  projectDir: string,
  opts: CssGenOptions,
): Promise<boolean> {
  const LOG = '[rewriteGlobalsCss]';
  const candidates = [
    path.join(projectDir, 'src', 'app', 'globals.css'),
    path.join(projectDir, 'app', 'globals.css'),
    path.join(projectDir, 'src', 'index.css'),
    path.join(projectDir, 'src', 'styles', 'globals.css'),
  ];
  const existing = candidates.find(p => fs.existsSync(p));
  if (!existing) {
    console.error(`${LOG} ❌ No globals.css found! Checked: ${candidates.join(', ')}`);
    return false;
  }
  try {
    console.log(`${LOG} Target file: ${existing}`);

    // Read the existing file to preserve shadcn v2 imports
    const existingContent = await fs.promises.readFile(existing, 'utf-8');
    console.log(`${LOG} Existing file: ${existingContent.length} chars, has shadcn/tailwind.css: ${existingContent.includes('shadcn/tailwind.css')}`);

    // Extract shadcn v2 imports and directives that must be preserved
    const preserveLines: string[] = [];
    for (const line of existingContent.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('@import') && !trimmed.includes('"tailwindcss"') && !trimmed.includes("'tailwindcss'")) {
        preserveLines.push(trimmed);
      }
      if (trimmed.startsWith('@custom-variant')) {
        preserveLines.push(trimmed);
      }
    }
    console.log(`${LOG} Preserved ${preserveLines.length} shadcn lines: ${preserveLines.join(' | ')}`);

    // Generate our clean CSS
    const baseCss = generateGlobalsCss(opts);

    // Inject the preserved shadcn imports after our @import "tailwindcss" line
    let finalCss: string;
    if (preserveLines.length > 0) {
      const insertBlock = preserveLines.join('\n');
      finalCss = baseCss.replace(
        '@import "tailwindcss";',
        `@import "tailwindcss";\n${insertBlock}`,
      );
    } else {
      finalCss = baseCss;
    }

    console.log(`${LOG} Final CSS length: ${finalCss.length} chars`);
    const primaryMatch = finalCss.match(/--primary:\s*([^;]+);/);
    console.log(`${LOG} First --primary value: ${primaryMatch?.[1]?.trim()}`);

    await fs.promises.writeFile(existing, finalCss, 'utf-8');

    // Verification: read back and confirm no stale :root blocks
    const readBack = await fs.promises.readFile(existing, 'utf-8');
    const rootCount = (readBack.match(/:root\s*\{/g) || []).length;
    console.log(`${LOG} ✅ Written: ${readBack.length} chars, :root blocks: ${rootCount} (expected 1)`);
    if (rootCount > 1) {
      console.warn(`${LOG} ⚠️ Multiple :root blocks detected — possible override conflict`);
    }
    return true;
  } catch (err) {
    console.error(`${LOG} ❌ Write failed:`, err);
    return false;
  }
}

function generateUtilsTs(): string {
  return `import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
`;
}

function generateLayoutTsx(appName: string, layout: string): string {
  const hasMetadata = true;

  const sidebarImport = layout === 'sidebar' ? `
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"` : '';

  const bodyContent = layout === 'sidebar'
    ? `
        <SidebarProvider>
          <AppSidebar />
          <main className="flex-1 overflow-auto">
            <div className="flex items-center gap-2 border-b px-4 py-2">
              <SidebarTrigger />
            </div>
            <div className="p-6">{children}</div>
          </main>
        </SidebarProvider>`
    : layout === 'centered'
      ? `
        <main className="min-h-screen flex flex-col items-center">
          <div className="w-full max-w-4xl px-4 py-8">{children}</div>
        </main>`
      : `
        <main className="min-h-screen">{children}</main>`;

  return `import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"${sidebarImport}

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "${appName}",
  description: "Built with Ordinex",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>${bodyContent}
      </body>
    </html>
  )
}
`;
}

const ICON_MAP: Record<string, string> = {
  dashboard: 'LayoutDashboard',
  home: 'Home',
  settings: 'Settings',
  todo: 'CheckSquare',
  todos: 'CheckSquare',
  task: 'ListTodo',
  tasks: 'ListTodo',
  calendar: 'Calendar',
  analytics: 'BarChart3',
  chart: 'BarChart3',
  team: 'Users',
  user: 'User',
  users: 'Users',
  project: 'FolderKanban',
  projects: 'FolderKanban',
  kanban: 'Columns3',
  board: 'Columns3',
  category: 'Tag',
  categories: 'Tag',
  tag: 'Tag',
  tags: 'Tag',
  template: 'FileText',
  templates: 'FileText',
  login: 'LogIn',
  register: 'UserPlus',
  profile: 'UserCircle',
  search: 'Search',
  filter: 'Filter',
  notification: 'Bell',
  message: 'MessageSquare',
  chat: 'MessageCircle',
  file: 'File',
  document: 'FileText',
  report: 'ClipboardList',
  mail: 'Mail',
  inbox: 'Inbox',
};

function pickIcon(pageName: string): string {
  const lower = pageName.toLowerCase().replace(/[^a-z]/g, '');
  for (const [key, icon] of Object.entries(ICON_MAP)) {
    if (lower.includes(key)) return icon;
  }
  return 'CircleDot';
}

function generateAppSidebarTsx(pages?: OverlayPageInfo[]): string {
  const navPages = pages && pages.length > 0
    ? pages.filter(p => !['/login', '/register', '/signup', '/signin'].includes(p.path))
    : [{ name: 'Home', path: '/' }, { name: 'Settings', path: '/settings' }];

  const iconNames = new Set(navPages.map(p => pickIcon(p.name)));
  const iconImport = Array.from(iconNames).sort().join(', ');

  const items = navPages.map(p =>
    `  { title: "${p.name}", url: "${p.path}", icon: ${pickIcon(p.name)} },`
  ).join('\n');

  return `"use client"

import { ${iconImport} } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const items = [
${items}
]

export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Application</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <a href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
`;
}

function generateLoadingTsx(): string {
  return `export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  )
}
`;
}

function generateErrorTsx(): string {
  return `"use client"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground text-sm">{error.message}</p>
      <button
        onClick={reset}
        className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90"
      >
        Try again
      </button>
    </div>
  )
}
`;
}

function generateHomePage(appName: string, pages?: OverlayPageInfo[]): string {
  const links = (pages || [])
    .filter(p => p.path !== '/')
    .slice(0, 8)
    .map(p => `          <a href="${p.path}" className="flex items-center gap-2 rounded-lg border p-4 hover:bg-accent transition-colors">\n            <span className="font-medium">${p.name}</span>\n          </a>`)
    .join('\n');

  return `import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export default function Home() {
  return (
    <div className="container mx-auto py-8 px-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">${appName}</CardTitle>
          <CardDescription>Welcome to your application. Select a page to get started.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
${links}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
`;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Apply the overlay shell to a staging directory.
 * Creates/overwrites layout, globals, utils, and component directories.
 */
export async function applyOverlay(
  stagingDir: string,
  config: OverlayConfig,
): Promise<OverlayResult> {
  const created: string[] = [];
  const modified: string[] = [];

  const isNextjs = config.recipeId === 'nextjs_app_router';

  // Detect if project uses src/ directory
  const hasSrc = fs.existsSync(path.join(stagingDir, 'src'));
  const base = hasSrc ? path.join(stagingDir, 'src') : stagingDir;
  const appDir = isNextjs
    ? (hasSrc ? path.join(base, 'app') : path.join(stagingDir, 'app'))
    : path.join(base, 'app');

  // Detect Tailwind version from the project
  const twVersion = config.tailwindVersion ?? detectTailwindVersion(stagingDir);
  console.log(`[OverlayApplier] Detected Tailwind CSS v${twVersion} for project at ${stagingDir}`);

  // Ensure directories
  const dirs = [
    appDir,
    path.join(base, 'lib'),
    path.join(base, 'components'),
    path.join(base, 'components', 'ui'),
  ];
  for (const dir of dirs) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  // Write globals.css
  const globalsPath = path.join(appDir, 'globals.css');
  const existed = fs.existsSync(globalsPath);
  const globalsCssContent = generateGlobalsCss({
    tokens: config.tokens,
    vibe: config.designVibe,
    twVersion,
    oklchVars: config.oklchVars,
    darkTokens: config.darkTokens,
    darkOklchVars: config.darkOklchVars,
  });
  console.log(`[OverlayApplier] Writing globals.css (${globalsCssContent.length} chars) to ${globalsPath}, twVersion=${twVersion}, oklchVars=${config.oklchVars ? Object.keys(config.oklchVars).length : 0} keys`);
  await fs.promises.writeFile(globalsPath, globalsCssContent, 'utf-8');
  (existed ? modified : created).push('app/globals.css');

  // Write utils
  const utilsPath = path.join(base, 'lib', 'utils.ts');
  const utilsExisted = fs.existsSync(utilsPath);
  await fs.promises.writeFile(utilsPath, generateUtilsTs(), 'utf-8');
  (utilsExisted ? modified : created).push('lib/utils.ts');

  if (isNextjs) {
    // Write layout.tsx
    const layoutPath = path.join(appDir, 'layout.tsx');
    const layoutExisted = fs.existsSync(layoutPath);
    await fs.promises.writeFile(layoutPath, generateLayoutTsx(config.appName, config.primaryLayout), 'utf-8');
    (layoutExisted ? modified : created).push('app/layout.tsx');

    // Write loading.tsx
    const loadingPath = path.join(appDir, 'loading.tsx');
    await fs.promises.writeFile(loadingPath, generateLoadingTsx(), 'utf-8');
    created.push('app/loading.tsx');

    // Write error.tsx
    const errorPath = path.join(appDir, 'error.tsx');
    await fs.promises.writeFile(errorPath, generateErrorTsx(), 'utf-8');
    created.push('app/error.tsx');

    // Write sidebar component if sidebar layout
    if (config.primaryLayout === 'sidebar') {
      const sidebarPath = path.join(base, 'components', 'app-sidebar.tsx');
      await fs.promises.writeFile(sidebarPath, generateAppSidebarTsx(config.pages), 'utf-8');
      created.push('components/app-sidebar.tsx');
    }

    // Write a proper page.tsx (replaces the default Next.js starter page)
    const pagePath = path.join(appDir, 'page.tsx');
    const dashboardRoute = config.pages?.find(p => p.path === '/dashboard');
    const firstRoute = config.pages?.[0];
    const redirectTarget = dashboardRoute?.path || firstRoute?.path || '/';

    let pageContent: string;
    if (redirectTarget !== '/') {
      pageContent = `import { redirect } from "next/navigation";\n\nexport default function Home() {\n  redirect("${redirectTarget}");\n}\n`;
    } else {
      pageContent = generateHomePage(config.appName, config.pages);
    }
    await fs.promises.writeFile(pagePath, pageContent, 'utf-8');
    modified.push('app/page.tsx');
  }

  return { filesCreated: created, filesModified: modified };
}

/**
 * Append design-vibe-specific CSS to an existing globals.css.
 * Call this AFTER shadcn init to re-apply vibe styles that shadcn may overwrite.
 */
export async function appendVibeStylesToGlobals(
  projectDir: string,
  vibe?: string,
): Promise<boolean> {
  if (!vibe) return false;

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

    if (content.includes('glass-card') || content.includes('neo-glow') || content.includes('gradient-card')) {
      return true;
    }

    const colorFn: 'hsl' | 'oklch' = content.includes('oklch(') ? 'oklch' : 'hsl';
    const vibeCssWithColorFn = getVibeSpecificCss(vibe, colorFn);
    if (!vibeCssWithColorFn.trim()) return false;

    content += '\n' + vibeCssWithColorFn;
    await fs.promises.writeFile(existing, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}
