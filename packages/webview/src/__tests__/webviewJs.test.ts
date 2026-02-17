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
});
