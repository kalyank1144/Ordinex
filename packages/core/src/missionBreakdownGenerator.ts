/**
 * Mission Breakdown Generator: Deterministic V1 algorithm for breaking large plans into missions
 * 
 * Step 26 - Anti-Failure Guard
 * 
 * This module generates a mission breakdown from a large plan using:
 * 1. Domain tagging per step
 * 2. Dependency inference (DAG)
 * 3. Clustering into bounded missions
 * 4. Acceptance criteria and outOfScope generation
 * 
 * DETERMINISTIC: No LLM calls. Same input produces same output.
 */

import { createHash } from 'crypto';
import { LargePlanDetectionResult, PlanStepForAnalysis } from './largePlanDetector';

// ===== TYPES =====

export type MissionDomain = 'UI' | 'Web' | 'Mobile' | 'Backend' | 'Data' | 'Infra' | 'Tests' | 'Docs';
export type RiskLevel = 'low' | 'med' | 'high';
export type MissionSize = 'S' | 'M' | 'L';
export type StepPhase = 'foundation' | 'feature' | 'polish';

/**
 * Mission V1 Schema - full mission object for breakdown
 */
export interface MissionV1 {
  missionId: string;
  title: string;
  intent: string; // 1-2 sentences
  includedSteps: Array<{ stepId: string; title: string }>;
  dependencies: string[]; // missionId[] - DAG edges
  scope: {
    domains: MissionDomain[];
    surfaces?: string[];
    likelyFiles?: string[];
    outOfScope: string[]; // REQUIRED for trust
  };
  acceptance: string[]; // REQUIRED checklist, testable
  verification: {
    suggestedCommands: string[];
    manualChecks: string[];
  };
  risk: { level: RiskLevel; notes: string[] };
  estimate: { size: MissionSize; rationale: string[] };
}

/**
 * Mission breakdown output
 */
export interface MissionBreakdown {
  breakdownId: string;
  planId: string;
  planVersion: number;
  missions: MissionV1[];
  deferredSteps: Array<{ stepId: string; title: string; reason: string }>;
  generatedAt: string;
}

/**
 * Tagged step for internal processing
 */
interface TaggedStep {
  step: PlanStepForAnalysis;
  index: number;
  domains: MissionDomain[];
  riskFlags: string[];
  phase: StepPhase;
  verbCategory: 'small' | 'medium' | 'large';
  dependencies: number[]; // indexes of steps this depends on
}

// ===== CONSTANTS & CONFIG =====

const BREAKDOWN_CONFIG = {
  maxMissions: 8,
  minMissions: 2,
  maxStepsPerMission: 6,
  minStepsPerMission: 2,
  maxDomainsPerMission: 3,
  maxHighRiskPerMission: 1,
};

// Domain keywords for tagging
const DOMAIN_KEYWORDS: Record<MissionDomain, string[]> = {
  'UI': ['ui', 'component', 'button', 'form', 'layout', 'style', 'css', 'screen', 'modal', 'dialog', 'card', 'navigation', 'header', 'footer'],
  'Web': ['web', 'browser', 'react', 'vue', 'angular', 'next', 'nextjs', 'html', 'dom', 'client-side', 'spa', 'ssr'],
  'Mobile': ['mobile', 'ios', 'android', 'react native', 'flutter', 'expo', 'native', 'app store', 'play store'],
  'Backend': ['backend', 'server', 'api', 'endpoint', 'route', 'controller', 'middleware', 'express', 'node', 'rest', 'graphql'],
  'Data': ['database', 'db', 'schema', 'model', 'orm', 'query', 'migration', 'postgres', 'mysql', 'mongo', 'redis', 'cache', 'storage'],
  'Infra': ['infra', 'deploy', 'ci', 'cd', 'pipeline', 'docker', 'kubernetes', 'aws', 'cloud', 'terraform', 'config', 'environment'],
  'Tests': ['test', 'spec', 'unit', 'integration', 'e2e', 'coverage', 'jest', 'vitest', 'cypress', 'playwright'],
  'Docs': ['doc', 'readme', 'documentation', 'comment', 'jsdoc', 'changelog', 'contributing'],
};

// Phase keywords
const PHASE_KEYWORDS = {
  foundation: ['setup', 'configure', 'install', 'initialize', 'create project', 'scaffold', 'tooling', 'dependencies', 'routing', 'state management', 'models', 'schema', 'api client'],
  feature: ['implement', 'add', 'build', 'create', 'develop', 'write', 'integrate', 'connect', 'hook up'],
  polish: ['optimize', 'refine', 'polish', 'improve', 'fix', 'clean', 'review', 'finalize', 'document', 'test'],
};

// Risk keywords
const RISK_KEYWORDS: Record<string, string[]> = {
  'security': ['auth', 'authentication', 'login', 'password', 'session', 'token', 'oauth', 'security', 'encryption'],
  'payments': ['payment', 'stripe', 'billing', 'subscription', 'checkout', 'invoice', 'transaction'],
  'migration': ['migration', 'migrate', 'data migration', 'schema change'],
  'refactor': ['refactor', 'rewrite', 'restructure', 'overhaul', 'major change'],
};

// Verb categories for size estimation
const VERB_CATEGORIES = {
  small: ['read', 'review', 'analyze', 'check', 'verify', 'update', 'fix', 'tweak', 'adjust', 'document'],
  medium: ['add', 'create', 'implement', 'write', 'build', 'develop', 'configure', 'install', 'set up'],
  large: ['refactor', 'migrate', 'integrate', 'rewrite', 'restructure', 'overhaul', 'redesign', 'replace'],
};

// Dependency inference keywords
const DEPENDENCY_INDICATORS = [
  'use', 'using', 'integrate', 'integrating', 'connect', 'connecting',
  'with', 'from', 'based on', 'after', 'hook up', 'wire', 'wiring',
];

// ===== MAIN GENERATOR FUNCTION =====

/**
 * Generate a mission breakdown from a large plan
 * 
 * @param planId - Plan ID
 * @param planVersion - Plan version number
 * @param goal - Plan goal
 * @param steps - Plan steps
 * @param detectionResult - Large plan detection result (for metrics)
 * @returns Mission breakdown
 */
export function generateMissionBreakdown(
  planId: string,
  planVersion: number,
  goal: string,
  steps: PlanStepForAnalysis[],
  detectionResult: LargePlanDetectionResult
): MissionBreakdown {
  // Step 1: Tag all steps
  const taggedSteps = tagSteps(steps);

  // Step 2: Infer dependencies (build DAG)
  inferDependencies(taggedSteps);

  // Step 3: Cluster into missions
  const clusters = clusterIntoMissions(taggedSteps, goal);

  // Step 4: Convert clusters to MissionV1 objects
  const missions = clusters.map((cluster, idx) => 
    buildMission(cluster, idx, planId, planVersion, goal, taggedSteps, detectionResult)
  );

  // Step 5: Assign mission dependencies based on step dependencies
  assignMissionDependencies(missions, taggedSteps);

  // Step 6: Validation pass
  validateMissions(missions, steps);

  // Generate breakdown ID (stable hash)
  const breakdownId = generateBreakdownId(planId, planVersion, missions);

  return {
    breakdownId,
    planId,
    planVersion,
    missions,
    deferredSteps: [], // V1: no deferred steps, all included
    generatedAt: new Date().toISOString(),
  };
}

// ===== STEP 1: TAG STEPS =====

function tagSteps(steps: PlanStepForAnalysis[]): TaggedStep[] {
  return steps.map((step, index) => {
    const descLower = step.description.toLowerCase();

    return {
      step,
      index,
      domains: inferDomains(descLower),
      riskFlags: inferRisks(descLower),
      phase: inferPhase(descLower, index, steps.length),
      verbCategory: inferVerbCategory(descLower),
      dependencies: [], // Filled in step 2
    };
  });
}

function inferDomains(text: string): MissionDomain[] {
  const domains: MissionDomain[] = [];

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        domains.push(domain as MissionDomain);
        break;
      }
    }
  }

  // Default to UI if no domain detected
  if (domains.length === 0) {
    domains.push('UI');
  }

  return domains;
}

function inferRisks(text: string): string[] {
  const risks: string[] = [];

  for (const [risk, keywords] of Object.entries(RISK_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        risks.push(risk);
        break;
      }
    }
  }

  return risks;
}

function inferPhase(text: string, index: number, totalSteps: number): StepPhase {
  // Check explicit phase keywords
  for (const keyword of PHASE_KEYWORDS.foundation) {
    if (text.includes(keyword)) return 'foundation';
  }

  for (const keyword of PHASE_KEYWORDS.polish) {
    if (text.includes(keyword)) return 'polish';
  }

  // Position-based heuristic
  const position = index / totalSteps;
  if (position < 0.25) return 'foundation';
  if (position > 0.75) return 'polish';

  return 'feature';
}

function inferVerbCategory(text: string): 'small' | 'medium' | 'large' {
  for (const verb of VERB_CATEGORIES.large) {
    if (text.includes(verb)) return 'large';
  }

  for (const verb of VERB_CATEGORIES.medium) {
    if (text.includes(verb)) return 'medium';
  }

  return 'small';
}

// ===== STEP 2: INFER DEPENDENCIES =====

function inferDependencies(taggedSteps: TaggedStep[]): void {
  for (let i = 0; i < taggedSteps.length; i++) {
    const step = taggedSteps[i];
    const descLower = step.step.description.toLowerCase();

    // Foundation steps precede feature steps
    if (step.phase === 'feature') {
      for (let j = 0; j < i; j++) {
        if (taggedSteps[j].phase === 'foundation') {
          step.dependencies.push(j);
        }
      }
    }

    // Check for explicit dependency indicators
    for (const indicator of DEPENDENCY_INDICATORS) {
      if (descLower.includes(indicator)) {
        // Look for references to earlier steps
        for (let j = 0; j < i; j++) {
          const prevStep = taggedSteps[j].step.description.toLowerCase();
          // Simple heuristic: check for domain overlap
          const sharedDomains = step.domains.filter(d => taggedSteps[j].domains.includes(d));
          if (sharedDomains.length > 0 && !step.dependencies.includes(j)) {
            step.dependencies.push(j);
          }
        }
        break;
      }
    }

    // Remove duplicates
    step.dependencies = [...new Set(step.dependencies)];
  }
}

// ===== STEP 3: CLUSTER INTO MISSIONS =====

interface Cluster {
  stepIndexes: number[];
  domains: Set<MissionDomain>;
  riskFlags: Set<string>;
  title: string;
}

function clusterIntoMissions(taggedSteps: TaggedStep[], goal: string): Cluster[] {
  const clusters: Cluster[] = [];
  const assigned = new Set<number>();

  // Strategy: Group by phase first, then by domain similarity

  // Pass 1: Foundation steps (first mission)
  const foundationIndexes = taggedSteps
    .filter(s => s.phase === 'foundation')
    .map(s => s.index);

  if (foundationIndexes.length > 0) {
    const cluster = createCluster(foundationIndexes.slice(0, BREAKDOWN_CONFIG.maxStepsPerMission), taggedSteps, 'Foundation & Setup');
    clusters.push(cluster);
    foundationIndexes.slice(0, BREAKDOWN_CONFIG.maxStepsPerMission).forEach(i => assigned.add(i));
  }

  // Pass 2: Feature steps - group by primary domain
  const featureSteps = taggedSteps.filter(s => s.phase === 'feature' && !assigned.has(s.index));
  const domainGroups = groupByDomain(featureSteps);

  for (const [domain, steps] of Object.entries(domainGroups)) {
    if (steps.length === 0) continue;

    // Split large groups
    for (let i = 0; i < steps.length; i += BREAKDOWN_CONFIG.maxStepsPerMission) {
      const chunk = steps.slice(i, i + BREAKDOWN_CONFIG.maxStepsPerMission);
      const title = generateMissionTitle(domain, chunk, i);
      const cluster = createCluster(chunk.map(s => s.index), taggedSteps, title);
      clusters.push(cluster);
      chunk.forEach(s => assigned.add(s.index));
    }
  }

  // Pass 3: Polish steps (last mission)
  const polishIndexes = taggedSteps
    .filter(s => s.phase === 'polish' && !assigned.has(s.index))
    .map(s => s.index);

  if (polishIndexes.length > 0) {
    for (let i = 0; i < polishIndexes.length; i += BREAKDOWN_CONFIG.maxStepsPerMission) {
      const chunk = polishIndexes.slice(i, i + BREAKDOWN_CONFIG.maxStepsPerMission);
      const cluster = createCluster(chunk, taggedSteps, i === 0 ? 'Testing & Polish' : `Testing & Polish (Part ${Math.floor(i / BREAKDOWN_CONFIG.maxStepsPerMission) + 1})`);
      clusters.push(cluster);
      chunk.forEach(idx => assigned.add(idx));
    }
  }

  // Pass 4: Any remaining unassigned steps
  const remaining = taggedSteps.filter(s => !assigned.has(s.index));
  if (remaining.length > 0) {
    for (let i = 0; i < remaining.length; i += BREAKDOWN_CONFIG.maxStepsPerMission) {
      const chunk = remaining.slice(i, i + BREAKDOWN_CONFIG.maxStepsPerMission);
      const cluster = createCluster(chunk.map(s => s.index), taggedSteps, 'Additional Features');
      clusters.push(cluster);
    }
  }

  // Ensure we have at least 2 missions if steps warrant it
  if (clusters.length < BREAKDOWN_CONFIG.minMissions && taggedSteps.length >= 4) {
    // Split the largest cluster
    const largest = clusters.reduce((a, b) => a.stepIndexes.length > b.stepIndexes.length ? a : b);
    const mid = Math.ceil(largest.stepIndexes.length / 2);
    const firstHalf = largest.stepIndexes.slice(0, mid);
    const secondHalf = largest.stepIndexes.slice(mid);

    if (firstHalf.length >= 2 && secondHalf.length >= 2) {
      const idx = clusters.indexOf(largest);
      clusters.splice(idx, 1,
        createCluster(firstHalf, taggedSteps, `${largest.title} - Part 1`),
        createCluster(secondHalf, taggedSteps, `${largest.title} - Part 2`)
      );
    }
  }

  // Limit to max missions
  if (clusters.length > BREAKDOWN_CONFIG.maxMissions) {
    // Merge smallest clusters
    while (clusters.length > BREAKDOWN_CONFIG.maxMissions) {
      clusters.sort((a, b) => a.stepIndexes.length - b.stepIndexes.length);
      const smallest = clusters.shift()!;
      const nextSmallest = clusters[0];
      
      // Merge if combined is within limit
      if (nextSmallest.stepIndexes.length + smallest.stepIndexes.length <= BREAKDOWN_CONFIG.maxStepsPerMission) {
        nextSmallest.stepIndexes.push(...smallest.stepIndexes);
        smallest.domains.forEach(d => nextSmallest.domains.add(d));
        smallest.riskFlags.forEach(r => nextSmallest.riskFlags.add(r));
      } else {
        // Put back and break - accept more missions
        clusters.unshift(smallest);
        break;
      }
    }
  }

  return clusters;
}

function createCluster(stepIndexes: number[], taggedSteps: TaggedStep[], title: string): Cluster {
  const domains = new Set<MissionDomain>();
  const riskFlags = new Set<string>();

  for (const idx of stepIndexes) {
    taggedSteps[idx].domains.forEach(d => domains.add(d));
    taggedSteps[idx].riskFlags.forEach(r => riskFlags.add(r));
  }

  return { stepIndexes, domains, riskFlags, title };
}

function groupByDomain(steps: TaggedStep[]): Record<string, TaggedStep[]> {
  const groups: Record<string, TaggedStep[]> = {};

  for (const step of steps) {
    const primaryDomain = step.domains[0] || 'UI';
    if (!groups[primaryDomain]) {
      groups[primaryDomain] = [];
    }
    groups[primaryDomain].push(step);
  }

  return groups;
}

function generateMissionTitle(domain: string, steps: TaggedStep[], partIndex: number): string {
  const domainLabel = domain.charAt(0).toUpperCase() + domain.slice(1).toLowerCase();
  
  // Extract key verbs/nouns from steps
  const firstStep = steps[0]?.step.description || '';
  const keyVerbs = ['Implement', 'Build', 'Create', 'Add', 'Set up', 'Configure'];
  let verb = 'Implement';
  
  for (const v of keyVerbs) {
    if (firstStep.toLowerCase().includes(v.toLowerCase())) {
      verb = v;
      break;
    }
  }

  if (partIndex > 0) {
    return `${domainLabel} Features - Part ${Math.floor(partIndex / BREAKDOWN_CONFIG.maxStepsPerMission) + 1}`;
  }

  return `${verb} ${domainLabel} Features`;
}

// ===== STEP 4: BUILD MISSION OBJECTS =====

function buildMission(
  cluster: Cluster,
  missionIndex: number,
  planId: string,
  planVersion: number,
  goal: string,
  taggedSteps: TaggedStep[],
  detectionResult: LargePlanDetectionResult
): MissionV1 {
  const includedSteps = cluster.stepIndexes.map(idx => ({
    stepId: taggedSteps[idx].step.step_id,
    title: taggedSteps[idx].step.description,
  }));

  // Generate mission ID (stable hash)
  const missionId = generateMissionId(planId, planVersion, cluster.title, includedSteps);

  // Generate intent
  const intent = generateIntent(cluster, taggedSteps);

  // Determine risk level
  const riskLevel = determineRiskLevel(cluster);
  const riskNotes = Array.from(cluster.riskFlags).map(r => `Contains ${r}-related changes`);

  // Generate acceptance criteria
  const acceptance = generateAcceptanceCriteria(cluster, taggedSteps);

  // Generate out of scope
  const outOfScope = generateOutOfScope(cluster, taggedSteps, missionIndex, goal);

  // Estimate size
  const estimate = estimateSize(cluster, taggedSteps);

  return {
    missionId,
    title: cluster.title,
    intent,
    includedSteps,
    dependencies: [], // Filled in step 5
    scope: {
      domains: Array.from(cluster.domains),
      outOfScope,
    },
    acceptance,
    verification: {
      suggestedCommands: generateVerificationCommands(cluster),
      manualChecks: generateManualChecks(cluster),
    },
    risk: { level: riskLevel, notes: riskNotes },
    estimate,
  };
}

function generateIntent(cluster: Cluster, taggedSteps: TaggedStep[]): string {
  const steps = cluster.stepIndexes.map(i => taggedSteps[i]);
  const domains = Array.from(cluster.domains).join(', ');
  const stepCount = steps.length;

  // Get key actions from step descriptions
  const actions = steps.slice(0, 2).map(s => {
    const desc = s.step.description;
    // Truncate if too long
    return desc.length > 50 ? desc.substring(0, 50) + '...' : desc;
  });

  return `Complete ${stepCount} steps related to ${domains}: ${actions.join('; ')}`;
}

function determineRiskLevel(cluster: Cluster): RiskLevel {
  const highRiskFlags = ['security', 'payments', 'migration'];
  const highRiskCount = Array.from(cluster.riskFlags).filter(r => highRiskFlags.includes(r)).length;

  if (highRiskCount >= 2) return 'high';
  if (highRiskCount === 1) return 'med';
  if (cluster.riskFlags.size > 0) return 'med';
  return 'low';
}

function generateAcceptanceCriteria(cluster: Cluster, taggedSteps: TaggedStep[]): string[] {
  const criteria: string[] = [];
  const steps = cluster.stepIndexes.map(i => taggedSteps[i]);

  // Generate criteria from steps
  for (const step of steps) {
    const desc = step.step.description;
    
    // Convert step description to acceptance criterion
    if (desc.toLowerCase().includes('create') || desc.toLowerCase().includes('add')) {
      criteria.push(`✓ ${desc.split(' ').slice(0, 6).join(' ')} is complete`);
    } else if (desc.toLowerCase().includes('implement')) {
      criteria.push(`✓ ${desc.split(' ').slice(0, 6).join(' ')} works correctly`);
    } else if (desc.toLowerCase().includes('test')) {
      criteria.push(`✓ Tests pass for related functionality`);
    } else {
      criteria.push(`✓ ${desc.split(' ').slice(0, 5).join(' ')} verified`);
    }
  }

  // Add domain-specific criteria
  if (cluster.domains.has('Tests')) {
    criteria.push('✓ All new tests pass');
    criteria.push('✓ No regression in existing tests');
  }

  if (cluster.domains.has('UI')) {
    criteria.push('✓ UI renders correctly');
  }

  if (cluster.domains.has('Backend')) {
    criteria.push('✓ API endpoints respond correctly');
  }

  // Limit to 8 criteria
  return criteria.slice(0, 8);
}

function generateOutOfScope(
  cluster: Cluster,
  taggedSteps: TaggedStep[],
  missionIndex: number,
  goal: string
): string[] {
  const outOfScope: string[] = [];

  // Other missions' work
  outOfScope.push('Work from other missions in this breakdown');

  // Phase-based exclusions
  const steps = cluster.stepIndexes.map(i => taggedSteps[i]);
  const phases = new Set(steps.map(s => s.phase));

  if (!phases.has('foundation')) {
    outOfScope.push('Project setup and configuration (handled separately)');
  }

  if (!phases.has('polish')) {
    outOfScope.push('Final testing and documentation (handled later)');
  }

  // Domain-based exclusions
  const allDomains: MissionDomain[] = ['UI', 'Web', 'Mobile', 'Backend', 'Data', 'Infra', 'Tests', 'Docs'];
  const excludedDomains = allDomains.filter(d => !cluster.domains.has(d));

  if (excludedDomains.length > 0) {
    outOfScope.push(`${excludedDomains.slice(0, 3).join(', ')} changes`);
  }

  // Feature-based exclusions (generic)
  outOfScope.push('Performance optimization (unless critical)');
  outOfScope.push('Edge case handling (basic functionality only)');
  outOfScope.push('Full error handling (basic errors only)');

  // Limit to 8
  return outOfScope.slice(0, 8);
}

function estimateSize(cluster: Cluster, taggedSteps: TaggedStep[]): { size: MissionSize; rationale: string[] } {
  const steps = cluster.stepIndexes.map(i => taggedSteps[i]);
  const rationale: string[] = [];

  let sizeScore = 0;

  // Step count factor
  if (steps.length <= 2) {
    sizeScore += 1;
    rationale.push(`${steps.length} steps (small)`);
  } else if (steps.length <= 4) {
    sizeScore += 2;
    rationale.push(`${steps.length} steps (medium)`);
  } else {
    sizeScore += 3;
    rationale.push(`${steps.length} steps (large)`);
  }

  // Verb complexity factor
  const largeVerbCount = steps.filter(s => s.verbCategory === 'large').length;
  if (largeVerbCount >= 2) {
    sizeScore += 2;
    rationale.push('Contains complex refactoring/migration work');
  } else if (largeVerbCount === 1) {
    sizeScore += 1;
    rationale.push('Contains some complex work');
  }

  // Risk factor
  if (cluster.riskFlags.size >= 2) {
    sizeScore += 1;
    rationale.push('Multiple risk areas require careful handling');
  }

  // Determine size
  let size: MissionSize;
  if (sizeScore <= 2) {
    size = 'S';
  } else if (sizeScore <= 4) {
    size = 'M';
  } else {
    size = 'L';
  }

  return { size, rationale };
}

function generateVerificationCommands(cluster: Cluster): string[] {
  const commands: string[] = [];

  if (cluster.domains.has('Tests')) {
    commands.push('npm test');
    commands.push('npm run test:coverage');
  } else {
    commands.push('npm test (run existing tests)');
  }

  if (cluster.domains.has('Infra')) {
    commands.push('npm run build');
    commands.push('npm run lint');
  }

  if (commands.length === 0) {
    commands.push('npm run build');
    commands.push('npm run lint');
  }

  return commands;
}

function generateManualChecks(cluster: Cluster): string[] {
  const checks: string[] = [];

  if (cluster.domains.has('UI') || cluster.domains.has('Web') || cluster.domains.has('Mobile')) {
    checks.push('Visual inspection of UI changes');
    checks.push('Check responsive behavior');
  }

  if (cluster.domains.has('Backend')) {
    checks.push('Test API endpoints manually');
    checks.push('Check error responses');
  }

  if (cluster.domains.has('Data')) {
    checks.push('Verify data integrity');
    checks.push('Check database migrations');
  }

  if (checks.length === 0) {
    checks.push('Review code changes');
    checks.push('Verify expected behavior');
  }

  return checks.slice(0, 4);
}

// ===== STEP 5: ASSIGN MISSION DEPENDENCIES =====

function assignMissionDependencies(missions: MissionV1[], taggedSteps: TaggedStep[]): void {
  // Build step-to-mission map
  const stepToMission = new Map<number, number>();
  
  for (let mIdx = 0; mIdx < missions.length; mIdx++) {
    for (const step of missions[mIdx].includedSteps) {
      const stepIdx = taggedSteps.findIndex(t => t.step.step_id === step.stepId);
      if (stepIdx >= 0) {
        stepToMission.set(stepIdx, mIdx);
      }
    }
  }

  // For each mission, check if any of its steps depend on steps in other missions
  for (let mIdx = 0; mIdx < missions.length; mIdx++) {
    const mission = missions[mIdx];
    const depMissions = new Set<string>();

    for (const step of mission.includedSteps) {
      const stepIdx = taggedSteps.findIndex(t => t.step.step_id === step.stepId);
      if (stepIdx < 0) continue;

      const deps = taggedSteps[stepIdx].dependencies;
      for (const depIdx of deps) {
        const depMissionIdx = stepToMission.get(depIdx);
        if (depMissionIdx !== undefined && depMissionIdx !== mIdx) {
          depMissions.add(missions[depMissionIdx].missionId);
        }
      }
    }

    mission.dependencies = Array.from(depMissions);
  }

  // Ensure no cycles (simple check)
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function hasCycle(missionId: string): boolean {
    if (inStack.has(missionId)) return true;
    if (visited.has(missionId)) return false;

    visited.add(missionId);
    inStack.add(missionId);

    const mission = missions.find(m => m.missionId === missionId);
    if (mission) {
      for (const dep of mission.dependencies) {
        if (hasCycle(dep)) return true;
      }
    }

    inStack.delete(missionId);
    return false;
  }

  // If cycles detected, remove problematic dependencies
  for (const mission of missions) {
    visited.clear();
    inStack.clear();
    
    if (hasCycle(mission.missionId)) {
      // Simple fix: clear dependencies for this mission
      console.warn(`[MissionBreakdown] Cycle detected in mission ${mission.missionId}, clearing dependencies`);
      mission.dependencies = [];
    }
  }
}

// ===== STEP 6: VALIDATION =====

function validateMissions(missions: MissionV1[], originalSteps: PlanStepForAnalysis[]): void {
  // Check all steps are included exactly once
  const includedStepIds = new Set<string>();
  
  for (const mission of missions) {
    for (const step of mission.includedSteps) {
      if (includedStepIds.has(step.stepId)) {
        console.warn(`[MissionBreakdown] Step ${step.stepId} included in multiple missions`);
      }
      includedStepIds.add(step.stepId);
    }
  }

  for (const step of originalSteps) {
    if (!includedStepIds.has(step.step_id)) {
      console.warn(`[MissionBreakdown] Step ${step.step_id} not included in any mission`);
    }
  }

  // Check no mission has >6 steps
  for (const mission of missions) {
    if (mission.includedSteps.length > BREAKDOWN_CONFIG.maxStepsPerMission) {
      console.warn(`[MissionBreakdown] Mission ${mission.missionId} has ${mission.includedSteps.length} steps (max: ${BREAKDOWN_CONFIG.maxStepsPerMission})`);
    }
  }

  // Check missions <= 8
  if (missions.length > BREAKDOWN_CONFIG.maxMissions) {
    console.warn(`[MissionBreakdown] Too many missions: ${missions.length} (max: ${BREAKDOWN_CONFIG.maxMissions})`);
  }
}

// ===== UTILITY FUNCTIONS =====

function generateMissionId(
  planId: string,
  planVersion: number,
  title: string,
  includedSteps: Array<{ stepId: string; title: string }>
): string {
  const stepIds = includedSteps.map(s => s.stepId).sort().join(',');
  const input = `${planId}:${planVersion}:${title}:${stepIds}`;
  return createHash('sha256').update(input).digest('hex').substring(0, 16);
}

function generateBreakdownId(
  planId: string,
  planVersion: number,
  missions: MissionV1[]
): string {
  const missionIds = missions.map(m => m.missionId).sort().join(',');
  const input = `breakdown:${planId}:${planVersion}:${missionIds}`;
  return createHash('sha256').update(input).digest('hex').substring(0, 16);
}
