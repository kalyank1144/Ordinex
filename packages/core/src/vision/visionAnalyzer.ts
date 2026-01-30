/**
 * Step 37: Vision Analyzer Stub
 * 
 * NO-OP interface for future Vision API integration.
 * This guarantees zero refactor later when Vision reasoning is added.
 * 
 * Current implementation returns { status: 'pending', reason: 'vision_not_enabled' }
 */

import type { ReferenceContext, VisionTokens, VisionAnalyzer } from '../types';

/**
 * Stub Vision Analyzer implementation
 * 
 * This is a placeholder that will be replaced with real Vision API
 * integration in a future step. For now, it returns a pending status.
 */
export class StubVisionAnalyzer implements VisionAnalyzer {
  /**
   * Analyze references using Vision API (STUB)
   * 
   * @param refs - Reference context containing images and URLs
   * @returns VisionTokens with pending status
   */
  async analyze(refs: ReferenceContext): Promise<VisionTokens> {
    // Log for debugging
    const imageCount = refs.images.length;
    const urlCount = refs.urls.length;
    
    console.log(
      `[VisionAnalyzer] Stub called with ${imageCount} images, ${urlCount} URLs. ` +
      `Vision API not yet implemented.`
    );

    // Return pending status - no analysis performed yet
    return {
      status: 'pending',
      reason: 'vision_not_enabled',
    };
  }
}

/**
 * Default vision analyzer instance (stub)
 */
export const visionAnalyzer: VisionAnalyzer = new StubVisionAnalyzer();

/**
 * Factory function to create a vision analyzer
 * 
 * In the future, this can be configured to return different
 * implementations based on feature flags or configuration.
 */
export function createVisionAnalyzer(): VisionAnalyzer {
  // TODO: Add configuration for real Vision API when available
  return new StubVisionAnalyzer();
}
