/**
 * Step 34: Verify Policy Configuration
 * 
 * Defines safe verification policies for post-apply command execution.
 * 
 * CRITICAL RULES:
 * - Never run destructive commands automatically
 * - 'prompt' is the default mode (user confirms each verify run)
 * - 'auto' is opt-in and only for allowlisted safe commands
 * - Policy is snapshotted at run start for audit/replay
 */

/**
 * Verify execution mode
 * - off: Skip verification entirely
 * - prompt: Ask user before running commands (default, safest)
 * - auto: Run allowlisted safe commands automatically
 */
export type VerifyMode = 'off' | 'prompt' | 'auto';

/**
 * Verify policy configuration
 * 
 * This controls how verification commands are discovered and executed
 * after code changes are applied.
 */
export interface VerifyPolicyConfig {
  /**
   * Execution mode for verification commands
   * Default: 'prompt' (always ask before running)
   */
  mode: VerifyMode;

  /**
   * Maximum repair attempts per verification failure
   * After this cap, system will emit decision_point_needed
   * Default: 2
   */
  maxFixAttemptsPerVerify: number;

  /**
   * Allowlist patterns for safe verify commands
   * Only commands matching these patterns can run in 'auto' mode
   * Examples: lint, test (with no-watch), build
   */
  allowlistPatterns: RegExp[];

  /**
   * Blocklist patterns for dangerous commands
   * Commands matching these are NEVER safe to auto-run
   * Examples: rm, dd, format, deploy, publish
   */
  blocklistPatterns: RegExp[];

  /**
   * Maximum output bytes per command (prevent memory blowup)
   * If output exceeds this, truncate and store as referenced evidence
   * Default: 5MB (5 * 1024 * 1024)
   */
  maxOutputBytesPerCommand: number;

  /**
   * Throttle interval for streaming output chunks (ms)
   * Prevents UI spam from high-frequency output
   * Default: 250ms
   */
  chunkThrottleMs: number;

  /**
   * Command timeout in milliseconds
   * Kill command if it runs longer than this
   * Default: 5 minutes (300000ms)
   */
  commandTimeoutMs: number;

  /**
   * Whether to kill command on first error exit code
   * If true, stop verification on first failure
   * If false, run all commands regardless
   * Default: true
   */
  failFast: boolean;
}

/**
 * Default verify policy configuration
 * 
 * SAFE DEFAULTS:
 * - prompt mode (never auto-run)
 * - 2 repair attempts max
 * - Common safe commands allowlisted
 * - Dangerous patterns blocklisted
 * - Reasonable output/time caps
 */
export const DEFAULT_VERIFY_POLICY: VerifyPolicyConfig = {
  mode: 'prompt',
  maxFixAttemptsPerVerify: 2,
  
  // Allowlist: Common safe verification commands
  allowlistPatterns: [
    /^npm\s+(run\s+)?(lint|test|build|check|typecheck|tsc)/,
    /^pnpm\s+(run\s+)?(lint|test|build|check|typecheck|tsc)/,
    /^yarn\s+(run\s+)?(lint|test|build|check|typecheck|tsc)/,
    /^eslint\b/,
    /^tsc\b.*--noEmit/,
    /^prettier\b.*--check/,
    /^jest\b.*--no-watch/,
    /^vitest\b.*--run/,
    /^cargo\s+(test|check|clippy)\b/,
    /^go\s+(test|vet|build)\b/,
    /^python\s+-m\s+(pytest|unittest)\b/,
    /^mvn\s+(test|verify)\b/,
    /^gradle\s+(test|check)\b/,
  ],
  
  // Blocklist: Dangerous patterns that should NEVER auto-run
  blocklistPatterns: [
    /\brm\b.*-rf?\b/,           // Dangerous file deletion
    /\bdd\b/,                    // Disk operations
    /\bformat\b/,                // Disk formatting
    /\bmkfs\b/,                  // File system creation
    /\bsudo\b/,                  // Privilege escalation
    /\bcurl\b.*\|\s*bash/,       // Pipe to shell
    /\bwget\b.*\|\s*sh/,         // Pipe to shell
    /\bnpm\s+publish\b/,         // Publishing
    /\byarn\s+publish\b/,        // Publishing
    /\bpnpm\s+publish\b/,        // Publishing
    /\bgit\s+push\b/,            // Git operations
    /\bdocker\b.*\b(run|exec)\b/, // Container execution
    /\bkubectl\b/,               // Kubernetes
    /\baws\b/,                   // Cloud operations
    /\bgcloud\b/,                // Cloud operations
    /\bazure\b/,                 // Cloud operations
    /\bterraform\b.*\bapply\b/,  // Infrastructure changes
    /\bdeploy\b/,                // Deployment
    /\bmigrate\b/,               // Database migrations
    /\bdrop\b.*\b(database|table)\b/, // Database operations
  ],
  
  maxOutputBytesPerCommand: 5 * 1024 * 1024, // 5MB
  chunkThrottleMs: 250,
  commandTimeoutMs: 5 * 60 * 1000, // 5 minutes
  failFast: true,
};

/**
 * Discovered verification command
 * 
 * Represents a command discovered from package.json or other sources
 */
export interface DiscoveredCommand {
  /**
   * Human-readable name (e.g., "lint", "test")
   */
  name: string;

  /**
   * Actual shell command to execute
   */
  command: string;

  /**
   * Where this command was discovered
   */
  source: 'package.json' | 'makefile' | 'cargo.toml' | 'user_provided';

  /**
   * Is this command safe to auto-run?
   * Only true if it passes allowlist AND doesn't match blocklist
   */
  safe: boolean;

  /**
   * If not safe, why?
   */
  reasonIfUnsafe?: string;

  /**
   * Original script name from source (e.g., package.json script name)
   */
  scriptName?: string;
}

/**
 * Check if a command is safe to auto-run based on policy
 * 
 * @param command - Command string to check
 * @param policy - Verify policy configuration
 * @returns true if safe, false otherwise (with reason)
 */
export function isCommandSafe(
  command: string,
  policy: VerifyPolicyConfig
): { safe: boolean; reason?: string } {
  // Check blocklist first (takes precedence)
  for (const pattern of policy.blocklistPatterns) {
    if (pattern.test(command)) {
      return {
        safe: false,
        reason: `Matches blocklist pattern: ${pattern.source}`,
      };
    }
  }

  // Check allowlist
  let matchedAllowlist = false;
  for (const pattern of policy.allowlistPatterns) {
    if (pattern.test(command)) {
      matchedAllowlist = true;
      break;
    }
  }

  if (!matchedAllowlist) {
    return {
      safe: false,
      reason: 'Does not match any allowlist pattern',
    };
  }

  return { safe: true };
}

/**
 * Verify phase result status
 */
export type VerifyStatus = 'pass' | 'fail' | 'skipped';

/**
 * Result from running the verify phase
 */
export interface VerifyPhaseResult {
  /**
   * Overall verification status
   */
  status: VerifyStatus;

  /**
   * Command that failed (if status === 'fail')
   */
  failedCommand?: DiscoveredCommand;

  /**
   * Exit code of failed command
   */
  exitCode?: number;

  /**
   * Evidence ID for full transcript
   * For large outputs, this references stored evidence file
   */
  transcriptEvidenceId?: string;

  /**
   * Summarized error snippet (last N lines of stderr)
   * For quick display in UI without loading full transcript
   */
  summarizedErrorSnippet?: string;

  /**
   * Commands that were executed
   */
  executedCommands: DiscoveredCommand[];

  /**
   * Total duration in milliseconds
   */
  durationMs: number;

  /**
   * Why verification was skipped (if status === 'skipped')
   */
  skipReason?: string;
}

/**
 * Command execution result
 */
export interface CommandExecutionResult {
  /**
   * Command that was executed
   */
  command: DiscoveredCommand;

  /**
   * Exit code
   */
  exitCode: number;

  /**
   * Stdout output (may be truncated)
   */
  stdout: string;

  /**
   * Stderr output (may be truncated)
   */
  stderr: string;

  /**
   * Whether output was truncated
   */
  truncated: boolean;

  /**
   * Execution duration in milliseconds
   */
  durationMs: number;

  /**
   * Evidence ID if output was stored as referenced evidence
   */
  evidenceId?: string;
}
