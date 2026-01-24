/**
 * Edit Evidence Manager for MISSION EDIT
 * Based on spec Section 6: PERSIST PROPOSED DIFF AS EVIDENCE
 * 
 * Handles:
 * - Writing .diff files with raw unified diff
 * - Writing .manifest.json with validation and context info
 * - Writing .apply.json after successful application
 * - Evidence directory management
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ParsedDiff } from './unifiedDiffParser';
import { FileSelectionEvidence } from './excerptSelector';
import { LLMEditStepOutput } from './llmEditTool';
import { AtomicApplyResult } from './atomicDiffApply';

/**
 * Diff manifest structure (persisted as .manifest.json)
 */
export interface DiffManifest {
  diff_id: string;
  task_id: string;
  step_id: string;
  created_at: string;
  source_context: {
    files: Array<{
      path: string;
      base_sha: string;
      lines_included: number;
    }>;
    total_lines_sent: number;
  };
  validation_report: {
    parse: 'passed' | 'failed';
    safety: 'passed' | 'failed';
    sha_match: 'passed' | 'failed';
    scope: 'passed' | 'failed';
  };
  stats: {
    files_changed: number;
    additions: number;
    deletions: number;
    total_changed_lines: number;
  };
  llm_confidence: 'low' | 'medium' | 'high';
  llm_notes: string;
}

/**
 * Apply evidence structure (persisted as .apply.json)
 */
export interface ApplyEvidence {
  diff_id: string;
  checkpoint_id: string;
  applied_at: string;
  success: boolean;
  files: Array<{
    path: string;
    before_sha: string;
    after_sha: string;
    additions: number;
    deletions: number;
  }>;
  error?: {
    type: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Edit Evidence Manager
 */
export class EditEvidenceManager {
  private readonly workspaceRoot: string;
  private readonly evidenceDir: string;

  constructor(workspaceRoot: string, evidenceDir: string = '.ordinex/evidence') {
    this.workspaceRoot = workspaceRoot;
    this.evidenceDir = path.join(workspaceRoot, evidenceDir);
  }

  /**
   * Ensure evidence directory exists
   */
  async ensureEvidenceDir(): Promise<void> {
    await fs.mkdir(this.evidenceDir, { recursive: true });
  }

  /**
   * Persist proposed diff as evidence
   * Creates both .diff and .manifest.json files
   */
  async persistProposedDiff(params: {
    diff_id: string;
    task_id: string;
    step_id: string;
    unified_diff: string;
    parsed_diff: ParsedDiff;
    source_context: FileSelectionEvidence[];
    total_lines_sent: number;
    llm_output: LLMEditStepOutput;
  }): Promise<{ diffPath: string; manifestPath: string }> {
    await this.ensureEvidenceDir();

    const {
      diff_id,
      task_id,
      step_id,
      unified_diff,
      parsed_diff,
      source_context,
      total_lines_sent,
      llm_output,
    } = params;

    // Write raw diff file
    const diffPath = path.join(this.evidenceDir, `${diff_id}.diff`);
    await fs.writeFile(diffPath, unified_diff, 'utf-8');

    // Build manifest
    const manifest: DiffManifest = {
      diff_id,
      task_id,
      step_id,
      created_at: new Date().toISOString(),
      source_context: {
        files: source_context.map(f => ({
          path: f.path,
          base_sha: f.base_sha,
          lines_included: f.lines_included,
        })),
        total_lines_sent,
      },
      validation_report: {
        parse: 'passed',
        safety: 'passed',
        sha_match: 'passed',
        scope: 'passed',
      },
      stats: {
        files_changed: parsed_diff.files.length,
        additions: parsed_diff.totalAdditions,
        deletions: parsed_diff.totalDeletions,
        total_changed_lines: parsed_diff.totalChangedLines,
      },
      llm_confidence: llm_output.confidence,
      llm_notes: llm_output.notes,
    };

    // Write manifest file
    const manifestPath = path.join(this.evidenceDir, `${diff_id}.manifest.json`);
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    return { diffPath, manifestPath };
  }

  /**
   * Persist apply evidence after successful/failed application
   */
  async persistApplyEvidence(params: {
    diff_id: string;
    checkpoint_id: string;
    apply_result: AtomicApplyResult;
  }): Promise<string> {
    await this.ensureEvidenceDir();

    const { diff_id, checkpoint_id, apply_result } = params;

    const evidence: ApplyEvidence = {
      diff_id,
      checkpoint_id,
      applied_at: new Date().toISOString(),
      success: apply_result.success,
      files: apply_result.applied_files.map(f => ({
        path: f.path,
        before_sha: f.before_sha,
        after_sha: f.after_sha,
        additions: f.additions,
        deletions: f.deletions,
      })),
    };

    if (!apply_result.success && apply_result.error) {
      evidence.error = {
        type: apply_result.error.type,
        message: apply_result.error.message,
        details: apply_result.error.details,
      };
    }

    const applyPath = path.join(this.evidenceDir, `${diff_id}.apply.json`);
    await fs.writeFile(applyPath, JSON.stringify(evidence, null, 2), 'utf-8');

    return applyPath;
  }

  /**
   * Persist edit context selection evidence
   */
  async persistContextSelectionEvidence(params: {
    step_id: string;
    files: FileSelectionEvidence[];
    total_lines: number;
    selection_method: string;
  }): Promise<string> {
    await this.ensureEvidenceDir();

    const evidence = {
      type: 'edit_context_selected',
      created_at: new Date().toISOString(),
      payload: {
        step_id: params.step_id,
        files: params.files.map(f => ({
          path: f.path,
          base_sha: f.base_sha,
          lines_included: f.lines_included,
          is_full_file: f.is_full_file,
          ranges: f.ranges,
        })),
        total_lines: params.total_lines,
        selection_method: params.selection_method,
      },
    };

    const evidencePath = path.join(this.evidenceDir, `context_${params.step_id}_${Date.now()}.json`);
    await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), 'utf-8');

    return evidencePath;
  }

  /**
   * Read diff manifest
   */
  async readManifest(diff_id: string): Promise<DiffManifest | null> {
    try {
      const manifestPath = path.join(this.evidenceDir, `${diff_id}.manifest.json`);
      const content = await fs.readFile(manifestPath, 'utf-8');
      return JSON.parse(content) as DiffManifest;
    } catch {
      return null;
    }
  }

  /**
   * Read raw diff
   */
  async readDiff(diff_id: string): Promise<string | null> {
    try {
      const diffPath = path.join(this.evidenceDir, `${diff_id}.diff`);
      return await fs.readFile(diffPath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Read apply evidence
   */
  async readApplyEvidence(diff_id: string): Promise<ApplyEvidence | null> {
    try {
      const applyPath = path.join(this.evidenceDir, `${diff_id}.apply.json`);
      const content = await fs.readFile(applyPath, 'utf-8');
      return JSON.parse(content) as ApplyEvidence;
    } catch {
      return null;
    }
  }

  /**
   * Get evidence directory path
   */
  getEvidenceDir(): string {
    return this.evidenceDir;
  }

  /**
   * List all diff IDs in evidence directory
   */
  async listDiffs(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.evidenceDir);
      return files
        .filter(f => f.endsWith('.diff'))
        .map(f => f.replace('.diff', ''));
    } catch {
      return [];
    }
  }
}

/**
 * Build diff_proposed event payload
 */
export function buildDiffProposedPayload(params: {
  diff_id: string;
  step_id: string;
  parsed_diff: ParsedDiff;
  llm_output: LLMEditStepOutput;
  manifest_path: string;
}): Record<string, unknown> {
  const { diff_id, step_id, parsed_diff, llm_output, manifest_path } = params;

  return {
    diff_id,
    step_id,
    files_changed: parsed_diff.files.map(f => ({
      path: f.newPath !== '/dev/null' ? f.newPath : f.oldPath,
      additions: f.additions,
      deletions: f.deletions,
    })),
    summary: `${llm_output.notes} (+${parsed_diff.totalAdditions}/-${parsed_diff.totalDeletions} lines)`,
    evidence_id: path.basename(manifest_path),
    llm_confidence: llm_output.confidence,
  };
}

/**
 * Build diff_applied event payload
 */
export function buildDiffAppliedPayload(params: {
  diff_id: string;
  checkpoint_id: string;
  apply_result: AtomicApplyResult;
  apply_evidence_path: string;
}): Record<string, unknown> {
  const { diff_id, checkpoint_id, apply_result, apply_evidence_path } = params;

  return {
    diff_id,
    checkpoint_id,
    files_changed: apply_result.applied_files.map(f => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
    })),
    summary: `Applied changes to ${apply_result.applied_files.length} file(s)`,
    evidence_id: path.basename(apply_evidence_path),
  };
}
