/**
 * Scaffold Session — Context threading for follow-up prompts.
 *
 * After scaffold completion, this session stores everything the agent
 * needs to understand the project context when handling follow-up prompts.
 * No special routing needed — the enriched system prompt gives the agent
 * full awareness of what was built.
 */

import type { RecipeId } from './recipeTypes';
import type { DoctorStatus } from './blueprintSchema';
import type { DoctorCardPayload } from './doctorCard';

export interface ScaffoldSession {
  projectPath: string;
  appName: string;
  recipeId: RecipeId;
  designPackId: string;
  createdAt: string;
  blueprint?: {
    appType: string;
    pages: Array<{ name: string; path: string }>;
    features: string[];
    shadcnComponents: string[];
  };
  doctorStatus?: DoctorStatus;
  doctorCard?: DoctorCardPayload;
  projectSummary?: {
    summary: string;
    featuresBuilt: string[];
    suggestedFeatures: string[];
    accessUrl: string;
  };
  lastCommitHash?: string;
}

/**
 * Build a context block to inject into the agent's system prompt
 * when a follow-up prompt is sent after scaffold completion.
 */
export function buildFollowUpContext(session: ScaffoldSession): string {
  const lines: string[] = [
    `[Project Context]`,
    `Project: ${session.appName}`,
    `Path: ${session.projectPath}`,
    `Framework: ${session.recipeId}`,
    `Design: ${session.designPackId}`,
  ];

  if (session.blueprint) {
    lines.push(`App Type: ${session.blueprint.appType}`);
    if (session.blueprint.pages.length > 0) {
      lines.push(`Pages: ${session.blueprint.pages.map(p => `${p.name} (${p.path})`).join(', ')}`);
    }
    if (session.blueprint.features.length > 0) {
      lines.push(`Features: ${session.blueprint.features.join(', ')}`);
    }
  }

  if (session.doctorStatus) {
    const status = session.doctorStatus;
    const healthy = status.tsc === 'pass' && status.eslint === 'pass' && status.build === 'pass';
    if (healthy) {
      lines.push(`Health: All checks passing (tsc, eslint, build)`);
    } else {
      const issues: string[] = [];
      if (status.tsc === 'fail') issues.push('TypeScript errors');
      if (status.eslint === 'fail') issues.push('ESLint errors');
      if (status.build === 'fail') issues.push('Build errors');
      lines.push(`Health: Issues detected — ${issues.join(', ')}`);
    }
  }

  if (session.projectSummary) {
    lines.push(`Summary: ${session.projectSummary.summary}`);
    if (session.projectSummary.accessUrl) {
      lines.push(`Dev URL: ${session.projectSummary.accessUrl}`);
    }
  }

  return lines.join('\n');
}

/**
 * Create a ScaffoldSession from post-scaffold completion data.
 */
export function createScaffoldSession(params: {
  projectPath: string;
  appName: string;
  recipeId: RecipeId;
  designPackId: string;
  blueprint?: any;
  doctorStatus?: DoctorStatus;
  doctorCard?: DoctorCardPayload;
  projectSummary?: any;
  lastCommitHash?: string;
}): ScaffoldSession {
  const session: ScaffoldSession = {
    projectPath: params.projectPath,
    appName: params.appName,
    recipeId: params.recipeId,
    designPackId: params.designPackId,
    createdAt: new Date().toISOString(),
    lastCommitHash: params.lastCommitHash,
  };

  if (params.blueprint) {
    session.blueprint = {
      appType: params.blueprint.app_type || params.blueprint.appType || 'unknown',
      pages: (params.blueprint.pages || []).map((p: any) => ({
        name: p.name,
        path: p.path,
      })),
      features: (params.blueprint.features || []).map((f: any) =>
        typeof f === 'string' ? f : f.name || String(f)
      ),
      shadcnComponents: params.blueprint.shadcn_components || params.blueprint.shadcnComponents || [],
    };
  }

  if (params.doctorStatus) {
    session.doctorStatus = params.doctorStatus;
  }

  if (params.doctorCard) {
    session.doctorCard = params.doctorCard;
  }

  if (params.projectSummary) {
    session.projectSummary = {
      summary: params.projectSummary.summary || '',
      featuresBuilt: params.projectSummary.features_built || params.projectSummary.featuresBuilt || [],
      suggestedFeatures: params.projectSummary.suggested_features || params.projectSummary.suggestedFeatures || [],
      accessUrl: params.projectSummary.access_url || params.projectSummary.accessUrl || 'http://localhost:3000',
    };
  }

  return session;
}
