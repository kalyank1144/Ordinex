import { describe, it, expect } from 'vitest';
import { buildDoctorCardPayload, pipelineToDoctorStatus } from '../scaffold/doctorCard';
import type { DoctorStatus } from '../scaffold/blueprintSchema';
import type { PipelineResult } from '../scaffold/qualityGatePipeline';

describe('buildDoctorCardPayload', () => {
  const healthyStatus: DoctorStatus = {
    tsc: 'pass',
    eslint: 'pass',
    build: 'pass',
    devServer: { status: 'running', url: 'http://localhost:3000' },
  };

  it('builds healthy payload when all checks pass', () => {
    const payload = buildDoctorCardPayload({
      doctorStatus: healthyStatus,
      devServerUrl: 'http://localhost:3000',
    });
    expect(payload.overall).toBe('healthy');
    expect(payload.checks).toHaveLength(4);
    expect(payload.actions.some(a => a.id === 'open_dev_server')).toBe(true);
  });

  it('builds failing payload with fix action', () => {
    const failingStatus: DoctorStatus = {
      tsc: 'fail',
      eslint: 'fail',
      build: 'fail',
      devServer: { status: 'fail', url: '' },
    };
    const payload = buildDoctorCardPayload({ doctorStatus: failingStatus });
    expect(payload.overall).toBe('failing');
    expect(payload.actions.some(a => a.id === 'fix_automatically')).toBe(true);
  });

  it('includes dirty worktree action when specified', () => {
    const payload = buildDoctorCardPayload({
      doctorStatus: healthyStatus,
      hasDirtyWorktree: true,
    });
    expect(payload.actions.some(a => a.id === 'commit_stash_merge')).toBe(true);
  });

  it('includes conflict actions when specified', () => {
    const payload = buildDoctorCardPayload({
      doctorStatus: healthyStatus,
      hasMergeConflicts: true,
    });
    expect(payload.actions.some(a => a.id === 'resolve_conflicts')).toBe(true);
    expect(payload.actions.some(a => a.id === 'open_conflict_files')).toBe(true);
  });

  it('includes resume action when stage failed', () => {
    const payload = buildDoctorCardPayload({
      doctorStatus: { ...healthyStatus, tsc: 'fail' },
      failedStage: 'gen_pages',
    });
    expect(payload.actions.some(a => a.id === 'fix_and_resume')).toBe(true);
    expect(payload.stage).toBe('gen_pages');
  });

  it('includes rollback when lastCommit is set', () => {
    const payload = buildDoctorCardPayload({
      doctorStatus: healthyStatus,
      lastCommit: 'abc123',
    });
    expect(payload.actions.some(a => a.id === 'rollback')).toBe(true);
    expect(payload.lastCommit).toBe('abc123');
  });
});

describe('pipelineToDoctorStatus', () => {
  it('merges pipeline results into doctor status', () => {
    const pipeline: PipelineResult = {
      stage: 'gen_pages',
      passed: true,
      checks: [
        { name: 'tsc', status: 'pass', durationMs: 100 },
        { name: 'eslint', status: 'pass', durationMs: 50 },
        { name: 'build', status: 'pass', durationMs: 200 },
      ],
      doctorStatus: { tsc: 'pass', eslint: 'pass', build: 'pass' },
    };
    const status = pipelineToDoctorStatus(pipeline);
    expect(status.tsc).toBe('pass');
    expect(status.eslint).toBe('pass');
    expect(status.build).toBe('pass');
    expect(status.devServer.status).toBe('unknown');
  });

  it('preserves existing devServer status', () => {
    const existing: DoctorStatus = {
      tsc: 'unknown',
      eslint: 'unknown',
      build: 'unknown',
      devServer: { status: 'running', url: 'http://localhost:3000' },
    };
    const pipeline: PipelineResult = {
      stage: 'tokens',
      passed: true,
      checks: [],
      doctorStatus: { tsc: 'pass' },
    };
    const status = pipelineToDoctorStatus(pipeline, existing);
    expect(status.devServer.status).toBe('running');
    expect(status.devServer.url).toBe('http://localhost:3000');
  });
});
