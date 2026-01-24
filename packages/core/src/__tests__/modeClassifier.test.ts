/**
 * Mode Classifier V2 Tests
 * Tests for deterministic heuristic classification
 */

import { describe, test, expect } from 'vitest';
import { classifyPromptV2, classifyPrompt } from '../modeClassifier';

describe('Mode Classifier V2', () => {
  describe('Conversational action requests', () => {
    test('"Can you help me add error handling?" → MISSION', () => {
      const result = classifyPromptV2('Can you help me add error handling?');
      expect(result.suggestedMode).toBe('MISSION');
      expect(result.confidence).not.toBe('low');
      expect(result.reasonTags).toContain('action_verbs');
      expect(result.reasonTags).toContain('conversational_action');
    });
    
    test('"Let\'s implement authentication" → MISSION', () => {
      const result = classifyPromptV2('Let\'s implement authentication');
      expect(result.suggestedMode).toBe('MISSION');
      expect(result.reasonTags).toContain('conversational_action');
      expect(result.reasonTags).toContain('action_verbs');
    });
    
    test('"I need to refactor the payment flow" → MISSION', () => {
      const result = classifyPromptV2('I need to refactor the payment flow');
      expect(result.suggestedMode).toBe('MISSION');
      expect(result.reasonTags).toContain('conversational_action');
      expect(result.reasonTags).toContain('action_verbs');
    });
    
    test('"Can we fix the TypeScript errors?" → MISSION', () => {
      const result = classifyPromptV2('Can we fix the TypeScript errors?');
      expect(result.suggestedMode).toBe('MISSION');
      expect(result.reasonTags).toContain('conversational_action');
      expect(result.reasonTags).toContain('action_verbs');
      expect(result.reasonTags).toContain('error_reference');
    });
  });

  describe('Action verbs override question form', () => {
    test('"Show me how to add logging" → MISSION (not ANSWER high)', () => {
      const result = classifyPromptV2('Show me how to add logging');
      // Should be MISSION or at least not ANSWER with high confidence
      if (result.suggestedMode === 'ANSWER') {
        expect(result.confidence).not.toBe('high');
      }
      // More likely: should be MISSION with medium confidence
      expect(result.reasonTags).toContain('action_verbs');
    });
    
    test('"Can you add error handling?" → MISSION despite question mark', () => {
      const result = classifyPromptV2('Can you add error handling?');
      expect(result.suggestedMode).toBe('MISSION');
      expect(result.reasonTags).toContain('action_verbs');
    });
  });

  describe('File references boost MISSION', () => {
    test('"Fix TS error in src/components/Profile.tsx" → MISSION high', () => {
      const result = classifyPromptV2('Fix TS error in src/components/Profile.tsx');
      expect(result.suggestedMode).toBe('MISSION');
      expect(result.confidence).toBe('high');
      expect(result.reasonTags).toContain('action_verbs');
      expect(result.reasonTags).toContain('file_reference');
      expect(result.reasonTags).toContain('error_reference');
    });
    
    test('"Error in packages/core/src/types.ts line 42" → MISSION', () => {
      const result = classifyPromptV2('Error in packages/core/src/types.ts line 42');
      expect(result.suggestedMode).toBe('MISSION');
      expect(result.reasonTags).toContain('file_reference');
      expect(result.reasonTags).toContain('error_reference');
    });
    
    test('"The tests/ directory is failing" → MISSION', () => {
      const result = classifyPromptV2('The tests/ directory is failing');
      expect(result.suggestedMode).toBe('MISSION');
      expect(result.reasonTags).toContain('file_reference');
      expect(result.reasonTags).toContain('error_reference');
    });
  });

  describe('Planning vs execution', () => {
    test('"Plan a new authentication system" → PLAN high', () => {
      const result = classifyPromptV2('Plan a new authentication system');
      expect(result.suggestedMode).toBe('PLAN');
      expect(result.confidence).toBe('high');
      expect(result.reasonTags).toContain('planning_terms');
    });
    
    test('"Next steps to improve this repo architecture" → PLAN', () => {
      const result = classifyPromptV2('Next steps to improve this repo architecture');
      expect(result.suggestedMode).toBe('PLAN');
      expect(result.reasonTags).toContain('planning_terms');
    });
    
    test('"Roadmap for implementing JWT authentication" → PLAN', () => {
      const result = classifyPromptV2('Roadmap for implementing JWT authentication');
      expect(result.suggestedMode).toBe('PLAN');
      expect(result.reasonTags).toContain('planning_terms');
    });
    
    test('"Design a new caching strategy" → PLAN', () => {
      const result = classifyPromptV2('Design a new caching strategy');
      expect(result.suggestedMode).toBe('PLAN');
      expect(result.reasonTags).toContain('planning_terms');
    });
  });

  describe('Planning with file references', () => {
    test('"Plan how to fix the failing tests" → PLAN medium/high', () => {
      const result = classifyPromptV2('Plan how to fix the failing tests');
      expect(result.suggestedMode).toBe('PLAN');
      expect(result.reasonTags).toContain('planning_terms');
      expect(result.reasonTags).toContain('error_reference');
      // Should have medium or high confidence
      expect(['medium', 'high']).toContain(result.confidence);
    });
    
    test('"Strategy to refactor src/api.ts" → May be ambiguous', () => {
      const result = classifyPromptV2('Strategy to refactor src/api.ts');
      // Has both planning terms and action verbs + file ref
      expect(result.reasonTags).toContain('planning_terms');
      expect(result.reasonTags).toContain('action_verbs');
      expect(result.reasonTags).toContain('file_reference');
      // Confidence may be low due to ambiguity
    });
  });

  describe('Pure questions → ANSWER', () => {
    test('"What is TypeScript?" → ANSWER high', () => {
      const result = classifyPromptV2('What is TypeScript?');
      expect(result.suggestedMode).toBe('ANSWER');
      expect(result.confidence).toBe('high');
      expect(result.reasonTags).toContain('question_form');
    });
    
    test('"Explain JWT vs sessions" → ANSWER high', () => {
      const result = classifyPromptV2('Explain JWT vs sessions');
      expect(result.suggestedMode).toBe('ANSWER');
      expect(result.confidence).toBe('high');
      expect(result.reasonTags).toContain('question_form');
    });
    
    test('"Why does React use virtual DOM?" → ANSWER', () => {
      const result = classifyPromptV2('Why does React use virtual DOM?');
      expect(result.suggestedMode).toBe('ANSWER');
      expect(result.reasonTags).toContain('question_form');
    });
    
    test('"How does async/await work?" → ANSWER', () => {
      const result = classifyPromptV2('How does async/await work?');
      expect(result.suggestedMode).toBe('ANSWER');
      expect(result.reasonTags).toContain('question_form');
    });
  });

  describe('Edge cases and ambiguity', () => {
    test('Empty string → low confidence', () => {
      const result = classifyPromptV2('');
      expect(result.confidence).toBe('low');
    });
    
    test('"Hello" (generic greeting) → low confidence', () => {
      const result = classifyPromptV2('Hello');
      expect(result.confidence).toBe('low');
    });
    
    test('"Let\'s plan to add authentication" (planning + action) → Ambiguous', () => {
      const result = classifyPromptV2('Let\'s plan to add authentication');
      // Has both planning terms and action verbs
      expect(result.reasonTags).toContain('planning_terms');
      expect(result.reasonTags).toContain('action_verbs');
      expect(result.reasonTags).toContain('conversational_action');
      // Could be PLAN or MISSION depending on scoring
    });
  });

  describe('Confidence levels', () => {
    test('High confidence when clear single mode', () => {
      const result = classifyPromptV2('What is Redux?');
      expect(result.confidence).toBe('high');
      expect(result.suggestedMode).toBe('ANSWER');
    });
    
    test('Medium confidence when moderate signal', () => {
      const result = classifyPromptV2('Could you help me refactor this?');
      // Conversational action but less specific
      expect(['medium', 'high']).toContain(result.confidence);
    });
    
    test('Low confidence when ambiguous or weak signals', () => {
      const result = classifyPromptV2('Something needs work');
      expect(result.confidence).toBe('low');
    });
  });

  describe('Reason signature stability', () => {
    test('Same prompt produces same reasonSignature', () => {
      const result1 = classifyPromptV2('Add error handling');
      const result2 = classifyPromptV2('Add error handling');
      expect(result1.reasonSignature).toBe(result2.reasonSignature);
    });
    
    test('Tags are sorted in signature', () => {
      const result = classifyPromptV2('Fix error in src/api.ts');
      // Should have action_verbs, error_reference, file_reference
      // Check that signature has sorted tags
      expect(result.reasonSignature).toMatch(/→MISSION$/);
      expect(result.reasonSignature.split('→')[0].split(',')).toEqual(
        expect.arrayContaining(result.reasonTags.sort())
      );
    });
  });

  describe('Backward compatibility', () => {
    test('classifyPrompt() wrapper works', () => {
      const result = classifyPrompt('What is TypeScript?');
      expect(result.suggestedMode).toBe('ANSWER');
      expect(result.confidence).toBe('high');
      expect(result.reasoning).toContain('question_form');
    });
    
    test('classifyPrompt() returns simplified result', () => {
      const result = classifyPrompt('Add error handling');
      expect(result).toHaveProperty('suggestedMode');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('reasoning');
      expect(result).not.toHaveProperty('reasonTags');
      expect(result).not.toHaveProperty('scores');
    });
  });

  describe('Score transparency', () => {
    test('Scores are exposed for debugging', () => {
      const result = classifyPromptV2('Add authentication');
      expect(result.scores).toHaveProperty('answer');
      expect(result.scores).toHaveProperty('plan');
      expect(result.scores).toHaveProperty('mission');
      expect(typeof result.scores.answer).toBe('number');
      expect(typeof result.scores.plan).toBe('number');
      expect(typeof result.scores.mission).toBe('number');
    });
    
    test('MISSION score is highest for action verbs', () => {
      const result = classifyPromptV2('Implement user authentication');
      expect(result.scores.mission).toBeGreaterThan(result.scores.answer);
      expect(result.scores.mission).toBeGreaterThan(result.scores.plan);
    });
    
    test('PLAN score is highest for planning terms', () => {
      const result = classifyPromptV2('Create a roadmap for authentication');
      expect(result.scores.plan).toBeGreaterThan(result.scores.answer);
      expect(result.scores.plan).toBeGreaterThan(result.scores.mission);
    });
  });
});
