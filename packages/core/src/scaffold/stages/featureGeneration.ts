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

const FEATURE_EXTRACTION_TIMEOUT_MS = 120_000; // 2 min — lightweight extraction call (small response)

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
  console.log(`[ORDINEX_DEBUG] ========== FEATURE GENERATION STAGE START ==========`);
  console.log(`[ORDINEX_DEBUG] ctx.userPrompt: "${ctx.userPrompt}"`);
  console.log(`[ORDINEX_DEBUG] ctx.llmClient present: ${!!ctx.llmClient}`);
  console.log(`[ORDINEX_DEBUG] ctx.blueprint: ${ctx.blueprint ? `${ctx.blueprint.pages.length} pages` : 'null'}`);
  console.log(`[ORDINEX_DEBUG] ctx.recipeId: ${ctx.recipeId}`);
  console.log(`[ORDINEX_DEBUG] ctx.scaffoldId: ${ctx.scaffoldId}`);
  console.log(`[ORDINEX_DEBUG] ctx.designPackId: ${ctx.designPackId}`);
  console.log(`[ORDINEX_DEBUG] ctx.modelId: ${ctx.modelId}`);
  console.log(`[ORDINEX_DEBUG] state.hasSrcDir: ${state.hasSrcDir}`);
  console.log(`[ORDINEX_DEBUG] state.featureCodeApplied: ${state.featureCodeApplied}`);
  console.log(`[ORDINEX_DEBUG] state.designTokens.primary: ${state.designTokens.primary}`);
  console.log(`[ORDINEX_DEBUG] state.designTokens.background: ${state.designTokens.background}`);
  console.log(`[ORDINEX_DEBUG] state.designTokens.accent: ${state.designTokens.accent}`);

  // Check CSS state BEFORE feature generation
  try {
    const cssPrePaths = [
      path.join(projectPath, 'src', 'app', 'globals.css'),
      path.join(projectPath, 'app', 'globals.css'),
    ];
    for (const cp of cssPrePaths) {
      if (fs.existsSync(cp)) {
        const preCss = fs.readFileSync(cp, 'utf-8');
        console.log(`[ORDINEX_DEBUG] [PRE-FEATURE] globals.css at ${cp}: ${preCss.length} chars`);
        console.log(`[ORDINEX_DEBUG] [PRE-FEATURE]   has oklch: ${preCss.includes('oklch(')}`);
        console.log(`[ORDINEX_DEBUG] [PRE-FEATURE]   has --primary: ${preCss.includes('--primary')}`);
        console.log(`[ORDINEX_DEBUG] [PRE-FEATURE]   has :root: ${preCss.includes(':root')}`);
        break;
      }
    }
  } catch { /* non-fatal */ }

  const hasFeatureIntent = ctx.userPrompt ? hasSpecificFeature(ctx.userPrompt) : false;
  const blueprintPages = ctx.blueprint?.pages?.length || 0;
  console.log(`[ORDINEX_DEBUG] hasSpecificFeature("${ctx.userPrompt}"): ${hasFeatureIntent}`);
  console.log(`[ORDINEX_DEBUG] blueprint pages: ${blueprintPages}`);

  const shouldGenerateFeatures = ctx.userPrompt
    && ctx.llmClient
    && (hasFeatureIntent || blueprintPages > 0);

  console.log(`[ORDINEX_DEBUG] shouldGenerateFeatures: ${!!shouldGenerateFeatures}`);

  if (!shouldGenerateFeatures) {
    const skipReason = !ctx.userPrompt ? 'No user prompt' :
      !ctx.llmClient ? 'No LLM client (API key missing or SDK failed)' :
      `Prompt feature check=${hasFeatureIntent}, blueprint pages=${blueprintPages} (both false)`;
    console.warn(`[ORDINEX_DEBUG] ❌ Feature generation SKIPPED: ${skipReason}`);
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
    console.log(`[ORDINEX_DEBUG] Calling extractFeatureRequirements (timeout: ${FEATURE_EXTRACTION_TIMEOUT_MS}ms, model: ${ctx.modelId || 'not set'})...`);
    const requirements = await withTimeout(
      extractFeatureRequirements(ctx.userPrompt!, ctx.recipeId, ctx.llmClient!, ctx.modelId),
      FEATURE_EXTRACTION_TIMEOUT_MS,
      'Feature extraction',
    );

    console.log(`[ORDINEX_DEBUG] extractFeatureRequirements returned: ${requirements ? 'object' : 'null'}`);
    if (requirements) {
      console.log(`[ORDINEX_DEBUG]   app_type: "${requirements.app_type}"`);
      console.log(`[ORDINEX_DEBUG]   features: ${requirements.features?.length}`);
      console.log(`[ORDINEX_DEBUG]   pages: ${requirements.pages?.length}`);
    }

    const hasContent = requirements
      && ((requirements.features?.length || 0) > 0 || (requirements.pages?.length || 0) > 0);

    if (hasContent) {
      console.log(`[ORDINEX_DEBUG] ✅ Requirements have content (features or pages) — proceeding to code generation`);
      state.featureRequirements = requirements!;

      await emitFeatureEvent(ctx, 'feature_extraction_completed', {
        scaffold_id: ctx.scaffoldId,
        features_count: requirements.features?.length || 0,
        app_type: requirements.app_type,
      });

      const projectContext = collectProjectContext(projectPath);
      const designPack = getDesignPackById(ctx.designPackId);
      const useMultiPass = ctx.blueprint && ctx.blueprint.pages.length >= 5;

      console.log(`[ORDINEX_DEBUG] Generation path: ${useMultiPass ? 'MULTI-PASS' : 'SINGLE-PASS'}`);
      console.log(`[ORDINEX_DEBUG]   blueprint pages: ${ctx.blueprint?.pages?.length || 0} (threshold for multi-pass: 5)`);
      console.log(`[ORDINEX_DEBUG]   designPack: ${designPack ? designPack.id : 'null'}`);
      console.log(`[ORDINEX_DEBUG]   projectContext.existingFiles: ${projectContext.existingFiles?.length || 0}`);

      if (useMultiPass && ctx.blueprint) {
        console.log(`[ORDINEX_DEBUG] Starting MULTI-PASS generation...`);
        await runMultiPass(ctx, state, projectPath, logPrefix, staging, designPack, projectContext);
      } else {
        console.log(`[ORDINEX_DEBUG] Starting SINGLE-PASS generation...`);
        await runSinglePass(ctx, state, projectPath, logPrefix, staging, designPack, projectContext, requirements);
      }

      console.log(`[ORDINEX_DEBUG] Generation pass complete. state.featureCodeApplied: ${state.featureCodeApplied}`);
    } else {
      console.warn(`[ORDINEX_DEBUG] ⚠️ Skipping code generation: requirements=${requirements ? 'present' : 'null'}, features=${requirements?.features?.length || 0}, pages=${requirements?.pages?.length || 0}`);
      console.warn(`[ORDINEX_DEBUG] No features or pages to generate`);
    }
  } catch (featureErr) {
    const errMsg = featureErr instanceof Error ? featureErr.message : String(featureErr);
    console.error(`[ORDINEX_DEBUG] ❌ Feature generation stage CATCH block`);
    console.error(`[ORDINEX_DEBUG] Error type: ${featureErr instanceof Error ? featureErr.constructor.name : typeof featureErr}`);
    console.error(`[ORDINEX_DEBUG] Error message: ${errMsg}`);
    console.error(`[ORDINEX_DEBUG] Error stack: ${featureErr instanceof Error ? (featureErr as Error).stack : 'N/A'}`);
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

  console.log(`[ORDINEX_DEBUG] Final status check: featureCodeApplied=${state.featureCodeApplied}`);
  if (state.featureCodeApplied) {
    console.log(`[ORDINEX_DEBUG] ✅ Emitting: Features generated (success)`);
    await emitScaffoldProgress(ctx, 'generating_features' as any, {
      message: 'Features generated',
      stage: 'features',
      status: 'done',
    });
  } else {
    console.warn(`[ORDINEX_DEBUG] ❌ Emitting: Partial generation (featureCodeApplied is still false)`);
    console.warn(`[ORDINEX_DEBUG] This means code generation either: returned null, threw an error, or produced 0 files`);
    await emitScaffoldProgress(ctx, 'generating_features' as any, {
      message: 'Feature generation had issues — stub pages created',
      stage: 'features',
      status: 'error',
      detail: 'Partial generation',
    });
  }
  console.log(`[ORDINEX_DEBUG] ========== FEATURE GENERATION STAGE END ==========`);

  // Post-generation CSS verification
  await verifyCss(ctx, state, projectPath, logPrefix);

  // Final CSS state dump
  try {
    const cssCheckPaths = [
      path.join(projectPath, 'src', 'app', 'globals.css'),
      path.join(projectPath, 'app', 'globals.css'),
    ];
    for (const cp of cssCheckPaths) {
      if (fs.existsSync(cp)) {
        const finalCss = fs.readFileSync(cp, 'utf-8');
        console.log(`[ORDINEX_DEBUG] ========== FINAL CSS STATE ==========`);
        console.log(`[ORDINEX_DEBUG] globals.css at: ${cp}`);
        console.log(`[ORDINEX_DEBUG] Length: ${finalCss.length} chars`);
        console.log(`[ORDINEX_DEBUG] Has oklch(): ${finalCss.includes('oklch(')}`);
        console.log(`[ORDINEX_DEBUG] Has --primary: ${finalCss.includes('--primary')}`);
        console.log(`[ORDINEX_DEBUG] Has --background: ${finalCss.includes('--background')}`);
        console.log(`[ORDINEX_DEBUG] Has --accent: ${finalCss.includes('--accent')}`);
        console.log(`[ORDINEX_DEBUG] Has :root: ${finalCss.includes(':root')}`);
        console.log(`[ORDINEX_DEBUG] Has .dark: ${finalCss.includes('.dark')}`);
        console.log(`[ORDINEX_DEBUG] Has @import tailwindcss: ${finalCss.includes('@import "tailwindcss"')}`);
        console.log(`[ORDINEX_DEBUG] Has @tailwind base: ${finalCss.includes('@tailwind base')}`);
        console.log(`[ORDINEX_DEBUG] Has @theme inline: ${finalCss.includes('@theme inline')}`);
        console.log(`[ORDINEX_DEBUG] First 1000 chars:\n${finalCss.substring(0, 1000)}`);
        console.log(`[ORDINEX_DEBUG] ========== END FINAL CSS STATE ==========`);
        break;
      }
    }
  } catch { /* non-fatal */ }

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
    projectPath, state.hasSrcDir, state.tailwindVersion, ctx.modelId,
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
  console.log(`[ORDINEX_DEBUG] runSinglePass entered`);
  await emitFeatureEvent(ctx, 'feature_code_generating', {
    scaffold_id: ctx.scaffoldId,
    message: 'Generating feature code via LLM...',
  });

  console.log(`[ORDINEX_DEBUG] Calling generateFeatureCode (heartbeat-based timeout, model: ${ctx.modelId || 'not set'})...`);
  const generationResult = await generateFeatureCode(
    requirements, ctx.recipeId, designPack || null, ctx.llmClient!,
    ctx.modelId, projectContext, state.hasSrcDir,
  );

  console.log(`[ORDINEX_DEBUG] generateFeatureCode returned: ${generationResult ? `${generationResult.files.length} files` : 'null'}`);
  if (!generationResult) {
    console.warn(`[ORDINEX_DEBUG] ❌ generateFeatureCode returned null — no files to apply`);
    return;
  }

  const protectedPaths = ['layout.tsx', 'globals.css', 'lib/utils.ts'];
  const isProtected = (filePath: string) => protectedPaths.some(p => filePath.endsWith(p));

  console.log(`[ORDINEX_DEBUG] [SINGLE_PASS] All generated files (${generationResult.files.length}):`);
  for (const file of generationResult.files) {
    const prot = isProtected(file.path);
    console.log(`[ORDINEX_DEBUG]   ${prot ? '🛑 PROTECTED' : '✅'} ${file.path} (${file.content.length} chars)`);
  }
  if (generationResult.modified_files?.length) {
    console.log(`[ORDINEX_DEBUG] [SINGLE_PASS] Modified files (${generationResult.modified_files.length}):`);
    for (const mod of generationResult.modified_files) {
      const prot = isProtected(mod.path);
      console.log(`[ORDINEX_DEBUG]   ${prot ? '🛑 PROTECTED' : '✅'} ${mod.path} (${mod.content.length} chars)`);
    }
  }

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
  console.log(`[ORDINEX_DEBUG] Published ${published.length} staged files (${stagedCount} staged, ${generationResult.files.length - stagedCount} protected/skipped)`);
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
  console.log(`[ORDINEX_DEBUG] ========== CSS VERIFY START ==========`);
  const twVersion = detectTailwindVersion(projectPath);
  console.log(`[ORDINEX_DEBUG] [CSS_VERIFY] Tailwind version: ${twVersion}`);
  console.log(`[ORDINEX_DEBUG] [CSS_VERIFY] state.designTokens.primary: ${state.designTokens.primary}`);
  console.log(`[ORDINEX_DEBUG] [CSS_VERIFY] state.designTokens.background: ${state.designTokens.background}`);
  console.log(`[ORDINEX_DEBUG] [CSS_VERIFY] state.designTokens.accent: ${state.designTokens.accent}`);
  console.log(`[ORDINEX_DEBUG] [CSS_VERIFY] state.darkTokens present: ${!!state.darkTokens}`);
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
    console.log(`[ORDINEX_DEBUG] [CSS_VERIFY] globals.css found at: ${globalsCssPath || 'NOT FOUND'}`);
    if (globalsCssPath) {
      const cssContent = fs.readFileSync(globalsCssPath, 'utf-8');
      const hasV4Import = cssContent.includes('@import "tailwindcss"') || cssContent.includes("@import 'tailwindcss'");
      const hasV3Directives = cssContent.includes('@tailwind base');
      const hasTailwindSetup = twVersion === 4 ? hasV4Import : hasV3Directives;
      const hasRootVars = cssContent.includes('--primary:');
      const hasOklch = cssContent.includes('oklch(');
      const hasMismatch = twVersion === 4 && hasV3Directives && !hasV4Import;

      console.log(`[ORDINEX_DEBUG] [CSS_VERIFY] CSS analysis:`);
      console.log(`[ORDINEX_DEBUG]   length: ${cssContent.length} chars`);
      console.log(`[ORDINEX_DEBUG]   hasV4Import: ${hasV4Import}`);
      console.log(`[ORDINEX_DEBUG]   hasV3Directives: ${hasV3Directives}`);
      console.log(`[ORDINEX_DEBUG]   hasTailwindSetup: ${hasTailwindSetup}`);
      console.log(`[ORDINEX_DEBUG]   hasRootVars (--primary:): ${hasRootVars}`);
      console.log(`[ORDINEX_DEBUG]   hasOklch: ${hasOklch}`);
      console.log(`[ORDINEX_DEBUG]   hasMismatch: ${hasMismatch}`);
      console.log(`[ORDINEX_DEBUG]   First 500 chars: ${cssContent.substring(0, 500)}`);

      if (hasOklch && hasRootVars && hasTailwindSetup) {
        console.log(`[ORDINEX_DEBUG] [CSS_VERIFY] ✅ globals.css has valid OKLCH tokens — skipping regeneration`);
        console.log(`[ORDINEX_DEBUG] ========== CSS VERIFY END ==========`);
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
