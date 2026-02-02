/**
 * Step 38: Vision Configuration
 * 
 * Reads and validates workspace settings for vision analysis.
 * IMPORTANT: Vision provider is INDEPENDENT from chat model dropdown.
 * 
 * Settings:
 * - ordinex.references.visionMode: 'off' | 'prompt' | 'on' (default: 'off')
 * - ordinex.references.visionProvider: 'anthropic' | 'backend-default' | 'openai' (default: 'anthropic')
 * - ordinex.references.maxImages: number (max 10)
 * - ordinex.references.maxPixels: number (max dimension for resize)
 * - ordinex.references.maxTotalUploadMB: number (max total upload size)
 */

import type {
  VisionConfig,
  VisionMode,
  VisionProvider,
} from '../types';

// ============================================================================
// DEFAULT VALUES (Enterprise-safe)
// ============================================================================

/**
 * Default vision configuration
 * Enterprise-safe: visionMode defaults to 'off'
 */
export const DEFAULT_VISION_CONFIG: VisionConfig = {
  visionMode: 'off',
  visionProvider: 'anthropic',
  maxImages: 10,
  maxPixels: 1024,
  maxTotalUploadMB: 15,
};

/**
 * Maximum allowed images (hard limit, cannot be overridden)
 */
export const MAX_IMAGES_HARD_LIMIT = 10;

/**
 * Maximum allowed pixels per dimension (hard limit)
 */
export const MAX_PIXELS_HARD_LIMIT = 2048;

/**
 * Maximum total upload size in MB (hard limit)
 */
export const MAX_UPLOAD_MB_HARD_LIMIT = 25;

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Valid vision modes
 */
const VALID_VISION_MODES: VisionMode[] = ['off', 'prompt', 'on'];

/**
 * Valid vision providers
 */
const VALID_VISION_PROVIDERS: VisionProvider[] = ['anthropic', 'openai', 'backend-default'];

/**
 * Validate and normalize a vision mode value
 */
export function validateVisionMode(value: unknown): VisionMode {
  if (typeof value === 'string' && VALID_VISION_MODES.includes(value as VisionMode)) {
    return value as VisionMode;
  }
  console.warn(`[VisionConfig] Invalid visionMode: ${value}, defaulting to 'off'`);
  return 'off';
}

/**
 * Validate and normalize a vision provider value
 */
export function validateVisionProvider(value: unknown): VisionProvider {
  if (typeof value === 'string' && VALID_VISION_PROVIDERS.includes(value as VisionProvider)) {
    return value as VisionProvider;
  }
  console.warn(`[VisionConfig] Invalid visionProvider: ${value}, defaulting to 'anthropic'`);
  return 'anthropic';
}

/**
 * Validate and clamp maxImages value
 */
export function validateMaxImages(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return Math.min(value, MAX_IMAGES_HARD_LIMIT);
  }
  return DEFAULT_VISION_CONFIG.maxImages;
}

/**
 * Validate and clamp maxPixels value
 */
export function validateMaxPixels(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return Math.min(value, MAX_PIXELS_HARD_LIMIT);
  }
  return DEFAULT_VISION_CONFIG.maxPixels;
}

/**
 * Validate and clamp maxTotalUploadMB value
 */
export function validateMaxTotalUploadMB(value: unknown): number {
  if (typeof value === 'number' && value > 0) {
    return Math.min(value, MAX_UPLOAD_MB_HARD_LIMIT);
  }
  return DEFAULT_VISION_CONFIG.maxTotalUploadMB;
}

// ============================================================================
// CONFIG BUILDER
// ============================================================================

/**
 * Workspace settings interface (from VS Code workspace configuration)
 * This matches the shape returned by workspace.getConfiguration()
 */
export interface WorkspaceSettingsSource {
  get<T>(key: string, defaultValue?: T): T | undefined;
}

/**
 * Build VisionConfig from workspace settings
 * 
 * @param settings - Workspace settings source (e.g., workspace.getConfiguration('ordinex.references'))
 * @returns Validated and clamped VisionConfig
 */
export function buildVisionConfig(settings?: WorkspaceSettingsSource): VisionConfig {
  if (!settings) {
    return { ...DEFAULT_VISION_CONFIG };
  }

  return {
    visionMode: validateVisionMode(settings.get('visionMode', DEFAULT_VISION_CONFIG.visionMode)),
    visionProvider: validateVisionProvider(settings.get('visionProvider', DEFAULT_VISION_CONFIG.visionProvider)),
    maxImages: validateMaxImages(settings.get('maxImages', DEFAULT_VISION_CONFIG.maxImages)),
    maxPixels: validateMaxPixels(settings.get('maxPixels', DEFAULT_VISION_CONFIG.maxPixels)),
    maxTotalUploadMB: validateMaxTotalUploadMB(settings.get('maxTotalUploadMB', DEFAULT_VISION_CONFIG.maxTotalUploadMB)),
  };
}

/**
 * Build VisionConfig from raw object (useful for testing or direct config)
 * 
 * @param raw - Raw config object
 * @returns Validated and clamped VisionConfig
 */
export function buildVisionConfigFromRaw(raw: Partial<VisionConfig>): VisionConfig {
  return {
    visionMode: validateVisionMode(raw.visionMode),
    visionProvider: validateVisionProvider(raw.visionProvider),
    maxImages: validateMaxImages(raw.maxImages),
    maxPixels: validateMaxPixels(raw.maxPixels),
    maxTotalUploadMB: validateMaxTotalUploadMB(raw.maxTotalUploadMB),
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if vision analysis is enabled
 */
export function isVisionEnabled(config: VisionConfig): boolean {
  return config.visionMode !== 'off';
}

/**
 * Check if vision requires user consent
 */
export function requiresConsent(config: VisionConfig): boolean {
  return config.visionMode === 'prompt';
}

/**
 * Check if vision can proceed automatically
 */
export function canProceedAutomatically(config: VisionConfig): boolean {
  return config.visionMode === 'on';
}

/**
 * Get human-readable description of vision mode
 */
export function getVisionModeDescription(mode: VisionMode): string {
  switch (mode) {
    case 'off':
      return 'Vision analysis is disabled';
    case 'prompt':
      return 'Vision analysis requires your consent';
    case 'on':
      return 'Vision analysis is enabled';
    default:
      return 'Unknown vision mode';
  }
}

/**
 * Get human-readable description of vision provider
 */
export function getVisionProviderDescription(provider: VisionProvider): string {
  switch (provider) {
    case 'anthropic':
      return 'Anthropic Claude Vision';
    case 'openai':
      return 'OpenAI Vision';
    case 'backend-default':
      return 'Backend Default Provider';
    default:
      return 'Unknown provider';
  }
}

// ============================================================================
// API KEY RETRIEVAL (Placeholder for extension integration)
// ============================================================================

/**
 * API key source interface
 * Extension will provide implementation that reads from secure storage
 */
export interface ApiKeySource {
  getApiKey(provider: VisionProvider): Promise<string | undefined>;
}

/**
 * Default API key source (returns undefined, must be overridden)
 */
export const defaultApiKeySource: ApiKeySource = {
  async getApiKey(_provider: VisionProvider): Promise<string | undefined> {
    console.warn('[VisionConfig] No API key source configured');
    return undefined;
  },
};

/**
 * Global API key source (set by extension during initialization)
 */
let globalApiKeySource: ApiKeySource = defaultApiKeySource;

/**
 * Set the global API key source
 */
export function setApiKeySource(source: ApiKeySource): void {
  globalApiKeySource = source;
}

/**
 * Get API key for a vision provider
 */
export async function getVisionApiKey(provider: VisionProvider): Promise<string | undefined> {
  return globalApiKeySource.getApiKey(provider);
}
