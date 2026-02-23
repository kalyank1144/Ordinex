/**
 * Pipeline Types — Shared types for the post-scaffold pipeline.
 *
 * Extracted from postScaffoldOrchestrator.ts to avoid circular deps
 * and provide a clean interface for stage modules.
 */

import type { Event, Mode, Stage, FeatureRequirements } from '../types';
import type { RecipeId } from './recipeTypes';
import type { DesignPackId } from './designPacks';
import type { FeatureLLMClient } from './featureExtractor';
import type { AppBlueprint, DoctorStatus, StyleInput } from './blueprintSchema';
import type { VerifyStepResult, VerifyOutcome } from './postVerify';
import type { DoctorCardPayload } from './doctorCard';
import type { DesignTokens } from './tokenValidator';

// ============================================================================
// EVENT PUBLISHER
// ============================================================================

export interface EventPublisher {
  publish(event: Event): void | Promise<void>;
}

// ============================================================================
// CONTEXT
// ============================================================================

export interface PostScaffoldContext {
  taskId: string;
  scaffoldId: string;
  targetDirectory: string;
  appName: string;
  recipeId: RecipeId;
  designPackId: DesignPackId;
  eventBus: EventPublisher;
  mode: Mode;
  userPrompt?: string;
  llmClient?: FeatureLLMClient;
  blueprint?: AppBlueprint;
  styleInput?: StyleInput;
  /** User's selected model ID (fully-qualified Anthropic model name). All LLM calls in the pipeline use this. */
  modelId: string;
  /** @deprecated Enhanced pipeline is now the only path. */
  useEnhancedPipeline?: boolean;
  /** Optional logger callback — when provided, pipeline stages write structured logs to this function (e.g. VS Code Output Channel). */
  logger?: (msg: string) => void;
}

// ============================================================================
// RESULTS
// ============================================================================

export interface PostScaffoldResult {
  success: boolean;
  projectPath?: string;
  designPackApplied?: boolean;
  modifiedFiles?: string[];
  featureCodeApplied?: boolean;
  featureRequirements?: FeatureRequirements;
  verificationOutcome?: VerifyOutcome;
  verificationSteps?: VerifyStepResult[];
  error?: string;
  failedStage?: 'polling' | 'design_pack' | 'feature_generation' | 'verification' | 'next_steps' | 'overlay' | 'shadcn' | 'tokens' | 'quality_gate';
  doctorCard?: DoctorCardPayload;
  lastCommitHash?: string;
}

export interface PostScaffoldPollingConfig {
  maxWaitMs: number;
  pollIntervalMs: number;
  completionMarker: string;
  stabilizationDelayMs?: number;
}

export const DEFAULT_POLLING_CONFIG: PostScaffoldPollingConfig = {
  maxWaitMs: 300000,
  pollIntervalMs: 2000,
  completionMarker: 'package.json',
};

// ============================================================================
// STAGE CONTEXT (passed to each pipeline stage)
// ============================================================================

export interface PipelineStageContext {
  ctx: PostScaffoldContext;
  projectPath: string;
  logPrefix: string;
}

/**
 * Mutable state that flows through the pipeline stages.
 * Each stage reads and writes to this shared state object.
 */
export interface PipelineState {
  lastCommitHash?: string;
  designTokens: DesignTokens;
  darkTokens?: DesignTokens;
  shadcnVars: Record<string, string>;
  featureCodeApplied: boolean;
  featureRequirements?: FeatureRequirements;
  doctorStatus: DoctorStatus;
  doctorCard?: DoctorCardPayload;
  tailwindVersion: 3 | 4;
  hasSrcDir: boolean;
}

export const DEFAULT_DESIGN_TOKENS: DesignTokens = {
  background: '#ffffff',
  foreground: '#0f172a',
  primary: '#6366f1',
  primary_foreground: '#ffffff',
  secondary: '#f1f5f9',
  secondary_foreground: '#1e293b',
  muted: '#f1f5f9',
  muted_foreground: '#64748b',
  destructive: '#ef4444',
  destructive_foreground: '#ffffff',
  accent: '#8b5cf6',
  accent_foreground: '#ffffff',
  card: '#ffffff',
  card_foreground: '#0f172a',
  popover: '#ffffff',
  popover_foreground: '#0f172a',
  border: '#e2e8f0',
  input: '#e2e8f0',
  ring: '#6366f1',
  chart_1: '#6366f1',
  chart_2: '#8b5cf6',
  chart_3: '#ec4899',
  chart_4: '#f59e0b',
  chart_5: '#10b981',
  sidebar: '#f8fafc',
  sidebar_foreground: '#0f172a',
  sidebar_primary: '#6366f1',
  sidebar_primary_foreground: '#ffffff',
  sidebar_accent: '#f1f5f9',
  sidebar_accent_foreground: '#0f172a',
  sidebar_border: '#e2e8f0',
  sidebar_ring: '#6366f1',
  radius: '0.5rem',
};
