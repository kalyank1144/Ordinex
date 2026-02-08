/**
 * Step 41: Dev Server Lifecycle + Long-Running Command UX
 *
 * Handles background processes (dev servers, watch modes) that run indefinitely,
 * with proper start/stop/stream capabilities.
 *
 * ARCHITECTURE:
 * - ProcessManager is the central coordinator for all long-running processes
 * - Each process has a stable ID for tracking across events
 * - Ready signals detect when a process is fully started (e.g., "ready on port 3000")
 * - Output is streamed via events for real-time display
 * - Clean shutdown on extension deactivation
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Process status lifecycle
 */
export type ProcessStatus = 'starting' | 'running' | 'ready' | 'stopped' | 'error';

/**
 * Process ready signal patterns for common dev servers
 */
export interface ProcessReadySignal {
  /** Pattern to match in stdout/stderr */
  pattern: RegExp;
  /** Optional port extraction group */
  portGroup?: number;
}

/**
 * Built-in ready signals for common frameworks
 */
export const PROCESS_READY_SIGNALS: Record<string, ProcessReadySignal[]> = {
  vite: [
    { pattern: /Local:\s+http:\/\/localhost:(\d+)/, portGroup: 1 },
    { pattern: /ready in \d+ms/, portGroup: undefined },
  ],
  next: [
    { pattern: /- Local:\s+http:\/\/localhost:(\d+)/, portGroup: 1 },
    { pattern: /Ready in \d+(\.\d+)?s/, portGroup: undefined },
    { pattern: /started server on/, portGroup: undefined },
  ],
  cra: [
    { pattern: /Compiled successfully/, portGroup: undefined },
    { pattern: /Local:\s+http:\/\/localhost:(\d+)/, portGroup: 1 },
  ],
  express: [
    { pattern: /listening on port (\d+)/i, portGroup: 1 },
    { pattern: /server started/i, portGroup: undefined },
  ],
  generic: [
    { pattern: /listening on (\d+)/i, portGroup: 1 },
    { pattern: /ready/i, portGroup: undefined },
    { pattern: /started/i, portGroup: undefined },
  ],
};

/**
 * Long-running process record
 */
export interface LongRunningProcess {
  /** Stable process ID */
  id: string;
  /** Command that was run */
  command: string;
  /** Command arguments */
  args: string[];
  /** Working directory */
  cwd: string;
  /** Current status */
  status: ProcessStatus;
  /** OS process ID (if running) */
  pid?: number;
  /** Detected port (if applicable) */
  port?: number;
  /** Start timestamp */
  startedAt: string;
  /** Ready timestamp (if reached ready state) */
  readyAt?: string;
  /** Stop timestamp (if stopped) */
  stoppedAt?: string;
  /** Exit code (if stopped) */
  exitCode?: number;
  /** Error message (if error state) */
  error?: string;
  /** Last few lines of output */
  recentOutput: string[];
  /** Run ID for correlation */
  runId?: string;
}

/**
 * Options for starting a process
 */
export interface StartProcessOpts {
  /** Unique ID for this process */
  id: string;
  /** Command to run */
  command: string;
  /** Command arguments */
  args?: string[];
  /** Working directory */
  cwd: string;
  /** Ready signals to detect completion */
  readySignals?: ProcessReadySignal[];
  /** Timeout in ms before assuming ready (default: 60000) */
  timeout?: number;
  /** Environment variables */
  env?: Record<string, string>;
  /** Run ID for correlation */
  runId?: string;
  /** Process type hint for ready signal detection */
  processType?: 'vite' | 'next' | 'cra' | 'express' | 'generic';
}

/**
 * Process output event
 */
export interface ProcessOutputEvent {
  processId: string;
  stream: 'stdout' | 'stderr';
  data: string;
  timestamp: string;
}

/**
 * Process status change event
 */
export interface ProcessStatusEvent {
  processId: string;
  previousStatus: ProcessStatus;
  newStatus: ProcessStatus;
  port?: number;
  exitCode?: number;
  error?: string;
  timestamp: string;
}

// ============================================================================
// PROCESS MANAGER
// ============================================================================

/**
 * Maximum lines of output to keep per process
 */
const MAX_RECENT_OUTPUT = 100;

/**
 * ProcessManager - Central coordinator for long-running processes
 *
 * Features:
 * - Start/stop processes with proper lifecycle management
 * - Stream output in real-time via events
 * - Detect "ready" state via configurable patterns
 * - Clean shutdown on extension deactivation
 * - Port conflict detection
 */
export class ProcessManager extends EventEmitter {
  private processes: Map<string, LongRunningProcess> = new Map();
  private childProcesses: Map<string, ChildProcess> = new Map();
  private readyTimeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    super();
  }

  /**
   * Start a new long-running process
   */
  async startProcess(opts: StartProcessOpts): Promise<LongRunningProcess> {
    const {
      id,
      command,
      args = [],
      cwd,
      readySignals,
      timeout = 60000,
      env,
      runId,
      processType,
    } = opts;

    // Check if process already exists
    if (this.processes.has(id)) {
      const existing = this.processes.get(id)!;
      if (existing.status === 'running' || existing.status === 'ready') {
        throw new Error(`Process ${id} is already running`);
      }
    }

    // Create process record
    const process: LongRunningProcess = {
      id,
      command,
      args,
      cwd,
      status: 'starting',
      startedAt: new Date().toISOString(),
      recentOutput: [],
      runId,
    };

    this.processes.set(id, process);
    this.emitStatusChange(process, 'stopped', 'starting');

    // Get ready signals
    const signals = readySignals || (processType ? PROCESS_READY_SIGNALS[processType] : PROCESS_READY_SIGNALS.generic);

    // Spawn the child process
    try {
      const child = spawn(command, args, {
        cwd,
        env: { ...globalThis.process.env, ...env },
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      if (!child.pid) {
        throw new Error('Failed to spawn process');
      }

      process.pid = child.pid;
      process.status = 'running';
      this.childProcesses.set(id, child);
      this.emitStatusChange(process, 'starting', 'running');

      // Handle stdout
      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        this.handleOutput(id, 'stdout', text, signals);
      });

      // Handle stderr
      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        this.handleOutput(id, 'stderr', text, signals);
      });

      // Handle process exit
      child.on('exit', (code, signal) => {
        this.handleExit(id, code, signal);
      });

      // Handle process error
      child.on('error', (err) => {
        this.handleError(id, err);
      });

      // Set ready timeout
      const readyTimeout = setTimeout(() => {
        const proc = this.processes.get(id);
        if (proc && proc.status === 'running') {
          // Assume ready after timeout
          proc.status = 'ready';
          proc.readyAt = new Date().toISOString();
          this.emitStatusChange(proc, 'running', 'ready');
        }
      }, timeout);

      this.readyTimeouts.set(id, readyTimeout);

      return process;
    } catch (err) {
      process.status = 'error';
      process.error = err instanceof Error ? err.message : String(err);
      this.emitStatusChange(process, 'starting', 'error');
      throw err;
    }
  }

  /**
   * Stop a running process
   */
  async stopProcess(id: string, reason: string = 'user_stopped'): Promise<void> {
    const process = this.processes.get(id);
    if (!process) {
      throw new Error(`Process ${id} not found`);
    }

    const child = this.childProcesses.get(id);
    if (!child) {
      return;
    }

    // Clear ready timeout
    const timeout = this.readyTimeouts.get(id);
    if (timeout) {
      clearTimeout(timeout);
      this.readyTimeouts.delete(id);
    }

    // Send SIGTERM first
    child.kill('SIGTERM');

    // Force kill after 5 seconds
    const forceKillTimeout = setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }, 5000);

    // Wait for exit
    return new Promise<void>((resolve) => {
      const cleanup = () => {
        clearTimeout(forceKillTimeout);
        this.childProcesses.delete(id);
        resolve();
      };

      if (child.killed || !child.pid) {
        cleanup();
      } else {
        child.once('exit', cleanup);
      }
    });
  }

  /**
   * Stop all running processes (for extension deactivation)
   */
  async stopAll(reason: string = 'extension_deactivate'): Promise<void> {
    const stopPromises: Promise<void>[] = [];

    for (const [id, process] of this.processes) {
      if (process.status === 'running' || process.status === 'ready') {
        stopPromises.push(this.stopProcess(id, reason));
      }
    }

    await Promise.all(stopPromises);
  }

  /**
   * Get a process by ID
   */
  getProcess(id: string): LongRunningProcess | undefined {
    return this.processes.get(id);
  }

  /**
   * Get all active processes
   */
  getActiveProcesses(): LongRunningProcess[] {
    return Array.from(this.processes.values()).filter(
      (p) => p.status === 'running' || p.status === 'ready'
    );
  }

  /**
   * Get all processes
   */
  getAllProcesses(): LongRunningProcess[] {
    return Array.from(this.processes.values());
  }

  /**
   * Check if a port is in use
   */
  async isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();

      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          resolve(true);
        } else {
          resolve(false);
        }
      });

      server.once('listening', () => {
        server.close();
        resolve(false);
      });

      server.listen(port);
    });
  }

  /**
   * Find an available port starting from a given port
   */
  async findAvailablePort(startPort: number, maxAttempts: number = 10): Promise<number> {
    for (let i = 0; i < maxAttempts; i++) {
      const port = startPort + i;
      const inUse = await this.isPortInUse(port);
      if (!inUse) {
        return port;
      }
    }
    throw new Error(`No available port found starting from ${startPort}`);
  }

  /**
   * Dispose of the process manager
   */
  dispose(): void {
    this.stopAll('disposed');
    this.removeAllListeners();
  }

  // -------------------------------------------------------------------------
  // PRIVATE METHODS
  // -------------------------------------------------------------------------

  private handleOutput(
    id: string,
    stream: 'stdout' | 'stderr',
    data: string,
    signals: ProcessReadySignal[]
  ): void {
    const process = this.processes.get(id);
    if (!process) return;

    // Add to recent output
    const lines = data.split('\n').filter((l) => l.trim());
    process.recentOutput.push(...lines);
    if (process.recentOutput.length > MAX_RECENT_OUTPUT) {
      process.recentOutput = process.recentOutput.slice(-MAX_RECENT_OUTPUT);
    }

    // Emit output event
    this.emit('output', {
      processId: id,
      stream,
      data,
      timestamp: new Date().toISOString(),
    } as ProcessOutputEvent);

    // Check for ready signals
    if (process.status === 'running') {
      for (const signal of signals) {
        const match = data.match(signal.pattern);
        if (match) {
          // Extract port if available
          if (signal.portGroup !== undefined && match[signal.portGroup]) {
            process.port = parseInt(match[signal.portGroup], 10);
          }

          // Clear ready timeout
          const timeout = this.readyTimeouts.get(id);
          if (timeout) {
            clearTimeout(timeout);
            this.readyTimeouts.delete(id);
          }

          // Transition to ready
          process.status = 'ready';
          process.readyAt = new Date().toISOString();
          this.emitStatusChange(process, 'running', 'ready');
          break;
        }
      }
    }
  }

  private handleExit(id: string, code: number | null, signal: string | null): void {
    const process = this.processes.get(id);
    if (!process) return;

    const previousStatus = process.status;
    process.status = 'stopped';
    process.stoppedAt = new Date().toISOString();
    process.exitCode = code ?? undefined;

    // Clear ready timeout
    const timeout = this.readyTimeouts.get(id);
    if (timeout) {
      clearTimeout(timeout);
      this.readyTimeouts.delete(id);
    }

    this.childProcesses.delete(id);
    this.emitStatusChange(process, previousStatus, 'stopped', code ?? undefined);
  }

  private handleError(id: string, err: Error): void {
    const process = this.processes.get(id);
    if (!process) return;

    const previousStatus = process.status;
    process.status = 'error';
    process.error = err.message;

    // Clear ready timeout
    const timeout = this.readyTimeouts.get(id);
    if (timeout) {
      clearTimeout(timeout);
      this.readyTimeouts.delete(id);
    }

    this.emitStatusChange(process, previousStatus, 'error', undefined, err.message);
  }

  private emitStatusChange(
    process: LongRunningProcess,
    previousStatus: ProcessStatus,
    newStatus: ProcessStatus,
    exitCode?: number,
    error?: string
  ): void {
    this.emit('status', {
      processId: process.id,
      previousStatus,
      newStatus,
      port: process.port,
      exitCode,
      error,
      timestamp: new Date().toISOString(),
    } as ProcessStatusEvent);
  }
}

// ============================================================================
// SINGLETON & HELPERS
// ============================================================================

/**
 * Global process manager instance
 */
let globalProcessManager: ProcessManager | null = null;

/**
 * Get the global process manager
 */
export function getProcessManager(): ProcessManager {
  if (!globalProcessManager) {
    globalProcessManager = new ProcessManager();
  }
  return globalProcessManager;
}

/**
 * Reset the global process manager (for testing)
 */
export function resetProcessManager(): void {
  if (globalProcessManager) {
    globalProcessManager.dispose();
  }
  globalProcessManager = new ProcessManager();
}

/**
 * Generate a unique process ID
 */
export function generateProcessId(prefix: string = 'proc'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Detect process type from command
 */
export function detectProcessType(command: string): 'vite' | 'next' | 'cra' | 'express' | 'generic' {
  const cmd = command.toLowerCase();

  if (cmd.includes('vite') || cmd.includes('dev') && cmd.includes('vite')) {
    return 'vite';
  }
  if (cmd.includes('next')) {
    return 'next';
  }
  if (cmd.includes('react-scripts') || cmd.includes('cra')) {
    return 'cra';
  }
  if (cmd.includes('node') && cmd.includes('server')) {
    return 'express';
  }

  return 'generic';
}

/**
 * Get the default dev server command for a project type
 */
export function getDefaultDevCommand(
  projectType: 'nextjs' | 'vite' | 'react' | 'express' | 'unknown',
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun'
): { command: string; args: string[] } {
  const runCmd = packageManager === 'npm' ? 'npm run' : `${packageManager} run`;

  switch (projectType) {
    case 'nextjs':
      return { command: runCmd, args: ['dev'] };
    case 'vite':
      return { command: runCmd, args: ['dev'] };
    case 'react':
      return { command: runCmd, args: ['start'] };
    case 'express':
      return { command: runCmd, args: ['start'] };
    default:
      return { command: runCmd, args: ['dev'] };
  }
}
