/**
 * Step 40.5: Context Enricher - Intelligence Layer (Enhanced)
 *
 * The main orchestrator that combines codebase + session context,
 * resolves references, detects out-of-scope requests, and decides
 * if clarification is needed.
 *
 * This is Deliverable C of the Intelligence Layer.
 *
 * ARCHITECTURE:
 * User Input → Context Enricher → Intent Router → Execute
 *
 * The enricher DOES NOT change the routing logic.
 * It enriches the input with context so routing is more accurate.
 *
 * Enhancement: EditorContext, expanded out-of-scope detection,
 * improved clarification with multi-match + multi-ref detection,
 * secret redaction in injected context.
 */

import { CodebaseContext, gatherCodebaseContext, DEFAULT_INTELLIGENCE_SETTINGS, IntelligenceSettings } from './codebaseContext';
import {
  SessionContext,
  SessionContextManager,
  getSessionContextManager,
  COMPONENT_TYPES,
} from './sessionContext';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Resolved reference - maps vague reference to concrete file/entity
 */
export interface ResolvedReference {
  /** Original reference text (e.g., "the button") */
  original: string;
  /** Resolved path or entity (e.g., "src/components/Button.tsx") */
  resolved: string;
  /** How the reference was resolved */
  source: 'session_history' | 'codebase_scan' | 'open_files' | 'recent_error' | 'active_editor';
  /** Confidence in the resolution (0-1) */
  confidence: number;
}

/**
 * A diagnostic entry from the editor
 */
export interface DiagnosticEntry {
  message: string;
  severity: 'error' | 'warning' | 'info';
  file?: string;
  line?: number;
}

/**
 * Editor context passed from the extension
 */
export interface EditorContext {
  /** Currently active file in the editor */
  activeFile?: string;
  /** Cursor line (0-based) */
  cursorLine?: number;
  /** Cursor column (0-based) */
  cursorColumn?: number;
  /** Selected text (may be capped and redacted) */
  selectedText?: string;
  /** Diagnostics for the active file */
  diagnostics: DiagnosticEntry[];
  /** Workspace-level diagnostics (errors only) */
  workspaceDiagnostics: DiagnosticEntry[];
}

/**
 * Enriched input - the output of the context enricher
 *
 * This is passed to the intent router instead of raw string.
 */
export interface EnrichedInput {
  /** Original user input (unchanged) */
  originalInput: string;

  /** Codebase context (project type, structure, etc.) */
  codebaseContext: CodebaseContext;

  /** Session context (recent topics, files, decisions) */
  sessionContext: SessionContext;

  /** Editor context (active file, selection, diagnostics) */
  editorContext?: EditorContext;

  /** Resolved references (e.g., "the button" → "Button.tsx") */
  resolvedReferences: Record<string, string>;

  /** Detailed reference resolutions (with confidence) */
  referenceDetails: ResolvedReference[];

  /** Whether clarification is needed before proceeding */
  clarificationNeeded: boolean;

  /** Clarification question (if needed) */
  clarificationQuestion?: string;

  /** Clarification options (if applicable) */
  clarificationOptions?: string[];

  /** Whether request is out of scope (non-code related) */
  outOfScope: boolean;

  /** Response for out-of-scope requests */
  outOfScopeResponse?: string;

  /** Enriched prompt with context injected */
  enrichedPrompt: string;

  /** Enrichment metadata */
  metadata: {
    /** When enrichment was performed */
    enrichedAt: string;
    /** Duration of enrichment in ms */
    enrichmentDurationMs: number;
    /** Whether any references were resolved */
    hasResolvedReferences: boolean;
    /** Number of references resolved */
    resolvedCount: number;
  };
}

/**
 * Enricher options
 */
export interface EnricherOptions {
  /** Workspace root path */
  workspaceRoot: string;
  /** Currently open files in editor */
  openFiles?: string[];
  /** Session manager (uses global if not provided) */
  sessionManager?: SessionContextManager;
  /** Skip codebase context gathering (for performance) */
  skipCodebaseContext?: boolean;
  /** Editor context from VS Code */
  editorContext?: EditorContext;
  /** Intelligence settings overrides */
  settings?: Partial<IntelligenceSettings>;
  /** Project Memory Manager (V2-V5) for memory context injection */
  projectMemoryManager?: import('./projectMemoryManager').ProjectMemoryManager;
}

// ============================================================================
// SECRET REDACTION
// ============================================================================

const SECRET_PATTERNS = [
  /Bearer\s+\S+/gi,
  /\bsk-[A-Za-z0-9_-]{10,}/g,
  /\b(api[_-]?key|apikey)\s*[:=]\s*['"]?\S+/gi,
  /\b(secret|token|password|passwd)\s*[:=]\s*['"]?\S+/gi,
  /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/g,
];

/**
 * Redact obvious secrets from a string
 */
export function redactSecrets(text: string): string {
  let result = text;
  for (const p of SECRET_PATTERNS) {
    result = result.replace(p, '[REDACTED]');
  }
  return result;
}

// ============================================================================
// OUT-OF-SCOPE DETECTION (improved)
// ============================================================================

/**
 * Patterns that indicate non-code requests
 */
const OUT_OF_SCOPE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Weather/time — exclude "server temperature" via negative lookbehind handled below
  { pattern: /\b(weather|forecast)\b/i, label: 'weather' },
  { pattern: /\btemperature\b/i, label: 'temperature' },
  // General knowledge
  { pattern: /\b(capital of|population of|who is|when was|history of)\b/i, label: 'knowledge' },
  // Entertainment
  { pattern: /\bjoke\b/i, label: 'joke' },
  { pattern: /\b(riddle|poem|song|lyrics|movie|book review)\b/i, label: 'entertainment' },
  // Math (exact patterns only)
  { pattern: /^what is \d+\s*[\+\-\*\/]\s*\d+\s*\??$/i, label: 'math' },
  // Cooking/recipes
  { pattern: /\b(recipe|cook|bake|ingredients)\b/i, label: 'cooking' },
  // Travel
  { pattern: /\b(directions to|how to get to|flight to|hotel in)\b/i, label: 'travel' },
  // Health advice
  { pattern: /\b(symptoms of|treatment for|cure for|medicine for)\b/i, label: 'health' },
  // Personal questions
  { pattern: /\b(your name|who are you|are you human|are you ai)\b/i, label: 'personal' },
];

/**
 * Expanded patterns that indicate code-related requests (overrides out-of-scope)
 */
const CODE_RELATED_PATTERNS = [
  /\b(code|function|component|file|import|export|module)\b/i,
  /\b(error|bug|fix|debug|debugging|test|testing|lint|build)\b/i,
  /\b(create|generate|implement|add|remove|update|refactor)\b/i,
  /\b(api|endpoint|route|database|query|schema)\b/i,
  /\b(css|style|layout|design|responsive)\b/i,
  /\b(npm|yarn|pnpm|package|dependency|install)\b/i,
  /\b(typescript|javascript|react|next|node|python|go|rust)\b/i,
  /\.(ts|tsx|js|jsx|json|css|scss|html|md|py|go|rs)$/i,
  // Infrastructure / DevOps
  /\b(server|deploy|docker|container|kubernetes|k8s)\b/i,
  /\b(ci|cd|pipeline|github.actions|gitlab|jenkins)\b/i,
  // Performance & monitoring
  /\b(performance|optimization|latency|throughput|metrics|monitoring)\b/i,
  // Algorithms & data structures
  /\b(algorithm|data.structure|sort|hash|tree|graph|cache)\b/i,
  // Git
  /\b(git|commit|branch|merge|rebase|pull.request|pr)\b/i,
  // Tooling
  /\b(webpack|vite|eslint|prettier|babel|rollup|esbuild)\b/i,
  // React patterns
  /\b(hook|context|reducer|state|effect|ref|memo|callback)\b/i,
  // Auth
  /\b(auth|login|logout|jwt|oauth|session|cookie|token)\b/i,
  // Config
  /\b(config|env|environment|variable|setting|\.env)\b/i,
  // Logging / tracing
  /\b(log|logging|trace|tracing|sentry|datadog)\b/i,
];

/**
 * Check "about" proximity: if input says "joke about debugging", check whether
 * the word following "about" relates to code. If so, NOT out of scope.
 */
function hasCodeTermAfterAbout(input: string): boolean {
  const aboutMatch = input.match(/\babout\s+(\w+)/i);
  if (!aboutMatch) return false;
  const wordAfterAbout = aboutMatch[1].toLowerCase();
  return CODE_RELATED_PATTERNS.some(p => p.test(wordAfterAbout));
}

/**
 * Check if input is out of scope (non-code related)
 *
 * Requires:
 *   matchesOutOfScope && !matchesCodeRelated && noAboutCodeProximity
 *
 * Also special-cases temperature: "server temperature" is NOT out-of-scope.
 */
export function isOutOfScope(input: string, hasEditorContext?: boolean, hasRecentCodingTopic?: boolean): boolean {
  const text = input.toLowerCase().trim();

  // If it's clearly code-related, it's NOT out of scope
  if (CODE_RELATED_PATTERNS.some(p => p.test(text))) {
    return false;
  }

  // "about <code-term>" proximity check
  if (hasCodeTermAfterAbout(text)) {
    return false;
  }

  // If user has active editor context or recent coding topic, lean towards in-scope
  if (hasEditorContext || hasRecentCodingTopic) {
    return false;
  }

  // Temperature special case: "server temperature" or "CPU temperature" not out of scope
  if (/temperature/i.test(text) && /\b(server|cpu|gpu|system|process|node)\b/i.test(text)) {
    return false;
  }

  // Check if any out-of-scope pattern matches
  return OUT_OF_SCOPE_PATTERNS.some(({ pattern }) => pattern.test(text));
}

/**
 * Generate polite redirect for out-of-scope requests
 */
export function generateOutOfScopeResponse(input: string): string {
  const text = input.toLowerCase();

  if (/weather|temperature|forecast/i.test(text)) {
    return "I focus on helping with your codebase. For weather information, you might want to check a weather app or website. Is there something in your code I can help with?";
  }

  if (/joke|riddle|poem/i.test(text)) {
    return "I'm designed to help with coding tasks. While I appreciate the request, I'm best at helping you build and fix code. What can I help you code today?";
  }

  if (/who are you|are you ai|your name/i.test(text)) {
    return "I'm Ordinex, your AI coding assistant. I help you build, debug, and improve your code. I'm focused on your codebase - what would you like to work on?";
  }

  // Generic response
  return "I focus on your codebase and coding tasks. Is there code I can help you with?";
}

// ============================================================================
// CLARIFICATION DETECTION (improved)
// ============================================================================

/**
 * Ambiguous reference patterns that might need clarification
 */
const AMBIGUOUS_PATTERNS = [
  /\b(it|this|that|the thing|the stuff)\b/i,
  /\b(make it|fix it|update it|change it)\b/i,
  /\b(the file|the component|the function|the page)\b/i,
  /\b(the error|the bug|the issue|the problem)\b/i,
];

/**
 * Check if clarification might be needed
 */
export function shouldClarify(
  input: string,
  codebaseContext: CodebaseContext,
  sessionContext: SessionContext,
  resolvedReferences: ResolvedReference[]
): { needsClarification: boolean; question?: string; options?: string[] } {
  const text = input.toLowerCase().trim();

  // If we successfully resolved all references with high confidence, no clarification needed
  if (resolvedReferences.length > 0) {
    const allResolved = resolvedReferences.every(r => r.confidence >= 0.7);
    if (allResolved) {
      return { needsClarification: false };
    }

    // Multi-match detection: if multiple files match a reference with < 0.7 confidence
    const lowConfidence = resolvedReferences.filter(r => r.confidence < 0.7);
    if (lowConfidence.length > 0) {
      // Collect candidate files from open + recent
      const candidates = [
        ...codebaseContext.openFiles.slice(0, 2),
        ...sessionContext.recentFiles.slice(0, 2).map(f => f.path),
      ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);

      if (candidates.length > 1) {
        return {
          needsClarification: true,
          question: `Which file did you mean by "${lowConfidence[0].original}"?`,
          options: candidates,
        };
      }
    }
  }

  // Conflicting references: if 3+ distinct unresolved refs, suggest breaking into tasks
  const refPatterns = AMBIGUOUS_PATTERNS.filter(p => p.test(text));
  if (refPatterns.length >= 3 && resolvedReferences.length === 0) {
    return {
      needsClarification: true,
      question: "Your prompt references several things. Would you like to break this into smaller tasks, or should I try to handle it all at once?",
      options: ['Break into tasks', 'Handle all at once'],
    };
  }

  // Check for ambiguous references
  const hasAmbiguousRef = AMBIGUOUS_PATTERNS.some(p => p.test(text));
  if (!hasAmbiguousRef) {
    return { needsClarification: false };
  }

  // "the file" / "the component" with no recent file context
  if (/\b(the file|the component)\b/i.test(text) && sessionContext.recentFiles.length === 0) {
    return {
      needsClarification: true,
      question: "Which file would you like me to work on?",
      options: codebaseContext.openFiles.length > 0
        ? codebaseContext.openFiles.slice(0, 4)
        : undefined,
    };
  }

  // "the error" / "the bug" with no recent errors
  if (/\b(the error|the bug|the issue)\b/i.test(text) && sessionContext.recentErrors.length === 0) {
    return {
      needsClarification: true,
      question: "I don't see a recent error in our conversation. Could you share the error message or describe the issue?",
    };
  }

  // Very short, vague inputs
  if (text.length < 15 && /\b(fix|update|change|make)\b/i.test(text)) {
    return {
      needsClarification: true,
      question: "Could you provide more details about what you'd like me to fix or change?",
    };
  }

  return { needsClarification: false };
}

// ============================================================================
// REFERENCE RESOLUTION
// ============================================================================

/**
 * Reference patterns to detect and resolve — expanded with common component types
 */
const REFERENCE_PATTERNS: Array<{
  pattern: RegExp;
  type: 'component' | 'file' | 'error' | 'generic';
}> = [
  // Original patterns
  { pattern: /\b(the button|that button|this button)\b/i, type: 'component' },
  { pattern: /\b(the form|that form|this form)\b/i, type: 'component' },
  { pattern: /\b(the modal|that modal|this modal|the dialog)\b/i, type: 'component' },
  { pattern: /\b(the component|that component|this component)\b/i, type: 'component' },
  // New expanded component patterns
  { pattern: /\b(the sidebar|that sidebar|this sidebar)\b/i, type: 'component' },
  { pattern: /\b(the dropdown|that dropdown|this dropdown)\b/i, type: 'component' },
  { pattern: /\b(the table|that table|this table)\b/i, type: 'component' },
  { pattern: /\b(the input|that input|this input)\b/i, type: 'component' },
  { pattern: /\b(the hook|that hook|this hook)\b/i, type: 'component' },
  { pattern: /\b(the service|that service|this service)\b/i, type: 'component' },
  { pattern: /\b(the page|that page|this page)\b/i, type: 'component' },
  { pattern: /\b(the menu|that menu|this menu)\b/i, type: 'component' },
  { pattern: /\b(the tabs|that tabs|this tabs)\b/i, type: 'component' },
  // File / error / generic
  { pattern: /\b(the file|that file|this file)\b/i, type: 'file' },
  { pattern: /\b(the error|that error|this error|the bug)\b/i, type: 'error' },
  { pattern: /\b(it|this|that)\b(?!\s+(is|was|will|should|could|would))/i, type: 'generic' },
];

/**
 * Resolve vague references using session and codebase context.
 * Now uses scored resolveComponentReference and supports EditorContext.
 */
export function resolveReferences(
  input: string,
  sessionManager: SessionContextManager,
  codebaseContext: CodebaseContext,
  editorContext?: EditorContext
): ResolvedReference[] {
  const resolved: ResolvedReference[] = [];
  const text = input.toLowerCase();
  const activeFile = editorContext?.activeFile;

  for (const { pattern, type } of REFERENCE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;

    const original = match[0];
    let resolution: ResolvedReference | null = null;

    switch (type) {
      case 'component': {
        const scored = sessionManager.resolveComponentReference(original, activeFile);
        if (scored) {
          resolution = {
            original,
            resolved: scored.path,
            source: scored.path === activeFile ? 'active_editor' : 'session_history',
            confidence: scored.confidence,
          };
        } else if (codebaseContext.openFiles.length > 0) {
          const componentFile = codebaseContext.openFiles.find(f =>
            f.includes('component') || f.endsWith('.tsx') || f.endsWith('.jsx')
          );
          if (componentFile) {
            resolution = {
              original,
              resolved: componentFile,
              source: 'open_files',
              confidence: 0.6,
            };
          }
        }
        break;
      }

      case 'file': {
        // Prefer active editor file
        if (activeFile) {
          resolution = {
            original,
            resolved: activeFile,
            source: 'active_editor',
            confidence: 0.85,
          };
        } else {
          const filePath = sessionManager.resolveFileReference();
          if (filePath) {
            resolution = {
              original,
              resolved: filePath,
              source: 'session_history',
              confidence: 0.8,
            };
          } else if (codebaseContext.openFiles.length > 0) {
            resolution = {
              original,
              resolved: codebaseContext.openFiles[0],
              source: 'open_files',
              confidence: 0.5,
            };
          }
        }
        break;
      }

      case 'error': {
        const error = sessionManager.resolveErrorReference();
        if (error) {
          const resolvedPath = error.file || error.message.substring(0, 50);
          resolution = {
            original,
            resolved: resolvedPath,
            source: 'recent_error',
            confidence: 0.9,
          };
        }
        break;
      }

      case 'generic': {
        if (activeFile) {
          resolution = {
            original,
            resolved: activeFile,
            source: 'active_editor',
            confidence: 0.6,
          };
        } else {
          const lastFile = sessionManager.resolveFileReference();
          if (lastFile) {
            resolution = {
              original,
              resolved: lastFile,
              source: 'session_history',
              confidence: 0.5,
            };
          }
        }
        break;
      }
    }

    if (resolution) {
      if (!resolved.some(r => r.original === resolution!.original)) {
        resolved.push(resolution);
      }
    }
  }

  return resolved;
}

// ============================================================================
// PROMPT ENRICHMENT
// ============================================================================

/**
 * Memory context for prompt injection (V4)
 */
export interface MemoryContext {
  facts?: string;
  facts_line_count?: number;
  solutions?: Array<{
    solution: { problem: string; fix: string; verification: { command: string; type: string } };
    score: number;
  }>;
}

/**
 * Build enriched prompt with context injected.
 * Now includes EditorContext (active file, selection, diagnostics)
 * and memory context (V4: project facts + proven solutions).
 */
export function buildEnrichedPrompt(
  input: string,
  codebaseContext: CodebaseContext,
  resolvedReferences: ResolvedReference[],
  editorContext?: EditorContext,
  settings?: Partial<IntelligenceSettings>,
  memoryContext?: MemoryContext,
): string {
  const maxSelected = settings?.maxSelectedTextChars ?? DEFAULT_INTELLIGENCE_SETTINGS.maxSelectedTextChars;
  const maxDiag = settings?.maxDiagnostics ?? DEFAULT_INTELLIGENCE_SETTINGS.maxDiagnostics;
  const parts: string[] = [];

  // Add project context
  if (codebaseContext.projectType !== 'unknown') {
    parts.push(`[Project: ${codebaseContext.projectType}${codebaseContext.hasTypeScript ? ' + TypeScript' : ''}]`);
  }

  // Add component library context if relevant
  if (codebaseContext.componentLibrary !== 'none') {
    parts.push(`[UI: ${codebaseContext.componentLibrary}]`);
  }

  // Add resolved references
  if (resolvedReferences.length > 0) {
    const refs = resolvedReferences
      .filter(r => r.confidence >= 0.6)
      .map(r => `${r.original} → ${r.resolved}`)
      .join(', ');
    if (refs) {
      parts.push(`[References: ${refs}]`);
    }
  }

  // Add editor context
  if (editorContext) {
    if (editorContext.activeFile) {
      parts.push(`[Active file: ${editorContext.activeFile}]`);
    }
    if (editorContext.selectedText) {
      const capped = editorContext.selectedText.substring(0, maxSelected);
      const safe = redactSecrets(capped);
      parts.push(`[Selection: ${safe}${editorContext.selectedText.length > maxSelected ? '...' : ''}]`);
    }
    const errorCount = editorContext.diagnostics.filter(d => d.severity === 'error').length;
    const warnCount = editorContext.diagnostics.filter(d => d.severity === 'warning').length;
    if (errorCount > 0 || warnCount > 0) {
      const diagParts: string[] = [];
      if (errorCount > 0) diagParts.push(`${errorCount} error(s)`);
      if (warnCount > 0) diagParts.push(`${warnCount} warning(s)`);
      parts.push(`[Diagnostics: ${diagParts.join(', ')} in active file]`);
    }
    const workspaceErrors = editorContext.workspaceDiagnostics
      .filter(d => d.severity === 'error')
      .slice(0, maxDiag);
    if (workspaceErrors.length > 0) {
      parts.push(`[Workspace: ${workspaceErrors.length} error(s)]`);
    }
  }

  // Add open files context if relevant (and no editor context already providing it)
  if (!editorContext?.activeFile && codebaseContext.openFiles.length > 0 && codebaseContext.openFiles.length <= 3) {
    parts.push(`[Open files: ${codebaseContext.openFiles.join(', ')}]`);
  }

  // V4: Inject memory context (structured blocks)
  const memoryParts: string[] = [];
  if (memoryContext?.facts) {
    const lineCount = memoryContext.facts_line_count ?? memoryContext.facts.split('\n').length;
    memoryParts.push(`## Project Facts (last ${lineCount} lines)\n${memoryContext.facts}`);
  }
  if (memoryContext?.solutions && memoryContext.solutions.length > 0) {
    const block = memoryContext.solutions.slice(0, 3).map((s, i) =>
      `${i + 1}. **Problem:** ${s.solution.problem}\n   **Fix:** ${s.solution.fix}\n   **Verified by:** \`${s.solution.verification.command}\` (${s.solution.verification.type})`
    ).join('\n');
    memoryParts.push(`## Proven Solutions (top ${memoryContext.solutions.length})\n${block}`);
  }

  // Build final prompt
  const contextPrefix = parts.length > 0 ? parts.join(' ') + '\n\n' : '';
  const memorySuffix = memoryParts.length > 0 ? '\n\n' + memoryParts.join('\n\n') : '';

  if (contextPrefix || memorySuffix) {
    return `${contextPrefix}${input}${memorySuffix}`;
  }

  return input;
}

// ============================================================================
// MAIN ENRICHER FUNCTION
// ============================================================================

/**
 * Enrich user input with codebase and session context
 *
 * This is the main entry point for the Intelligence Layer.
 * Call this BEFORE the intent router.
 *
 * @param input - Raw user input
 * @param options - Enricher options
 * @returns EnrichedInput ready for intent routing
 */
export async function enrichUserInput(
  input: string,
  options: EnricherOptions
): Promise<EnrichedInput> {
  const startTime = Date.now();

  // Get session manager
  const sessionManager = options.sessionManager || getSessionContextManager();
  const sessionContext = sessionManager.getContext();
  const editorContext = options.editorContext;

  // Gather codebase context (unless skipped)
  const codebaseContext = options.skipCodebaseContext
    ? createEmptyCodebaseContext(options.workspaceRoot)
    : gatherCodebaseContext(options.workspaceRoot, options.openFiles || []);

  // Feed editor diagnostics into session errors (auto-enrich)
  if (editorContext) {
    for (const diag of editorContext.diagnostics.filter(d => d.severity === 'error').slice(0, 5)) {
      sessionManager.addError(
        redactSecrets(diag.message).substring(0, 200),
        'build',
        diag.file || editorContext.activeFile,
        diag.line
      );
    }
  }

  // Check if out of scope — now considers editor context and recent topics
  const hasEditorCtx = !!(editorContext?.activeFile);
  const hasRecentCodingTopic = sessionContext.recentTopics.length > 0;
  const outOfScope = isOutOfScope(input, hasEditorCtx, hasRecentCodingTopic);
  const outOfScopeResponse = outOfScope ? generateOutOfScopeResponse(input) : undefined;

  // If out of scope, return early
  if (outOfScope) {
    return {
      originalInput: input,
      codebaseContext,
      sessionContext,
      editorContext,
      resolvedReferences: {},
      referenceDetails: [],
      clarificationNeeded: false,
      outOfScope: true,
      outOfScopeResponse,
      enrichedPrompt: input,
      metadata: {
        enrichedAt: new Date().toISOString(),
        enrichmentDurationMs: Date.now() - startTime,
        hasResolvedReferences: false,
        resolvedCount: 0,
      },
    };
  }

  // Resolve references (now with editor context)
  const referenceDetails = resolveReferences(input, sessionManager, codebaseContext, editorContext);
  const resolvedReferences: Record<string, string> = {};
  for (const ref of referenceDetails) {
    resolvedReferences[ref.original] = ref.resolved;
  }

  // Check if clarification needed
  const clarificationResult = shouldClarify(input, codebaseContext, sessionContext, referenceDetails);

  // V4: Query project memory for context injection
  let memoryContext: MemoryContext | undefined;
  if (options.projectMemoryManager) {
    try {
      const [facts, solutions] = await Promise.all([
        options.projectMemoryManager.getFactsSummary(30),
        options.projectMemoryManager.queryRelevantSolutions(input, 3),
      ]);
      if (facts || solutions.length > 0) {
        memoryContext = {
          facts: facts || undefined,
          facts_line_count: facts ? facts.split('\n').length : undefined,
          solutions: solutions.length > 0 ? solutions : undefined,
        };
      }
    } catch (memErr) {
      // Graceful degradation: memory unavailable doesn't block enrichment
      console.warn('[V4] Memory context query failed:', memErr);
    }
  }

  // Build enriched prompt (now with editor context + memory context)
  const enrichedPrompt = buildEnrichedPrompt(input, codebaseContext, referenceDetails, editorContext, options.settings, memoryContext);

  // Update session with this interaction
  sessionManager.addTopic(extractTopicFromInput(input));

  return {
    originalInput: input,
    codebaseContext,
    sessionContext,
    editorContext,
    resolvedReferences,
    referenceDetails,
    clarificationNeeded: clarificationResult.needsClarification,
    clarificationQuestion: clarificationResult.question,
    clarificationOptions: clarificationResult.options,
    outOfScope: false,
    enrichedPrompt,
    metadata: {
      enrichedAt: new Date().toISOString(),
      enrichmentDurationMs: Date.now() - startTime,
      hasResolvedReferences: referenceDetails.length > 0,
      resolvedCount: referenceDetails.length,
    },
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create empty codebase context (for skip mode)
 */
function createEmptyCodebaseContext(workspaceRoot: string): CodebaseContext {
  return {
    projectType: 'unknown',
    hasTypeScript: false,
    packageManager: 'npm',
    openFiles: [],
    recentlyModified: [],
    hasAuth: false,
    hasDatabase: false,
    componentLibrary: 'none',
    srcStructure: 'unknown',
    dependencies: [],
    devDependencies: [],
    isMonorepo: false,
    testingFramework: 'none',
    cicdProvider: 'none',
    containerTool: 'none',
    cloudProvider: 'none',
    workspaceRoot,
    gatheredAt: new Date().toISOString(),
  };
}

/**
 * Extract topic from user input for session tracking
 */
function extractTopicFromInput(input: string): string {
  // Take first sentence or first 50 chars
  const firstSentence = input.split(/[.!?]/)[0];
  return firstSentence.substring(0, 50).trim();
}

// ============================================================================
// EXPORTS
// ============================================================================

export { CodebaseContext } from './codebaseContext';
export { SessionContext, SessionContextManager, getSessionContextManager } from './sessionContext';
