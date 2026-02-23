/**
 * Stage 7: Quality Gates — Diagnostic Health Check
 *
 * Runs autofix, tsc + eslint + build checks, bounded LLM repair,
 * and generates Doctor Card. Non-blocking — always completes.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Event, Stage } from '../../types';
import type { PipelineStageContext, PipelineState } from '../pipelineTypes';
import type { DoctorStatus } from '../blueprintSchema';
import { emitScaffoldProgress, generateEventId } from '../pipelineEvents';
import { runQualityGatePipeline, type PipelineResult, type GateCheckResult } from '../qualityGatePipeline';
import { pipelineToDoctorStatus, buildDoctorCardPayload } from '../doctorCard';
import { runDeterministicAutofix } from '../deterministicAutofix';
import { commitStage } from '../gitCommitter';
import { updateDoctorStatus as persistDoctorStatus } from '../projectContext';
import { callLLMWithHeartbeat } from '../featureCodeGenerator';

const MAX_REPAIR_ATTEMPTS = 2;

export async function runQualityGateStage(
  { ctx, projectPath, logPrefix }: PipelineStageContext,
  state: PipelineState,
): Promise<void> {
  console.log(`${logPrefix} [QUALITY_GATES] >>> Starting quality gates (diagnostic, non-blocking)`);
  await emitScaffoldProgress(ctx, 'verifying' as any, {
    message: 'Running quality checks...',
    stage: 'quality_gates',
  });

  try {
    let pipelineResult: PipelineResult | undefined;

    console.log(`${logPrefix} [QUALITY_GATES] Running initial pipeline check...`);
    pipelineResult = await runQualityGatePipeline({
      stage: 'pre_publish',
      projectDir: projectPath,
      skipBuild: false,
      skipLint: false,
    });
    state.doctorStatus = pipelineToDoctorStatus(pipelineResult);
    const initialIssues = pipelineResult.checks.filter(c => c.status === 'fail');

    console.log(`${logPrefix} [QUALITY_GATES] Initial: tsc=${state.doctorStatus.tsc}, eslint=${state.doctorStatus.eslint}, build=${state.doctorStatus.build} (${initialIssues.length} issues)`);
    for (const check of pipelineResult.checks) {
      if (check.status === 'fail') {
        console.log(`${logPrefix} [QUALITY_GATES]   ❌ ${check.name}: ${(check.output || '').slice(0, 300)}`);
      }
    }

    // Bounded LLM repair
    if (initialIssues.length > 0 && ctx.llmClient) {
      for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
        const failedChecks = pipelineResult!.checks.filter(c => c.status === 'fail');
        if (failedChecks.length === 0) break;

        console.log(`${logPrefix} [QUALITY_GATES] Repair attempt ${attempt}/${MAX_REPAIR_ATTEMPTS} for ${failedChecks.length} issue(s)...`);
        await emitScaffoldProgress(ctx, 'verifying' as any, {
          message: `Auto-fixing ${failedChecks.length} issue(s) (attempt ${attempt}/${MAX_REPAIR_ATTEMPTS})...`,
          stage: 'quality_gates',
        });

        const repairResult = await attemptLLMRepair(ctx, projectPath, failedChecks, attempt, logPrefix);

        if (!repairResult.fixed) {
          console.log(`${logPrefix} [QUALITY_GATES] No fixes applied — stopping repair loop`);
          break;
        }

        try { await runDeterministicAutofix(projectPath); } catch { /* non-fatal */ }

        await emitScaffoldProgress(ctx, 'verifying' as any, {
          message: `Repair attempt ${attempt} applied — re-checking...`,
          stage: 'quality_gates',
        });
        pipelineResult = await runQualityGatePipeline({
          stage: 'pre_publish',
          projectDir: projectPath,
          skipBuild: false,
          skipLint: false,
        });
        state.doctorStatus = pipelineToDoctorStatus(pipelineResult);

        const remaining = pipelineResult.checks.filter(c => c.status === 'fail');
        if (remaining.length === 0) {
          console.log(`${logPrefix} [QUALITY_GATES] All clean after repair ${attempt}`);
          break;
        }

        try {
          const cr = await commitStage(projectPath, {
            stage: 'llm_repair',
            extra: { attempt: String(attempt), files_fixed: String(repairResult.filesModified.length) },
          });
          if (cr.success) state.lastCommitHash = cr.commitHash;
        } catch { /* non-fatal */ }
      }
    }

    state.doctorCard = buildDoctorCardPayload({
      doctorStatus: state.doctorStatus,
      pipelineResult,
      lastCommit: state.lastCommitHash,
    });

    try { await persistDoctorStatus(projectPath, state.doctorStatus); } catch { /* non-fatal */ }

    try {
      const cr = await commitStage(projectPath, {
        stage: 'pre_publish',
        extra: { tsc: state.doctorStatus.tsc, eslint: state.doctorStatus.eslint, build: state.doctorStatus.build },
      });
      if (cr.success) state.lastCommitHash = cr.commitHash;
    } catch { /* non-fatal */ }

    const issueCount = [state.doctorStatus.tsc, state.doctorStatus.eslint, state.doctorStatus.build].filter(s => s === 'fail').length;
    const detailParts: string[] = [];
    detailParts.push(`tsc: ${state.doctorStatus.tsc}`);
    detailParts.push(`build: ${state.doctorStatus.build}`);

    await emitScaffoldProgress(ctx, 'applying_design' as any, {
      message: issueCount === 0 ? 'All checks passed' : `Completed with ${issueCount} warning(s)`,
      stage: 'quality_gates',
      status: issueCount === 0 ? 'done' : 'error',
      detail: detailParts.join(', ') || 'checks complete',
    });

    // Emit Doctor Card event
    const doctorEvent: Event = {
      event_id: generateEventId(),
      task_id: ctx.taskId,
      timestamp: new Date().toISOString(),
      type: 'scaffold_doctor_card' as any,
      mode: ctx.mode,
      stage: 'plan' as Stage,
      payload: {
        scaffold_id: ctx.scaffoldId,
        doctor_card: state.doctorCard,
        doctor_status: state.doctorStatus,
      },
      evidence_ids: [],
      parent_event_id: null,
    };
    await ctx.eventBus.publish(doctorEvent);
  } catch (gateErr) {
    console.error(`${logPrefix} [QUALITY_GATES] Pipeline error (non-blocking):`, gateErr);
    await emitScaffoldProgress(ctx, 'applying_design' as any, {
      message: `Quality gates error: ${gateErr instanceof Error ? gateErr.message : String(gateErr)}`,
      stage: 'quality_gates',
      status: 'error',
      detail: 'check error — see Doctor Card',
    });
  }
}

// ============================================================================
// LLM REPAIR
// ============================================================================

interface LLMRepairResult {
  fixed: boolean;
  filesModified: string[];
  description: string;
}

async function attemptLLMRepair(
  ctx: any,
  projectPath: string,
  failedChecks: GateCheckResult[],
  attempt: number,
  logPrefix: string,
): Promise<LLMRepairResult> {
  if (!ctx.llmClient) {
    return { fixed: false, filesModified: [], description: 'No LLM client available' };
  }

  const errorSummaries = failedChecks
    .filter(c => c.status === 'fail' && c.output)
    .map(c => `[${c.name}] ${c.output}`)
    .join('\n\n');

  if (!errorSummaries.trim()) {
    return { fixed: false, filesModified: [], description: 'No error output to analyze' };
  }

  const fileRefs = extractFileRefsFromErrors(errorSummaries, projectPath);
  const fileContents: Record<string, string> = {};

  // Dynamic budget: compute how many chars of file content the model can accept.
  // Same math as ContextBudgetManager but scoped to repair prompts.
  const CHARS_PER_TOKEN = 4;
  const MODEL_CONTEXT = 200_000;
  const OUTPUT_RESERVE = 16_384;
  const OVERHEAD = 2_000;
  const systemPromptChars = 400; // short system prompt for repair
  const errorTokens = Math.ceil(errorSummaries.length / CHARS_PER_TOKEN);
  const systemTokens = Math.ceil(systemPromptChars / CHARS_PER_TOKEN);
  const budgetTokens = MODEL_CONTEXT - OUTPUT_RESERVE - OVERHEAD - systemTokens - errorTokens;
  const budgetChars = Math.max(budgetTokens * CHARS_PER_TOKEN, 20_000);

  let charsUsed = 0;

  for (const ref of fileRefs) {
    try {
      const fullPath = path.resolve(projectPath, ref);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const available = budgetChars - charsUsed;
        if (available <= 0) break;
        if (content.length <= available) {
          fileContents[ref] = content;
          charsUsed += content.length;
        } else {
          fileContents[ref] = content.slice(0, available) + '\n// ... truncated ...';
          charsUsed += available;
          break;
        }
      }
    } catch { /* skip */ }
  }

  if (Object.keys(fileContents).length === 0) {
    const hasSrc = fs.existsSync(path.join(projectPath, 'src'));
    const prefix = hasSrc ? 'src/' : '';
    const scanDirs = [`${prefix}app`, `${prefix}components`];
    for (const dir of scanDirs) {
      const fullDir = path.join(projectPath, dir);
      if (!fs.existsSync(fullDir)) continue;
      try {
        const entries = fs.readdirSync(fullDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !/\.(tsx?|jsx?)$/.test(entry.name)) continue;
          const available = budgetChars - charsUsed;
          if (available <= 0) break;
          const rel = `${dir}/${entry.name}`;
          const content = fs.readFileSync(path.join(fullDir, entry.name), 'utf-8');
          if (content.length <= available) {
            fileContents[rel] = content;
            charsUsed += content.length;
          } else {
            fileContents[rel] = content.slice(0, available) + '\n// ... truncated ...';
            charsUsed += available;
            break;
          }
        }
      } catch { /* skip */ }
    }
  }

  if (Object.keys(fileContents).length === 0) {
    return { fixed: false, filesModified: [], description: 'Could not read any error-referenced files' };
  }

  console.log(`${logPrefix} [LLM_REPAIR] Attempt ${attempt}: analyzing ${failedChecks.length} failures across ${Object.keys(fileContents).length} files (${Math.round(charsUsed / 1000)}K chars, budget ${Math.round(budgetChars / 1000)}K)`);

  const repairPrompt = buildRepairPrompt(errorSummaries, fileContents, attempt, projectPath);

  try {
    const repairSystem = 'You are an expert code repair assistant. You fix TypeScript, React, and Next.js build errors. Return ONLY a JSON array of file fixes. Each fix has "file" (relative path) and "content" (complete corrected file content). No markdown fences, no explanation — just the JSON array.';
    const response = await callLLMWithHeartbeat(
      ctx.llmClient, ctx.modelId, 16384, repairSystem, repairPrompt, attempt,
    );

    const stopReason = (response as any)?.stop_reason;
    if (stopReason === 'max_tokens') {
      console.warn(`${logPrefix} [LLM_REPAIR] Response truncated (stop_reason=max_tokens) — will attempt to parse partial`);
    }

    const text = (response as any)?.content
      ?.filter((b: any) => b.type === 'text')
      ?.map((b: any) => b.text)
      ?.join('') || '';

    const fixes = parseRepairResponse(text);
    if (!fixes || fixes.length === 0) {
      const reason = stopReason === 'max_tokens'
        ? 'LLM response truncated (max_tokens) — try fewer files'
        : 'LLM returned no actionable fixes';
      return { fixed: false, filesModified: [], description: reason };
    }

    const protectedPaths = ['globals.css', 'layout.tsx', 'lib/utils.ts'];
    const isProtected = (filePath: string) => protectedPaths.some(p => filePath.endsWith(p));

    const modifiedFiles: string[] = [];
    for (const fix of fixes) {
      if (isProtected(fix.file)) {
        console.log(`${logPrefix} [LLM_REPAIR] Skipping protected file: ${fix.file}`);
        continue;
      }
      try {
        const fullPath = path.resolve(projectPath, fix.file);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, fix.content, 'utf-8');
        modifiedFiles.push(fix.file);
      } catch { /* skip */ }
    }

    return { fixed: modifiedFiles.length > 0, filesModified: modifiedFiles, description: `Applied ${modifiedFiles.length} fix(es) via LLM` };
  } catch (llmErr) {
    console.error(`${logPrefix} [LLM_REPAIR] LLM call failed:`, llmErr);
    return { fixed: false, filesModified: [], description: `LLM error: ${llmErr instanceof Error ? llmErr.message : String(llmErr)}` };
  }
}

function extractFileRefsFromErrors(errorOutput: string, projectDir: string): string[] {
  const refs = new Set<string>();
  const patterns = [
    /(?:^|\s)(?:\.\/)?([a-zA-Z\d][\w./\\-]*\.(?:tsx?|jsx?|mjs|cjs))[\s(:]/gm,
    /\.\/([a-zA-Z\d][\w./\\-]*\.(?:tsx?|jsx?|mjs|cjs))/gm,
    /(\/[^\s:'"()]+\.(?:tsx?|jsx?|mjs|cjs))[\s(:]/gm,
    /(?:at\s+)(?:.*?)[\s(]([\w./\\-]+\.(?:tsx?|jsx?))(?:[:\d)]+)/gm,
    /Module not found.*?['"]([^'"]+)['"]/gm,
    /Cannot find module\s+['"]([^'"]+)['"]/gm,
    /(?:from|import)\s+['"](@\/[^'"]+)['"]/gm,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(errorOutput)) !== null) {
      let file = match[1];
      if (file.startsWith(projectDir)) {
        file = path.relative(projectDir, file);
      }
      if (file.startsWith('@/')) {
        const withSrc = 'src/' + file.slice(2);
        const withoutSrc = file.slice(2);
        for (const ext of ['', '.tsx', '.ts', '.jsx', '.js']) {
          if (fs.existsSync(path.join(projectDir, withSrc + ext))) { refs.add(withSrc + ext); break; }
          if (fs.existsSync(path.join(projectDir, withoutSrc + ext))) { refs.add(withoutSrc + ext); break; }
        }
        continue;
      }
      if (!file.includes('node_modules') && !file.includes('.next')) {
        if (file.includes('/') || file.includes('\\')) {
          refs.add(file);
        }
      }
    }
  }
  return Array.from(refs);
}

function buildRepairPrompt(
  errors: string,
  fileContents: Record<string, string>,
  attempt: number,
  projectDir?: string,
): string {
  const filesSection = Object.entries(fileContents)
    .map(([name, content]) => `--- ${name} ---\n${content}`)
    .join('\n\n');

  let projectInfo = '';
  if (projectDir) {
    const hasSrc = fs.existsSync(path.join(projectDir, 'src'));
    const prefix = hasSrc ? 'src/' : '';
    const uiComponentsDir = path.join(projectDir, prefix, 'components', 'ui');
    let availableUiComponents: string[] = [];
    try {
      if (fs.existsSync(uiComponentsDir)) {
        availableUiComponents = fs.readdirSync(uiComponentsDir)
          .filter(f => f.endsWith('.tsx'))
          .map(f => f.replace('.tsx', ''));
      }
    } catch { /* skip */ }

    projectInfo = `
PROJECT STRUCTURE:
- Uses ${hasSrc ? 'src/' : ''} directory structure
- Import alias: @/ maps to ${hasSrc ? './src/*' : './*'}
- shadcn/ui components available at @/components/ui/*: ${availableUiComponents.join(', ') || 'button, card, input, label, badge, dialog, table, tabs, select'}
- Utility: import { cn } from "@/lib/utils"

COMMON FIXES:
- Add "use client" at the VERY TOP of files that use useState, useEffect, onClick, onChange, etc.
- All shadcn imports: import { ComponentName } from "@/components/ui/component-name"
- If a component is not available, remove the import and use an alternative or create a simple version
- For TypeScript errors about missing types, add proper type annotations or use 'any' as last resort
- For "Module not found" errors, check if the import path uses the correct @/ alias
`;
  }

  return `Fix the following build/type errors in this Next.js App Router project (attempt ${attempt}).

ERRORS:
${errors}
${projectInfo}
CURRENT FILES:
${filesSection}

Return a JSON array of fixes. Each fix should have:
- "file": relative file path
- "content": the complete corrected file content

CRITICAL RULES:
1. Fix ALL errors across ALL files — not just the first error
2. Add "use client" at the VERY FIRST LINE of any file using useState, useEffect, onClick, onChange, useRouter, usePathname, or any browser API
3. Every import must resolve: use @/ alias
4. Only import shadcn/ui components that exist — if unsure, create the component inline
5. Fix TypeScript type errors: add proper type annotations, use 'any' as a last resort
6. Do NOT remove functionality — fix errors while preserving the app's intent
7. Return ONLY the JSON array — no markdown fences, no explanation text`;
}

function parseRepairResponse(text: string): Array<{ file: string; content: string }> | null {
  try {
    let cleaned = text.trim();
    const jsonBlockMatch = cleaned.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
    if (jsonBlockMatch) {
      cleaned = jsonBlockMatch[1].trim();
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    const arrayStart = cleaned.indexOf('[');
    const arrayEnd = cleaned.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      cleaned = cleaned.slice(arrayStart, arrayEnd + 1);
    }
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (item: any) => typeof item.file === 'string' && typeof item.content === 'string'
    );
  } catch {
    return null;
  }
}
