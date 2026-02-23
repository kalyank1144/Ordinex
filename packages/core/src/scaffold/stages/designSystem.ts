/**
 * Stage 2-4: Design System Setup
 *
 * 2. Style Intent Resolution → design tokens
 * 3. Overlay Application (layout, globals.css, utils, error/loading pages)
 * 4. shadcn/ui init + component installation
 */

import type { PipelineStageContext, PipelineState } from '../pipelineTypes';
import { debugLog, debugWarn } from '../debugLog';
import { emitScaffoldProgress, emitDesignPackApplied } from '../pipelineEvents';
import { getDesignPackById } from '../designPacks';
import type { DesignPack } from '../designPacks';
import { resolveStyleIntent, resolveStyleIntentWithLLM, getAppTypeDefaultStyle } from '../styleIntentResolver';
import type { StyleInput } from '../blueprintSchema';
import { updateStyleInfo } from '../projectContext';
import { applyOverlay, appendVibeStylesToGlobals, detectTailwindVersion, rewriteGlobalsCss } from '../overlayApplier';
import type { OverlayConfig } from '../overlayApplier';
import { initShadcn, updateGlobalsCssTokens } from '../designPackToShadcn';
import { commitStage } from '../gitCommitter';
import { getShadcnComponents } from '../recipeConfig';
import type { DesignTokens } from '../tokenValidator';
import { tokensToShadcnVars } from '../tokenValidator';
import { generateFullTheme, tokensToOklchVars } from '../oklchEngine';
import type { SemanticTokens } from '../oklchEngine';

function semanticToDesign(st: SemanticTokens): DesignTokens {
  return {
    background: st.background, foreground: st.foreground,
    primary: st.primary, primary_foreground: st.primary_foreground,
    secondary: st.secondary, secondary_foreground: st.secondary_foreground,
    muted: st.muted, muted_foreground: st.muted_foreground,
    destructive: st.destructive, destructive_foreground: st.destructive_foreground,
    accent: st.accent, accent_foreground: st.accent_foreground,
    card: st.card, card_foreground: st.card_foreground,
    popover: st.popover, popover_foreground: st.popover_foreground,
    border: st.border, input: st.input, ring: st.ring,
    chart_1: st.chart_1, chart_2: st.chart_2, chart_3: st.chart_3,
    chart_4: st.chart_4, chart_5: st.chart_5,
    sidebar: st.sidebar, sidebar_foreground: st.sidebar_foreground,
    sidebar_primary: st.sidebar_primary,
    sidebar_primary_foreground: st.sidebar_primary_foreground,
    sidebar_accent: st.sidebar_accent,
    sidebar_accent_foreground: st.sidebar_accent_foreground,
    sidebar_border: st.sidebar_border,
    sidebar_ring: st.sidebar_ring,
    radius: st.radius,
  };
}

const RADIUS_MAP: Record<string, string> = { sm: '0.25rem', md: '0.5rem', lg: '1rem' };

/**
 * Convert a DesignPack into full light + dark DesignTokens via the OKLCH engine.
 * The pack's primary/secondary/accent hex colors are used as seed colors.
 * Falls back to a manual mapping if the engine fails.
 */
async function designPackToTheme(pack: DesignPack): Promise<{ light: DesignTokens; dark: DesignTokens }> {
  const c = pack.tokens.colors;
  const radius = RADIUS_MAP[pack.tokens.radius] || '0.5rem';
  try {
    const theme = await generateFullTheme(c.primary, c.secondary, c.accent, { radius });
    return { light: semanticToDesign(theme.light), dark: semanticToDesign(theme.dark) };
  } catch (err) {
    console.warn('[DesignSystem] OKLCH engine failed for pack, using manual fallback:', err);
    const manual: DesignTokens = {
      background: c.background, foreground: c.foreground,
      primary: c.primary, primary_foreground: c.primary_foreground || '#ffffff',
      secondary: c.secondary, secondary_foreground: c.secondary_foreground || '#ffffff',
      muted: c.muted, muted_foreground: c.muted_foreground || c.foreground,
      accent: c.accent, accent_foreground: c.accent_foreground || c.foreground,
      destructive: '#ef4444', destructive_foreground: '#ffffff',
      card: c.background, card_foreground: c.foreground,
      popover: c.background, popover_foreground: c.foreground,
      border: c.border, input: c.border, ring: c.primary,
      chart_1: c.primary, chart_2: c.secondary, chart_3: c.accent,
      chart_4: c.accent, chart_5: c.secondary,
      sidebar: c.muted || c.background, sidebar_foreground: c.foreground,
      sidebar_primary: c.primary,
      sidebar_primary_foreground: c.primary_foreground || '#ffffff',
      sidebar_accent: c.muted || c.background,
      sidebar_accent_foreground: c.foreground,
      sidebar_border: c.border,
      sidebar_ring: c.primary,
      radius,
    };
    return { light: manual, dark: manual };
  }
}

export async function runDesignSystemStage(
  { ctx, projectPath, logPrefix }: PipelineStageContext,
  state: PipelineState,
): Promise<void> {
  debugLog(`========== DESIGN SYSTEM STAGE START ==========`);
  debugLog(`[DS] projectPath: ${projectPath}`);
  debugLog(`[DS] ctx.designPackId: ${ctx.designPackId}`);
  debugLog(`[DS] ctx.llmClient present: ${!!ctx.llmClient}`);
  debugLog(`[DS] ctx.modelId: ${ctx.modelId}`);
  debugLog(`[DS] ctx.blueprint app_type: ${ctx.blueprint?.app_type || 'null'}`);
  debugLog(`[DS] ctx.styleInput: ${ctx.styleInput ? JSON.stringify(ctx.styleInput) : 'null'}`);

  // --- Stage 2: Style Intent Resolution ---
  await emitScaffoldProgress(ctx, 'applying_design' as any, {
    message: 'Resolving design tokens...',
    stage: 'tokens',
  });

  try {
    const designPack = getDesignPackById(ctx.designPackId);
    const appType = ctx.blueprint?.app_type;
    debugLog(`[DS] designPack resolved: ${designPack ? `${designPack.id} (${designPack.name})` : 'NULL — no pack selected'}`);

    let resolvedStyleInput: StyleInput;

    if (designPack) {
      debugLog(`[DS] Using design pack OKLCH path — seeds: primary=${designPack.tokens.colors.primary}, secondary=${designPack.tokens.colors.secondary}, accent=${designPack.tokens.colors.accent}`);
      console.log(`${logPrefix} Using design pack "${designPack.id}" (${designPack.name}) via OKLCH engine — seeds: primary=${designPack.tokens.colors.primary}, secondary=${designPack.tokens.colors.secondary}, accent=${designPack.tokens.colors.accent}`);
      const packTheme = await designPackToTheme(designPack);
      state.designTokens = packTheme.light;
      state.darkTokens = packTheme.dark;
      state.shadcnVars = tokensToShadcnVars(state.designTokens);
      debugLog(`[DS] OKLCH theme generated — primary=${state.designTokens.primary}, bg=${state.designTokens.background}, accent=${state.designTokens.accent}`);
      debugLog(`[DS] shadcnVars count: ${Object.keys(state.shadcnVars).length}`);
      debugLog(`[DS] darkTokens generated: ${!!state.darkTokens}`);
      console.log(`${logPrefix} OKLCH theme generated — light: bg=${state.designTokens.background}, primary=${state.designTokens.primary}, accent=${state.designTokens.accent}`);
      resolvedStyleInput = { mode: 'vibe', value: designPack.vibe };
    } else {
      resolvedStyleInput = ctx.styleInput
        || (appType ? getAppTypeDefaultStyle(appType) : undefined)
        || { mode: 'vibe', value: 'minimal' };
      debugLog(`[DS] No design pack — using style resolution. mode=${resolvedStyleInput.mode}, value="${resolvedStyleInput.value}"`);
      console.log(`${logPrefix} No design pack — style input: mode=${resolvedStyleInput.mode}, value="${resolvedStyleInput.value}"`);

      let styleResult;
      if (ctx.llmClient && (resolvedStyleInput.mode === 'nl' || resolvedStyleInput.mode === 'vibe')) {
        debugLog(`[DS] Calling resolveStyleIntentWithLLM with modelId=${ctx.modelId}`);
        styleResult = await resolveStyleIntentWithLLM(resolvedStyleInput, ctx.llmClient, appType, ctx.modelId);
        debugLog(`[DS] LLM style result: primary=${styleResult.tokens.primary}, bg=${styleResult.tokens.background}, accent=${styleResult.tokens.accent}`);
      } else {
        debugLog(`[DS] Using static resolveStyleIntent (no LLM client or non-vibe mode)`);
        styleResult = resolveStyleIntent(resolvedStyleInput);
        debugLog(`[DS] Static style result: primary=${styleResult.tokens.primary}, bg=${styleResult.tokens.background}`);
      }
      state.designTokens = styleResult.tokens;
      state.shadcnVars = styleResult.shadcnVars;
    }

    debugLog(`[DS] ✓ Style resolution done — primary=${state.designTokens.primary}, shadcnVars=${Object.keys(state.shadcnVars).length}`);

    try {
      const flatTokens: Record<string, string> = {};
      for (const [k, v] of Object.entries(state.designTokens)) {
        if (typeof v === 'string') flatTokens[k] = v;
      }
      await updateStyleInfo(projectPath, resolvedStyleInput, flatTokens, state.shadcnVars);
    } catch { /* non-fatal */ }

    console.log(`${logPrefix} ✓ Style resolved: ${state.designTokens.primary} primary, ${Object.keys(state.shadcnVars).length} CSS vars`);

    await emitScaffoldProgress(ctx, 'applying_design' as any, {
      message: `Design tokens resolved (${Object.keys(state.shadcnVars).length} CSS vars)`,
      stage: 'tokens',
      status: 'done',
    });
  } catch (styleErr) {
    debugWarn(`[DS] ❌ Style resolution FAILED:`, styleErr);
    console.warn(`${logPrefix} Style resolution warning (non-fatal):`, styleErr);
  }

  // --- Stage 3: Overlay Application ---
  debugLog(`[DS] >>> Stage 3: Overlay Application`);
  console.log(`${logPrefix} [OVERLAY] >>> Starting overlay stage`);
  await emitScaffoldProgress(ctx, 'applying_design' as any, {
    message: 'Applying premium shell overlays...',
    stage: 'overlay',
  });

  state.tailwindVersion = detectTailwindVersion(projectPath);
  debugLog(`[DS] Tailwind version detected: ${state.tailwindVersion}`);
  console.log(`${logPrefix} Detected Tailwind CSS v${state.tailwindVersion} for project at ${projectPath}`);

  try {
    const primaryLayout = ctx.blueprint?.primary_layout || 'sidebar';
    const designPackForOverlay = getDesignPackById(ctx.designPackId);
    const blueprintPages = ctx.blueprint?.pages?.map(p => ({ name: p.name, path: p.path }));

    let oklchVars: Record<string, string> | undefined;
    let darkTokens: DesignTokens | undefined = state.darkTokens;
    let darkOklchVars: Record<string, string> | undefined;
    try {
      debugLog(`[DS] Generating OKLCH vars from tokens...`);
      oklchVars = await tokensToOklchVars(state.designTokens as unknown as Record<string, string | undefined>);
      debugLog(`[DS] OKLCH light vars: ${Object.keys(oklchVars).length} keys. Sample --primary=${oklchVars['--primary'] || 'MISSING'}, --background=${oklchVars['--background'] || 'MISSING'}`);
      if (!darkTokens) {
        debugLog(`[DS] No dark tokens yet, generating via OKLCH engine...`);
        const theme = await generateFullTheme(
          state.designTokens.primary, state.designTokens.secondary, state.designTokens.accent,
          { radius: state.designTokens.radius },
        );
        darkTokens = semanticToDesign(theme.dark);
        state.darkTokens = darkTokens;
      }
      darkOklchVars = await tokensToOklchVars(darkTokens as unknown as Record<string, string | undefined>);
      debugLog(`[DS] OKLCH dark vars: ${Object.keys(darkOklchVars).length} keys`);
      console.log(`${logPrefix} [OKLCH] Generated ${Object.keys(oklchVars).length} OKLCH vars + dark mode`);
    } catch (oklchErr) {
      debugWarn(`[DS] ❌ OKLCH generation FAILED:`, oklchErr);
      console.warn(`${logPrefix} [OKLCH] Non-fatal: ${oklchErr instanceof Error ? oklchErr.message : String(oklchErr)}`);
    }

    const overlayConfig: OverlayConfig = {
      recipeId: ctx.recipeId,
      appName: ctx.appName,
      tokens: state.designTokens,
      primaryLayout,
      designVibe: designPackForOverlay?.vibe,
      tailwindVersion: state.tailwindVersion,
      pages: blueprintPages,
      oklchVars,
      darkTokens,
      darkOklchVars,
    };

    debugLog(`[DS] Applying overlay — layout=${primaryLayout}, vibe=${designPackForOverlay?.vibe || 'none'}, oklchVars=${oklchVars ? Object.keys(oklchVars).length : 0}`);
    const overlayResult = await applyOverlay(projectPath, overlayConfig);
    debugLog(`[DS] Overlay result: ${overlayResult.filesCreated.length} created, ${overlayResult.filesModified.length} modified`);
    console.log(`${logPrefix} [OVERLAY] ✓ Applied: ${overlayResult.filesCreated.length} created, ${overlayResult.filesModified.length} modified`);

    await emitScaffoldProgress(ctx, 'applying_design' as any, {
      message: `Applied ${overlayResult.filesCreated.length} shell files`,
      stage: 'overlay',
      status: 'done',
      detail: `${overlayResult.filesCreated.length} files`,
    });

    try {
      const cr = await commitStage(projectPath, {
        stage: 'overlay',
        extra: {
          files_created: String(overlayResult.filesCreated.length),
          layout: primaryLayout,
        },
      });
      if (cr.success) state.lastCommitHash = cr.commitHash;
    } catch { /* non-fatal */ }
  } catch (overlayErr) {
    debugWarn(`[DS] ❌ Overlay FAILED:`, overlayErr);
    console.error(`${logPrefix} [OVERLAY] FAILED:`, overlayErr);
    await emitScaffoldProgress(ctx, 'applying_design' as any, {
      message: `Overlay failed: ${overlayErr instanceof Error ? overlayErr.message : String(overlayErr)}`,
      stage: 'overlay',
      status: 'error',
    });
  }

  debugLog(`[DS] <<< Stage 3: Overlay complete`);

  const designPack = getDesignPackById(ctx.designPackId);
  await emitDesignPackApplied(ctx, designPack || { id: ctx.designPackId, name: ctx.designPackId } as any, []);

  // --- Stage 4: shadcn/ui Init + CSS Tokens ---
  debugLog(`[DS] >>> Stage 4: shadcn/ui Init + CSS Rewrite`);
  console.log(`${logPrefix} [SHADCN] >>> Starting shadcn/ui stage`);
  await emitScaffoldProgress(ctx, 'applying_design' as any, {
    message: 'Setting up shadcn/ui components...',
    stage: 'shadcn',
  });

  const shadcnComponents = getShadcnComponents(ctx.recipeId);

  try {
    debugLog(`[DS] shadcn: initializing ${shadcnComponents.length} components...`);
    console.log(`${logPrefix} [SHADCN] Initializing ${shadcnComponents.length} components...`);
    const shadcnResult = await initShadcn(projectPath, shadcnComponents);
    debugLog(`[DS] shadcn: ${shadcnResult.componentsInstalled.length} installed, ${shadcnResult.errors.length} errors`);
    console.log(`${logPrefix} [SHADCN] ✓ Init result: ${shadcnResult.componentsInstalled.length} installed, ${shadcnResult.errors.length} errors`);
    if (shadcnResult.errors.length > 0) {
      console.warn(`${logPrefix} [SHADCN] Component errors:`, shadcnResult.errors);
    }

    debugLog(`[DS] >>> CSS Rewrite — design tokens: primary=${state.designTokens.primary}, bg=${state.designTokens.background}, accent=${state.designTokens.accent}`);
    console.log(`${logPrefix} [SHADCN] >>> Rewriting globals.css with OKLCH tokens after shadcn init`);
    console.log(`${logPrefix} [SHADCN] Design tokens snapshot: primary=${state.designTokens.primary}, bg=${state.designTokens.background}, accent=${state.designTokens.accent}, sidebar=${state.designTokens.sidebar}`);
    {
      const designPackForRewrite = getDesignPackById(ctx.designPackId);
      debugLog(`[DS] Design pack for CSS rewrite: ${designPackForRewrite?.id || 'NONE'}`);
      console.log(`${logPrefix} [SHADCN] Design pack for rewrite: ${designPackForRewrite?.id || '(none)'}, vibe=${designPackForRewrite?.vibe || '(none)'}`);

      let oklchVarsRewrite: Record<string, string> | undefined;
      let darkOklchVarsRewrite: Record<string, string> | undefined;
      try {
        oklchVarsRewrite = await tokensToOklchVars(state.designTokens as unknown as Record<string, string | undefined>);
        debugLog(`[DS] OKLCH rewrite light vars: ${Object.keys(oklchVarsRewrite).length}. --primary=${oklchVarsRewrite['--primary'] || 'MISSING'}, --background=${oklchVarsRewrite['--background'] || 'MISSING'}, --accent=${oklchVarsRewrite['--accent'] || 'MISSING'}`);
        console.log(`${logPrefix} [OKLCH-REWRITE] Light vars: ${Object.keys(oklchVarsRewrite).length} keys`);
        const sampleKeys = ['--primary', '--background', '--accent', '--sidebar-background'];
        for (const k of sampleKeys) {
          console.log(`${logPrefix} [OKLCH-REWRITE]   ${k} = ${oklchVarsRewrite[k] || '(MISSING!)'}`);
        }
        if (state.darkTokens) {
          darkOklchVarsRewrite = await tokensToOklchVars(state.darkTokens as unknown as Record<string, string | undefined>);
          debugLog(`[DS] OKLCH rewrite dark vars: ${Object.keys(darkOklchVarsRewrite).length}`);
          console.log(`${logPrefix} [OKLCH-REWRITE] Dark vars: ${Object.keys(darkOklchVarsRewrite).length} keys`);
        }
      } catch (oklchErr) {
        debugWarn(`[DS] ❌ OKLCH rewrite FAILED:`, oklchErr);
        console.error(`${logPrefix} [OKLCH-REWRITE] ❌ Failed to generate OKLCH vars:`, oklchErr);
      }

      debugLog(`[DS] Calling rewriteGlobalsCss — twVersion=${state.tailwindVersion}`);
      console.log(`${logPrefix} [SHADCN] Calling rewriteGlobalsCss with twVersion=${state.tailwindVersion}`);
      const rewrote = await rewriteGlobalsCss(projectPath, {
        tokens: state.designTokens,
        vibe: designPackForRewrite?.vibe,
        twVersion: state.tailwindVersion,
        oklchVars: oklchVarsRewrite,
        darkTokens: state.darkTokens,
        darkOklchVars: darkOklchVarsRewrite,
      });

      if (rewrote) {
        debugLog(`[DS] ✅ rewriteGlobalsCss returned TRUE — CSS was rewritten`);
        console.log(`${logPrefix} [SHADCN] ✅ globals.css fully rewritten with ${oklchVarsRewrite ? Object.keys(oklchVarsRewrite).length : 0} OKLCH vars + dark mode`);

        try {
          const fsp = (await import('fs')).promises;
          const pathMod = (await import('path'));
          const verifyPaths = [
            pathMod.join(projectPath, 'src', 'app', 'globals.css'),
            pathMod.join(projectPath, 'app', 'globals.css'),
          ];
          for (const vp of verifyPaths) {
            try {
              const content = await fsp.readFile(vp, 'utf-8');
              debugLog(`[DS] [CSS_VERIFY] globals.css at ${vp}: ${content.length} chars`);
              debugLog(`[DS] [CSS_VERIFY]   has oklch(): ${content.includes('oklch(')}`);
              debugLog(`[DS] [CSS_VERIFY]   has :root: ${content.includes(':root')}`);
              debugLog(`[DS] [CSS_VERIFY]   has .dark: ${content.includes('.dark')}`);
              debugLog(`[DS] [CSS_VERIFY]   has @theme inline: ${content.includes('@theme inline')}`);
              debugLog(`[DS] [CSS_VERIFY]   first 3 lines: ${content.split('\n').slice(0, 3).join(' | ')}`);
              console.log(`${logPrefix} [VERIFY] globals.css at ${vp}: ${content.length} chars`);
              console.log(`${logPrefix} [VERIFY]   has @import tailwindcss: ${content.includes('@import "tailwindcss"')}`);
              console.log(`${logPrefix} [VERIFY]   has @theme inline: ${content.includes('@theme inline')}`);
              console.log(`${logPrefix} [VERIFY]   has oklch(): ${content.includes('oklch(')}`);
              console.log(`${logPrefix} [VERIFY]   has :root: ${content.includes(':root')}`);
              console.log(`${logPrefix} [VERIFY]   has .dark: ${content.includes('.dark')}`);
              console.log(`${logPrefix} [VERIFY]   has body bg: ${content.includes('background-color:')}`);
              const lines = content.split('\n');
              console.log(`${logPrefix} [VERIFY]   First 5 lines: ${lines.slice(0, 5).join(' | ')}`);
              break;
            } catch { /* try next */ }
          }
        } catch { /* non-fatal */ }
      } else {
        debugWarn(`[DS] ❌ rewriteGlobalsCss returned FALSE — CSS was NOT rewritten!`);
        console.warn(`${logPrefix} [SHADCN] ⚠️ globals.css rewrite FAILED, falling back to partial update`);
        if (Object.keys(state.shadcnVars).length > 0) {
          const fallbackOk = await updateGlobalsCssTokens(projectPath, state.designTokens);
          debugLog(`[DS] Fallback updateGlobalsCssTokens result: ${fallbackOk}`);
          if (!fallbackOk) {
            debugWarn(`[DS] ❌ BOTH CSS rewrite AND fallback FAILED — design tokens NOT applied!`);
            console.error(`${logPrefix} [SHADCN] ❌ Fallback updateGlobalsCssTokens also failed — design tokens NOT applied!`);
          }
        }
        const designPackVibe = getDesignPackById(ctx.designPackId)?.vibe;
        if (designPackVibe) {
          await appendVibeStylesToGlobals(projectPath, designPackVibe);
        }
      }
    }

    await emitScaffoldProgress(ctx, 'applying_design' as any, {
      message: `Installed ${shadcnResult.componentsInstalled.length} shadcn/ui components`,
      stage: 'shadcn',
      status: 'done',
      detail: `${shadcnResult.componentsInstalled.length} components`,
    });

    try {
      const cr = await commitStage(projectPath, {
        stage: 'shadcn_init',
        extra: {
          components: shadcnResult.componentsInstalled.join(','),
          tokens: String(Object.keys(state.shadcnVars).length),
        },
      });
      if (cr.success) state.lastCommitHash = cr.commitHash;
    } catch { /* non-fatal */ }
  } catch (shadcnErr) {
    debugWarn(`[DS] ❌ shadcn stage FAILED:`, shadcnErr);
    console.error(`${logPrefix} [SHADCN] FAILED:`, shadcnErr);
    await emitScaffoldProgress(ctx, 'applying_design' as any, {
      message: `shadcn/ui init failed: ${shadcnErr instanceof Error ? shadcnErr.message : String(shadcnErr)}`,
      stage: 'shadcn',
      status: 'error',
    });
  }
  debugLog(`========== DESIGN SYSTEM STAGE END ==========`);
}
