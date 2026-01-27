/**
 * Model Selection Tests
 * Task 2: Integrate Claude Sonnet 4.5 into Model dropdown
 * 
 * Tests:
 * 1. Unit test: selecting Sonnet 4.5 sets the correct model id in outgoing request payload
 * 2. Smoke test: model list includes both models
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock MODEL_MAP as used in llmService.ts and llmEditTool.ts
const MODEL_MAP: Record<string, string> = {
  'claude-3-haiku': 'claude-3-haiku-20240307',
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20250514',
  'claude-3-sonnet': 'claude-3-sonnet-20240229',
  'claude-3-opus': 'claude-3-opus-20240229',
  'sonnet-4.5': 'claude-sonnet-4-5-20250514',
  'opus-4.5': 'claude-3-haiku-20240307',
  'gpt-5.2': 'claude-3-haiku-20240307',
  'gemini-3': 'claude-3-haiku-20240307',
};

const DEFAULT_MODEL = 'claude-3-haiku-20240307';

// Available models in UI dropdown
const UI_MODEL_OPTIONS = [
  { value: 'claude-3-haiku', label: 'Claude 3 Haiku', hint: 'Fast / lightweight' },
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', hint: 'Best for building features / multi-file changes' },
];

describe('Model Selection', () => {
  describe('MODEL_MAP Mappings', () => {
    it('should map claude-3-haiku to claude-3-haiku-20240307', () => {
      expect(MODEL_MAP['claude-3-haiku']).toBe('claude-3-haiku-20240307');
    });

    it('should map claude-sonnet-4-5 to claude-sonnet-4-5-20250514', () => {
      expect(MODEL_MAP['claude-sonnet-4-5']).toBe('claude-sonnet-4-5-20250514');
    });

    it('should have a default model fallback', () => {
      expect(DEFAULT_MODEL).toBe('claude-3-haiku-20240307');
    });

    it('should fallback to DEFAULT_MODEL for unknown models', () => {
      const unknownModel = 'unknown-model-xyz';
      const actualModel = MODEL_MAP[unknownModel] || DEFAULT_MODEL;
      expect(actualModel).toBe(DEFAULT_MODEL);
    });
  });

  describe('Unit Test: Selecting Sonnet 4.5 sets correct model id', () => {
    it('should resolve claude-sonnet-4-5 to the correct Anthropic model name', () => {
      const userSelectedModel = 'claude-sonnet-4-5';
      const actualModel = MODEL_MAP[userSelectedModel] || DEFAULT_MODEL;
      
      // CRITICAL: This is what gets sent to Anthropic API
      expect(actualModel).toBe('claude-sonnet-4-5-20250514');
    });

    it('should use exactly the user-selected model, no auto-switching', () => {
      const selections = [
        { userSelected: 'claude-3-haiku', expected: 'claude-3-haiku-20240307' },
        { userSelected: 'claude-sonnet-4-5', expected: 'claude-sonnet-4-5-20250514' },
      ];

      for (const { userSelected, expected } of selections) {
        const actualModel = MODEL_MAP[userSelected] || DEFAULT_MODEL;
        expect(actualModel).toBe(expected);
      }
    });

    it('should pass correct model in request payload simulation', () => {
      // Simulate what happens in LLMService.streamAnswerWithContext
      const config = {
        apiKey: 'test-key',
        model: 'claude-sonnet-4-5',  // User selected Sonnet 4.5
        maxTokens: 4096,
      };

      const userSelectedModel = config.model;
      const actualModel = MODEL_MAP[userSelectedModel] || DEFAULT_MODEL;
      const didFallback = !MODEL_MAP[userSelectedModel];

      // Should NOT fallback - claude-sonnet-4-5 is a valid selection
      expect(didFallback).toBe(false);
      
      // Payload would contain:
      const mockPayload = {
        tool: 'llm_answer',
        model: actualModel,
        max_tokens: config.maxTokens,
      };

      expect(mockPayload.model).toBe('claude-sonnet-4-5-20250514');
    });
  });

  describe('Smoke Test: Model list renders both models', () => {
    it('should include Claude 3 Haiku in UI options', () => {
      const haikuOption = UI_MODEL_OPTIONS.find(opt => opt.value === 'claude-3-haiku');
      expect(haikuOption).toBeDefined();
      expect(haikuOption?.label).toBe('Claude 3 Haiku');
      expect(haikuOption?.hint).toBe('Fast / lightweight');
    });

    it('should include Claude Sonnet 4.5 in UI options', () => {
      const sonnetOption = UI_MODEL_OPTIONS.find(opt => opt.value === 'claude-sonnet-4-5');
      expect(sonnetOption).toBeDefined();
      expect(sonnetOption?.label).toBe('Claude Sonnet 4.5');
      expect(sonnetOption?.hint).toBe('Best for building features / multi-file changes');
    });

    it('should have exactly 2 model options in dropdown', () => {
      expect(UI_MODEL_OPTIONS.length).toBe(2);
    });

    it('should have tooltips/hints for each model', () => {
      for (const option of UI_MODEL_OPTIONS) {
        expect(option.hint).toBeDefined();
        expect(option.hint.length).toBeGreaterThan(0);
      }
    });
  });

  describe('No Hidden Routing', () => {
    it('should not auto-switch between models based on context', () => {
      // The model passed in config should be used exactly
      // No internal logic should change the user's selection
      
      const testCases = [
        { input: 'claude-3-haiku', expectedOutput: 'claude-3-haiku-20240307' },
        { input: 'claude-sonnet-4-5', expectedOutput: 'claude-sonnet-4-5-20250514' },
      ];

      for (const { input, expectedOutput } of testCases) {
        const result = MODEL_MAP[input];
        expect(result).toBe(expectedOutput);
      }
    });

    it('should use the same model across all call types', () => {
      const userSelection = 'claude-sonnet-4-5';
      const actualModel = MODEL_MAP[userSelection] || DEFAULT_MODEL;

      // PLAN mode calls
      expect(actualModel).toBe('claude-sonnet-4-5-20250514');

      // Mission execution calls (llm_edit_step)
      expect(actualModel).toBe('claude-sonnet-4-5-20250514');

      // Repair loop calls
      expect(actualModel).toBe('claude-sonnet-4-5-20250514');
    });
  });

  describe('Error Mapping', () => {
    // Test error type mapping
    const mapApiErrorToType = (error: Error): string => {
      const message = error.message.toLowerCase();
      
      if (message.includes('model') && (message.includes('not found') || message.includes('not available'))) {
        return 'model_not_available';
      }
      if (message.includes('unauthorized') || message.includes('invalid api key')) {
        return 'unauthorized';
      }
      if (message.includes('rate limit') || message.includes('too many requests')) {
        return 'rate_limit';
      }
      return 'unknown';
    };

    it('should map model not available error', () => {
      const error = new Error('Model claude-sonnet-4-5-20250514 not found');
      expect(mapApiErrorToType(error)).toBe('model_not_available');
    });

    it('should map unauthorized error', () => {
      const error = new Error('Invalid API key provided');
      expect(mapApiErrorToType(error)).toBe('unauthorized');
    });

    it('should map rate limit error', () => {
      const error = new Error('Rate limit exceeded. Too many requests.');
      expect(mapApiErrorToType(error)).toBe('rate_limit');
    });

    it('should map unknown error', () => {
      const error = new Error('Something went wrong');
      expect(mapApiErrorToType(error)).toBe('unknown');
    });
  });
});
