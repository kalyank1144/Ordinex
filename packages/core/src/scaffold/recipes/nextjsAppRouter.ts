/**
 * Next.js App Router Recipe (Step 35.3)
 *
 * Minimal runnable Next.js 14+ project with App Router.
 * TypeScript by default, ~15-20 files.
 */

import {
  RecipeBuilder,
  RecipeContext,
  RecipePlan,
  FilePlanItem,
  CommandPlanItem,
} from '../recipeTypes';
import { getInstallCommand, getRunCommand } from '../recipeSelector';
import { DesignPack, generateGlobalsCss, DESIGN_PACKS } from '../designPacks';

// ============================================================================
// TEMPLATES
// ============================================================================

const packageJson = (appName: string, pm: string) => `{
  "name": "${appName}",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "typescript": "^5.0.0",
    "eslint": "^8.0.0",
    "eslint-config-next": "^14.2.0"
  }
}
`;

const tsconfig = `{
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`;

const nextConfig = `/** @type {import('next').NextConfig} */
const nextConfig = {}

module.exports = nextConfig
`;

const nextEnvDts = `/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/basic-features/typescript for more information.
`;

const eslintrc = `{
  "extends": "next/core-web-vitals"
}
`;

const gitignore = `# Dependencies
node_modules
.pnp
.pnp.js

# Testing
coverage

# Next.js
.next/
out/

# Production
build

# Misc
.DS_Store
*.pem

# Debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Local env files
.env*.local

# Vercel
.vercel

# TypeScript
*.tsbuildinfo
next-env.d.ts
`;

/**
 * Generate root layout with design pack font
 */
const getRootLayout = (appName: string, pack?: DesignPack): string => {
  const fontName = pack?.tokens.fonts.heading || 'Inter';
  const fontImportName = fontName.replace(/\s+/g, '_');

  return `import type { Metadata } from 'next'
import { ${fontImportName} } from 'next/font/google'
import './globals.css'

const font = ${fontImportName}({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: '${appName}',
  description: 'Created with Ordinex',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={font.className}>{children}</body>
    </html>
  )
}
`;
};

/**
 * Generate home page using design token CSS variables
 */
const getHomePage = (appName: string): string => `export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-4" style={{ fontFamily: 'var(--font-heading)' }}>
        ${appName}
      </h1>
      <p className="text-lg" style={{ color: 'var(--muted-foreground)' }}>
        Welcome to your new Next.js app!
      </p>
      <div className="mt-8 flex gap-4">
        <a
          href="https://nextjs.org/docs"
          className="px-4 py-2 rounded transition-opacity hover:opacity-80"
          style={{
            backgroundColor: 'var(--primary)',
            color: 'var(--primary-foreground)',
            borderRadius: 'var(--radius)',
          }}
          target="_blank"
          rel="noopener noreferrer"
        >
          Documentation
        </a>
        <a
          href="https://nextjs.org/learn"
          className="px-4 py-2 border rounded transition-colors hover:opacity-80"
          style={{
            borderColor: 'var(--border)',
            borderRadius: 'var(--radius)',
          }}
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn
        </a>
      </div>
    </main>
  )
}
`;

/**
 * Generate globals.css with design pack tokens
 * Falls back to minimal default if no pack provided
 */
const getGlobalsCss = (pack?: DesignPack): string => {
  if (pack) {
    return generateGlobalsCss(pack);
  }
  // Fallback to minimal default
  return `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: #ffffff;
    --foreground: #0f172a;
    --primary: #0f172a;
    --primary-foreground: #ffffff;
    --secondary: #64748b;
    --secondary-foreground: #ffffff;
    --accent: #0ea5e9;
    --accent-foreground: #ffffff;
    --muted: #f1f5f9;
    --muted-foreground: #64748b;
    --border: #e2e8f0;
    --font-heading: "Inter", system-ui, sans-serif;
    --font-body: "Inter", system-ui, sans-serif;
    --radius: 0.5rem;
    --spacing-base: 1rem;
    --spacing-lg: 1.5rem;
    --shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
    font-family: var(--font-body);
  }
  h1, h2, h3, h4, h5, h6 {
    font-family: var(--font-heading);
  }
}
`;
};

const readme = (appName: string, pm: string) => `# ${appName}

A [Next.js](https://nextjs.org/) project created with Ordinex.

## Getting Started

First, install dependencies:

\`\`\`bash
${pm === 'npm' ? 'npm install' : pm === 'yarn' ? 'yarn' : 'pnpm install'}
\`\`\`

Then, run the development server:

\`\`\`bash
${pm === 'npm' ? 'npm run dev' : pm === 'yarn' ? 'yarn dev' : 'pnpm dev'}
\`\`\`

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying \`app/page.tsx\`. The page auto-updates as you edit the file.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new).
`;

// ============================================================================
// RECIPE BUILDER
// ============================================================================

export const nextjsAppRouterRecipe: RecipeBuilder = {
  id: 'nextjs_app_router',

  build(ctx: RecipeContext): RecipePlan {
    const { app_name, target_directory, package_manager, design_pack } = ctx;
    const pm = package_manager;

    // Use design pack if provided, otherwise fall back to default (minimal-light)
    const pack = design_pack || DESIGN_PACKS.find(p => p.id === 'minimal-light');

    const files: FilePlanItem[] = [
      // Root config files
      { path: 'package.json', kind: 'file', content: packageJson(app_name, pm), description: 'Project manifest' },
      { path: 'tsconfig.json', kind: 'file', content: tsconfig, description: 'TypeScript configuration' },
      { path: 'next.config.js', kind: 'file', content: nextConfig, description: 'Next.js configuration' },
      { path: 'next-env.d.ts', kind: 'file', content: nextEnvDts, description: 'Next.js TypeScript declarations' },
      { path: '.eslintrc.json', kind: 'file', content: eslintrc, description: 'ESLint configuration' },
      { path: '.gitignore', kind: 'file', content: gitignore, description: 'Git ignore rules' },
      { path: 'README.md', kind: 'file', content: readme(app_name, pm), description: 'Project documentation' },

      // App directory
      { path: 'app', kind: 'dir', description: 'Next.js App Router directory' },
      { path: 'app/layout.tsx', kind: 'file', content: getRootLayout(app_name, pack), description: 'Root layout component' },
      { path: 'app/page.tsx', kind: 'file', content: getHomePage(app_name), description: 'Home page component' },
      { path: 'app/globals.css', kind: 'file', content: getGlobalsCss(pack), description: 'Global styles with design tokens' },

      // Public directory
      { path: 'public', kind: 'dir', description: 'Static assets directory' },
    ];
    
    const commands: CommandPlanItem[] = [
      {
        label: 'Install dependencies',
        cmd: getInstallCommand(pm),
        cwd: target_directory,
        when: 'post_apply',
        description: 'Install npm packages',
      },
      {
        label: 'Run linter',
        cmd: `${getRunCommand(pm)} lint`,
        cwd: target_directory,
        when: 'post_apply',
        description: 'Check code quality',
      },
      {
        label: 'Build project',
        cmd: `${getRunCommand(pm)} build`,
        cwd: target_directory,
        when: 'post_apply',
        description: 'Create production build',
      },
      {
        label: 'Start dev server',
        cmd: `${getRunCommand(pm)} dev`,
        cwd: target_directory,
        when: 'user_explicit',
        description: 'Start development server on localhost:3000',
      },
    ];
    
    return {
      recipe_id: 'nextjs_app_router',
      package_manager: pm,
      files,
      commands,
      notes: [
        'Uses Next.js 14 with App Router',
        'TypeScript enabled by default',
        'ESLint configured with Next.js rules',
        pack ? `Design: ${pack.name} (${pack.vibe})` : 'Default minimal styling',
      ],
      design_pack_id: pack?.id,
      design_tokens_summary: pack ? `${pack.tokens.colors.primary} | ${pack.tokens.fonts.heading}` : undefined,
      preview_asset_id: pack?.preview.imageAssetId,
    };
  },
};
