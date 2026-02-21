/**
 * Doctor Card — Final diagnostics card payload and action contracts.
 *
 * Shows quality gate results, dev server status, and actionable buttons.
 * Persists results to .ordinex/context.json.
 */

import type { DoctorStatus, ScaffoldStage } from './blueprintSchema';
import type { GateCheckResult, PipelineResult } from './qualityGatePipeline';

// ============================================================================
// TYPES
// ============================================================================

export type DoctorActionId =
  | 'fix_automatically'
  | 'fix_and_resume'
  | 'open_logs'
  | 'rollback'
  | 'commit_stash_merge'
  | 'resolve_conflicts'
  | 'open_conflict_files'
  | 'open_dev_server'
  | 'restart_dev_server';

export interface DoctorAction {
  id: DoctorActionId;
  label: string;
  description?: string;
  variant: 'primary' | 'secondary' | 'destructive';
  enabled: boolean;
}

export interface DoctorCheckDisplay {
  name: string;
  label: string;
  status: 'pass' | 'fail' | 'unknown' | 'warning' | 'skip';
  details?: string;
  icon: string;
}

export interface DoctorCardPayload {
  stage: ScaffoldStage | 'final';
  overall: 'healthy' | 'degraded' | 'failing';
  checks: DoctorCheckDisplay[];
  actions: DoctorAction[];
  devServerUrl?: string;
  lastCommit?: string;
  scaffoldRunId?: string;
}

// ============================================================================
// PAYLOAD BUILDERS
// ============================================================================

function statusIcon(status: string): string {
  switch (status) {
    case 'pass': return '\u2705';
    case 'fail': return '\u274C';
    case 'warning': return '\u26A0\uFE0F';
    case 'skip': return '\u23ED\uFE0F';
    default: return '\u2753';
  }
}

/**
 * Build a Doctor Card payload from pipeline results and context.
 */
export function buildDoctorCardPayload(opts: {
  pipelineResult?: PipelineResult;
  doctorStatus: DoctorStatus;
  devServerUrl?: string;
  lastCommit?: string;
  scaffoldRunId?: string;
  hasDirtyWorktree?: boolean;
  hasMergeConflicts?: boolean;
  failedStage?: ScaffoldStage;
}): DoctorCardPayload {
  const { doctorStatus, devServerUrl, lastCommit, scaffoldRunId } = opts;

  const checks: DoctorCheckDisplay[] = [
    {
      name: 'tsc',
      label: 'TypeScript',
      status: doctorStatus.tsc,
      icon: statusIcon(doctorStatus.tsc),
    },
    {
      name: 'eslint',
      label: 'ESLint',
      status: doctorStatus.eslint,
      icon: statusIcon(doctorStatus.eslint),
    },
    {
      name: 'build',
      label: 'Build',
      status: doctorStatus.build,
      icon: statusIcon(doctorStatus.build),
    },
    {
      name: 'devServer',
      label: 'Dev Server',
      status: doctorStatus.devServer.status === 'running' ? 'pass' :
        doctorStatus.devServer.status === 'fail' ? 'fail' : 'unknown',
      details: devServerUrl || undefined,
      icon: statusIcon(doctorStatus.devServer.status === 'running' ? 'pass' :
        doctorStatus.devServer.status === 'fail' ? 'fail' : 'unknown'),
    },
  ];

  // Add pipeline-specific check details
  if (opts.pipelineResult) {
    for (const check of opts.pipelineResult.checks) {
      const existing = checks.find(c => c.name === check.name);
      if (existing && check.output) {
        existing.details = check.output.slice(0, 200);
      }
    }
  }

  // Compute overall status
  const failCount = checks.filter(c => c.status === 'fail').length;
  const overall = failCount === 0 ? 'healthy' : failCount <= 1 ? 'degraded' : 'failing';

  // Build actions
  const actions: DoctorAction[] = [];

  if (failCount > 0) {
    actions.push({
      id: 'fix_automatically',
      label: 'Fix automatically',
      variant: 'primary',
      enabled: true,
    });
  }

  if (opts.failedStage) {
    actions.push({
      id: 'fix_and_resume',
      label: 'Fix and resume scaffold',
      description: `Resume from ${opts.failedStage}`,
      variant: 'primary',
      enabled: true,
    });
  }

  actions.push({
    id: 'open_logs',
    label: 'Open logs',
    variant: 'secondary',
    enabled: true,
  });

  if (lastCommit) {
    actions.push({
      id: 'rollback',
      label: 'Rollback to last good commit',
      variant: 'destructive',
      enabled: true,
    });
  }

  if (opts.hasDirtyWorktree) {
    actions.push({
      id: 'commit_stash_merge',
      label: 'Commit or Stash changes, then Merge',
      variant: 'secondary',
      enabled: true,
    });
  }

  if (opts.hasMergeConflicts) {
    actions.push({
      id: 'resolve_conflicts',
      label: 'Resolve conflicts',
      variant: 'primary',
      enabled: true,
    });
    actions.push({
      id: 'open_conflict_files',
      label: 'Open conflict files',
      variant: 'secondary',
      enabled: true,
    });
  }

  if (devServerUrl) {
    actions.push({
      id: 'open_dev_server',
      label: 'Open preview',
      variant: 'secondary',
      enabled: true,
    });
  } else if (doctorStatus.devServer.status === 'fail') {
    actions.push({
      id: 'restart_dev_server',
      label: 'Restart dev server',
      variant: 'secondary',
      enabled: true,
    });
  }

  return {
    stage: opts.failedStage || 'final',
    overall,
    checks,
    actions,
    devServerUrl,
    lastCommit,
    scaffoldRunId,
  };
}

/**
 * Merge pipeline gate results into a DoctorStatus.
 */
export function pipelineToDoctorStatus(
  pipeline: PipelineResult,
  existingStatus?: DoctorStatus,
): DoctorStatus {
  const base: DoctorStatus = existingStatus || {
    tsc: 'unknown',
    eslint: 'unknown',
    build: 'unknown',
    devServer: { status: 'unknown', url: '' },
  };

  return {
    ...base,
    ...pipeline.doctorStatus,
    devServer: base.devServer,
  };
}
