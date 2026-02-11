/**
 * Mode Confirmation Policy Tests
 * Tests for confirmation decisions and sticky suppression
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { ModeConfirmationPolicy } from '../modeConfirmationPolicy';
import { classifyPromptV2 } from '../modeClassifier';
import { ClassificationResultV2 } from '../types';

describe('Mode Confirmation Policy', () => {
  let policy: ModeConfirmationPolicy;
  
  beforeEach(() => {
    policy = new ModeConfirmationPolicy();
  });
  
  describe('Low confidence never confirms', () => {
    test('Low confidence with mode mismatch → no confirmation', () => {
      const mockResult: ClassificationResultV2 = {
        suggestedMode: 'MISSION',
        confidence: 'low',
        reasonTags: [],
        scores: { answer: 1, plan: 1, mission: 1.5 },
        reasonSignature: 'test→MISSION'
      };
      
      const decision = policy.shouldConfirm('task1', 'PLAN', mockResult, 1);
      expect(decision.shouldConfirm).toBe(false);
      expect(decision.reason).toContain('Low confidence');
    });
  });
  
  describe('Medium confidence mismatches', () => {
    test('Medium confidence mismatch shows confirmation', () => {
      const result = classifyPromptV2('Can you help me add logging?');
      
      // If medium confidence and user selected different mode
      if (result.confidence === 'medium') {
        const decision = policy.shouldConfirm('task1', 'PLAN', result, 1);
        expect(decision.shouldConfirm).toBe(true);
        expect(decision.reason).toContain('Medium confidence');
      }
    });
    
    test('Medium confidence but modes match → no confirmation', () => {
      const mockResult: ClassificationResultV2 = {
        suggestedMode: 'MISSION',
        confidence: 'medium',
        reasonTags: ['action_verbs'],
        scores: { answer: 0, plan: 2, mission: 3 },
        reasonSignature: 'action_verbs→MISSION'
      };
      
      const decision = policy.shouldConfirm('task1', 'MISSION', mockResult, 1);
      expect(decision.shouldConfirm).toBe(false);
      expect(decision.severity).toBe('none');
    });
  });
  
  describe('High confidence with severity', () => {
    test('High confidence + high severity → confirm', () => {
      const mockResult: ClassificationResultV2 = {
        suggestedMode: 'MISSION',
        confidence: 'high',
        reasonTags: ['action_verbs', 'file_reference'],
        scores: { answer: 0, plan: 0, mission: 5 },
        reasonSignature: 'action_verbs,file_reference→MISSION'
      };
      
      // User chose PLAN but system suggests MISSION (high severity)
      const decision = policy.shouldConfirm('task1', 'PLAN', mockResult, 1);
      expect(decision.shouldConfirm).toBe(true);
      expect(decision.severity).toBe('high');
    });
    
    test('High confidence + medium severity → no confirmation', () => {
      const mockResult: ClassificationResultV2 = {
        suggestedMode: 'PLAN',
        confidence: 'high',
        reasonTags: ['planning_terms'],
        scores: { answer: 0, plan: 5, mission: 0 },
        reasonSignature: 'planning_terms→PLAN'
      };
      
      // User chose MISSION but system suggests PLAN (medium severity)
      const decision = policy.shouldConfirm('task1', 'MISSION', mockResult, 1);
      expect(decision.shouldConfirm).toBe(false);
      expect(decision.severity).toBe('medium');
    });
    
    test('High confidence + low severity → no confirmation', () => {
      const mockResult: ClassificationResultV2 = {
        suggestedMode: 'PLAN',
        confidence: 'high',
        reasonTags: ['planning_terms'],
        scores: { answer: 0, plan: 5, mission: 0 },
        reasonSignature: 'planning_terms→PLAN'
      };
      
      // User chose ANSWER but system suggests PLAN (low severity)
      const decision = policy.shouldConfirm('task1', 'ANSWER', mockResult, 1);
      expect(decision.shouldConfirm).toBe(false);
      expect(decision.severity).toBe('low');
    });
  });
  
  describe('Severity levels', () => {
    test('PLAN→MISSION is high severity', () => {
      const mockResult: ClassificationResultV2 = {
        suggestedMode: 'MISSION',
        confidence: 'high',
        reasonTags: ['action_verbs'],
        scores: { answer: 0, plan: 0, mission: 5 },
        reasonSignature: 'action_verbs→MISSION'
      };
      
      const decision = policy.shouldConfirm('task1', 'PLAN', mockResult, 1);
      expect(decision.severity).toBe('high');
    });
    
    test('ANSWER→MISSION is high severity', () => {
      const mockResult: ClassificationResultV2 = {
        suggestedMode: 'MISSION',
        confidence: 'high',
        reasonTags: ['action_verbs'],
        scores: { answer: 0, plan: 0, mission: 5 },
        reasonSignature: 'action_verbs→MISSION'
      };
      
      const decision = policy.shouldConfirm('task1', 'ANSWER', mockResult, 1);
      expect(decision.severity).toBe('high');
    });
    
    test('MISSION→PLAN is medium severity', () => {
      const mockResult: ClassificationResultV2 = {
        suggestedMode: 'PLAN',
        confidence: 'medium',
        reasonTags: ['planning_terms'],
        scores: { answer: 0, plan: 3, mission: 0 },
        reasonSignature: 'planning_terms→PLAN'
      };
      
      const decision = policy.shouldConfirm('task1', 'MISSION', mockResult, 1);
      expect(decision.severity).toBe('medium');
    });
    
    test('ANSWER↔PLAN is low severity', () => {
      const mockResult: ClassificationResultV2 = {
        suggestedMode: 'PLAN',
        confidence: 'medium',
        reasonTags: ['planning_terms'],
        scores: { answer: 0, plan: 3, mission: 0 },
        reasonSignature: 'planning_terms→PLAN'
      };
      
      const decision = policy.shouldConfirm('task1', 'ANSWER', mockResult, 1);
      expect(decision.severity).toBe('low');
    });
  });
  
  describe('Sticky suppression', () => {
    test('First occurrence shows confirmation', () => {
      const result = classifyPromptV2('Add error handling');
      
      const decision = policy.shouldConfirm('task1', 'PLAN', result, 1);
      // Should confirm (no previous override)
      expect(decision.shouldConfirm).toBe(true);
    });
    
    test('Second occurrence with same pattern suppresses confirmation', () => {
      // Use medium confidence scenario (high+high overrides suppression)
      const mockResult: ClassificationResultV2 = {
        suggestedMode: 'PLAN',
        confidence: 'medium',
        reasonTags: ['planning_terms'],
        scores: { answer: 0, plan: 3, mission: 0 },
        reasonSignature: 'planning_terms→PLAN'
      };

      // First time: confirm (medium confidence mismatch)
      const decision1 = policy.shouldConfirm('task1', 'MISSION', mockResult, 1);
      expect(decision1.shouldConfirm).toBe(true);

      // User chooses MISSION (dismisses suggestion)
      policy.recordOverride('task1', mockResult, 'MISSION', 1);

      // Second time with same pattern (turn 2): should suppress
      const decision2 = policy.shouldConfirm('task1', 'MISSION', mockResult, 2);
      expect(decision2.shouldConfirm).toBe(false);
      expect(decision2.reason).toContain('suppression');
    });
    
    test('Suppression expires after window', () => {
      const result = classifyPromptV2('Add error handling');
      
      // User chooses PLAN at turn 1
      policy.recordOverride('task1', result, 'PLAN', 1);
      
      // Turn 7 (beyond 5-turn window): should not suppress
      const decision = policy.shouldConfirm('task1', 'PLAN', result, 7);
      expect(decision.shouldConfirm).toBe(true);
    });
    
    test('High confidence + high severity overrides suppression', () => {
      const mockResult: ClassificationResultV2 = {
        suggestedMode: 'MISSION',
        confidence: 'high',
        reasonTags: ['action_verbs', 'file_reference'],
        scores: { answer: 0, plan: 0, mission: 5 },
        reasonSignature: 'action_verbs,file_reference→MISSION'
      };
      
      // User dismissed at turn 1
      policy.recordOverride('task1', mockResult, 'PLAN', 1);
      
      // Turn 2: high severity should override suppression
      const decision = policy.shouldConfirm('task1', 'PLAN', mockResult, 2);
      expect(decision.shouldConfirm).toBe(true);
      expect(decision.reason).toContain('override suppression');
    });
    
    test('Different reasonSignature is not suppressed', () => {
      const result1 = classifyPromptV2('Add error handling');
      const result2 = classifyPromptV2('Fix TypeScript errors');
      
      // User dismisses first pattern
      policy.recordOverride('task1', result1, 'PLAN', 1);
      
      // Different pattern: should not be suppressed
      const decision = policy.shouldConfirm('task1', 'PLAN', result2, 2);
      expect(decision.shouldConfirm).toBe(true);
    });
    
    test('Different taskId is not suppressed', () => {
      const result = classifyPromptV2('Add error handling');
      
      // User dismisses in task1
      policy.recordOverride('task1', result, 'PLAN', 1);
      
      // Same pattern in task2: should not be suppressed
      const decision = policy.shouldConfirm('task2', 'PLAN', result, 2);
      expect(decision.shouldConfirm).toBe(true);
    });
  });
  
  describe('Cache management', () => {
    test('clearCache() removes all overrides', () => {
      const result = classifyPromptV2('Add error handling');
      
      policy.recordOverride('task1', result, 'PLAN', 1);
      policy.clearCache();
      
      // After clear: should confirm again
      const decision = policy.shouldConfirm('task1', 'PLAN', result, 2);
      expect(decision.shouldConfirm).toBe(true);
    });
  });
  
  describe('Integration with real classifier', () => {
    test('Conversational action request flow', () => {
      const result = classifyPromptV2('Can you help me implement OAuth?');
      
      expect(result.suggestedMode).toBe('MISSION');
      
      // User selected PLAN
      const decision = policy.shouldConfirm('task1', 'PLAN', result, 1);
      
      // Should show confirmation (PLAN→MISSION is high severity)
      expect(decision.shouldConfirm).toBe(true);
    });
    
    test('Planning request flow', () => {
      // Avoid action verbs so PLAN wins ("create" would trigger action_verbs)
      const result = classifyPromptV2('Roadmap for adding OAuth support');

      expect(result.suggestedMode).toBe('PLAN');

      // User selected MISSION
      const decision = policy.shouldConfirm('task1', 'MISSION', result, 1);

      // Should not confirm (medium severity + high confidence)
      expect(decision.shouldConfirm).toBe(false);
      expect(decision.severity).toBe('medium');
    });
  });
});
