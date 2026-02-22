/**
 * Pipeline Events — All event emission helpers for the post-scaffold pipeline.
 *
 * Extracted from postScaffoldOrchestrator.ts for reuse across stage modules.
 */

import { randomUUID } from 'crypto';
import type { Event, Stage } from '../types';
import type { PostScaffoldContext } from './pipelineTypes';
import type { VerifyStepResult, VerifyOutcome } from './postVerify';
import type { DesignPack } from './designPacks';
import type { DoctorCardPayload } from './doctorCard';
import type { DoctorStatus } from './blueprintSchema';
import {
  buildNextStepsShownPayload,
  NextStepsContext,
  NextStepSuggestion,
} from './nextSteps';

export function generateEventId(): string {
  return `evt_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

export async function emitFeatureEvent(
  ctx: PostScaffoldContext,
  type: 'feature_extraction_started' | 'feature_extraction_completed' | 'feature_code_generating' | 'feature_code_applied' | 'feature_code_error',
  payload: Record<string, unknown>,
): Promise<void> {
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.taskId,
    timestamp: new Date().toISOString(),
    type: type as any,
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload,
    evidence_ids: [],
    parent_event_id: null,
  };
  await ctx.eventBus.publish(event);
}

export async function emitScaffoldProgress(
  ctx: PostScaffoldContext,
  status: 'creating' | 'applying_design' | 'timeout' | 'error',
  details: Record<string, unknown>,
): Promise<void> {
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.taskId,
    timestamp: new Date().toISOString(),
    type: 'scaffold_progress' as any,
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      scaffold_id: ctx.scaffoldId,
      status,
      ...details,
    },
    evidence_ids: [],
    parent_event_id: null,
  };
  await ctx.eventBus.publish(event);
}

export async function emitDesignPackApplied(
  ctx: PostScaffoldContext,
  designPack: DesignPack,
  modifiedFiles: string[],
): Promise<void> {
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.taskId,
    timestamp: new Date().toISOString(),
    type: 'design_pack_applied' as any,
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      scaffold_id: ctx.scaffoldId,
      design_pack_id: designPack.id,
      design_pack_name: designPack.name,
      vibe: (designPack as any).vibe,
      primary_color: designPack.tokens?.colors?.primary ?? '#6366f1',
      modified_files: modifiedFiles,
    },
    evidence_ids: [],
    parent_event_id: null,
  };
  await ctx.eventBus.publish(event);
}

export async function emitNextStepsShown(
  ctx: PostScaffoldContext,
  nextStepsContext: NextStepsContext,
  suggestions: NextStepSuggestion[],
): Promise<void> {
  const payload = buildNextStepsShownPayload(nextStepsContext, suggestions);
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.taskId,
    timestamp: new Date().toISOString(),
    type: 'next_steps_shown',
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      ...payload,
      suggestions,
      target_directory: nextStepsContext.target_directory,
    } as unknown as Record<string, unknown>,
    evidence_ids: [],
    parent_event_id: null,
  };
  await ctx.eventBus.publish(event);
}

export async function emitScaffoldFinalComplete(
  ctx: PostScaffoldContext,
  projectPath: string,
  designPackApplied: boolean,
  nextStepsCount: number,
  doctorCard?: DoctorCardPayload,
  doctorStatus?: DoctorStatus,
  projectSummary?: { summary: string; features_built: string[]; suggested_features: string[]; access_url: string } | null,
): Promise<void> {
  const blueprintSummary = ctx.blueprint ? {
    app_name: ctx.blueprint.app_name,
    app_type: ctx.blueprint.app_type,
    pages_count: ctx.blueprint.pages.length,
    features_count: ctx.blueprint.features?.length || 0,
    components_count: ctx.blueprint.shadcn_components?.length || 0,
    pages: ctx.blueprint.pages.map(p => ({
      name: p.name,
      route: p.path,
      component_count: p.key_components?.length || 0,
    })),
    features: (ctx.blueprint.features || []).map(f => typeof f === 'string' ? f : (f as any).name || String(f)),
    shadcn_components: ctx.blueprint.shadcn_components || [],
  } : undefined;

  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.taskId,
    timestamp: new Date().toISOString(),
    type: 'scaffold_final_complete' as any,
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      scaffold_id: ctx.scaffoldId,
      project_path: projectPath,
      design_pack_applied: designPackApplied,
      design_pack_name: ctx.designPackId,
      next_steps_available: nextStepsCount,
      status: 'success',
      success: true,
      blueprint_summary: blueprintSummary,
      doctor_card: doctorCard || undefined,
      doctor_status: doctorStatus || undefined,
      project_summary: projectSummary || undefined,
    },
    evidence_ids: [],
    parent_event_id: null,
  };
  await ctx.eventBus.publish(event);
}

export async function emitVerifyStarted(
  ctx: PostScaffoldContext,
  projectPath: string,
  recipeId: string,
): Promise<void> {
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.taskId,
    timestamp: new Date().toISOString(),
    type: 'scaffold_verify_started' as any,
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      scaffold_id: ctx.scaffoldId,
      project_path: projectPath,
      recipe_id: recipeId,
      message: 'Running post-scaffold verification...',
    },
    evidence_ids: [],
    parent_event_id: null,
  };
  await ctx.eventBus.publish(event);
}

export async function emitVerifyStepCompleted(
  ctx: PostScaffoldContext,
  step: VerifyStepResult,
): Promise<void> {
  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.taskId,
    timestamp: new Date().toISOString(),
    type: 'scaffold_verify_step_completed' as any,
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      scaffold_id: ctx.scaffoldId,
      step_name: step.id,
      step_status: step.status,
      duration_ms: step.durationMs,
      message: step.message || `${step.id}: ${step.status}`,
      output: step.output || undefined,
    },
    evidence_ids: [],
    parent_event_id: null,
  };
  await ctx.eventBus.publish(event);
}

export async function emitVerifyCompleted(
  ctx: PostScaffoldContext,
  outcome: VerifyOutcome,
  steps: VerifyStepResult[],
  durationMs: number,
  packageManager: string,
): Promise<void> {
  const passCount = steps.filter(s => s.status === 'pass').length;
  const failCount = steps.filter(s => s.status === 'fail').length;
  const warnCount = steps.filter(s => s.status === 'warn').length;
  const skipCount = steps.filter(s => s.status === 'skipped').length;

  const event: Event = {
    event_id: generateEventId(),
    task_id: ctx.taskId,
    timestamp: new Date().toISOString(),
    type: 'scaffold_verify_completed' as any,
    mode: ctx.mode,
    stage: 'plan' as Stage,
    payload: {
      scaffold_id: ctx.scaffoldId,
      outcome,
      total_steps: steps.length,
      pass_count: passCount,
      fail_count: failCount,
      warn_count: warnCount,
      skip_count: skipCount,
      duration_ms: durationMs,
      package_manager: packageManager,
      message: `Verification ${outcome}: ${passCount} passed, ${failCount} failed, ${warnCount} warnings, ${skipCount} skipped`,
    },
    evidence_ids: [],
    parent_event_id: null,
  };
  await ctx.eventBus.publish(event);
}
