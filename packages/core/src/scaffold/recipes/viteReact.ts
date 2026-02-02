/**
 * Vite + React Recipe (Step 35.3)
 *
 * Minimal runnable Vite + React SPA project.
 * TypeScript by default, ~10-15 files.
 */

import {
  RecipeBuilder,
  RecipeContext,
  RecipePlan,
  FilePlanItem,
  CommandPlanItem,
} from '../recipeTypes';
import { getInstallCommand, getRunCommand } from '../recipeSelector';
import { DesignPack, generateCssVariables, DESIGN_PACKS } from '../designPacks';

// ============================================================================
// TEMPLATES
// ============================================================================

const packageJson = (appName: string) => `{
  "name": "${appName}",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "@vitejs/plugin-react": "^4.2.0",
    "eslint": "^8.0.0",
    "eslint-plugin-react-hooks": "^4.6.0",
    "eslint-plugin-react-refresh": "^0.4.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0"
  }
}
`;

const tsconfig = `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
`;

const tsconfigNode = `{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
`;

const viteConfig = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
})
`;

const eslintrc = `{
  "root": true,
  "env": { "browser": true, "es2020": true },
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended"
  ],
  "ignorePatterns": ["dist", ".eslintrc.cjs"],
  "parser": "@typescript-eslint/parser",
  "plugins": ["react-refresh"],
  "rules": {
    "react-refresh/only-export-components": [
      "warn",
      { "allowConstantExport": true }
    ]
  }
}
`;

const gitignore = `# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

node_modules
dist
dist-ssr
*.local

# Editor directories and files
.vscode/*
!.vscode/extensions.json
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?
`;

const indexHtml = (appName: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${appName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

const mainTsx = `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`;

const appTsx = (appName: string) => `import { useState } from 'react'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <h1>${appName}</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  )
}

export default App
`;

/**
 * Generate App.css with design pack tokens
 */
const getAppCss = (pack?: DesignPack): string => {
  const colors = pack?.tokens.colors;

  return `#root {
  max-width: 1280px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
}

.card {
  padding: 2em;
}

.read-the-docs {
  color: var(--muted-foreground, #888);
}

button {
  border-radius: 8px;
  border: 1px solid var(--border, transparent);
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  background-color: var(--primary, #1a1a1a);
  color: var(--primary-foreground, #ffffff);
  cursor: pointer;
  transition: border-color 0.25s, opacity 0.25s;
}
button:hover {
  opacity: 0.9;
  border-color: var(--accent, #646cff);
}
button:focus,
button:focus-visible {
  outline: 4px auto -webkit-focus-ring-color;
}
`;
};

/**
 * Generate index.css with design pack tokens
 */
const getIndexCss = (pack?: DesignPack): string => {
  const tokens = pack?.tokens;
  const colors = tokens?.colors;
  const fonts = tokens?.fonts;

  // Use design pack values or sensible defaults
  const fontFamily = fonts?.body || 'Inter';
  const background = colors?.background || '#ffffff';
  const foreground = colors?.foreground || '#213547';
  const accent = colors?.accent || '#646cff';
  const accentHover = colors?.primary || '#535bf2';
  const muted = colors?.muted || '#f9f9f9';

  return `:root {
  /* Design Pack Tokens - Generated by Ordinex */
  --background: ${background};
  --foreground: ${foreground};
  --primary: ${colors?.primary || '#0f172a'};
  --primary-foreground: ${colors?.primary_foreground || '#ffffff'};
  --accent: ${accent};
  --accent-foreground: ${colors?.accent_foreground || '#ffffff'};
  --muted: ${muted};
  --muted-foreground: ${colors?.muted_foreground || '#64748b'};
  --border: ${colors?.border || '#e2e8f0'};

  font-family: "${fontFamily}", system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;

  color-scheme: light dark;
  color: var(--foreground);
  background-color: var(--background);

  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

a {
  font-weight: 500;
  color: var(--accent);
  text-decoration: inherit;
}
a:hover {
  color: var(--primary);
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
}

h1 {
  font-size: 3.2em;
  line-height: 1.1;
  font-family: "${fonts?.heading || fontFamily}", system-ui, sans-serif;
}
`;
};

const viteSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true" role="img" class="iconify iconify--logos" width="31.88" height="32" preserveAspectRatio="xMidYMid meet" viewBox="0 0 256 257"><defs><linearGradient id="IconifyId1813088fe1fbc01fb466" x1="-.828%" x2="57.636%" y1="7.652%" y2="78.411%"><stop offset="0%" stop-color="#41D1FF"></stop><stop offset="100%" stop-color="#BD34FE"></stop></linearGradient><linearGradient id="IconifyId1813088fe1fbc01fb467" x1="43.376%" x2="50.316%" y1="2.242%" y2="89.03%"><stop offset="0%" stop-color="#FFBD4F"></stop><stop offset="100%" stop-color="#FF980E"></stop></linearGradient></defs><path fill="url(#IconifyId1813088fe1fbc01fb466)" d="M255.153 37.938L134.897 252.976c-2.483 4.44-8.862 4.466-11.382.048L.875 37.958c-2.746-4.814 1.371-10.646 6.827-9.67l120.385 21.517a6.537 6.537 0 0 0 2.322-.004l117.867-21.483c5.438-.991 9.574 4.796 6.877 9.62Z"></path><path fill="url(#IconifyId1813088fe1fbc01fb467)" d="M185.432.063L96.44 17.501a3.268 3.268 0 0 0-2.634 3.014l-5.474 92.456a3.268 3.268 0 0 0 3.997 3.378l24.777-5.718c2.318-.535 4.413 1.507 3.936 3.838l-7.361 36.047c-.495 2.426 1.782 4.5 4.151 3.78l15.304-4.649c2.372-.72 4.652 1.36 4.15 3.788l-11.698 56.621c-.732 3.542 3.979 5.473 5.943 2.437l1.313-2.028l72.516-144.72c1.215-2.423-.88-5.186-3.54-4.672l-25.505 4.922c-2.396.462-4.435-1.77-3.759-4.114l16.646-57.705c.677-2.35-1.37-4.583-3.769-4.113Z"></path></svg>`;

const readme = (appName: string, pm: string) => `# ${appName}

A React + TypeScript project built with [Vite](https://vitejs.dev/).

## Getting Started

Install dependencies:

\`\`\`bash
${pm === 'npm' ? 'npm install' : pm === 'yarn' ? 'yarn' : 'pnpm install'}
\`\`\`

Start the development server:

\`\`\`bash
${pm === 'npm' ? 'npm run dev' : pm === 'yarn' ? 'yarn dev' : 'pnpm dev'}
\`\`\`

Open [http://localhost:5173](http://localhost:5173) to view it in the browser.

## Available Scripts

- \`${pm === 'npm' ? 'npm run' : pm === 'yarn' ? 'yarn' : 'pnpm'} dev\` - Start development server
- \`${pm === 'npm' ? 'npm run' : pm === 'yarn' ? 'yarn' : 'pnpm'} build\` - Build for production
- \`${pm === 'npm' ? 'npm run' : pm === 'yarn' ? 'yarn' : 'pnpm'} lint\` - Run ESLint
- \`${pm === 'npm' ? 'npm run' : pm === 'yarn' ? 'yarn' : 'pnpm'} preview\` - Preview production build

## Learn More

- [Vite Documentation](https://vitejs.dev/)
- [React Documentation](https://react.dev/)
`;

const viteEnvDts = `/// <reference types="vite/client" />
`;

// ============================================================================
// RECIPE BUILDER
// ============================================================================

export const viteReactRecipe: RecipeBuilder = {
  id: 'vite_react',

  build(ctx: RecipeContext): RecipePlan {
    const { app_name, target_directory, package_manager, design_pack } = ctx;
    const pm = package_manager;

    // Use design pack if provided, otherwise fall back to default (minimal-light)
    const pack = design_pack || DESIGN_PACKS.find(p => p.id === 'minimal-light');

    const files: FilePlanItem[] = [
      // Root config files
      { path: 'package.json', kind: 'file', content: packageJson(app_name), description: 'Project manifest' },
      { path: 'tsconfig.json', kind: 'file', content: tsconfig, description: 'TypeScript configuration' },
      { path: 'tsconfig.node.json', kind: 'file', content: tsconfigNode, description: 'TypeScript config for Node' },
      { path: 'vite.config.ts', kind: 'file', content: viteConfig, description: 'Vite configuration' },
      { path: '.eslintrc.cjs', kind: 'file', content: eslintrc, description: 'ESLint configuration' },
      { path: '.gitignore', kind: 'file', content: gitignore, description: 'Git ignore rules' },
      { path: 'README.md', kind: 'file', content: readme(app_name, pm), description: 'Project documentation' },
      { path: 'index.html', kind: 'file', content: indexHtml(app_name), description: 'HTML entry point' },

      // Source directory
      { path: 'src', kind: 'dir', description: 'Source code directory' },
      { path: 'src/main.tsx', kind: 'file', content: mainTsx, description: 'Application entry point' },
      { path: 'src/App.tsx', kind: 'file', content: appTsx(app_name), description: 'Root App component' },
      { path: 'src/App.css', kind: 'file', content: getAppCss(pack), description: 'App component styles with design tokens' },
      { path: 'src/index.css', kind: 'file', content: getIndexCss(pack), description: 'Global styles with design tokens' },
      { path: 'src/vite-env.d.ts', kind: 'file', content: viteEnvDts, description: 'Vite type declarations' },

      // Public directory
      { path: 'public', kind: 'dir', description: 'Static assets directory' },
      { path: 'public/vite.svg', kind: 'file', content: viteSvg, description: 'Vite logo' },
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
        description: 'Start development server on localhost:5173',
      },
    ];
    
    return {
      recipe_id: 'vite_react',
      package_manager: pm,
      files,
      commands,
      notes: [
        'Uses Vite 5 with React 18',
        'TypeScript enabled by default',
        'ESLint configured with React hooks rules',
        pack ? `Design: ${pack.name} (${pack.vibe})` : 'Default minimal styling',
      ],
      design_pack_id: pack?.id,
      design_tokens_summary: pack ? `${pack.tokens.colors.primary} | ${pack.tokens.fonts.heading}` : undefined,
      preview_asset_id: pack?.preview.imageAssetId,
    };
  },
};
