/**
 * Mode Confirmation Policy
 * 
 * Decides whether to show confirmation card based on:
 * - Classification confidence
 * - Mode mismatch severity
 * - Sticky suppression (LRU cache)
 * 
 * RULES:
 * - Low confidence → Never confirm
 * - Medium confidence → Confirm on mismatch (unless suppressed)
 * - High confidence → Confirm only on high-severity mismatches
 * 
 * SEVERITY LEVELS:
 * - High: User chose safe mode but system suggests risky mode (PLAN→MISSION, ANSWER→MISSION)
 * - Medium: Reverse direction (MISSION→PLAN, MISSION→ANSWER)
 * - Low: ANSWER ↔ PLAN
 */

import { Mode, ClassificationResultV2 } from './types';

/**
 * User override record for sticky suppression
 */
export interface UserOverride {
  suggestedMode: Mode;
  chosenMode: Mode;
  reasonSignature: string;
  timestamp: string;
  turnIndex: number;
}

/**
 * Confirmation decision result
 */
export interface ConfirmationDecision {
  shouldConfirm: boolean;
  severity: 'none' | 'low' | 'medium' | 'high';
  reason: string;
}

/**
 * Simple LRU Cache implementation
 */
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;
  
  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }
  
  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (LRU behavior)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }
  
  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Delete oldest (first item)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }
  
  clear(): void {
    this.cache.clear();
  }
}

/**
 * Mode Confirmation Policy
 * Manages confirmation decisions and sticky suppression
 */
export class ModeConfirmationPolicy {
  private overrideCache = new LRUCache<string, UserOverride>(50);
  private readonly SUPPRESSION_WINDOW_TURNS = 5;
  
  /**
   * Record user's mode choice for sticky suppression
   */
  recordOverride(
    taskId: string,
    result: ClassificationResultV2,
    chosenMode: Mode,
    turnIndex: number
  ): void {
    const cacheKey = `${taskId}:${result.reasonSignature}`;
    this.overrideCache.set(cacheKey, {
      suggestedMode: result.suggestedMode,
      chosenMode,
      reasonSignature: result.reasonSignature,
      timestamp: new Date().toISOString(),
      turnIndex
    });
  }
  
  /**
   * Decide whether to show confirmation card
   */
  shouldConfirm(
    taskId: string,
    userCurrentMode: Mode,
    result: ClassificationResultV2,
    currentTurnIndex: number
  ): ConfirmationDecision {
    const { suggestedMode, confidence, reasonSignature } = result;
    
    // Rule 1: Low confidence → never confirm
    if (confidence === 'low') {
      return {
        shouldConfirm: false,
        severity: 'none',
        reason: 'Low confidence - respecting user choice'
      };
    }
    
    // Rule 2: No mismatch → no confirmation
    if (userCurrentMode === suggestedMode) {
      return {
        shouldConfirm: false,
        severity: 'none',
        reason: 'Modes match'
      };
    }
    
    // Rule 3: Determine severity
    const severity = this.getMismatchSeverity(userCurrentMode, suggestedMode);
    
    // Rule 4: Check sticky suppression
    const cacheKey = `${taskId}:${reasonSignature}`;
    const lastOverride = this.overrideCache.get(cacheKey);
    
    if (lastOverride) {
      const turnDelta = currentTurnIndex - lastOverride.turnIndex;
      const isRecent = turnDelta <= this.SUPPRESSION_WINDOW_TURNS;
      
      if (isRecent && lastOverride.chosenMode === userCurrentMode) {
        // User already dismissed this pattern recently
        if (confidence === 'high' && severity === 'high') {
          // Override suppression for high-risk cases
          return {
            shouldConfirm: true,
            severity,
            reason: 'High confidence + high severity override suppression'
          };
        }
        return {
          shouldConfirm: false,
          severity,
          reason: 'Sticky suppression (user dismissed this pattern recently)'
        };
      }
    }
    
    // Rule 5: Apply confirmation policy
    if (confidence === 'medium') {
      return {
        shouldConfirm: true,
        severity,
        reason: 'Medium confidence mismatch'
      };
    }
    
    if (confidence === 'high' && severity === 'high') {
      return {
        shouldConfirm: true,
        severity,
        reason: 'High confidence + high severity mismatch'
      };
    }
    
    return {
      shouldConfirm: false,
      severity,
      reason: 'Low severity mismatch'
    };
  }
  
  /**
   * Determine mismatch severity based on mode directions
   */
  private getMismatchSeverity(
    userMode: Mode,
    suggestedMode: Mode
  ): 'low' | 'medium' | 'high' {
    // High severity: user chose safe mode but system suggests risky mode
    // (Risk of unintended code changes or tool execution)
    if (userMode === 'PLAN' && suggestedMode === 'MISSION') {
      return 'high';
    }
    if (userMode === 'ANSWER' && suggestedMode === 'MISSION') {
      return 'high';
    }
    
    // Medium severity: reverse direction (less risky)
    // User wants to execute but system thinks they want to plan/explain
    if (userMode === 'MISSION' && suggestedMode === 'PLAN') {
      return 'medium';
    }
    if (userMode === 'MISSION' && suggestedMode === 'ANSWER') {
      return 'medium';
    }
    
    // Low severity: ANSWER ↔ PLAN (both are read-only, low consequence)
    return 'low';
  }
  
  /**
   * Clear the override cache (useful for testing or task resets)
   */
  clearCache(): void {
    this.overrideCache.clear();
  }
}

/**
 * Export singleton instance for global use
 */
export const modeConfirmationPolicy = new ModeConfirmationPolicy();
