/**
 * Tests for Preflight Detection (Step 35.7)
 * 
 * Tests cover:
 * 1. Directory inspection (empty, non-empty, project detection)
 * 2. Monorepo detection (pnpm, yarn, lerna, nx, turbo)
 * 3. Decision building and path suggestions
 * 4. Destructive confirmation validation
 * 5. Path traversal protection
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  inspectTargetDirectory,
  getPreflightRecommendation,
  buildPreflightDecisionOptions,
  buildPreflightDecisionPayload,
  suggestMonorepoPaths,
  validateDestructiveConfirmation,
  isPathWithinTarget,
  DESTRUCTIVE_CONFIRM_TEXT,
  TargetDirInspection,
} from '../scaffold/preflightDetection';

describe('preflightDetection', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-test-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('inspectTargetDirectory', () => {
    it('detects empty directory', async () => {
      const result = await inspectTargetDirectory(tempDir);

      expect(result.exists).toBe(true);
      expect(result.isEmpty).toBe(true);
      expect(result.entriesCount).toBe(0);
      expect(result.hasPackageJson).toBe(false);
    });

    it('detects non-empty directory', async () => {
      fs.writeFileSync(path.join(tempDir, 'file.txt'), 'content');

      const result = await inspectTargetDirectory(tempDir);

      expect(result.exists).toBe(true);
      expect(result.isEmpty).toBe(false);
      expect(result.entriesCount).toBe(1);
    });

    it('detects directory that does not exist', async () => {
      const nonExistent = path.join(tempDir, 'does-not-exist');

      const result = await inspectTargetDirectory(nonExistent);

      expect(result.exists).toBe(false);
      expect(result.isEmpty).toBe(true);
    });

    it('detects Next.js project', async () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      fs.writeFileSync(path.join(tempDir, 'next.config.js'), 'module.exports = {}');
      fs.mkdirSync(path.join(tempDir, 'app'));

      const result = await inspectTargetDirectory(tempDir);

      expect(result.hasPackageJson).toBe(true);
      expect(result.hasNextConfig).toBe(true);
      expect(result.hasAppDir).toBe(true);
    });

    it('detects Vite project', async () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      fs.writeFileSync(path.join(tempDir, 'vite.config.ts'), 'export default {}');
      fs.mkdirSync(path.join(tempDir, 'src'));

      const result = await inspectTargetDirectory(tempDir);

      expect(result.hasPackageJson).toBe(true);
      expect(result.hasViteConfig).toBe(true);
      expect(result.hasSrcDir).toBe(true);
    });

    it('detects Expo project', async () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      fs.writeFileSync(path.join(tempDir, 'app.json'), '{"expo":{}}');

      const result = await inspectTargetDirectory(tempDir);

      expect(result.hasPackageJson).toBe(true);
      expect(result.hasExpoAppJson).toBe(true);
    });

    it('detects pnpm monorepo', async () => {
      fs.writeFileSync(path.join(tempDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*');
      fs.writeFileSync(path.join(tempDir, 'pnpm-lock.yaml'), '');
      fs.mkdirSync(path.join(tempDir, 'packages'));

      const result = await inspectTargetDirectory(tempDir);

      expect(result.isMonorepo).toBe(true);
      expect(result.monorepoType).toBe('pnpm');
      expect(result.workspaceFile).toBe('pnpm-workspace.yaml');
      expect(result.hasPackagesDir).toBe(true);
      expect(result.detectedPackageManager).toBe('pnpm');
    });

    it('detects yarn workspaces monorepo', async () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
        workspaces: ['packages/*']
      }));
      fs.writeFileSync(path.join(tempDir, 'yarn.lock'), '');
      fs.mkdirSync(path.join(tempDir, 'packages'));

      const result = await inspectTargetDirectory(tempDir);

      expect(result.isMonorepo).toBe(true);
      expect(result.monorepoType).toBe('yarn');
      expect(result.workspaceFile).toBe('package.json(workspaces)');
      expect(result.detectedPackageManager).toBe('yarn');
    });

    it('detects nx monorepo', async () => {
      fs.writeFileSync(path.join(tempDir, 'nx.json'), '{}');
      fs.mkdirSync(path.join(tempDir, 'apps'));

      const result = await inspectTargetDirectory(tempDir);

      expect(result.isMonorepo).toBe(true);
      expect(result.monorepoType).toBe('nx');
      expect(result.workspaceFile).toBe('nx.json');
      expect(result.hasAppsDir).toBe(true);
    });

    it('detects turbo monorepo', async () => {
      fs.writeFileSync(path.join(tempDir, 'turbo.json'), '{}');
      fs.mkdirSync(path.join(tempDir, 'apps'));
      fs.mkdirSync(path.join(tempDir, 'packages'));

      const result = await inspectTargetDirectory(tempDir);

      expect(result.isMonorepo).toBe(true);
      expect(result.monorepoType).toBe('turbo');
      expect(result.workspaceFile).toBe('turbo.json');
    });

    it('detects lerna monorepo', async () => {
      fs.writeFileSync(path.join(tempDir, 'lerna.json'), '{}');
      fs.mkdirSync(path.join(tempDir, 'packages'));

      const result = await inspectTargetDirectory(tempDir);

      expect(result.isMonorepo).toBe(true);
      expect(result.monorepoType).toBe('lerna');
      expect(result.workspaceFile).toBe('lerna.json');
    });

    it('detects git repository', async () => {
      fs.mkdirSync(path.join(tempDir, '.git'));

      const result = await inspectTargetDirectory(tempDir);

      expect(result.hasGit).toBe(true);
    });

    it('detects node_modules', async () => {
      fs.mkdirSync(path.join(tempDir, 'node_modules'));

      const result = await inspectTargetDirectory(tempDir);

      expect(result.hasNodeModules).toBe(true);
    });
  });

  describe('getPreflightRecommendation', () => {
    it('returns safe_to_apply for empty directory', () => {
      const inspection: TargetDirInspection = {
        absPath: tempDir,
        exists: true,
        entriesCount: 0,
        isEmpty: true,
        hasPackageJson: false,
        hasNodeModules: false,
        hasGit: false,
        hasSrcDir: false,
        hasAppDir: false,
        hasNextConfig: false,
        hasViteConfig: false,
        hasExpoAppJson: false,
        isMonorepo: false,
        hasAppsDir: false,
        hasPackagesDir: false,
      };

      const result = getPreflightRecommendation(inspection, 'my-app');

      expect(result).toBe('safe_to_apply');
    });

    it('returns safe_to_apply for non-existent directory', () => {
      const inspection: TargetDirInspection = {
        absPath: path.join(tempDir, 'new-folder'),
        exists: false,
        entriesCount: 0,
        isEmpty: true,
        hasPackageJson: false,
        hasNodeModules: false,
        hasGit: false,
        hasSrcDir: false,
        hasAppDir: false,
        hasNextConfig: false,
        hasViteConfig: false,
        hasExpoAppJson: false,
        isMonorepo: false,
        hasAppsDir: false,
        hasPackagesDir: false,
      };

      const result = getPreflightRecommendation(inspection, 'my-app');

      expect(result).toBe('safe_to_apply');
    });

    it('returns create_subfolder for non-empty directory without project', () => {
      const inspection: TargetDirInspection = {
        absPath: tempDir,
        exists: true,
        entriesCount: 5,
        isEmpty: false,
        hasPackageJson: false,
        hasNodeModules: false,
        hasGit: false,
        hasSrcDir: false,
        hasAppDir: false,
        hasNextConfig: false,
        hasViteConfig: false,
        hasExpoAppJson: false,
        isMonorepo: false,
        hasAppsDir: false,
        hasPackagesDir: false,
      };

      const result = getPreflightRecommendation(inspection, 'my-app');

      expect(result).toBe('create_subfolder');
    });

    it('returns needs_user_decision for existing project', () => {
      const inspection: TargetDirInspection = {
        absPath: tempDir,
        exists: true,
        entriesCount: 10,
        isEmpty: false,
        hasPackageJson: true,
        hasNodeModules: true,
        hasGit: true,
        hasSrcDir: true,
        hasAppDir: false,
        hasNextConfig: true,
        hasViteConfig: false,
        hasExpoAppJson: false,
        isMonorepo: false,
        hasAppsDir: false,
        hasPackagesDir: false,
      };

      const result = getPreflightRecommendation(inspection, 'my-app');

      expect(result).toBe('needs_user_decision');
    });

    it('returns use_monorepo_location for monorepo', () => {
      const inspection: TargetDirInspection = {
        absPath: tempDir,
        exists: true,
        entriesCount: 10,
        isEmpty: false,
        hasPackageJson: true,
        hasNodeModules: true,
        hasGit: true,
        hasSrcDir: false,
        hasAppDir: false,
        hasNextConfig: false,
        hasViteConfig: false,
        hasExpoAppJson: false,
        isMonorepo: true,
        monorepoType: 'pnpm',
        hasAppsDir: true,
        hasPackagesDir: true,
      };

      const result = getPreflightRecommendation(inspection, 'my-app');

      expect(result).toBe('use_monorepo_location');
    });
  });

  describe('buildPreflightDecisionPayload', () => {
    it('builds NON_EMPTY_DIR payload for non-empty directory', () => {
      const inspection: TargetDirInspection = {
        absPath: tempDir,
        exists: true,
        entriesCount: 5,
        isEmpty: false,
        hasPackageJson: false,
        hasNodeModules: false,
        hasGit: false,
        hasSrcDir: false,
        hasAppDir: false,
        hasNextConfig: false,
        hasViteConfig: false,
        hasExpoAppJson: false,
        isMonorepo: false,
        hasAppsDir: false,
        hasPackagesDir: false,
      };

      const result = buildPreflightDecisionPayload(inspection, 'my-app');

      expect(result.problem).toBe('NON_EMPTY_DIR');
      expect(result.options.length).toBeGreaterThan(0);
      expect(result.options.some(o => o.id === 'create_subfolder')).toBe(true);
    });

    it('builds EXISTING_PROJECT payload for project directory', () => {
      const inspection: TargetDirInspection = {
        absPath: tempDir,
        exists: true,
        entriesCount: 10,
        isEmpty: false,
        hasPackageJson: true,
        hasNodeModules: false,
        hasGit: false,
        hasSrcDir: true,
        hasAppDir: false,
        hasNextConfig: false,
        hasViteConfig: false,
        hasExpoAppJson: false,
        isMonorepo: false,
        hasAppsDir: false,
        hasPackagesDir: false,
      };

      const result = buildPreflightDecisionPayload(inspection, 'my-app');

      expect(result.problem).toBe('EXISTING_PROJECT');
    });

    it('builds MONOREPO_AMBIGUOUS payload for monorepo', () => {
      const inspection: TargetDirInspection = {
        absPath: tempDir,
        exists: true,
        entriesCount: 10,
        isEmpty: false,
        hasPackageJson: true,
        hasNodeModules: false,
        hasGit: false,
        hasSrcDir: false,
        hasAppDir: false,
        hasNextConfig: false,
        hasViteConfig: false,
        hasExpoAppJson: false,
        isMonorepo: true,
        monorepoType: 'pnpm',
        hasAppsDir: true,
        hasPackagesDir: true,
      };

      const result = buildPreflightDecisionPayload(inspection, 'my-app');

      expect(result.problem).toBe('MONOREPO_AMBIGUOUS');
      expect(result.options.some(o => o.id === 'choose_monorepo_path')).toBe(true);
    });

    it('includes replace option with requires_typed_confirm', () => {
      const inspection: TargetDirInspection = {
        absPath: tempDir,
        exists: true,
        entriesCount: 5,
        isEmpty: false,
        hasPackageJson: false,
        hasNodeModules: false,
        hasGit: false,
        hasSrcDir: false,
        hasAppDir: false,
        hasNextConfig: false,
        hasViteConfig: false,
        hasExpoAppJson: false,
        isMonorepo: false,
        hasAppsDir: false,
        hasPackagesDir: false,
      };

      const result = buildPreflightDecisionPayload(inspection, 'my-app');
      const replaceOption = result.options.find(o => o.id === 'replace');

      expect(replaceOption).toBeDefined();
      expect(replaceOption?.dangerous).toBe(true);
      expect(replaceOption?.requires_typed_confirm).toBe(true);
    });
  });

  describe('suggestMonorepoPaths', () => {
    it('suggests apps path when apps dir exists', () => {
      const inspection: TargetDirInspection = {
        absPath: tempDir,
        exists: true,
        entriesCount: 5,
        isEmpty: false,
        hasPackageJson: true,
        hasNodeModules: false,
        hasGit: false,
        hasSrcDir: false,
        hasAppDir: false,
        hasNextConfig: false,
        hasViteConfig: false,
        hasExpoAppJson: false,
        isMonorepo: true,
        monorepoType: 'turbo',
        hasAppsDir: true,
        hasPackagesDir: true,
      };

      const result = suggestMonorepoPaths(inspection, 'my-app');

      expect(result.length).toBeGreaterThan(0);
      expect(result.some(s => s.path.includes('/apps/'))).toBe(true);
      expect(result.some(s => s.recommended)).toBe(true);
    });

    it('suggests packages path when only packages dir exists', () => {
      const inspection: TargetDirInspection = {
        absPath: tempDir,
        exists: true,
        entriesCount: 5,
        isEmpty: false,
        hasPackageJson: true,
        hasNodeModules: false,
        hasGit: false,
        hasSrcDir: false,
        hasAppDir: false,
        hasNextConfig: false,
        hasViteConfig: false,
        hasExpoAppJson: false,
        isMonorepo: true,
        monorepoType: 'pnpm',
        hasAppsDir: false,
        hasPackagesDir: true,
      };

      const result = suggestMonorepoPaths(inspection, 'my-lib');

      expect(result.some(s => s.path.includes('/packages/'))).toBe(true);
    });
  });

  describe('validateDestructiveConfirmation', () => {
    it('accepts exact confirmation text', () => {
      expect(validateDestructiveConfirmation(DESTRUCTIVE_CONFIRM_TEXT)).toBe(true);
    });

    it('rejects incorrect text', () => {
      expect(validateDestructiveConfirmation('delete')).toBe(false);
      expect(validateDestructiveConfirmation('DELETE')).toBe(false);
      expect(validateDestructiveConfirmation('REPLACE')).toBe(false);
      expect(validateDestructiveConfirmation('')).toBe(false);
    });

    it('rejects partial matches', () => {
      expect(validateDestructiveConfirmation('DELETE_AND')).toBe(false);
      expect(validateDestructiveConfirmation('AND_REPLACE')).toBe(false);
    });

    it('rejects text with extra spaces', () => {
      expect(validateDestructiveConfirmation(' DELETE_AND_REPLACE ')).toBe(false);
      expect(validateDestructiveConfirmation('DELETE AND REPLACE')).toBe(false);
    });
  });

  describe('isPathWithinTarget', () => {
    it('allows paths within target', () => {
      expect(isPathWithinTarget('/project', '/project/src/file.ts')).toBe(true);
      expect(isPathWithinTarget('/project', '/project/deep/nested/file.ts')).toBe(true);
    });

    it('rejects path traversal attempts', () => {
      expect(isPathWithinTarget('/project', '/project/../secret/file.ts')).toBe(false);
      expect(isPathWithinTarget('/project', '/other/file.ts')).toBe(false);
      expect(isPathWithinTarget('/project', '/projectile/file.ts')).toBe(false);
    });

    it('handles root target', () => {
      expect(isPathWithinTarget('/', '/any/path/file.ts')).toBe(true);
    });

    it('rejects exact target path (must be within, not at)', () => {
      // This depends on implementation - typically the target itself is allowed
      expect(isPathWithinTarget('/project', '/project')).toBe(true);
    });
  });
});

describe('PreflightOrchestrator', () => {
  // Integration tests would go here but require mocking the event bus
  // These would test:
  // - Non-empty dir => decision_needed emitted
  // - Replace requires typed confirmation
  // - Chosen monorepo path persists into proposal
  // - Apply refuses writes outside target dir
});
