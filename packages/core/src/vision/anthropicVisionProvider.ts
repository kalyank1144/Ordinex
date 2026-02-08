/**
 * Step 38: Anthropic Vision Provider
 * 
 * Implements VisionProviderClient using Anthropic Claude's vision capabilities.
 * Extracts structured ReferenceTokens from user-provided images.
 * 
 * IMPORTANT:
 * - This provider is called from the extension layer (has access to API keys)
 * - Never store API keys in core package
 * - Uses structured output extraction with JSON schema guidance
 */

import type { ReferenceTokens, VisionImageData } from '../types';
import type { VisionProviderClient, ReferenceTokensSchema } from './visionAnalyzer';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Anthropic API message format
 */
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContent[];
}

/**
 * Anthropic content block types
 */
type AnthropicContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

/**
 * Anthropic API request
 */
interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
}

/**
 * Anthropic API response
 */
interface AnthropicResponse {
  id: string;
  type: 'message';
  content: Array<{ type: 'text'; text: string }>;
  model: string;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * Configuration for Anthropic Vision Provider
 */
export interface AnthropicVisionProviderConfig {
  /** API key (required) */
  apiKey: string;
  /** Model to use (default: claude-sonnet-4-20250514) */
  model?: string;
  /** Max tokens for response (default: 2048) */
  maxTokens?: number;
  /** API base URL (default: https://api.anthropic.com) */
  baseUrl?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default model for vision analysis
 */
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

/**
 * Default max tokens
 */
const DEFAULT_MAX_TOKENS = 2048;

/**
 * Default API base URL
 */
const DEFAULT_BASE_URL = 'https://api.anthropic.com';

/**
 * System prompt for structured extraction
 */
const EXTRACTION_SYSTEM_PROMPT = `You are a UI design token extractor. Analyze the provided images and extract design tokens in structured JSON format.

Focus on:
1. Color palette (primary, secondary, accent, neutrals)
2. Visual mood/vibe (minimal, modern, vibrant, enterprise, playful)
3. Typography hints (font families if identifiable)
4. Spacing/density (compact, default, relaxed)
5. Border radius style (none, sm, md, lg, full)
6. Shadow intensity (none, subtle, medium, dramatic)
7. Layout structure (sidebar, header, grid, cards)
8. Component patterns (nav, hero, form, footer)
9. UI framework hints if recognizable

Always return valid JSON matching the requested schema.
If you cannot determine a value with confidence, omit it.
Set confidence between 0 and 1 based on image clarity and your certainty.`;

// ============================================================================
// ANTHROPIC VISION PROVIDER
// ============================================================================

/**
 * Anthropic Vision Provider implementation
 */
export class AnthropicVisionProvider implements VisionProviderClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly baseUrl: string;

  constructor(config: AnthropicVisionProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || DEFAULT_MODEL;
    this.maxTokens = config.maxTokens || DEFAULT_MAX_TOKENS;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  /**
   * Analyze images and extract reference tokens
   */
  async analyze(
    images: VisionImageData[],
    urlContext: string,
    schema: ReferenceTokensSchema
  ): Promise<ReferenceTokens> {
    if (images.length === 0) {
      throw new Error('No images provided for analysis');
    }

    // Build message content with images
    const content: AnthropicContent[] = [];

    // Add images
    for (const img of images) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mime,
          data: img.base64,
        },
      });
    }

    // Add text prompt with schema
    const textPrompt = this.buildExtractionPrompt(schema, urlContext);
    content.push({ type: 'text', text: textPrompt });

    // Build request
    const request: AnthropicRequest = {
      model: this.model,
      max_tokens: this.maxTokens,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content,
        },
      ],
    };

    // Call API
    const response = await this.callApi(request);

    // Parse response
    const tokens = this.parseResponse(response, images.length);

    return tokens;
  }

  /**
   * Build extraction prompt with schema guidance
   */
  private buildExtractionPrompt(schema: ReferenceTokensSchema, urlContext: string): string {
    let prompt = `Analyze the provided image(s) and extract UI design tokens.

${schema.description}

`;

    if (urlContext) {
      prompt += `Additional context from URLs (not fetched, domain hints only):
${urlContext}

`;
    }

    prompt += `Return ONLY valid JSON matching the schema above. No markdown code blocks, no explanations.`;

    return prompt;
  }

  /**
   * Call Anthropic API
   */
  private async callApi(request: AnthropicRequest): Promise<AnthropicResponse> {
    const url = `${this.baseUrl}/v1/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as AnthropicResponse;
    return data;
  }

  /**
   * Parse API response into ReferenceTokens
   */
  private parseResponse(response: AnthropicResponse, imageCount: number): ReferenceTokens {
    // Extract text from response
    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent) {
      throw new Error('No text content in response');
    }

    const rawText = textContent.text.trim();

    // Try to parse JSON
    let parsed: Partial<ReferenceTokens>;
    try {
      // Handle potential markdown code blocks
      const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/) ||
                       rawText.match(/```\s*([\s\S]*?)\s*```/);
      const jsonText = jsonMatch ? jsonMatch[1] : rawText;
      
      parsed = JSON.parse(jsonText);
    } catch (error) {
      console.error('[AnthropicVisionProvider] Failed to parse JSON:', rawText.slice(0, 200));
      // Return fallback with low confidence
      return {
        source: { images_count: imageCount, urls_count: 0 },
        style: {},
        confidence: 0.1,
        warnings: ['json_parse_failed', 'raw_output_invalid'],
      };
    }

    // Validate and normalize
    return this.normalizeTokens(parsed, imageCount);
  }

  /**
   * Normalize and validate extracted tokens
   */
  private normalizeTokens(parsed: Partial<ReferenceTokens>, imageCount: number): ReferenceTokens {
    const tokens: ReferenceTokens = {
      source: {
        images_count: imageCount,
        urls_count: parsed.source?.urls_count || 0,
      },
      style: {},
      confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
      warnings: parsed.warnings || [],
    };

    // Copy style if present
    if (parsed.style) {

      if (parsed.style.palette) {
        tokens.style.palette = {
          primary: validateColor(parsed.style.palette.primary),
          secondary: validateColor(parsed.style.palette.secondary),
          accent: validateColor(parsed.style.palette.accent),
          neutrals: (parsed.style.palette.neutrals || [])
            .map(validateColor)
            .filter((c): c is string => c !== undefined),
        };
      }

      if (parsed.style.mood && Array.isArray(parsed.style.mood)) {
        tokens.style.mood = parsed.style.mood.filter(m => typeof m === 'string');
      }

      if (parsed.style.typography) {
        tokens.style.typography = {};
        if (typeof parsed.style.typography.heading === 'string') {
          tokens.style.typography.heading = parsed.style.typography.heading;
        }
        if (typeof parsed.style.typography.body === 'string') {
          tokens.style.typography.body = parsed.style.typography.body;
        }
      }

      if (isValidDensity(parsed.style.density)) {
        tokens.style.density = parsed.style.density;
      }

      if (isValidRadius(parsed.style.radius)) {
        tokens.style.radius = parsed.style.radius;
      }

      if (isValidShadows(parsed.style.shadows)) {
        tokens.style.shadows = parsed.style.shadows;
      }
    }

    // Copy layout if present
    if (parsed.layout) {
      tokens.layout = {};
      if (Array.isArray(parsed.layout.structure)) {
        tokens.layout.structure = parsed.layout.structure.filter(s => typeof s === 'string');
      }
      if (Array.isArray(parsed.layout.components)) {
        tokens.layout.components = parsed.layout.components.filter(c => typeof c === 'string');
      }
    }

    // Copy UI hints if present
    if (parsed.uiHints?.component_system_preference) {
      const pref = parsed.uiHints.component_system_preference;
      if (isValidComponentSystem(pref)) {
        tokens.uiHints = { component_system_preference: pref };
      }
    }

    return tokens;
  }
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate hex color format
 */
function validateColor(color: unknown): string | undefined {
  if (typeof color !== 'string') return undefined;
  // Accept #RGB, #RRGGBB, #RRGGBBAA formats
  if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(color)) {
    return color.toUpperCase();
  }
  return undefined;
}

/**
 * Validate density value
 */
function isValidDensity(value: unknown): value is 'compact' | 'default' | 'relaxed' {
  return value === 'compact' || value === 'default' || value === 'relaxed';
}

/**
 * Validate radius value
 */
function isValidRadius(value: unknown): value is 'none' | 'sm' | 'md' | 'lg' | 'full' {
  return value === 'none' || value === 'sm' || value === 'md' || value === 'lg' || value === 'full';
}

/**
 * Validate shadows value
 */
function isValidShadows(value: unknown): value is 'none' | 'subtle' | 'medium' | 'dramatic' {
  return value === 'none' || value === 'subtle' || value === 'medium' || value === 'dramatic';
}

/**
 * Validate component system preference
 */
function isValidComponentSystem(
  value: unknown
): value is 'shadcn' | 'mui' | 'chakra' | 'tailwind-plain' {
  return value === 'shadcn' || value === 'mui' || value === 'chakra' || value === 'tailwind-plain';
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create Anthropic Vision Provider
 * 
 * @param apiKey - Anthropic API key
 * @param config - Optional additional configuration
 */
export function createAnthropicVisionProvider(
  apiKey: string,
  config?: Partial<Omit<AnthropicVisionProviderConfig, 'apiKey'>>
): AnthropicVisionProvider {
  return new AnthropicVisionProvider({
    apiKey,
    ...config,
  });
}
