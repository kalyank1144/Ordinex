/**
 * P3-2: Webview JS Module Tests
 *
 * Validates that each webviewJs module:
 *   1. Exports a function that returns a string
 *   2. The returned string is syntactically valid JavaScript
 *   3. Contains expected DOM references, handlers, or identifiers
 */

import { describe, it, expect } from 'vitest';

import { getStateJs } from '../webviewJs/state';
import { getInputHandlersJs } from '../webviewJs/inputHandlers';
import { getMessageHandlerJs } from '../webviewJs/messageHandler';
import { getRenderersJs } from '../webviewJs/renderers';
import { getActionsJs } from '../webviewJs/actions';
import { getSendStopBtnJs } from '../webviewJs/sendStopBtn';
import { getInitJs } from '../webviewJs/init';
import { getOnboardingJs } from '../webviewJs/onboarding';

// Helper: validate that a JS string parses without errors
function assertValidJs(code: string, label: string): void {
  expect(typeof code).toBe('string');
  expect(code.length).toBeGreaterThan(0);
  // new Function(...) will throw SyntaxError on invalid JS
  expect(() => new Function(code)).not.toThrow();
}

describe('Webview JS Modules', () => {
  // ========================================================================
  // state.ts
  // ========================================================================

  describe('getStateJs', () => {
    const js = getStateJs();

    it('produces valid JavaScript', () => {
      assertValidJs(js, 'state');
    });

    it('declares DOM element references', () => {
      expect(js).toContain('statusPill');
      expect(js).toContain('promptInput');
      expect(js).toContain('sendBtn');
      expect(js).toContain('modeSelect');
      expect(js).toContain('modelSelect');
      expect(js).toContain('newChatBtn');
    });

    it('declares state object with required fields', () => {
      expect(js).toContain('taskStatus:');
      expect(js).toContain('events:');
      expect(js).toContain('currentMode:');
      expect(js).toContain('narrationCards:');
    });

    it('declares counters with expected keys', () => {
      expect(js).toContain('filesInScope');
      expect(js).toContain('filesTouched');
      expect(js).toContain('toolCallsUsed');
    });
  });

  // ========================================================================
  // inputHandlers.ts
  // ========================================================================

  describe('getInputHandlersJs', () => {
    const js = getInputHandlersJs();

    it('produces valid JavaScript', () => {
      assertValidJs(js, 'inputHandlers');
    });

    it('handles send button click', () => {
      expect(js).toContain("sendBtn.addEventListener('click'");
    });

    it('handles new chat button click', () => {
      expect(js).toContain('newChatBtn');
      expect(js).toContain("ordinex:newChat");
    });

    it('handles Enter key to send', () => {
      expect(js).toContain("e.key === 'Enter'");
      expect(js).toContain('!e.shiftKey');
    });

    it('handles mode and model changes', () => {
      expect(js).toContain("modeSelect.addEventListener('change'");
      expect(js).toContain("modelSelect.addEventListener('change'");
    });

    it('has autoResizeTextarea function', () => {
      expect(js).toContain('function autoResizeTextarea');
    });
  });

  // ========================================================================
  // messageHandler.ts
  // ========================================================================

  describe('getMessageHandlerJs', () => {
    const js = getMessageHandlerJs();

    it('produces valid JavaScript', () => {
      assertValidJs(js, 'messageHandler');
    });

    it('handles mission stream delta messages', () => {
      expect(js).toContain('ordinex:missionStreamDelta');
    });

    it('handles events update messages', () => {
      expect(js).toContain('ordinex:eventsUpdate');
    });

    it('handles focus input message (Step 52)', () => {
      expect(js).toContain("case 'ordinex:focusInput'");
    });

    it('handles new chat message (Step 52)', () => {
      expect(js).toContain("case 'ordinex:newChat'");
    });

    it('handles trigger stop message (Step 52)', () => {
      expect(js).toContain("case 'ordinex:triggerStop'");
    });

    it('handles onboarding message (A9)', () => {
      expect(js).toContain("case 'ordinex:showOnboarding'");
    });
  });

  // ========================================================================
  // sendStopBtn.ts
  // ========================================================================

  describe('getSendStopBtnJs', () => {
    const js = getSendStopBtnJs();

    it('produces valid JavaScript', () => {
      assertValidJs(js, 'sendStopBtn');
    });

    it('has updateSendStopButton function', () => {
      expect(js).toContain('function updateSendStopButton');
    });

    it('toggles between send and stop states', () => {
      expect(js).toContain("'send-stop-btn stop'");
      expect(js).toContain("'send-stop-btn send'");
    });

    it('posts stopExecution message', () => {
      expect(js).toContain('ordinex:stopExecution');
    });
  });

  // ========================================================================
  // init.ts
  // ========================================================================

  describe('getInitJs', () => {
    const js = getInitJs();

    it('produces valid JavaScript', () => {
      assertValidJs(js, 'init');
    });

    it('initializes status and stage', () => {
      expect(js).toContain("updateStatus('ready')");
      expect(js).toContain("updateStage('none')");
    });

    it('renders initial views', () => {
      expect(js).toContain('renderMission()');
      expect(js).toContain('renderLogs()');
      expect(js).toContain('renderSystemsCounters()');
    });

    it('sets up global keyboard shortcuts (Step 52)', () => {
      expect(js).toContain("document.addEventListener('keydown'");
      expect(js).toContain("e.key === 'Escape'");
    });

    it('focuses prompt input on load', () => {
      expect(js).toContain('promptInput.focus()');
    });
  });

  // ========================================================================
  // onboarding.ts
  // ========================================================================

  describe('getOnboardingJs', () => {
    const js = getOnboardingJs();

    it('produces valid JavaScript', () => {
      assertValidJs(js, 'onboarding');
    });

    it('defines showOnboarding function', () => {
      expect(js).toContain('window.showOnboarding');
    });

    it('defines checkOnboarding function', () => {
      expect(js).toContain('window.checkOnboarding');
    });

    it('defines slide navigation', () => {
      expect(js).toContain('window.goToSlide');
    });

    it('posts onboarding complete message', () => {
      expect(js).toContain('ordinex:onboardingComplete');
    });
  });

  // ========================================================================
  // renderers.ts — diff_applied card
  // ========================================================================

  describe('getRenderersJs — diff_applied file changes card', () => {
    const js = getRenderersJs();

    it('produces valid JavaScript', () => {
      assertValidJs(js, 'renderers');
    });

    it('skips diff_proposed events (internal for undo system)', () => {
      expect(js).toContain('diff_proposed is an internal event');
    });

    it('defers diff_applied rendering to end of timeline', () => {
      expect(js).toContain('deferredDiffApplied');
      expect(js).toContain("event.type === 'diff_applied'");
    });

    it('renders Codex-style file changes card with stats', () => {
      expect(js).toContain('diff-applied-card');
      expect(js).toContain('diff-applied-header');
      expect(js).toContain('diff-applied-stats');
      expect(js).toContain('diff-applied-files');
    });

    it('renders per-file additions and deletions with colored spans', () => {
      expect(js).toContain('diff-stat-add');
      expect(js).toContain('diff-stat-del');
      expect(js).toContain('diff-file-name');
      expect(js).toContain('diff-file-dot');
    });

    it('renders Undo button using existing handleUndoAction', () => {
      expect(js).toContain('handleUndoAction');
      expect(js).toContain('diff-action-btn');
    });

    it('renders Review button wired to handleDiffReview', () => {
      expect(js).toContain('diff-review-btn');
      expect(js).toContain('handleDiffReview');
    });

    it('renders clickable file rows with handleDiffFileClick', () => {
      expect(js).toContain('diff-file-clickable');
      expect(js).toContain('handleDiffFileClick');
    });

    it('hides loop_completed card from timeline', () => {
      expect(js).toContain("event.type === 'loop_completed'");
      // Should have a continue statement to skip rendering
      expect(js).toContain('Hide loop_completed card');
    });

    it('hides mission_completed card from timeline', () => {
      expect(js).toContain("event.type === 'mission_completed'");
      expect(js).toContain('Hide mission_completed card');
    });

    it('hides step_completed from progress groups', () => {
      expect(js).toContain("event.type === 'step_completed'");
    });

    it('keeps streaming block injection for loop_completed', () => {
      // The streaming blocks must still be injected at loop_completed position
      expect(js).toContain('renderCompletedBlocksAsTimelineItems');
    });
  });

  // ========================================================================
  // actions.ts — undo action handler
  // ========================================================================

  describe('getActionsJs — undo, review, file click handlers', () => {
    const js = getActionsJs();

    it('produces valid JavaScript', () => {
      assertValidJs(js, 'actions');
    });

    it('defines handleUndoAction function', () => {
      expect(js).toContain('window.handleUndoAction');
    });

    it('sends undo_action message with group_id', () => {
      expect(js).toContain("type: 'undo_action'");
      expect(js).toContain('group_id');
    });

    it('shows visual feedback on undo (disables button)', () => {
      expect(js).toContain('Undoing...');
      expect(js).toContain('btn.disabled = true');
    });

    it('defines handleDiffReview to open all changed files by diff_id', () => {
      expect(js).toContain('window.handleDiffReview');
      expect(js).toContain('diff_applied');
      expect(js).toContain('files_changed');
      expect(js).toContain("type: 'open_file'");
    });

    it('defines handleDiffFileClick to open a single file', () => {
      expect(js).toContain('window.handleDiffFileClick');
    });
  });
});
