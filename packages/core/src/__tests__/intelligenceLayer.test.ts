/**
 * Step 40.5: Intelligence Layer Tests (Enhanced)
 *
 * Tests for the Context Enricher, Codebase Context, Session Context,
 * EditorContext, expanded detection, out-of-scope fixes, clarification,
 * session persistence, and secret redaction.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  // Codebase context
  detectProjectType,
  detectTypeScript,
  detectPackageManager,
  detectAuth,
  detectDatabase,
  detectComponentLibrary,
  detectSrcStructure,
  detectMonorepo,
  gatherCodebaseContext,
  detectTestingFramework,
  detectCICD,
  detectContainerTool,
  detectCloudProvider,
} from '../intelligence/codebaseContext';

import {
  // Session context
  SessionContextManager,
  getSessionContextManager,
  resetSessionContextManager,
  COMPONENT_TYPES,
} from '../intelligence/sessionContext';

import {
  // Context enricher
  enrichUserInput,
  isOutOfScope,
  generateOutOfScopeResponse,
  shouldClarify,
  resolveReferences,
  buildEnrichedPrompt,
  redactSecrets,
} from '../intelligence/contextEnricher';

import type { EditorContext } from '../intelligence/contextEnricher';

// ============================================================================
// TEST SETUP
// ============================================================================

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ordinex-test-'));
}

function createMockProject(tempDir: string, config: {
  hasTypeScript?: boolean;
  projectType?: 'nextjs' | 'vite' | 'react' | 'express' | 'remix' | 'sveltekit' | 'gatsby' | 'fastify' | 'nestjs';
  packageManager?: 'npm' | 'pnpm' | 'yarn';
  hasAuth?: boolean;
  hasDatabase?: boolean;
  componentLibrary?: 'shadcn' | 'mui' | 'chakra' | 'none';
  testingFramework?: 'vitest' | 'jest' | 'playwright' | 'cypress';
}): void {
  // Create package.json
  const pkg: Record<string, unknown> = {
    name: 'test-project',
    version: '1.0.0',
    dependencies: {} as Record<string, string>,
    devDependencies: {} as Record<string, string>,
  };

  const deps = pkg.dependencies as Record<string, string>;
  const devDeps = pkg.devDependencies as Record<string, string>;

  // Project type specific files
  if (config.projectType === 'nextjs') {
    fs.writeFileSync(path.join(tempDir, 'next.config.js'), 'module.exports = {}');
    deps['next'] = '^14.0.0';
    deps['react'] = '^18.0.0';
  } else if (config.projectType === 'vite') {
    fs.writeFileSync(path.join(tempDir, 'vite.config.ts'), 'export default {}');
    devDeps['vite'] = '^5.0.0';
    deps['react'] = '^18.0.0';
  } else if (config.projectType === 'react') {
    deps['react'] = '^18.0.0';
    deps['react-dom'] = '^18.0.0';
  } else if (config.projectType === 'express') {
    deps['express'] = '^4.18.0';
  } else if (config.projectType === 'remix') {
    fs.writeFileSync(path.join(tempDir, 'remix.config.js'), 'module.exports = {}');
    deps['@remix-run/react'] = '^2.0.0';
  } else if (config.projectType === 'sveltekit') {
    fs.writeFileSync(path.join(tempDir, 'svelte.config.js'), 'export default {}');
    devDeps['@sveltejs/kit'] = '^1.0.0';
  } else if (config.projectType === 'gatsby') {
    fs.writeFileSync(path.join(tempDir, 'gatsby-config.js'), 'module.exports = {}');
    deps['gatsby'] = '^5.0.0';
  } else if (config.projectType === 'fastify') {
    deps['fastify'] = '^4.0.0';
  } else if (config.projectType === 'nestjs') {
    deps['@nestjs/core'] = '^10.0.0';
  }

  // TypeScript
  if (config.hasTypeScript) {
    fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), '{}');
    devDeps['typescript'] = '^5.0.0';
  }

  // Package manager lock files
  if (config.packageManager === 'pnpm') {
    fs.writeFileSync(path.join(tempDir, 'pnpm-lock.yaml'), '');
  } else if (config.packageManager === 'yarn') {
    fs.writeFileSync(path.join(tempDir, 'yarn.lock'), '');
  } else {
    fs.writeFileSync(path.join(tempDir, 'package-lock.json'), '');
  }

  // Auth
  if (config.hasAuth) {
    deps['next-auth'] = '^4.0.0';
  }

  // Database
  if (config.hasDatabase) {
    deps['@prisma/client'] = '^5.0.0';
    devDeps['prisma'] = '^5.0.0';
  }

  // Component library
  if (config.componentLibrary === 'shadcn') {
    fs.writeFileSync(path.join(tempDir, 'components.json'), '{}');
  } else if (config.componentLibrary === 'mui') {
    deps['@mui/material'] = '^5.0.0';
  } else if (config.componentLibrary === 'chakra') {
    deps['@chakra-ui/react'] = '^2.0.0';
  }

  // Testing framework
  if (config.testingFramework === 'vitest') {
    fs.writeFileSync(path.join(tempDir, 'vitest.config.ts'), 'export default {}');
    devDeps['vitest'] = '^1.0.0';
  } else if (config.testingFramework === 'jest') {
    fs.writeFileSync(path.join(tempDir, 'jest.config.js'), 'module.exports = {}');
    devDeps['jest'] = '^29.0.0';
  } else if (config.testingFramework === 'playwright') {
    fs.writeFileSync(path.join(tempDir, 'playwright.config.ts'), 'export default {}');
    devDeps['@playwright/test'] = '^1.40.0';
  } else if (config.testingFramework === 'cypress') {
    fs.writeFileSync(path.join(tempDir, 'cypress.config.ts'), 'export default {}');
    devDeps['cypress'] = '^13.0.0';
  }

  // Write package.json
  fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(pkg, null, 2));
}

function cleanup(tempDir: string): void {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

function makeEditorContext(overrides?: Partial<EditorContext>): EditorContext {
  return {
    diagnostics: [],
    workspaceDiagnostics: [],
    ...overrides,
  };
}

// ============================================================================
// CODEBASE CONTEXT TESTS
// ============================================================================

describe('CodebaseContext', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  describe('detectProjectType', () => {
    it('should detect Next.js project', () => {
      createMockProject(tempDir, { projectType: 'nextjs' });
      expect(detectProjectType(tempDir)).toBe('nextjs');
    });

    it('should detect Vite project', () => {
      createMockProject(tempDir, { projectType: 'vite' });
      expect(detectProjectType(tempDir)).toBe('vite');
    });

    it('should detect Express project', () => {
      createMockProject(tempDir, { projectType: 'express' });
      expect(detectProjectType(tempDir)).toBe('express');
    });

    it('should detect React (non-Next, non-Vite) project', () => {
      createMockProject(tempDir, { projectType: 'react' });
      expect(detectProjectType(tempDir)).toBe('react');
    });

    it('should return unknown for empty directory', () => {
      expect(detectProjectType(tempDir)).toBe('unknown');
    });

    // New project type tests
    it('should detect Remix project', () => {
      createMockProject(tempDir, { projectType: 'remix' });
      expect(detectProjectType(tempDir)).toBe('remix');
    });

    it('should detect SvelteKit project', () => {
      createMockProject(tempDir, { projectType: 'sveltekit' });
      expect(detectProjectType(tempDir)).toBe('sveltekit');
    });

    it('should detect Gatsby project', () => {
      createMockProject(tempDir, { projectType: 'gatsby' });
      expect(detectProjectType(tempDir)).toBe('gatsby');
    });

    it('should detect Fastify project', () => {
      createMockProject(tempDir, { projectType: 'fastify' });
      expect(detectProjectType(tempDir)).toBe('fastify');
    });
  });

  describe('detectTypeScript', () => {
    it('should detect TypeScript when tsconfig.json exists', () => {
      createMockProject(tempDir, { hasTypeScript: true });
      expect(detectTypeScript(tempDir)).toBe(true);
    });

    it('should return false when no tsconfig.json', () => {
      createMockProject(tempDir, { hasTypeScript: false });
      expect(detectTypeScript(tempDir)).toBe(false);
    });
  });

  describe('detectPackageManager', () => {
    it('should detect pnpm', () => {
      createMockProject(tempDir, { packageManager: 'pnpm' });
      expect(detectPackageManager(tempDir)).toBe('pnpm');
    });

    it('should detect yarn', () => {
      createMockProject(tempDir, { packageManager: 'yarn' });
      expect(detectPackageManager(tempDir)).toBe('yarn');
    });

    it('should default to npm', () => {
      createMockProject(tempDir, { packageManager: 'npm' });
      expect(detectPackageManager(tempDir)).toBe('npm');
    });
  });

  describe('detectAuth', () => {
    it('should detect auth when next-auth is present', () => {
      createMockProject(tempDir, { hasAuth: true });
      expect(detectAuth(tempDir)).toBe(true);
    });

    it('should return false when no auth packages', () => {
      createMockProject(tempDir, { hasAuth: false });
      expect(detectAuth(tempDir)).toBe(false);
    });
  });

  describe('detectDatabase', () => {
    it('should detect database when prisma is present', () => {
      createMockProject(tempDir, { hasDatabase: true });
      expect(detectDatabase(tempDir)).toBe(true);
    });

    it('should return false when no database packages', () => {
      createMockProject(tempDir, { hasDatabase: false });
      expect(detectDatabase(tempDir)).toBe(false);
    });
  });

  describe('detectComponentLibrary', () => {
    it('should detect shadcn', () => {
      createMockProject(tempDir, { componentLibrary: 'shadcn' });
      expect(detectComponentLibrary(tempDir)).toBe('shadcn');
    });

    it('should detect MUI', () => {
      createMockProject(tempDir, { componentLibrary: 'mui' });
      expect(detectComponentLibrary(tempDir)).toBe('mui');
    });

    it('should detect Chakra', () => {
      createMockProject(tempDir, { componentLibrary: 'chakra' });
      expect(detectComponentLibrary(tempDir)).toBe('chakra');
    });

    it('should return none when no component library', () => {
      createMockProject(tempDir, { componentLibrary: 'none' });
      expect(detectComponentLibrary(tempDir)).toBe('none');
    });
  });

  describe('detectMonorepo', () => {
    it('should detect pnpm workspaces', () => {
      createMockProject(tempDir, {});
      fs.writeFileSync(path.join(tempDir, 'pnpm-workspace.yaml'), '');
      const result = detectMonorepo(tempDir);
      expect(result.isMonorepo).toBe(true);
      expect(result.type).toBe('pnpm-workspaces');
    });

    it('should return false for non-monorepo', () => {
      createMockProject(tempDir, {});
      const result = detectMonorepo(tempDir);
      expect(result.isMonorepo).toBe(false);
    });
  });

  // New: Testing framework detection
  describe('detectTestingFramework', () => {
    it('should detect vitest', () => {
      createMockProject(tempDir, { testingFramework: 'vitest' });
      expect(detectTestingFramework(tempDir)).toBe('vitest');
    });

    it('should detect jest', () => {
      createMockProject(tempDir, { testingFramework: 'jest' });
      expect(detectTestingFramework(tempDir)).toBe('jest');
    });

    it('should detect playwright', () => {
      createMockProject(tempDir, { testingFramework: 'playwright' });
      expect(detectTestingFramework(tempDir)).toBe('playwright');
    });

    it('should detect cypress', () => {
      createMockProject(tempDir, { testingFramework: 'cypress' });
      expect(detectTestingFramework(tempDir)).toBe('cypress');
    });

    it('should return none when no testing framework', () => {
      createMockProject(tempDir, {});
      expect(detectTestingFramework(tempDir)).toBe('none');
    });
  });

  // New: CI/CD detection
  describe('detectCICD', () => {
    it('should detect github-actions', () => {
      createMockProject(tempDir, {});
      fs.mkdirSync(path.join(tempDir, '.github', 'workflows'), { recursive: true });
      expect(detectCICD(tempDir)).toBe('github-actions');
    });

    it('should detect gitlab-ci', () => {
      createMockProject(tempDir, {});
      fs.writeFileSync(path.join(tempDir, '.gitlab-ci.yml'), '');
      expect(detectCICD(tempDir)).toBe('gitlab-ci');
    });

    it('should return none when no CI/CD', () => {
      createMockProject(tempDir, {});
      expect(detectCICD(tempDir)).toBe('none');
    });
  });

  // New: Docker detection
  describe('detectContainerTool', () => {
    it('should detect docker', () => {
      createMockProject(tempDir, {});
      fs.writeFileSync(path.join(tempDir, 'Dockerfile'), '');
      expect(detectContainerTool(tempDir)).toBe('docker');
    });

    it('should detect docker-compose', () => {
      createMockProject(tempDir, {});
      fs.writeFileSync(path.join(tempDir, 'docker-compose.yml'), '');
      expect(detectContainerTool(tempDir)).toBe('docker-compose');
    });

    it('should return none when no container tool', () => {
      createMockProject(tempDir, {});
      expect(detectContainerTool(tempDir)).toBe('none');
    });
  });

  // New: Cloud provider detection
  describe('detectCloudProvider', () => {
    it('should detect vercel', () => {
      createMockProject(tempDir, {});
      fs.writeFileSync(path.join(tempDir, 'vercel.json'), '{}');
      expect(detectCloudProvider(tempDir)).toBe('vercel');
    });

    it('should detect netlify', () => {
      createMockProject(tempDir, {});
      fs.writeFileSync(path.join(tempDir, 'netlify.toml'), '');
      expect(detectCloudProvider(tempDir)).toBe('netlify');
    });

    it('should return none when no cloud provider', () => {
      createMockProject(tempDir, {});
      expect(detectCloudProvider(tempDir)).toBe('none');
    });
  });

  describe('gatherCodebaseContext', () => {
    it('should gather complete context', () => {
      createMockProject(tempDir, {
        projectType: 'nextjs',
        hasTypeScript: true,
        packageManager: 'pnpm',
        hasAuth: true,
        hasDatabase: true,
        componentLibrary: 'shadcn',
      });

      const context = gatherCodebaseContext(tempDir, ['src/page.tsx']);

      expect(context.projectType).toBe('nextjs');
      expect(context.hasTypeScript).toBe(true);
      expect(context.packageManager).toBe('pnpm');
      expect(context.hasAuth).toBe(true);
      expect(context.hasDatabase).toBe(true);
      expect(context.componentLibrary).toBe('shadcn');
      expect(context.openFiles).toContain('src/page.tsx');
      expect(context.workspaceRoot).toBe(tempDir);
      expect(context.gatheredAt).toBeDefined();
      // New fields have defaults
      expect(context.testingFramework).toBeDefined();
      expect(context.cicdProvider).toBeDefined();
      expect(context.containerTool).toBeDefined();
      expect(context.cloudProvider).toBeDefined();
    });

    it('should include new detection fields', () => {
      createMockProject(tempDir, { testingFramework: 'vitest' });
      fs.mkdirSync(path.join(tempDir, '.github', 'workflows'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'Dockerfile'), '');
      fs.writeFileSync(path.join(tempDir, 'vercel.json'), '{}');

      const context = gatherCodebaseContext(tempDir);
      expect(context.testingFramework).toBe('vitest');
      expect(context.cicdProvider).toBe('github-actions');
      expect(context.containerTool).toBe('docker');
      expect(context.cloudProvider).toBe('vercel');
    });
  });
});

// ============================================================================
// SESSION CONTEXT TESTS
// ============================================================================

describe('SessionContext', () => {
  let manager: SessionContextManager;

  beforeEach(() => {
    resetSessionContextManager();
    manager = getSessionContextManager();
  });

  describe('topic tracking', () => {
    it('should add and retrieve topics', () => {
      manager.addTopic('authentication', ['src/auth.ts']);
      manager.addTopic('button styling', ['src/Button.tsx']);

      const topics = manager.getRecentTopics(5);
      expect(topics).toHaveLength(2);
      expect(topics[0].topic).toBe('button styling');
      expect(topics[1].topic).toBe('authentication');
    });

    it('should check if topic was discussed', () => {
      manager.addTopic('authentication setup');
      expect(manager.wasTopicDiscussed('auth')).toBeDefined();
      expect(manager.wasTopicDiscussed('database')).toBeUndefined();
    });
  });

  describe('file tracking', () => {
    it('should track file mentions', () => {
      manager.addFileMention('src/Button.tsx', 'edited');
      manager.addFileMention('src/utils.ts', 'mentioned');

      const files = manager.getRecentFiles();
      expect(files).toHaveLength(2);
      expect(files[0].path).toBe('src/utils.ts');
    });

    it('should get last edited file', () => {
      manager.addFileMention('src/utils.ts', 'mentioned');
      manager.addFileMention('src/Button.tsx', 'edited');

      const lastEdited = manager.getLastEditedFile();
      expect(lastEdited?.path).toBe('src/Button.tsx');
    });
  });

  describe('error tracking', () => {
    it('should track errors', () => {
      manager.addError('Cannot find module', 'build', 'src/index.ts', 10);

      const lastError = manager.getLastError();
      expect(lastError).toBeDefined();
      expect(lastError?.message).toBe('Cannot find module');
      expect(lastError?.file).toBe('src/index.ts');
    });
  });

  describe('reference resolution', () => {
    it('should resolve component references with scoring', () => {
      manager.addFileMention('src/components/Button.tsx', 'edited');

      const resolved = manager.resolveComponentReference('the button');
      expect(resolved).toBeDefined();
      expect(resolved?.path).toBe('src/components/Button.tsx');
      expect(resolved?.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('should resolve error references', () => {
      manager.addError('Type error', 'lint', 'src/api.ts', 25);

      const resolved = manager.resolveErrorReference();
      expect(resolved?.message).toBe('Type error');
    });

    // New: expanded component types
    it('should resolve sidebar reference', () => {
      manager.addFileMention('src/components/Sidebar.tsx', 'edited');
      const resolved = manager.resolveComponentReference('the sidebar');
      expect(resolved?.path).toBe('src/components/Sidebar.tsx');
    });

    it('should resolve dropdown reference', () => {
      manager.addFileMention('src/components/Dropdown.tsx', 'mentioned');
      const resolved = manager.resolveComponentReference('the dropdown');
      expect(resolved?.path).toBe('src/components/Dropdown.tsx');
    });

    it('should resolve table reference', () => {
      manager.addFileMention('src/components/DataTable.tsx', 'edited');
      const resolved = manager.resolveComponentReference('the table');
      expect(resolved?.path).toBe('src/components/DataTable.tsx');
    });

    it('should resolve hook reference', () => {
      manager.addFileMention('src/hooks/useAuth.ts', 'edited');
      const resolved = manager.resolveComponentReference('the hook');
      expect(resolved?.path).toBe('src/hooks/useAuth.ts');
    });

    it('should prefer active editor file with high confidence', () => {
      manager.addFileMention('src/components/OldSidebar.tsx', 'mentioned');
      const resolved = manager.resolveComponentReference('the sidebar', 'src/components/Sidebar.tsx');
      expect(resolved?.path).toBe('src/components/Sidebar.tsx');
      expect(resolved?.confidence).toBe(0.9);
    });
  });

  // New: COMPONENT_TYPES constant
  describe('COMPONENT_TYPES', () => {
    it('should contain at least 40 types', () => {
      expect(COMPONENT_TYPES.length).toBeGreaterThanOrEqual(40);
    });

    it('should include original 8 types', () => {
      for (const t of ['button', 'form', 'modal', 'dialog', 'card', 'nav', 'header', 'footer']) {
        expect(COMPONENT_TYPES).toContain(t);
      }
    });

    it('should include new expanded types', () => {
      for (const t of ['sidebar', 'dropdown', 'table', 'hook', 'service', 'menu', 'tabs']) {
        expect(COMPONENT_TYPES).toContain(t);
      }
    });
  });

  // New: Session persistence
  describe('persistence', () => {
    let persistDir: string;

    beforeEach(() => {
      persistDir = createTempDir();
    });

    afterEach(() => {
      cleanup(persistDir);
    });

    it('should save and load session round-trip', () => {
      const filePath = path.join(persistDir, '.ordinex', 'session-context.json');
      manager.addTopic('auth setup');
      manager.addFileMention('src/auth.ts', 'edited');
      manager.addError('Type error', 'build', 'src/index.ts', 10);

      manager.saveToFile(filePath);

      const newManager = new SessionContextManager();
      const loaded = newManager.loadFromFile(filePath);
      expect(loaded).toBe(true);

      const ctx = newManager.getContext();
      expect(ctx.recentTopics).toHaveLength(1);
      expect(ctx.recentTopics[0].topic).toBe('auth setup');
      expect(ctx.recentFiles).toHaveLength(1);
      expect(ctx.recentErrors).toHaveLength(1);
    });

    it('should return false for non-existent file', () => {
      const newManager = new SessionContextManager();
      const loaded = newManager.loadFromFile(path.join(persistDir, 'does-not-exist.json'));
      expect(loaded).toBe(false);
    });

    it('should return false for corrupt file', () => {
      const filePath = path.join(persistDir, 'corrupt.json');
      fs.writeFileSync(filePath, 'not valid json {{{');
      const newManager = new SessionContextManager();
      expect(newManager.loadFromFile(filePath)).toBe(false);
    });

    it('should return false for valid JSON but missing required fields', () => {
      const filePath = path.join(persistDir, 'invalid.json');
      fs.writeFileSync(filePath, JSON.stringify({ foo: 'bar' }));
      const newManager = new SessionContextManager();
      expect(newManager.loadFromFile(filePath)).toBe(false);
    });
  });
});

// ============================================================================
// CONTEXT ENRICHER TESTS
// ============================================================================

describe('ContextEnricher', () => {
  describe('isOutOfScope', () => {
    it('should detect weather requests as out of scope', () => {
      expect(isOutOfScope("What's the weather today?")).toBe(true);
    });

    it('should detect joke requests as out of scope', () => {
      expect(isOutOfScope('Tell me a joke')).toBe(true);
    });

    it('should NOT mark code requests as out of scope', () => {
      expect(isOutOfScope('Fix the bug in my function')).toBe(false);
      expect(isOutOfScope('Create a new component')).toBe(false);
      expect(isOutOfScope('Help me debug this error')).toBe(false);
    });

    it('should NOT mark file references as out of scope', () => {
      expect(isOutOfScope('Update the index.ts file')).toBe(false);
    });

    // New: out-of-scope false positive fixes
    it('should NOT mark "joke about debugging" as out of scope', () => {
      expect(isOutOfScope('Tell me a joke about debugging')).toBe(false);
    });

    it('should NOT mark "calculate performance metrics" as out of scope', () => {
      expect(isOutOfScope('calculate performance metrics')).toBe(false);
    });

    it('should NOT mark "temperature monitoring for server" as out of scope', () => {
      expect(isOutOfScope('temperature monitoring for server')).toBe(false);
    });

    it('should still mark "weather in NYC" as out of scope', () => {
      expect(isOutOfScope('What is the weather in NYC?')).toBe(true);
    });

    it('should still mark "joke about chickens" as out of scope', () => {
      expect(isOutOfScope('Tell me a joke about chickens')).toBe(true);
    });

    it('should NOT mark out-of-scope when editor context is present', () => {
      expect(isOutOfScope('Tell me a joke', true, false)).toBe(false);
    });

    it('should NOT mark out-of-scope when recent coding topic exists', () => {
      expect(isOutOfScope('Tell me a joke', false, true)).toBe(false);
    });

    it('should NOT mark deploy/docker requests as out of scope', () => {
      expect(isOutOfScope('How do I deploy with docker?')).toBe(false);
    });

    it('should NOT mark git requests as out of scope', () => {
      expect(isOutOfScope('How do I rebase my branch?')).toBe(false);
    });
  });

  describe('generateOutOfScopeResponse', () => {
    it('should generate appropriate response for weather', () => {
      const response = generateOutOfScopeResponse("What's the weather?");
      expect(response).toContain('codebase');
      expect(response).toContain('weather');
    });

    it('should generate appropriate response for jokes', () => {
      const response = generateOutOfScopeResponse('Tell me a joke');
      expect(response).toContain('coding');
    });
  });

  describe('redactSecrets', () => {
    it('should redact Bearer tokens', () => {
      expect(redactSecrets('Authorization: Bearer abc123xyz')).toContain('[REDACTED]');
      expect(redactSecrets('Authorization: Bearer abc123xyz')).not.toContain('abc123xyz');
    });

    it('should redact sk- API keys', () => {
      expect(redactSecrets('key is sk-1234567890abcdef')).toContain('[REDACTED]');
    });

    it('should redact api_key patterns', () => {
      expect(redactSecrets('api_key = "secretvalue"')).toContain('[REDACTED]');
    });

    it('should leave normal text unchanged', () => {
      expect(redactSecrets('const x = 42;')).toBe('const x = 42;');
    });
  });

  describe('shouldClarify', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir();
      createMockProject(tempDir, { projectType: 'nextjs', hasTypeScript: true });
      resetSessionContextManager();
    });

    afterEach(() => {
      cleanup(tempDir);
    });

    it('should NOT need clarification when references are resolved', () => {
      const manager = getSessionContextManager();
      manager.addFileMention('src/Button.tsx', 'edited');

      const codebaseContext = gatherCodebaseContext(tempDir);
      const sessionContext = manager.getContext();
      const resolved = [{ original: 'the button', resolved: 'src/Button.tsx', source: 'session_history' as const, confidence: 0.9 }];

      const result = shouldClarify('Fix the button', codebaseContext, sessionContext, resolved);
      expect(result.needsClarification).toBe(false);
    });

    it('should need clarification for "the error" with no recent errors', () => {
      const codebaseContext = gatherCodebaseContext(tempDir);
      const sessionContext = getSessionContextManager().getContext();

      const result = shouldClarify('Fix the error', codebaseContext, sessionContext, []);
      expect(result.needsClarification).toBe(true);
    });

    // New: multi-match clarification
    it('should ask "which file?" when low-confidence multi-match', () => {
      const manager = getSessionContextManager();
      manager.addFileMention('src/Button.tsx', 'mentioned');
      manager.addFileMention('src/Form.tsx', 'mentioned');

      const codebaseContext = gatherCodebaseContext(tempDir, ['src/Button.tsx', 'src/Form.tsx']);
      const sessionContext = manager.getContext();
      const resolved = [{ original: 'the component', resolved: 'src/Button.tsx', source: 'open_files' as const, confidence: 0.5 }];

      const result = shouldClarify('Fix the component', codebaseContext, sessionContext, resolved);
      expect(result.needsClarification).toBe(true);
      expect(result.question?.toLowerCase()).toContain('which file');
      expect(result.options).toBeDefined();
      expect(result.options!.length).toBeGreaterThanOrEqual(2);
    });

    it('should suggest breaking into tasks for 3+ ambiguous references', () => {
      const codebaseContext = gatherCodebaseContext(tempDir);
      const sessionContext = getSessionContextManager().getContext();

      // Input that matches 3+ ambiguous patterns
      const result = shouldClarify('fix it and update the file and change the component and fix the error', codebaseContext, sessionContext, []);
      expect(result.needsClarification).toBe(true);
      expect(result.question).toContain('break');
    });
  });

  describe('resolveReferences', () => {
    beforeEach(() => {
      resetSessionContextManager();
    });

    it('should resolve "the button" to recent button file', () => {
      const manager = getSessionContextManager();
      manager.addFileMention('src/components/Button.tsx', 'edited');

      const tempDir = createTempDir();
      createMockProject(tempDir, {});
      const codebaseContext = gatherCodebaseContext(tempDir);

      const resolved = resolveReferences('Fix the button', manager, codebaseContext);

      expect(resolved.length).toBeGreaterThan(0);
      expect(resolved[0].resolved).toContain('Button');

      cleanup(tempDir);
    });

    it('should resolve "the error" to recent error', () => {
      const manager = getSessionContextManager();
      manager.addError('Cannot read property', 'runtime', 'src/api.ts', 42);

      const tempDir = createTempDir();
      createMockProject(tempDir, {});
      const codebaseContext = gatherCodebaseContext(tempDir);

      const resolved = resolveReferences('Fix the error', manager, codebaseContext);

      expect(resolved.length).toBeGreaterThan(0);
      expect(resolved[0].source).toBe('recent_error');

      cleanup(tempDir);
    });

    // New: EditorContext-aware resolution
    it('should prefer active editor file for "the file" reference', () => {
      const manager = getSessionContextManager();
      manager.addFileMention('src/old.ts', 'mentioned');

      const tempDir = createTempDir();
      createMockProject(tempDir, {});
      const codebaseContext = gatherCodebaseContext(tempDir);
      const editorCtx = makeEditorContext({ activeFile: 'src/current.ts' });

      const resolved = resolveReferences('Fix the file', manager, codebaseContext, editorCtx);
      expect(resolved.length).toBeGreaterThan(0);
      expect(resolved[0].resolved).toBe('src/current.ts');
      expect(resolved[0].source).toBe('active_editor');

      cleanup(tempDir);
    });

    it('should resolve "the sidebar" with editor context', () => {
      const manager = getSessionContextManager();
      const tempDir = createTempDir();
      createMockProject(tempDir, {});
      const codebaseContext = gatherCodebaseContext(tempDir);
      const editorCtx = makeEditorContext({ activeFile: 'src/components/Sidebar.tsx' });

      const resolved = resolveReferences('Fix the sidebar', manager, codebaseContext, editorCtx);
      expect(resolved.length).toBeGreaterThan(0);
      expect(resolved[0].resolved).toBe('src/components/Sidebar.tsx');

      cleanup(tempDir);
    });
  });

  describe('buildEnrichedPrompt', () => {
    it('should inject project context', () => {
      const tempDir = createTempDir();
      createMockProject(tempDir, {
        projectType: 'nextjs',
        hasTypeScript: true,
        componentLibrary: 'shadcn',
      });

      const context = gatherCodebaseContext(tempDir);
      const enriched = buildEnrichedPrompt('Add a new page', context, []);

      expect(enriched).toContain('nextjs');
      expect(enriched).toContain('TypeScript');
      expect(enriched).toContain('shadcn');
      expect(enriched).toContain('Add a new page');

      cleanup(tempDir);
    });

    it('should inject resolved references', () => {
      const tempDir = createTempDir();
      createMockProject(tempDir, {});

      const context = gatherCodebaseContext(tempDir);
      const references = [
        { original: 'the button', resolved: 'Button.tsx', source: 'session_history' as const, confidence: 0.9 },
      ];

      const enriched = buildEnrichedPrompt('Fix the button', context, references);

      expect(enriched).toContain('References');
      expect(enriched).toContain('Button.tsx');

      cleanup(tempDir);
    });

    // New: EditorContext in enriched prompt
    it('should inject active file from editor context', () => {
      const tempDir = createTempDir();
      createMockProject(tempDir, {});
      const context = gatherCodebaseContext(tempDir);
      const editorCtx = makeEditorContext({ activeFile: 'src/App.tsx' });

      const enriched = buildEnrichedPrompt('Fix this', context, [], editorCtx);
      expect(enriched).toContain('[Active file: src/App.tsx]');

      cleanup(tempDir);
    });

    it('should inject capped selection from editor context', () => {
      const tempDir = createTempDir();
      createMockProject(tempDir, {});
      const context = gatherCodebaseContext(tempDir);
      const longText = 'x'.repeat(500);
      const editorCtx = makeEditorContext({
        activeFile: 'src/App.tsx',
        selectedText: longText,
      });

      const enriched = buildEnrichedPrompt('Fix this', context, [], editorCtx, { maxSelectedTextChars: 100 });
      expect(enriched).toContain('[Selection:');
      expect(enriched).toContain('...');
      // Should not contain the full 500 chars
      expect(enriched.length).toBeLessThan(longText.length);

      cleanup(tempDir);
    });

    it('should inject diagnostics summary from editor context', () => {
      const tempDir = createTempDir();
      createMockProject(tempDir, {});
      const context = gatherCodebaseContext(tempDir);
      const editorCtx = makeEditorContext({
        activeFile: 'src/App.tsx',
        diagnostics: [
          { message: 'Type error', severity: 'error', file: 'src/App.tsx', line: 10 },
          { message: 'Unused var', severity: 'warning', file: 'src/App.tsx', line: 20 },
        ],
      });

      const enriched = buildEnrichedPrompt('Fix this', context, [], editorCtx);
      expect(enriched).toContain('1 error(s)');
      expect(enriched).toContain('1 warning(s)');
      expect(enriched).toContain('in active file');

      cleanup(tempDir);
    });

    it('should redact secrets in selection', () => {
      const tempDir = createTempDir();
      createMockProject(tempDir, {});
      const context = gatherCodebaseContext(tempDir);
      const editorCtx = makeEditorContext({
        activeFile: 'src/config.ts',
        selectedText: 'const key = "Bearer my-secret-token-123"',
      });

      const enriched = buildEnrichedPrompt('Fix this', context, [], editorCtx);
      expect(enriched).toContain('[REDACTED]');
      expect(enriched).not.toContain('my-secret-token-123');

      cleanup(tempDir);
    });
  });

  describe('enrichUserInput', () => {
    it('should return enriched input for code requests', async () => {
      const tempDir = createTempDir();
      createMockProject(tempDir, {
        projectType: 'nextjs',
        hasTypeScript: true,
      });

      const result = await enrichUserInput('Add authentication', {
        workspaceRoot: tempDir,
        openFiles: ['src/page.tsx'],
      });

      expect(result.originalInput).toBe('Add authentication');
      expect(result.outOfScope).toBe(false);
      expect(result.codebaseContext.projectType).toBe('nextjs');
      expect(result.enrichedPrompt).toContain('nextjs');
      expect(result.metadata.enrichmentDurationMs).toBeGreaterThanOrEqual(0);

      cleanup(tempDir);
    });

    it('should mark out-of-scope requests', async () => {
      const tempDir = createTempDir();
      createMockProject(tempDir, {});
      resetSessionContextManager();

      const result = await enrichUserInput("What's the weather?", {
        workspaceRoot: tempDir,
      });

      expect(result.outOfScope).toBe(true);
      expect(result.outOfScopeResponse).toBeDefined();

      cleanup(tempDir);
    });

    it('should track topic in session', async () => {
      resetSessionContextManager();

      const tempDir = createTempDir();
      createMockProject(tempDir, {});

      await enrichUserInput('Fix the login form', {
        workspaceRoot: tempDir,
      });

      const manager = getSessionContextManager();
      const topics = manager.getRecentTopics();

      expect(topics.length).toBeGreaterThan(0);
      expect(topics[0].topic).toContain('login');

      cleanup(tempDir);
    });

    // New: EditorContext integration in enrichUserInput
    it('should include editor context in enriched result', async () => {
      const tempDir = createTempDir();
      createMockProject(tempDir, { projectType: 'nextjs' });
      resetSessionContextManager();

      const editorCtx = makeEditorContext({
        activeFile: 'src/App.tsx',
        selectedText: 'const x = 1;',
      });

      const result = await enrichUserInput('Fix this', {
        workspaceRoot: tempDir,
        editorContext: editorCtx,
      });

      expect(result.editorContext).toBeDefined();
      expect(result.editorContext?.activeFile).toBe('src/App.tsx');
      expect(result.enrichedPrompt).toContain('[Active file: src/App.tsx]');

      cleanup(tempDir);
    });

    it('should auto-feed editor diagnostics into session errors', async () => {
      const tempDir = createTempDir();
      createMockProject(tempDir, {});
      resetSessionContextManager();

      const editorCtx = makeEditorContext({
        activeFile: 'src/App.tsx',
        diagnostics: [
          { message: 'Cannot find name "foo"', severity: 'error', file: 'src/App.tsx', line: 5 },
        ],
      });

      await enrichUserInput('Fix the errors', {
        workspaceRoot: tempDir,
        editorContext: editorCtx,
      });

      const mgr = getSessionContextManager();
      const errors = mgr.getRecentErrors();
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('Cannot find name');

      cleanup(tempDir);
    });
  });
});
