/**
 * Stage 6: Feature Generation
 *
 * Generates application features via LLM (single-pass or multi-pass),
 * verifies CSS, runs pre-quality-gate fixes, and ensures dependencies.
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { FeatureRequirements } from '../../types';
import type { PipelineStageContext, PipelineState } from '../pipelineTypes';
import type { AppBlueprint } from '../blueprintSchema';
import { emitScaffoldProgress, emitFeatureEvent } from '../pipelineEvents';
import { getDesignPackById } from '../designPacks';
import { extractFeatureRequirements, hasSpecificFeature } from '../featureExtractor';
import { generateFeatureCode, ProjectContext } from '../featureCodeGenerator';
import { planGeneration, executeMultiPassGeneration } from '../multiPassGenerator';
import { detectTailwindVersion } from '../overlayApplier';
import { initStagingWorkspace, stageFile, publishStaged, cleanupStaging } from '../stagingWorkspace';
import { commitStage } from '../gitCommitter';
import { runDeterministicAutofix } from '../deterministicAutofix';
import { detectPackageManager as detectPM } from '../postVerify';

const execAsync = promisify(exec);

const FEATURE_EXTRACTION_TIMEOUT_MS = 60_000;
const FEATURE_GENERATION_TIMEOUT_MS = 180_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

function collectProjectContext(projectPath: string): ProjectContext {
  const projectContext: ProjectContext = {};
  try {
    const tsConfigPath = path.join(projectPath, 'tsconfig.json');
    if (fs.existsSync(tsConfigPath)) {
      projectContext.tsconfigContent = fs.readFileSync(tsConfigPath, 'utf-8');
    }
  } catch { /* ignore */ }
  try {
    const pkgPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      projectContext.packageJsonContent = fs.readFileSync(pkgPath, 'utf-8');
    }
  } catch { /* ignore */ }
  try {
    projectContext.existingFiles = collectProjectFiles(projectPath, 2);
  } catch { /* ignore */ }
  return projectContext;
}

function collectProjectFiles(dir: string, maxDepth: number, currentDepth: number = 0): string[] {
  if (currentDepth >= maxDepth) return [];
  const files: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') {
        continue;
      }
      if (entry.isDirectory()) {
        files.push(entry.name + '/');
        const subFiles = collectProjectFiles(path.join(dir, entry.name), maxDepth, currentDepth + 1);
        files.push(...subFiles.map(f => entry.name + '/' + f));
      } else {
        files.push(entry.name);
      }
    }
  } catch { /* ignore */ }
  return files;
}

export async function runFeatureGenerationStage(
  { ctx, projectPath, logPrefix }: PipelineStageContext,
  state: PipelineState,
): Promise<void> {
  // Deterministic autofix before features
  await emitScaffoldProgress(ctx, 'verifying' as any, {
    message: 'Running deterministic autofixes...',
    stage: 'autofix',
  });
  try {
    await runDeterministicAutofix(projectPath);
    console.log(`${logPrefix} ✓ Deterministic autofix complete`);
  } catch (fixErr) {
    console.warn(`${logPrefix} Autofix warning (non-fatal):`, fixErr);
  }

  // Feature generation
  const shouldGenerateFeatures = ctx.userPrompt
    && ctx.llmClient
    && (hasSpecificFeature(ctx.userPrompt) || (ctx.blueprint && ctx.blueprint.pages.length > 0));

  if (!shouldGenerateFeatures) {
    const hasFeatureIntent = ctx.userPrompt ? hasSpecificFeature(ctx.userPrompt) : false;
    const blueprintPages = ctx.blueprint?.pages?.length || 0;
    const skipReason = !ctx.userPrompt ? 'No user prompt' :
      !ctx.llmClient ? 'No LLM client (API key missing or SDK failed)' :
      `Prompt feature check=${hasFeatureIntent}, blueprint pages=${blueprintPages} (both false)`;
    console.warn(`${logPrefix} Feature generation SKIPPED: ${skipReason}`);
    await emitScaffoldProgress(ctx, 'generating_features' as any, {
      message: `Feature generation skipped: ${skipReason}`,
      stage: 'features',
      status: 'skipped',
    });
    return;
  }

  await emitScaffoldProgress(ctx, 'generating_features' as any, {
    message: 'Generating application features via LLM...',
    stage: 'features',
  });
  await emitFeatureEvent(ctx, 'feature_extraction_started', {
    scaffold_id: ctx.scaffoldId,
    message: 'Extracting feature requirements...',
  });

  const staging = initStagingWorkspace(projectPath);
  console.log(`${logPrefix} Staging workspace initialized at ${staging.stagingPath}`);

  try {
    const requirements = await withTimeout(
      extractFeatureRequirements(ctx.userPrompt!, ctx.recipeId, ctx.llmClient!),
      FEATURE_EXTRACTION_TIMEOUT_MS,
      'Feature extraction',
    );

    if (requirements && requirements.app_type !== 'generic') {
      state.featureRequirements = requirements;

      await emitFeatureEvent(ctx, 'feature_extraction_completed', {
        scaffold_id: ctx.scaffoldId,
        features_count: requirements.features?.length || 0,
        app_type: requirements.app_type,
      });

      const projectContext = collectProjectContext(projectPath);
      const designPack = getDesignPackById(ctx.designPackId);
      const useMultiPass = ctx.blueprint && ctx.blueprint.pages.length >= 5;

      if (useMultiPass && ctx.blueprint) {
        await runMultiPass(ctx, state, projectPath, logPrefix, staging, designPack, projectContext);
      } else {
        await runSinglePass(ctx, state, projectPath, logPrefix, staging, designPack, projectContext, requirements);
      }
    }
  } catch (featureErr) {
    const errMsg = featureErr instanceof Error ? featureErr.message : String(featureErr);
    console.error(`${logPrefix} Feature generation FAILED: ${errMsg}`);
    await emitFeatureEvent(ctx, 'feature_code_error', {
      scaffold_id: ctx.scaffoldId,
      error: errMsg,
    });
  } finally {
    cleanupStaging(staging);
  }

  // Ensure blueprint routes exist (stub pages for any missing routes)
  if (ctx.blueprint && ctx.blueprint.pages.length > 0) {
    const { ensureBlueprintRoutesExist } = await import('../stages/helpers');
    const stubsCreated = ensureBlueprintRoutesExist(projectPath, ctx.blueprint, state.hasSrcDir, [], logPrefix);
    if (stubsCreated > 0) {
      console.log(`${logPrefix} Created ${stubsCreated} blueprint route pages as fallback`);
      state.featureCodeApplied = true;
      await emitFeatureEvent(ctx, 'feature_code_applied', {
        scaffold_id: ctx.scaffoldId,
        files_created: stubsCreated,
        files_count: stubsCreated,
        modified_files: 0,
      });
    }
  }

  if (state.featureCodeApplied) {
    await emitScaffoldProgress(ctx, 'generating_features' as any, {
      message: 'Features generated',
      stage: 'features',
      status: 'done',
    });
  } else {
    await emitScaffoldProgress(ctx, 'generating_features' as any, {
      message: 'Feature generation had issues — stub pages created',
      stage: 'features',
      status: 'error',
      detail: 'Partial generation',
    });
  }

  // Post-generation CSS verification
  await verifyCss(ctx, state, projectPath, logPrefix);

  // Pre-quality-gate fixes
  await runPreQualityGateFixes(projectPath, logPrefix);

  // Ensure dependencies installed
  await ensureDependencies(projectPath, logPrefix);
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

async function runMultiPass(
  ctx: any, state: PipelineState, projectPath: string, logPrefix: string,
  staging: any, designPack: any, _projectContext: ProjectContext,
): Promise<void> {
  const blueprint = ctx.blueprint as AppBlueprint;
  console.log(`${logPrefix} Using multi-pass generation (${blueprint.pages.length} pages) via staging`);
  const plan = planGeneration(blueprint);

  await emitFeatureEvent(ctx, 'feature_code_generating', {
    scaffold_id: ctx.scaffoldId,
    message: `Multi-pass generation: ${plan.passes.length} passes for ${blueprint.pages.length} pages`,
  });

  const multiResult = await executeMultiPassGeneration(
    plan, blueprint, staging.stagingPath, ctx.llmClient!,
    designPack || null, state.designTokens,
    (pass, passIdx, total) => {
      emitScaffoldProgress(ctx, 'generating_features' as any, {
        message: `Pass ${passIdx + 1}/${total}: ${pass}...`,
        stage: 'features',
        detail: `Generating ${pass}`,
      });
    },
    projectPath, state.hasSrcDir, state.tailwindVersion,
  );

  // Remove any protected files the LLM may have generated
  const protectedPaths = ['layout.tsx', 'globals.css', 'lib/utils.ts'];
  const isProtected = (filePath: string) => protectedPaths.some(p => filePath.endsWith(p));
  for (const pr of multiResult.passes) {
    const before = pr.files.length;
    pr.files = pr.files.filter(f => !isProtected(f.relativePath));
    if (pr.files.length < before) {
      console.log(`${logPrefix} [MULTI_PASS] Filtered ${before - pr.files.length} protected file(s) from ${pr.pass}`);
    }
    console.log(`${logPrefix} [MULTI_PASS] ${pr.pass}: ${pr.files.length} files`);
  }

  if (multiResult.totalFiles > 0) {
    const published = publishStaged(staging);
    console.log(`${logPrefix} Published ${published.length} staged files from multi-pass`);
    state.featureCodeApplied = true;

    for (const passResult of multiResult.passes) {
      if (passResult.files.length > 0) {
        try {
          const cr = await commitStage(projectPath, {
            stage: passResult.stage,
            extra: { pass: passResult.pass, files: String(passResult.files.length) },
          });
          if (cr.success) state.lastCommitHash = cr.commitHash;
        } catch { /* non-fatal */ }
      }
    }
  }
}

async function runSinglePass(
  ctx: any, state: PipelineState, projectPath: string, logPrefix: string,
  staging: any, designPack: any, projectContext: ProjectContext,
  requirements: FeatureRequirements,
): Promise<void> {
  await emitFeatureEvent(ctx, 'feature_code_generating', {
    scaffold_id: ctx.scaffoldId,
    message: 'Generating feature code via LLM...',
  });

  const generationResult = await withTimeout(
    generateFeatureCode(
      requirements, ctx.recipeId, designPack || null, ctx.llmClient!,
      undefined, projectContext, state.hasSrcDir,
    ),
    FEATURE_GENERATION_TIMEOUT_MS,
    'Single-pass feature generation',
  );

  if (!generationResult) return;

  const protectedPaths = ['layout.tsx', 'globals.css', 'lib/utils.ts'];
  const isProtected = (filePath: string) => protectedPaths.some(p => filePath.endsWith(p));

  let stagedCount = 0;
  for (const file of generationResult.files) {
    if (isProtected(file.path)) continue;
    stageFile(staging, file.path, file.content);
    stagedCount++;
  }
  if (generationResult.modified_files) {
    for (const mod of generationResult.modified_files) {
      if (isProtected(mod.path)) continue;
      stageFile(staging, mod.path, mod.content);
      stagedCount++;
    }
  }

  const published = publishStaged(staging);
  console.log(`${logPrefix} Published ${published.length} staged files`);
  state.featureCodeApplied = true;

  await emitFeatureEvent(ctx, 'feature_code_applied', {
    scaffold_id: ctx.scaffoldId,
    files_created: generationResult.files.length,
    files_count: generationResult.files.length,
    modified_files: generationResult.modified_files?.length || 0,
  });
  await emitScaffoldProgress(ctx, 'generating_features' as any, {
    message: `Generated ${generationResult.files.length} files`,
    stage: 'features',
    status: 'done',
    detail: `${generationResult.files.length} files created`,
  });

  try {
    const cr = await commitStage(projectPath, {
      stage: 'gen_pages',
      extra: {
        created: String(generationResult.files.length),
        modified: String(generationResult.modified_files?.length || 0),
        app_type: requirements.app_type,
      },
    });
    if (cr.success) state.lastCommitHash = cr.commitHash;
  } catch { /* non-fatal */ }
}

async function verifyCss(
  ctx: any, state: PipelineState, projectPath: string, logPrefix: string,
): Promise<void> {
  const twVersion = detectTailwindVersion(projectPath);
  try {
    const hasSrcDir = state.hasSrcDir;
    const cssCandidates = hasSrcDir
      ? [path.join(projectPath, 'src', 'app', 'globals.css')]
      : [path.join(projectPath, 'app', 'globals.css')];
    cssCandidates.push(
      path.join(projectPath, 'src', 'app', 'globals.css'),
      path.join(projectPath, 'app', 'globals.css'),
    );

    const globalsCssPath = cssCandidates.find(p => fs.existsSync(p));
    if (globalsCssPath) {
      const cssContent = fs.readFileSync(globalsCssPath, 'utf-8');
      const hasV4Import = cssContent.includes('@import "tailwindcss"') || cssContent.includes("@import 'tailwindcss'");
      const hasV3Directives = cssContent.includes('@tailwind base');
      const hasTailwindSetup = twVersion === 4 ? hasV4Import : hasV3Directives;
      const hasRootVars = cssContent.includes('--primary:');
      const hasOklch = cssContent.includes('oklch(');
      const hasMismatch = twVersion === 4 && hasV3Directives && !hasV4Import;

      // If CSS already has OKLCH tokens and proper setup, never overwrite — the
      // overlayApplier already generated correct OKLCH CSS.
      if (hasOklch && hasRootVars && hasTailwindSetup) {
        console.log(`${logPrefix} [CSS_VERIFY] globals.css has valid OKLCH tokens — skipping regeneration`);
        return;
      }

      if (!hasTailwindSetup || !hasRootVars || hasMismatch) {
        console.warn(`${logPrefix} [CSS_VERIFY] globals.css needs regeneration for Tailwind v${twVersion}`);

        // Use rewriteGlobalsCss from overlayApplier which properly handles
        // both OKLCH and HSL color spaces, dark mode, and vibe-specific CSS.
        const { rewriteGlobalsCss } = await import('../overlayApplier');
        const success = await rewriteGlobalsCss(projectPath, {
          tokens: state.designTokens,
          twVersion,
          darkTokens: state.darkTokens,
        });
        if (success) {
          console.log(`${logPrefix} [CSS_VERIFY] ✓ Regenerated globals.css via rewriteGlobalsCss (Tailwind v${twVersion})`);
        } else {
          // Fallback: use the simple builder if rewriteGlobalsCss fails
          const { hexToHsl } = await import('../tokenValidator');
          const { generateShadcnThemeBlock } = await import('../designPackToShadcn');
          const colorFn: 'hsl' | 'oklch' = 'hsl';
          const tokenVars = Object.entries(state.designTokens).map(([key, val]) =>
            `    --${key.replace(/_/g, '-')}: ${hexToHsl(val)};`
          );
          const regeneratedCss = twVersion === 4
            ? buildV4Css(tokenVars, generateShadcnThemeBlock, state.designTokens, hexToHsl, colorFn)
            : buildV3Css(tokenVars, state.designTokens, hexToHsl);
          fs.writeFileSync(globalsCssPath, regeneratedCss, 'utf-8');
          console.log(`${logPrefix} [CSS_VERIFY] ✓ Regenerated globals.css via fallback builder (Tailwind v${twVersion})`);
        }
      }
    } else {
      console.warn(`${logPrefix} [CSS_VERIFY] globals.css NOT FOUND — creating at default location`);
      const defaultCssPath = state.hasSrcDir
        ? path.join(projectPath, 'src', 'app', 'globals.css')
        : path.join(projectPath, 'app', 'globals.css');
      const dir = path.dirname(defaultCssPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const { rewriteGlobalsCss } = await import('../overlayApplier');
      const success = await rewriteGlobalsCss(projectPath, {
        tokens: state.designTokens,
        twVersion,
        darkTokens: state.darkTokens,
      });
      if (!success) {
        const { hexToHsl } = await import('../tokenValidator');
        const { generateShadcnThemeBlock } = await import('../designPackToShadcn');
        const tokenVars = Object.entries(state.designTokens).map(([key, val]) =>
          `    --${key.replace(/_/g, '-')}: ${hexToHsl(val)};`
        );
        const newCss = twVersion === 4
          ? buildV4Css(tokenVars, generateShadcnThemeBlock, state.designTokens, hexToHsl, 'hsl')
          : buildV3Css(tokenVars, state.designTokens, hexToHsl);
        fs.writeFileSync(defaultCssPath, newCss, 'utf-8');
      }
      console.log(`${logPrefix} [CSS_VERIFY] ✓ Created globals.css at ${defaultCssPath}`);
    }
  } catch (cssVerifyErr) {
    console.warn(`${logPrefix} [CSS_VERIFY] Non-fatal error:`, cssVerifyErr);
  }
}

function buildV4Css(
  tokenVars: string[],
  generateShadcnThemeBlock: (colorFn?: 'hsl' | 'oklch') => string,
  tokens: any,
  hexToHsl: (hex: string) => string,
  colorFn: 'hsl' | 'oklch' = 'hsl',
): string {
  return [
    '@import "tailwindcss";',
    '',
    generateShadcnThemeBlock(colorFn),
    '',
    ':root {',
    ...tokenVars,
    '  --radius: 0.5rem;',
    '}',
    '',
    '.dark {',
    `  --background: ${hexToHsl(tokens.background)};`,
    `  --foreground: ${hexToHsl(tokens.foreground)};`,
    '}',
    '',
    '@layer base {',
    '  * {',
    `    border-color: ${colorFn}(var(--border));`,
    '  }',
    '  body {',
    `    background-color: ${colorFn}(var(--background));`,
    `    color: ${colorFn}(var(--foreground));`,
    '  }',
    '}',
  ].join('\n');
}

function buildV3Css(tokenVars: string[], tokens: any, hexToHsl: (hex: string) => string): string {
  return [
    '@tailwind base;',
    '@tailwind components;',
    '@tailwind utilities;',
    '',
    '@layer base {',
    '  :root {',
    ...tokenVars,
    '    --radius: 0.5rem;',
    '  }',
    '',
    '  .dark {',
    `    --background: ${hexToHsl(tokens.background)};`,
    `    --foreground: ${hexToHsl(tokens.foreground)};`,
    '  }',
    '}',
    '',
    '@layer base {',
    '  * {',
    '    @apply border-border;',
    '  }',
    '  body {',
    '    @apply bg-background text-foreground;',
    '  }',
    '}',
  ].join('\n');
}

async function runPreQualityGateFixes(projectPath: string, logPrefix: string): Promise<void> {
  console.log(`${logPrefix} [PRE_QG] Running comprehensive pre-quality-gate fixes...`);
  try {
    const preQgAutofix = await runDeterministicAutofix(projectPath);
    if (preQgAutofix.applied) {
      console.log(`${logPrefix} [PRE_QG] ✓ Applied ${preQgAutofix.fixes.length} pre-quality-gate fixes`);
    } else {
      console.log(`${logPrefix} [PRE_QG] No fixes needed`);
    }
  } catch (preQgErr) {
    console.warn(`${logPrefix} [PRE_QG] Pre-QG autofix had issues (non-fatal):`, preQgErr);
  }
}

async function ensureDependencies(projectPath: string, logPrefix: string): Promise<void> {
  console.log(`${logPrefix} [DEPS] Running npm install to ensure all dependencies are resolved...`);
  try {
    const pm = detectPM(projectPath);
    const installCmd = pm === 'pnpm' ? 'pnpm install' : pm === 'yarn' ? 'yarn install' : 'npm install';
    await execAsync(installCmd, {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 120_000,
      env: { ...process.env, NODE_ENV: 'development' },
    });
    console.log(`${logPrefix} [DEPS] ✓ Dependencies installed successfully`);
  } catch (installErr: any) {
    console.warn(`${logPrefix} [DEPS] npm install had issues (non-fatal):`, installErr.message?.slice(0, 300));
  }
}
