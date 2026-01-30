/**
 * Step 34.5: Base Command Execution Policy
 * 
 * Shared policy for all command execution (verify, user-run, future scaffold).
 * 
 * CRITICAL RULES:
 * - Default mode: 'prompt' (always ask for approval)
 * - Auto mode: only for allowlisted FINITE commands
 * - Long-running commands (dev servers): ALWAYS require prompt, NEVER auto
 * - Blocklist prevents dangerous operations regardless of mode
 * - Policy snapshot must be deterministic and replayable
 */

/**
 * Command execution mode
 */
export type CommandMode = 'off' | 'prompt' | 'auto';

/**
 * Base command policy configuration
 * 
 * This is the shared foundation for all command execution.
 * VerifyPolicy extends this with verify-specific settings.
 */
export interface CommandPolicyConfig {
  /** Execution mode (default: 'prompt') */
  mode: CommandMode;
  
  /** Allowlist patterns for safe commands */
  allowlistPatterns: RegExp[];
  
  /** Blocklist patterns for dangerous commands */
  blocklistPatterns: RegExp[];
  
  /** Long-running command patterns (dev servers, watchers) */
  longRunningPatterns: RegExp[];
  
  /** Maximum output bytes per command (default: 3MB) */
  maxOutputBytesPerCommand: number;
  
  /** Throttle interval for streaming output (default: 250ms) */
  chunkThrottleMs: number;
  
  /** Default timeout for finite commands (default: 10 minutes) */
  defaultTimeoutMs: number;
}

/**
 * Default command policy (conservative, safe)
 */
export const DEFAULT_COMMAND_POLICY: CommandPolicyConfig = {
  mode: 'prompt',
  
  // Safe, read-only or standard build/test commands
  allowlistPatterns: [
    /^npm\s+(test|run\s+test|run\s+build|run\s+lint|run\s+typecheck|run\s+check)/,
    /^pnpm\s+(test|run\s+test|run\s+build|run\s+lint|run\s+typecheck|run\s+check)/,
    /^yarn\s+(test|run\s+test|run\s+build|run\s+lint|run\s+typecheck|run\s+check)/,
    /^tsc\s+(--noEmit|--build)/,
    /^eslint\s+/,
    /^prettier\s+--check/,
    /^jest\s+/,
    /^vitest\s+run/,
    /^node\s+.*\.js$/,
  ],
  
  // Dangerous operations that should NEVER auto-run
  blocklistPatterns: [
    /\brm\s+-rf\b/,
    /\bsudo\b/,
    /\bchmod\b/,
    /\bgit\s+push\b/,
    /\bnpm\s+publish\b/,
    /\bpnpm\s+publish\b/,
    /\byarn\s+publish\b/,
    /\bcurl\s+.*\|\s*bash\b/,
    /\bwget\s+.*\|\s*bash\b/,
    /\b>>\s*\/etc\//,
    /\bdd\s+if=/,
  ],
  
  // Long-running commands that need prompt + stop button
  longRunningPatterns: [
    /^npm\s+run\s+(dev|start|serve|watch)/,
    /^pnpm\s+run\s+(dev|start|serve|watch)/,
    /^yarn\s+(dev|start|serve|watch)/,
    /^vite\b/,
    /^next\s+dev\b/,
    /^webpack\s+serve\b/,
    /^nodemon\b/,
    /^node\s+.*--watch\b/,
  ],
  
  maxOutputBytesPerCommand: 3 * 1024 * 1024, // 3MB
  chunkThrottleMs: 250,
  defaultTimeoutMs: 10 * 60 * 1000, // 10 minutes
};

/**
 * Classify command as finite or long-running
 * 
 * Long-running commands (dev servers, watchers):
 * - ALWAYS require prompt (even in auto mode)
 * - MUST be stoppable by user
 * - No timeout
 * 
 * Finite commands (tests, builds):
 * - Can be auto-run if allowlisted
 * - Have timeout
 * - Exit naturally
 * 
 * @param command - Command string to classify
 * @param policy - Command policy with patterns
 * @returns 'finite' or 'long_running'
 */
export function classifyCommandKind(
  command: string,
  policy: CommandPolicyConfig
): 'finite' | 'long_running' {
  const normalized = command.trim().toLowerCase();
  
  // Check long-running patterns
  for (const pattern of policy.longRunningPatterns) {
    if (pattern.test(normalized)) {
      return 'long_running';
    }
  }
  
  return 'finite';
}

/**
 * Check if command is safe to execute
 * 
 * Safety rules:
 * 1. Blocklist always wins (reject immediately)
 * 2. If not on allowlist and mode is 'auto', reject
 * 3. If on allowlist or mode is 'prompt', allow (with prompt if needed)
 * 
 * @param command - Command to check
 * @param policy - Command policy
 * @returns Safety check result
 */
export function isCommandSafe(
  command: string,
  policy: CommandPolicyConfig
): { safe: boolean; reason?: string } {
  const normalized = command.trim().toLowerCase();
  
  // Check blocklist first (always reject)
  for (const pattern of policy.blocklistPatterns) {
    if (pattern.test(normalized)) {
      return {
        safe: false,
        reason: `Blocked by safety policy: matches dangerous pattern "${pattern.source}"`,
      };
    }
  }
  
  // Check allowlist
  const onAllowlist = policy.allowlistPatterns.some((pattern) =>
    pattern.test(normalized)
  );
  
  // If auto mode, must be on allowlist
  if (policy.mode === 'auto' && !onAllowlist) {
    return {
      safe: false,
      reason: 'Command not on allowlist for auto-execution',
    };
  }
  
  // Otherwise safe (may still require prompt)
  return { safe: true };
}

/**
 * Resolve command policy from workspace and global settings
 * 
 * Priority:
 * 1. Workspace settings (if present)
 * 2. Global settings (if present)
 * 3. Defaults
 * 
 * IMPORTANT: Returns a SNAPSHOT for this run.
 * This snapshot is stored in run metadata for deterministic replay.
 * 
 * @param workspaceSettings - Workspace-level settings (optional)
 * @param globalSettings - Global settings (optional)
 * @returns Resolved command policy snapshot
 */
export function resolveCommandPolicy(
  workspaceSettings?: Partial<CommandPolicyConfig>,
  globalSettings?: Partial<CommandPolicyConfig>
): CommandPolicyConfig {
  // Merge with priority: workspace > global > defaults
  const resolved: CommandPolicyConfig = {
    ...DEFAULT_COMMAND_POLICY,
    ...globalSettings,
    ...workspaceSettings,
  };
  
  // Ensure arrays are properly merged (not replaced)
  if (globalSettings?.allowlistPatterns || workspaceSettings?.allowlistPatterns) {
    resolved.allowlistPatterns = [
      ...DEFAULT_COMMAND_POLICY.allowlistPatterns,
      ...(globalSettings?.allowlistPatterns || []),
      ...(workspaceSettings?.allowlistPatterns || []),
    ];
  }
  
  if (globalSettings?.blocklistPatterns || workspaceSettings?.blocklistPatterns) {
    resolved.blocklistPatterns = [
      ...DEFAULT_COMMAND_POLICY.blocklistPatterns,
      ...(globalSettings?.blocklistPatterns || []),
      ...(workspaceSettings?.blocklistPatterns || []),
    ];
  }
  
  if (globalSettings?.longRunningPatterns || workspaceSettings?.longRunningPatterns) {
    resolved.longRunningPatterns = [
      ...DEFAULT_COMMAND_POLICY.longRunningPatterns,
      ...(globalSettings?.longRunningPatterns || []),
      ...(workspaceSettings?.longRunningPatterns || []),
    ];
  }
  
  return resolved;
}

/**
 * Serialize command policy for evidence/audit
 * 
 * Converts RegExp patterns to strings for JSON serialization.
 * This is stored with run metadata for replay.
 * 
 * @param policy - Command policy to serialize
 * @returns Serializable policy object
 */
export function serializeCommandPolicy(
  policy: CommandPolicyConfig
): Record<string, unknown> {
  return {
    mode: policy.mode,
    allowlistPatterns: policy.allowlistPatterns.map((p) => p.source),
    blocklistPatterns: policy.blocklistPatterns.map((p) => p.source),
    longRunningPatterns: policy.longRunningPatterns.map((p) => p.source),
    maxOutputBytesPerCommand: policy.maxOutputBytesPerCommand,
    chunkThrottleMs: policy.chunkThrottleMs,
    defaultTimeoutMs: policy.defaultTimeoutMs,
  };
}

/**
 * Deserialize command policy from stored evidence
 * 
 * Converts string patterns back to RegExp objects.
 * Used during replay to reconstruct policy snapshot.
 * 
 * @param serialized - Serialized policy object
 * @returns Reconstructed command policy
 */
export function deserializeCommandPolicy(
  serialized: Record<string, unknown>
): CommandPolicyConfig {
  return {
    mode: serialized.mode as CommandMode,
    allowlistPatterns: (serialized.allowlistPatterns as string[]).map(
      (s) => new RegExp(s)
    ),
    blocklistPatterns: (serialized.blocklistPatterns as string[]).map(
      (s) => new RegExp(s)
    ),
    longRunningPatterns: (serialized.longRunningPatterns as string[]).map(
      (s) => new RegExp(s)
    ),
    maxOutputBytesPerCommand: serialized.maxOutputBytesPerCommand as number,
    chunkThrottleMs: serialized.chunkThrottleMs as number,
    defaultTimeoutMs: serialized.defaultTimeoutMs as number,
  };
}
