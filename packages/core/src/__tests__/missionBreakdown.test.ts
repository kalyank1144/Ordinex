/**
 * Tests for Step 26 - Mission Breakdown (Anti-Failure Guard)
 * 
 * Tests cover:
 * - Large Plan Detector: threshold behavior, reason strings stability
 * - Mission Breakdown Generator: step accounting, mission caps, DAG cycles
 * - State derivation: replay behavior
 */

import { describe, it, expect } from 'vitest';
import { 
  detectLargePlan, 
  buildPlanTextForAnalysis,
  LARGE_PLAN_CONFIG,
  PlanStepForAnalysis
} from '../largePlanDetector';
import { 
  generateMissionBreakdown,
  MissionV1,
  MissionBreakdown
} from '../missionBreakdownGenerator';
import { LargePlanDetectionResult } from '../largePlanDetector';

// ===== LARGE PLAN DETECTOR TESTS =====

describe('Large Plan Detector', () => {
  describe('Step Count Thresholds', () => {
    it('should NOT detect small plan as large (5 steps)', () => {
      const steps = createSteps(5, 'Add feature');
      const result = detectLargePlan(steps, 'Add feature');
      
      expect(result.largePlan).toBe(false);
      expect(result.metrics.stepCount).toBe(5);
    });

    it('should warn for plan with 10+ steps', () => {
      const steps = createSteps(10, 'Add feature');
      const result = detectLargePlan(steps, 'Add feature');
      
      expect(result.metrics.stepCount).toBe(10);
      expect(result.reasons.some(r => r.includes('steps'))).toBe(true);
    });

    it('should mark plan as large when stepCount >= 16', () => {
      const steps = createSteps(16, 'Add feature');
      const result = detectLargePlan(steps, 'Add feature');
      
      expect(result.largePlan).toBe(true);
      expect(result.metrics.stepCount).toBe(16);
    });

    it('should mark plan as large when stepCount is 20', () => {
      const steps = createSteps(20, 'Add feature');
      const result = detectLargePlan(steps, 'Add feature');
      
      expect(result.largePlan).toBe(true);
      expect(result.score).toBeGreaterThan(0);
    });
  });

  describe('Risk Flags Detection', () => {
    it('should detect security risk keywords', () => {
      const steps = createSteps(3, 'Add feature');
      const result = detectLargePlan(steps, 'Implement authentication and login flow');
      
      expect(result.metrics.riskFlags).toContain('security');
    });

    it('should detect payments risk keywords', () => {
      const steps = createSteps(3, 'Add feature');
      const result = detectLargePlan(steps, 'Integrate Stripe payment processing');
      
      expect(result.metrics.riskFlags).toContain('payments');
    });

    it('should detect migration risk keywords', () => {
      const steps = createSteps(3, 'Add feature');
      const result = detectLargePlan(steps, 'Migrate database schema to new format');
      
      expect(result.metrics.riskFlags).toContain('migration');
    });

    it('should detect refactor risk keywords', () => {
      const steps = createSteps(3, 'Add feature');
      const result = detectLargePlan(steps, 'Refactor entire state management system');
      
      expect(result.metrics.riskFlags).toContain('refactor');
    });

    it('should trigger large plan when 2+ risk flags AND 10+ steps', () => {
      const steps = createSteps(10, 'Implement feature');
      const result = detectLargePlan(
        steps, 
        'Implement authentication, migrate database, and add payments'
      );
      
      expect(result.largePlan).toBe(true);
      expect(result.metrics.riskFlags.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Multi-Domain Detection', () => {
    it('should detect multi-domain (mobile + web)', () => {
      const steps = createSteps(5, 'Add feature');
      const result = detectLargePlan(
        steps, 
        'Build mobile app with React Native and web dashboard'
      );
      
      expect(result.metrics.domains).toContain('mobile');
      expect(result.metrics.domains).toContain('web');
    });

    it('should detect multi-domain (web + backend)', () => {
      const steps = createSteps(5, 'Add feature');
      const result = detectLargePlan(
        steps, 
        'Build React frontend with Node.js API backend'
      );
      
      expect(result.metrics.domains).toContain('web');
      expect(result.metrics.domains).toContain('backend');
    });

    it('should add score for multi-domain', () => {
      const singleDomainSteps = createSteps(5, 'Add React component');
      const singleResult = detectLargePlan(singleDomainSteps, 'Add React component');
      
      const multiDomainSteps = createSteps(5, 'Add feature');
      const multiResult = detectLargePlan(
        multiDomainSteps, 
        'Build mobile and web app with API'
      );
      
      expect(multiResult.score).toBeGreaterThan(singleResult.score);
    });
  });

  describe('Ambiguity Flags Detection', () => {
    it('should detect "complete app" ambiguity', () => {
      const steps = createSteps(5, 'Build feature');
      const result = detectLargePlan(steps, 'Build complete app from scratch');
      
      expect(result.metrics.ambiguityFlags).toContain('complete app');
    });

    it('should detect "entire system" ambiguity', () => {
      const steps = createSteps(5, 'Implement feature');
      const result = detectLargePlan(steps, 'Rewrite entire system');
      
      expect(result.metrics.ambiguityFlags).toContain('entire system');
    });

    it('should detect "production ready" ambiguity', () => {
      const steps = createSteps(5, 'Build feature');
      const result = detectLargePlan(steps, 'Build production ready e-commerce');
      
      expect(result.metrics.ambiguityFlags).toContain('production ready');
    });
  });

  describe('Score Thresholds', () => {
    it('should mark large when score >= 60', () => {
      // Create a plan that triggers multiple factors
      const steps = createSteps(12, 'Implement feature');
      const result = detectLargePlan(
        steps,
        'Build complete app with authentication, payments, mobile and web support'
      );
      
      expect(result.score).toBeGreaterThanOrEqual(60);
      expect(result.largePlan).toBe(true);
    });

    it('should cap score at 100', () => {
      const steps = createSteps(25, 'Implement complex feature');
      const result = detectLargePlan(
        steps,
        'Build complete app with authentication, payments, mobile, web, backend, database migration, refactor entire system, production ready enterprise grade scalable solution'
      );
      
      expect(result.score).toBeLessThanOrEqual(100);
    });
  });

  describe('Reasons Stability', () => {
    it('should produce stable reason strings for same input', () => {
      const steps = createSteps(12, 'Implement auth');
      const planText = 'Implement authentication with payments and migration';
      
      const result1 = detectLargePlan(steps, planText);
      const result2 = detectLargePlan(steps, planText);
      
      expect(result1.reasons).toEqual(result2.reasons);
    });

    it('should include user-readable reasons', () => {
      const steps = createSteps(18, 'Implement feature');
      const result = detectLargePlan(steps, 'Implement authentication');
      
      // All reasons should be non-empty strings
      expect(result.reasons.every(r => typeof r === 'string' && r.length > 0)).toBe(true);
    });
  });
});

// ===== MISSION BREAKDOWN GENERATOR TESTS =====

describe('Mission Breakdown Generator', () => {
  const mockDetectionResult: LargePlanDetectionResult = {
    largePlan: true,
    score: 75,
    reasons: ['Test reason'],
    metrics: {
      stepCount: 12,
      estimatedFileTouch: 30,
      riskFlags: [],
      ambiguityFlags: [],
      keywordHits: [],
      domains: ['UI', 'Backend'],
    },
  };

  describe('Step Accounting', () => {
    it('should include all plan steps exactly once', () => {
      const steps = createSteps(12, 'Step');
      const breakdown = generateMissionBreakdown(
        'plan-1',
        1,
        'Build feature',
        steps,
        mockDetectionResult
      );
      
      // Collect all included step IDs
      const includedStepIds = new Set<string>();
      for (const mission of breakdown.missions) {
        for (const step of mission.includedSteps) {
          expect(includedStepIds.has(step.stepId)).toBe(false); // No duplicates
          includedStepIds.add(step.stepId);
        }
      }
      
      // All original steps should be included
      for (const step of steps) {
        expect(includedStepIds.has(step.step_id)).toBe(true);
      }
    });

    it('should handle 5-step plan', () => {
      const steps = createSteps(5, 'Step');
      const breakdown = generateMissionBreakdown(
        'plan-1',
        1,
        'Build feature',
        steps,
        mockDetectionResult
      );
      
      // Should create 2+ missions
      expect(breakdown.missions.length).toBeGreaterThanOrEqual(2);
      
      // All steps accounted for
      const totalSteps = breakdown.missions.reduce(
        (sum, m) => sum + m.includedSteps.length, 
        0
      );
      expect(totalSteps).toBe(5);
    });

    it('should handle 20-step plan', () => {
      const steps = createSteps(20, 'Implement feature');
      const breakdown = generateMissionBreakdown(
        'plan-1',
        1,
        'Build large system',
        steps,
        mockDetectionResult
      );
      
      // All steps accounted for
      const totalSteps = breakdown.missions.reduce(
        (sum, m) => sum + m.includedSteps.length, 
        0
      );
      expect(totalSteps).toBe(20);
    });
  });

  describe('Mission Caps', () => {
    it('should create max 8 missions', () => {
      const steps = createSteps(30, 'Step');
      const breakdown = generateMissionBreakdown(
        'plan-1',
        1,
        'Build feature',
        steps,
        mockDetectionResult
      );
      
      expect(breakdown.missions.length).toBeLessThanOrEqual(8);
    });

    it('should have max 6 steps per mission', () => {
      const steps = createSteps(20, 'Step');
      const breakdown = generateMissionBreakdown(
        'plan-1',
        1,
        'Build feature',
        steps,
        mockDetectionResult
      );
      
      for (const mission of breakdown.missions) {
        expect(mission.includedSteps.length).toBeLessThanOrEqual(6);
      }
    });

    it('should create at least 2 missions when appropriate', () => {
      const steps = createSteps(8, 'Step');
      const breakdown = generateMissionBreakdown(
        'plan-1',
        1,
        'Build feature',
        steps,
        mockDetectionResult
      );
      
      expect(breakdown.missions.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Dependency Graph', () => {
    it('should have no cycles in dependencies', () => {
      const steps = createSteps(15, 'Implement feature');
      const breakdown = generateMissionBreakdown(
        'plan-1',
        1,
        'Build feature',
        steps,
        mockDetectionResult
      );
      
      // Check for cycles using DFS
      const hasCycle = checkForCycles(breakdown.missions);
      expect(hasCycle).toBe(false);
    });

    it('should have valid mission IDs in dependencies', () => {
      const steps = createSteps(12, 'Implement feature');
      const breakdown = generateMissionBreakdown(
        'plan-1',
        1,
        'Build feature',
        steps,
        mockDetectionResult
      );
      
      const missionIds = new Set(breakdown.missions.map(m => m.missionId));
      
      for (const mission of breakdown.missions) {
        for (const depId of mission.dependencies) {
          expect(missionIds.has(depId)).toBe(true);
        }
      }
    });
  });

  describe('Required Fields', () => {
    it('should have outOfScope for each mission', () => {
      const steps = createSteps(10, 'Build feature');
      const breakdown = generateMissionBreakdown(
        'plan-1',
        1,
        'Build feature',
        steps,
        mockDetectionResult
      );
      
      for (const mission of breakdown.missions) {
        expect(mission.scope.outOfScope).toBeDefined();
        expect(mission.scope.outOfScope.length).toBeGreaterThan(0);
      }
    });

    it('should have acceptance criteria for each mission', () => {
      const steps = createSteps(10, 'Implement feature');
      const breakdown = generateMissionBreakdown(
        'plan-1',
        1,
        'Build feature',
        steps,
        mockDetectionResult
      );
      
      for (const mission of breakdown.missions) {
        expect(mission.acceptance).toBeDefined();
        expect(mission.acceptance.length).toBeGreaterThan(0);
      }
    });

    it('should have size estimate for each mission', () => {
      const steps = createSteps(10, 'Build feature');
      const breakdown = generateMissionBreakdown(
        'plan-1',
        1,
        'Build feature',
        steps,
        mockDetectionResult
      );
      
      for (const mission of breakdown.missions) {
        expect(mission.estimate.size).toMatch(/^[SML]$/);
        expect(mission.estimate.rationale.length).toBeGreaterThan(0);
      }
    });

    it('should have risk level for each mission', () => {
      const steps = createSteps(10, 'Build feature');
      const breakdown = generateMissionBreakdown(
        'plan-1',
        1,
        'Build feature',
        steps,
        mockDetectionResult
      );
      
      for (const mission of breakdown.missions) {
        expect(mission.risk.level).toMatch(/^(low|med|high)$/);
      }
    });
  });

  describe('Determinism', () => {
    it('should produce same breakdown for same input', () => {
      const steps = createSteps(12, 'Implement feature');
      const goal = 'Build feature';
      
      const breakdown1 = generateMissionBreakdown(
        'plan-1', 1, goal, steps, mockDetectionResult
      );
      const breakdown2 = generateMissionBreakdown(
        'plan-1', 1, goal, steps, mockDetectionResult
      );
      
      expect(breakdown1.breakdownId).toBe(breakdown2.breakdownId);
      expect(breakdown1.missions.length).toBe(breakdown2.missions.length);
      
      for (let i = 0; i < breakdown1.missions.length; i++) {
        expect(breakdown1.missions[i].missionId).toBe(breakdown2.missions[i].missionId);
        expect(breakdown1.missions[i].title).toBe(breakdown2.missions[i].title);
      }
    });

    it('should produce different breakdown for different plan version', () => {
      const steps = createSteps(12, 'Implement feature');
      
      const breakdown1 = generateMissionBreakdown(
        'plan-1', 1, 'Build feature', steps, mockDetectionResult
      );
      const breakdown2 = generateMissionBreakdown(
        'plan-1', 2, 'Build feature', steps, mockDetectionResult
      );
      
      expect(breakdown1.breakdownId).not.toBe(breakdown2.breakdownId);
    });
  });
});

// ===== HELPER FUNCTIONS =====

function createSteps(count: number, descriptionPrefix: string): PlanStepForAnalysis[] {
  const steps: PlanStepForAnalysis[] = [];
  for (let i = 0; i < count; i++) {
    steps.push({
      step_id: `step_${i + 1}`,
      description: `${descriptionPrefix} ${i + 1}`,
      expected_evidence: [`Evidence for step ${i + 1}`],
    });
  }
  return steps;
}

function checkForCycles(missions: MissionV1[]): boolean {
  const missionMap = new Map<string, MissionV1>();
  for (const m of missions) {
    missionMap.set(m.missionId, m);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(missionId: string): boolean {
    if (inStack.has(missionId)) return true; // Cycle found
    if (visited.has(missionId)) return false;

    visited.add(missionId);
    inStack.add(missionId);

    const mission = missionMap.get(missionId);
    if (mission) {
      for (const dep of mission.dependencies) {
        if (dfs(dep)) return true;
      }
    }

    inStack.delete(missionId);
    return false;
  }

  for (const mission of missions) {
    visited.clear();
    inStack.clear();
    if (dfs(mission.missionId)) return true;
  }

  return false;
}
