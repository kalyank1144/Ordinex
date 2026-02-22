/**
 * Blueprint Schema — Strict types and validation for AppBlueprint.
 *
 * Canonical data contracts for the scaffold improvement plan.
 * This module is the single source of truth for blueprint shapes,
 * scaffold stage enums, project memory, and extraction results.
 */

// ============================================================================
// SCAFFOLD STAGE ENUM
// ============================================================================

export type ScaffoldStage =
  | 'blueprint'
  | 'preflight'
  | 'cli_scaffold'
  | 'overlay'
  | 'shadcn_init'
  | 'tokens'
  | 'gen_layout'
  | 'gen_routes'
  | 'gen_components'
  | 'gen_pages'
  | 'gen_polish'
  | 'pre_publish'
  | 'llm_repair'
  | 'publish'
  | 'staging_publish'
  | 'dev_smoke';

export const SCAFFOLD_STAGE_ORDER: ScaffoldStage[] = [
  'blueprint',
  'preflight',
  'cli_scaffold',
  'overlay',
  'shadcn_init',
  'tokens',
  'gen_layout',
  'gen_routes',
  'gen_components',
  'gen_pages',
  'gen_polish',
  'pre_publish',
  'publish',
  'dev_smoke',
];

// ============================================================================
// APP BLUEPRINT
// ============================================================================

export type AppType =
  | 'dashboard_saas'
  | 'ecommerce'
  | 'blog_portfolio'
  | 'social_community'
  | 'landing_page'
  | 'admin_panel'
  | 'mobile_app'
  | 'documentation'
  | 'marketplace'
  | 'custom';

export type LayoutType = 'sidebar' | 'header_only' | 'full_width' | 'centered' | 'split';

export interface BlueprintPage {
  name: string;
  path: string;
  description: string;
  key_components: string[];
  layout: 'sidebar' | 'full_width' | 'centered';
  is_auth_required: boolean;
}

export interface BlueprintDataModel {
  name: string;
  fields: string[];
}

export interface BlueprintFeature {
  name: string;
  description: string;
  complexity: 'low' | 'medium' | 'high';
}

export interface AppBlueprint {
  app_type: AppType;
  app_name: string;
  primary_layout: LayoutType;
  pages: BlueprintPage[];
  data_models: BlueprintDataModel[];
  shadcn_components: string[];
  features: BlueprintFeature[];
}

// ============================================================================
// BLUEPRINT EXTRACTION RESULT
// ============================================================================

export interface BlueprintExtractionResult {
  blueprint: AppBlueprint;
  confidence: number;
  missing_fields: string[];
}

/**
 * Confidence >= 0.75: auto-allow generation.
 * 0.4 <= confidence < 0.75: require user confirmation.
 * confidence < 0.4: archetype picker required.
 */
export type BlueprintConfidenceTier = 'auto' | 'confirm' | 'archetype';

export function classifyConfidence(confidence: number): BlueprintConfidenceTier {
  if (confidence >= 0.75) return 'auto';
  if (confidence >= 0.4) return 'confirm';
  return 'archetype';
}

// ============================================================================
// RECIPE GATE COMMANDS
// ============================================================================

export interface RecipeGateCommands {
  tsc: string;
  eslint: string;
  build: string;
  dev: string;
}

export const DEFAULT_GATE_COMMANDS: RecipeGateCommands = {
  tsc: 'npx tsc --noEmit --skipLibCheck',
  eslint: 'npx next lint --no-cache',
  build: 'npm run build',
  dev: 'npm run dev',
};

// ============================================================================
// .ordinex/context.json — PROJECT MEMORY
// ============================================================================

export interface DoctorStatus {
  tsc: 'unknown' | 'pass' | 'fail';
  eslint: 'unknown' | 'pass' | 'fail';
  build: 'unknown' | 'pass' | 'fail';
  devServer: {
    status: 'unknown' | 'running' | 'fail';
    url: string;
  };
}

export interface StageTelemetry {
  duration_ms: number;
  files_created: number;
  files_modified: number;
}

export interface StageHistoryEntry {
  stage: ScaffoldStage;
  commit: string;
  result: 'pass' | 'fail';
  telemetry?: StageTelemetry;
}

export interface StyleInput {
  mode: 'nl' | 'vibe' | 'hex' | 'image' | 'url';
  value: string;
}

export interface OrdinexProjectContext {
  version: '2';
  created_at: string;
  stack: {
    recipe: string;
    frameworkVersion: string;
    ui: string;
    styling: string;
    backend: string;
  };
  blueprint: AppBlueprint | Record<string, never>;
  style: {
    input: StyleInput | Record<string, never>;
    tokens: Record<string, string>;
    shadcnCssVars: Record<string, string>;
  };
  inventory: {
    routes: string[];
    components: string[];
    dataModels: string[];
  };
  doctor: DoctorStatus;
  history: StageHistoryEntry[];
}

export function createEmptyProjectContext(): OrdinexProjectContext {
  return {
    version: '2',
    created_at: new Date().toISOString(),
    stack: {
      recipe: '',
      frameworkVersion: '',
      ui: 'shadcn',
      styling: 'tailwind',
      backend: 'none',
    },
    blueprint: {},
    style: {
      input: {},
      tokens: {},
      shadcnCssVars: {},
    },
    inventory: {
      routes: [],
      components: [],
      dataModels: [],
    },
    doctor: {
      tsc: 'unknown',
      eslint: 'unknown',
      build: 'unknown',
      devServer: { status: 'unknown', url: '' },
    },
    history: [],
  };
}

// ============================================================================
// MULTI-PASS MANIFEST
// ============================================================================

export interface ManifestEntry {
  path: string;
  baseSha256?: string;
  newSha256: string;
}

export interface PassManifest {
  stage: ScaffoldStage;
  create: ManifestEntry[];
  modify: ManifestEntry[];
}

// ============================================================================
// BLUEPRINT VALIDATION
// ============================================================================

const VALID_APP_TYPES: AppType[] = [
  'dashboard_saas', 'ecommerce', 'blog_portfolio', 'social_community',
  'landing_page', 'admin_panel', 'mobile_app', 'documentation',
  'marketplace', 'custom',
];

const VALID_LAYOUTS: LayoutType[] = [
  'sidebar', 'header_only', 'full_width', 'centered', 'split',
];

const VALID_PAGE_LAYOUTS = ['sidebar', 'full_width', 'centered'] as const;
const VALID_COMPLEXITIES = ['low', 'medium', 'high'] as const;

export interface BlueprintValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateBlueprint(bp: unknown): BlueprintValidationResult {
  const errors: string[] = [];

  if (!bp || typeof bp !== 'object') {
    return { valid: false, errors: ['Blueprint must be a non-null object'] };
  }

  const b = bp as Record<string, unknown>;

  if (!b.app_type || !VALID_APP_TYPES.includes(b.app_type as AppType)) {
    errors.push(`app_type must be one of: ${VALID_APP_TYPES.join(', ')}`);
  }
  if (!b.app_name || typeof b.app_name !== 'string' || b.app_name.trim().length === 0) {
    errors.push('app_name must be a non-empty string');
  }
  if (!b.primary_layout || !VALID_LAYOUTS.includes(b.primary_layout as LayoutType)) {
    errors.push(`primary_layout must be one of: ${VALID_LAYOUTS.join(', ')}`);
  }

  if (!Array.isArray(b.pages) || b.pages.length === 0) {
    errors.push('pages must be a non-empty array');
  } else {
    (b.pages as unknown[]).forEach((p, i) => {
      const page = p as Record<string, unknown>;
      if (!page.name || typeof page.name !== 'string') errors.push(`pages[${i}].name required`);
      if (!page.path || typeof page.path !== 'string') errors.push(`pages[${i}].path required`);
      if (!page.description || typeof page.description !== 'string') errors.push(`pages[${i}].description required`);
      if (!Array.isArray(page.key_components)) errors.push(`pages[${i}].key_components must be an array`);
      if (!VALID_PAGE_LAYOUTS.includes(page.layout as typeof VALID_PAGE_LAYOUTS[number])) {
        errors.push(`pages[${i}].layout must be sidebar|full_width|centered`);
      }
      if (typeof page.is_auth_required !== 'boolean') errors.push(`pages[${i}].is_auth_required must be boolean`);
    });
  }

  if (!Array.isArray(b.data_models)) {
    errors.push('data_models must be an array');
  } else {
    (b.data_models as unknown[]).forEach((dm, i) => {
      const model = dm as Record<string, unknown>;
      if (!model.name || typeof model.name !== 'string') errors.push(`data_models[${i}].name required`);
      if (!Array.isArray(model.fields)) errors.push(`data_models[${i}].fields must be an array`);
    });
  }

  if (!Array.isArray(b.shadcn_components)) {
    errors.push('shadcn_components must be an array of strings');
  }

  if (!Array.isArray(b.features)) {
    errors.push('features must be an array');
  } else {
    (b.features as unknown[]).forEach((f, i) => {
      const feat = f as Record<string, unknown>;
      if (!feat.name || typeof feat.name !== 'string') errors.push(`features[${i}].name required`);
      if (!feat.description || typeof feat.description !== 'string') errors.push(`features[${i}].description required`);
      if (!VALID_COMPLEXITIES.includes(feat.complexity as typeof VALID_COMPLEXITIES[number])) {
        errors.push(`features[${i}].complexity must be low|medium|high`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
}
