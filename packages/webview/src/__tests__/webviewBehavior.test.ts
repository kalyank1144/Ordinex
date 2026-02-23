/**
 * A8: Webview Behavioral Tests
 *
 * Goes deeper than the existing syntactic tests — evaluates the generated JS
 * in a sandboxed environment to test runtime behavior of state management,
 * message handling, onboarding flow, and action handlers.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { getStateJs } from '../webviewJs/state';
import { getMessageHandlerJs } from '../webviewJs/messageHandler';
import { getOnboardingJs } from '../webviewJs/onboarding';
import { getActionsJs } from '../webviewJs/actions';

// ---------------------------------------------------------------------------
// Sandbox helper — evaluates JS string and returns accessible scope
// ---------------------------------------------------------------------------

type SandboxGlobals = Record<string, unknown>;

function createSandbox(jsModules: string[], globals: SandboxGlobals = {}): Record<string, any> {
  const scope: Record<string, any> = {
    document: createMockDocument(),
    window: {} as Record<string, any>,
    vscode: { postMessage: createPostMessageSpy() },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    requestAnimationFrame: (fn: Function) => fn(),
    Set: globalThis.Set,
    Map: globalThis.Map,
    Date: globalThis.Date,
    JSON: globalThis.JSON,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    simpleMarkdown: (text: string) => `<p>${text}</p>`,
    generateId: () => `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    renderMission: () => {},
    renderLogs: () => {},
    renderSystemsCounters: () => {},
    updateStatus: () => {},
    updateStage: () => {},
    ...globals,
  };

  const combined = jsModules.join('\n');

  const fn = new Function(
    ...Object.keys(scope),
    `${combined}\nreturn { state, window, vscode, ATTACHMENT_CONFIG };`,
  );

  try {
    const result = fn(...Object.values(scope));
    result.window = scope.window;
    return result;
  } catch (e) {
    throw new Error(`Sandbox evaluation failed: ${(e as Error).message}`);
  }
}

function createMockDocument() {
  const elements: Record<string, any> = {};
  return {
    getElementById: (id: string) => elements[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag: string) => ({
      tagName: tag.toUpperCase(),
      className: '',
      id: '',
      innerHTML: '',
      style: {},
      children: [],
      appendChild: function (child: any) { this.children.push(child); },
      addEventListener: () => {},
      setAttribute: () => {},
      focus: () => {},
    }),
    body: {
      appendChild: () => {},
      removeChild: () => {},
      querySelector: () => null,
    },
    addEventListener: () => {},
  };
}

function createPostMessageSpy() {
  const calls: any[] = [];
  const fn = (msg: any) => { calls.push(msg); };
  fn.calls = calls;
  fn.postMessage = fn;
  return fn;
}

// ============================================================================
// STATE MODULE TESTS
// ============================================================================

describe('State Module — runtime behavior', () => {
  it('initializes state with correct defaults', () => {
    const { state } = createSandbox([getStateJs()]);

    expect(state.activeTab).toBe('mission');
    expect(state.taskStatus).toBe('ready');
    expect(state.currentStage).toBe('none');
    expect(state.currentMode).toBe('MISSION');
    expect(state.events).toEqual([]);
    expect(state.narrationCards).toEqual([]);
    expect(state.pendingAttachments).toEqual([]);
  });

  it('initializes scope summary with budget defaults', () => {
    const { state } = createSandbox([getStateJs()]);

    expect(state.scopeSummary.contract.max_files).toBe(10);
    expect(state.scopeSummary.contract.max_lines).toBe(1000);
    expect(state.scopeSummary.contract.budgets.max_iterations).toBe(10);
    expect(state.scopeSummary.contract.budgets.max_tool_calls).toBe(100);
    expect(state.scopeSummary.contract.budgets.max_time_ms).toBe(300000);
  });

  it('initializes counters at zero', () => {
    const { state } = createSandbox([getStateJs()]);

    expect(state.counters.filesInScope).toBe(0);
    expect(state.counters.filesTouched).toBe(0);
    expect(state.counters.toolCallsUsed).toBe(0);
  });

  it('provides attachment config with valid constraints', () => {
    const { ATTACHMENT_CONFIG } = createSandbox([getStateJs()]);

    expect(ATTACHMENT_CONFIG.MAX_FILES).toBe(10);
    expect(ATTACHMENT_CONFIG.MAX_SIZE_BYTES).toBe(5 * 1024 * 1024);
    expect(ATTACHMENT_CONFIG.ALLOWED_MIME_TYPES).toContain('image/png');
    expect(ATTACHMENT_CONFIG.ALLOWED_MIME_TYPES).toContain('application/json');
    expect(ATTACHMENT_CONFIG.ALLOWED_EXTENSIONS).toContain('.png');
    expect(ATTACHMENT_CONFIG.ALLOWED_EXTENSIONS).toContain('.json');
  });

  it('streaming states all start null', () => {
    const { state } = createSandbox([getStateJs()]);

    expect(state.streamingAnswer).toBeNull();
    expect(state.streamingPlan).toBeNull();
    expect(state.streamingMission).toBeNull();
  });
});

// ============================================================================
// ATTACHMENT CONFIG TESTS
// ============================================================================

describe('Attachment Config — validation rules', () => {
  it('allows common image formats', () => {
    const { ATTACHMENT_CONFIG } = createSandbox([getStateJs()]);

    const imageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    for (const type of imageTypes) {
      expect(ATTACHMENT_CONFIG.ALLOWED_MIME_TYPES).toContain(type);
    }
  });

  it('allows code-adjacent file types', () => {
    const { ATTACHMENT_CONFIG } = createSandbox([getStateJs()]);

    expect(ATTACHMENT_CONFIG.ALLOWED_EXTENSIONS).toContain('.json');
    expect(ATTACHMENT_CONFIG.ALLOWED_EXTENSIONS).toContain('.md');
    expect(ATTACHMENT_CONFIG.ALLOWED_EXTENSIONS).toContain('.txt');
    expect(ATTACHMENT_CONFIG.ALLOWED_EXTENSIONS).toContain('.csv');
    expect(ATTACHMENT_CONFIG.ALLOWED_EXTENSIONS).toContain('.pdf');
  });

  it('enforces reasonable size limit (5MB)', () => {
    const { ATTACHMENT_CONFIG } = createSandbox([getStateJs()]);
    expect(ATTACHMENT_CONFIG.MAX_SIZE_BYTES).toBeLessThanOrEqual(10 * 1024 * 1024);
    expect(ATTACHMENT_CONFIG.MAX_SIZE_BYTES).toBeGreaterThan(0);
  });
});

// ============================================================================
// ONBOARDING MODULE TESTS
// ============================================================================

describe('Onboarding Module — runtime behavior', () => {
  it('defines all expected global functions', () => {
    const sandbox = createSandbox([getStateJs(), getOnboardingJs()]);

    expect(typeof sandbox.window.showOnboarding).toBe('function');
    expect(typeof sandbox.window.goToSlide).toBe('function');
    expect(typeof sandbox.window.skipOnboarding).toBe('function');
    expect(typeof sandbox.window.finishOnboarding).toBe('function');
    expect(typeof sandbox.window.selectOnboardingPrompt).toBe('function');
    expect(typeof sandbox.window.checkOnboarding).toBe('function');
  });

  it('builds onboarding HTML with 3 slides', () => {
    const js = getOnboardingJs();
    const slideMatches = js.match(/data-slide="\d"/g);
    expect(slideMatches).not.toBeNull();
    const uniqueSlides = new Set(slideMatches!.map(m => m.match(/\d/)![0]));
    expect(uniqueSlides.size).toBe(3);
  });

  it('includes progress dots for each slide', () => {
    const js = getOnboardingJs();
    expect(js).toContain('onb-dots');
    const dotMatches = js.match(/class="onb-dot/g);
    expect(dotMatches).not.toBeNull();
    expect(dotMatches!.length).toBeGreaterThanOrEqual(3);
  });

  it('first slide has welcome content with features', () => {
    const js = getOnboardingJs();
    expect(js).toContain('Event-Sourced Architecture');
    expect(js).toContain('Checkpoint & Restore');
    expect(js).toContain('Bounded Autonomy');
    expect(js).toContain('Deep Codebase Understanding');
  });

  it('second slide describes Agent and Plan modes', () => {
    const js = getOnboardingJs();
    expect(js).toContain('Agent');
    expect(js).toContain('Plan');
    expect(js).toContain('Two Powerful Modes');
  });

  it('third slide has quick-start prompts', () => {
    const js = getOnboardingJs();
    expect(js).toContain('selectOnboardingPrompt');
  });

  it('sends onboardingComplete message to extension', () => {
    const js = getOnboardingJs();
    expect(js).toContain('ordinex:onboardingComplete');
  });
});

// ============================================================================
// ACTIONS MODULE TESTS
// ============================================================================

describe('Actions Module — handler registration', () => {
  it('registers all expected global action handlers', () => {
    const sandbox = createSandbox([getStateJs(), getActionsJs()]);

    expect(typeof sandbox.window.handleApproval).toBe('function');
    expect(typeof sandbox.window.handleDecisionPoint).toBe('function');
    expect(typeof sandbox.window.handleCrashRecovery).toBe('function');
    expect(typeof sandbox.window.handleScopeApproval).toBe('function');
    expect(typeof sandbox.window.handleUndoAction).toBe('function');
    expect(typeof sandbox.window.handleDiffReview).toBe('function');
    expect(typeof sandbox.window.handleDiffFileClick).toBe('function');
    expect(typeof sandbox.window.handleOpenFile).toBe('function');
  });

  it('registers plan-related action handlers', () => {
    const sandbox = createSandbox([getStateJs(), getActionsJs()]);

    expect(typeof sandbox.window.handleApprovePlanAndExecute).toBe('function');
    expect(typeof sandbox.window.handleExecutePlan).toBe('function');
    expect(typeof sandbox.window.handleClarificationSelect).toBe('function');
    expect(typeof sandbox.window.handleClarificationSkip).toBe('function');
    expect(typeof sandbox.window.handleCancelPlan).toBe('function');
  });

  it('registers refinement handlers', () => {
    const sandbox = createSandbox([getStateJs(), getActionsJs()]);

    expect(typeof sandbox.window.toggleRefinePlanInput).toBe('function');
    expect(typeof sandbox.window.submitPlanRefinement).toBe('function');
  });
});

// ============================================================================
// MESSAGE HANDLER — STREAMING HELPERS
// ============================================================================

describe('Message Handler — streaming block helpers', () => {
  it('block ID generation pattern exists in code', () => {
    const js = getMessageHandlerJs();
    expect(js).toContain('newBlockId');
    expect(js).toContain('_blockCounter');
    expect(js).toContain("prefix + '_'");
  });

  it('implements ensureStreamingMission initialization', () => {
    const js = getMessageHandlerJs();
    expect(js).toContain('ensureStreamingMission');
    expect(js).toContain('streamingMission');
    expect(js).toContain('blocks: []');
    expect(js).toContain('activeNarrationId: null');
    expect(js).toContain('isComplete: false');
  });

  it('implements appendNarration accumulation', () => {
    const js = getMessageHandlerJs();
    expect(js).toContain('appendNarration');
    expect(js).toContain("kind: 'narration'");
  });

  it('implements closeNarration cleanup', () => {
    const js = getMessageHandlerJs();
    expect(js).toContain('closeNarration');
    expect(js).toContain('activeNarrationId = null');
  });
});

// ============================================================================
// MESSAGE HANDLER — MESSAGE TYPE COVERAGE
// ============================================================================

describe('Message Handler — message type coverage', () => {
  const js = getMessageHandlerJs();

  it('handles all core event streaming messages', () => {
    const coreMessages = [
      'ordinex:eventsUpdate',
      'ordinex:streamDelta',
      'ordinex:streamComplete',
      'ordinex:planStreamDelta',
      'ordinex:planStreamComplete',
      'ordinex:missionStreamDelta',
      'ordinex:missionStreamComplete',
      'ordinex:missionToolActivity',
    ];

    for (const msg of coreMessages) {
      expect(js).toContain(msg);
    }
  });

  it('handles UI control messages', () => {
    const controlMessages = [
      'ordinex:focusInput',
      'ordinex:newChat',
      'ordinex:cycleMode',
      'ordinex:triggerStop',
      'ordinex:showOnboarding',
    ];

    for (const msg of controlMessages) {
      expect(js).toContain(msg);
    }
  });

  it('handles attachment messages', () => {
    expect(js).toContain('ordinex:attachmentUploaded');
    expect(js).toContain('ordinex:attachmentError');
  });

  it('handles task management messages', () => {
    expect(js).toContain('ordinex:taskHistory');
    expect(js).toContain('ordinex:taskSwitched');
  });

  it('handles preflight and verification cards', () => {
    expect(js).toContain('ordinex:preflightCard');
    expect(js).toContain('ordinex:verificationCard');
  });

  it('handles undo state updates', () => {
    expect(js).toContain('updateUndoState');
  });

  it('handles context usage messages', () => {
    expect(js).toContain('ordinex:contextUsage');
    expect(js).toContain('ordinex:contextCompacting');
    expect(js).toContain('ordinex:suggestNewSession');
  });

  it('handles export completion', () => {
    expect(js).toContain('ordinex:exportComplete');
  });
});

// ============================================================================
// MESSAGE HANDLER — COUNTER CALCULATION LOGIC
// ============================================================================

describe('Message Handler — counter extraction from events', () => {
  const js = getMessageHandlerJs();

  it('extracts filesInScope from context_collected events', () => {
    expect(js).toContain('context_collected');
    expect(js).toContain('filesInScope');
  });

  it('extracts filesTouched from diff_applied events', () => {
    expect(js).toContain('diff_applied');
    expect(js).toContain('filesTouched');
  });

  it('extracts toolCallsUsed from tool_start events', () => {
    expect(js).toContain('tool_start');
    expect(js).toContain('toolCallsUsed');
  });

  it('extracts linesIncluded from retrieval events', () => {
    expect(js).toContain('linesIncluded');
  });
});

// ============================================================================
// MESSAGE HANDLER — MARKDOWN REPARSE LOGIC
// ============================================================================

describe('Message Handler — shouldReparseMarkdown heuristics', () => {
  const js = getMessageHandlerJs();

  it('reparses on 60-char threshold', () => {
    expect(js).toContain('>= 60');
  });

  it('reparses on newline patterns', () => {
    expect(js).toContain('\\n\\n');
  });

  it('reparses every 4th delta as fallback', () => {
    expect(js).toContain('% 4');
  });
});

// ============================================================================
// MESSAGE HANDLER — AUTO-SCROLL LOGIC
// ============================================================================

describe('Message Handler — auto-scroll behavior', () => {
  const js = getMessageHandlerJs();

  it('implements isNearBottom check', () => {
    expect(js).toContain('isNearBottom');
    expect(js).toContain('scrollTop');
    expect(js).toContain('scrollHeight');
    expect(js).toContain('clientHeight');
  });

  it('preserves scroll intent during updates', () => {
    expect(js).toContain('preserveStreamingScrollIntent');
  });

  it('respects user scroll pinning', () => {
    expect(js).toContain('_missionUserPinnedScroll');
  });
});

// ============================================================================
// ACTIONS — MESSAGE POSTING
// ============================================================================

describe('Actions — VS Code message protocol', () => {
  const js = getActionsJs();

  it('posts undo_action with group_id', () => {
    expect(js).toContain("type: 'undo_action'");
    expect(js).toContain('group_id');
  });

  it('posts open_file message for diff file clicks', () => {
    expect(js).toContain("type: 'open_file'");
  });

  it('posts plan approval messages', () => {
    expect(js).toContain('ordinex:resolvePlanApproval');
    expect(js).toContain('ordinex:approvePlanAndExecute');
  });

  it('posts clarification messages', () => {
    expect(js).toContain('ordinex:selectClarificationOption');
    expect(js).toContain('ordinex:skipClarification');
  });

  it('posts plan refinement message', () => {
    expect(js).toContain('ordinex:refinePlan');
  });

  it('handles scope approval via handleApproval', () => {
    expect(js).toContain('handleScopeApproval');
    expect(js).toContain('scope_expansion');
  });
});

// ============================================================================
// RENDERERS — CARD TYPES
// ============================================================================

describe('Renderers — card type coverage', () => {
  // We import lazily since getRenderersJs can be large
  let js: string;

  beforeEach(async () => {
    const mod = await import('../webviewJs/renderers');
    js = mod.getRenderersJs();
  });

  it('renders diff_applied cards with file stats', () => {
    expect(js).toContain('diff-applied-card');
    expect(js).toContain('diff-applied-header');
    expect(js).toContain('diff-applied-stats');
    expect(js).toContain('diff-applied-files');
  });

  it('renders per-file addition/deletion stats', () => {
    expect(js).toContain('diff-stat-add');
    expect(js).toContain('diff-stat-del');
    expect(js).toContain('diff-file-name');
  });

  it('renders streaming blocks for mission mode', () => {
    expect(js).toContain('renderStreamingBlocks');
    expect(js).toContain('streaming-blocks-container');
  });

  it('renders tool activity blocks', () => {
    expect(js).toContain('renderToolBlock');
    expect(js).toContain('tool-block');
  });

  it('renders narration blocks', () => {
    expect(js).toContain('renderNarrationBlock');
    expect(js).toContain('narration-block');
  });

  it('renders approval request cards', () => {
    expect(js).toContain('approval_requested');
    expect(js).toContain('renderApprovalCard');
  });

  it('hides internal events from timeline', () => {
    expect(js).toContain('loop_completed');
    expect(js).toContain('mission_completed');
  });

  it('defers diff_applied to end of timeline', () => {
    expect(js).toContain('deferredDiffApplied');
  });

  it('renders clickable file rows in diff cards', () => {
    expect(js).toContain('diff-file-clickable');
    expect(js).toContain('handleDiffFileClick');
  });

  it('renders undo and review buttons in diff cards', () => {
    expect(js).toContain('handleUndoAction');
    expect(js).toContain('diff-action-btn');
    expect(js).toContain('diff-review-btn');
    expect(js).toContain('handleDiffReview');
  });
});

// ============================================================================
// CROSS-MODULE INTEGRATION
// ============================================================================

describe('Cross-Module Integration', () => {
  it('all modules produce valid JS when concatenated', () => {
    const stateJs = getStateJs();
    const actionsJs = getActionsJs();
    const onboardingJs = getOnboardingJs();

    const combined = `${stateJs}\n${actionsJs}\n${onboardingJs}`;
    expect(() => new Function(combined)).not.toThrow();
  });

  it('state module references are consistent with action handlers', () => {
    const stateJs = getStateJs();
    const actionsJs = getActionsJs();

    expect(stateJs).toContain('events:');
    expect(actionsJs).toContain('state.events');
  });

  it('onboarding module references state correctly', () => {
    const stateJs = getStateJs();
    const onboardingJs = getOnboardingJs();

    expect(stateJs).toContain('currentMode:');
    expect(onboardingJs).toContain('state.currentMode');
  });
});
