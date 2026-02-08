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

const rootLayout = (appName: string) => `import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

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
      <body className={inter.className}>{children}</body>
    </html>
  )
}
`;

const homePage = (appName: string) => `export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-4">${appName}</h1>
      <p className="text-lg text-gray-600">
        Welcome to your new Next.js app!
      </p>
      <div className="mt-8 flex gap-4">
        <a
          href="https://nextjs.org/docs"
          className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800"
          target="_blank"
          rel="noopener noreferrer"
        >
          Documentation
        </a>
        <a
          href="https://nextjs.org/learn"
          className="px-4 py-2 border border-black rounded hover:bg-gray-100"
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

const globalsCss = `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --foreground-rgb: 0, 0, 0;
  --background-start-rgb: 214, 219, 220;
  --background-end-rgb: 255, 255, 255;
}

@media (prefers-color-scheme: dark) {
  :root {
    --foreground-rgb: 255, 255, 255;
    --background-start-rgb: 0, 0, 0;
    --background-end-rgb: 0, 0, 0;
  }
}

body {
  color: rgb(var(--foreground-rgb));
  background: linear-gradient(
    to bottom,
    transparent,
    rgb(var(--background-end-rgb))
  )
  rgb(var(--background-start-rgb));
}
`;

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
    const { app_name, target_directory, package_manager } = ctx;
    const pm = package_manager;
    
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
      { path: 'app/layout.tsx', kind: 'file', content: rootLayout(app_name), description: 'Root layout component' },
      { path: 'app/page.tsx', kind: 'file', content: homePage(app_name), description: 'Home page component' },
      { path: 'app/globals.css', kind: 'file', content: globalsCss, description: 'Global styles' },
      
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
        'Ready for Tailwind CSS (add via npx)',
      ],
    };
  },
};
