import { describe, it, expect } from 'vitest';
import {
  validateBlueprint,
  classifyConfidence,
  createEmptyProjectContext,
  SCAFFOLD_STAGE_ORDER,
} from '../scaffold/blueprintSchema';
import type { AppBlueprint } from '../scaffold/blueprintSchema';

const VALID_BLUEPRINT: AppBlueprint = {
  app_type: 'dashboard_saas',
  app_name: 'Test App',
  primary_layout: 'sidebar',
  pages: [
    {
      name: 'Dashboard',
      path: '/',
      description: 'Main dashboard',
      key_components: ['StatsCards'],
      layout: 'sidebar',
      is_auth_required: true,
    },
  ],
  data_models: [{ name: 'User', fields: ['id', 'email'] }],
  shadcn_components: ['card', 'button'],
  features: [{ name: 'Auth', description: 'Login flow', complexity: 'medium' }],
};

describe('validateBlueprint', () => {
  it('accepts a valid blueprint', () => {
    const result = validateBlueprint(VALID_BLUEPRINT);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects null input', () => {
    const result = validateBlueprint(null);
    expect(result.valid).toBe(false);
  });

  it('rejects missing app_type', () => {
    const bp = { ...VALID_BLUEPRINT, app_type: undefined };
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('app_type'))).toBe(true);
  });

  it('rejects invalid app_type', () => {
    const bp = { ...VALID_BLUEPRINT, app_type: 'invalid_type' };
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
  });

  it('rejects empty pages array', () => {
    const bp = { ...VALID_BLUEPRINT, pages: [] };
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('pages'))).toBe(true);
  });

  it('rejects page with missing is_auth_required', () => {
    const bp = {
      ...VALID_BLUEPRINT,
      pages: [{ name: 'Home', path: '/', description: 'Home page', key_components: [], layout: 'full_width' }],
    };
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
  });

  it('rejects data_model without fields array', () => {
    const bp = {
      ...VALID_BLUEPRINT,
      data_models: [{ name: 'User', fields: 'not_an_array' }],
    };
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
  });

  it('rejects features with invalid complexity', () => {
    const bp = {
      ...VALID_BLUEPRINT,
      features: [{ name: 'Auth', description: 'Login', complexity: 'extreme' }],
    };
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
  });

  it('validates all AppType values', () => {
    const types = [
      'dashboard_saas', 'ecommerce', 'blog_portfolio', 'social_community',
      'landing_page', 'admin_panel', 'mobile_app', 'documentation',
      'marketplace', 'custom',
    ];
    for (const t of types) {
      const bp = { ...VALID_BLUEPRINT, app_type: t };
      const result = validateBlueprint(bp);
      expect(result.valid).toBe(true);
    }
  });
});

describe('classifyConfidence', () => {
  it('returns auto for high confidence', () => {
    expect(classifyConfidence(0.8)).toBe('auto');
    expect(classifyConfidence(0.75)).toBe('auto');
    expect(classifyConfidence(1.0)).toBe('auto');
  });

  it('returns confirm for medium confidence', () => {
    expect(classifyConfidence(0.5)).toBe('confirm');
    expect(classifyConfidence(0.4)).toBe('confirm');
    expect(classifyConfidence(0.74)).toBe('confirm');
  });

  it('returns archetype for low confidence', () => {
    expect(classifyConfidence(0.2)).toBe('archetype');
    expect(classifyConfidence(0.0)).toBe('archetype');
    expect(classifyConfidence(0.39)).toBe('archetype');
  });
});

describe('createEmptyProjectContext', () => {
  it('returns valid v2 structure', () => {
    const ctx = createEmptyProjectContext();
    expect(ctx.version).toBe('2');
    expect(ctx.created_at).toBeTruthy();
    expect(ctx.doctor.tsc).toBe('unknown');
    expect(ctx.history).toEqual([]);
    expect(ctx.inventory.routes).toEqual([]);
  });
});

describe('SCAFFOLD_STAGE_ORDER', () => {
  it('has 14 stages in correct order', () => {
    expect(SCAFFOLD_STAGE_ORDER).toHaveLength(14);
    expect(SCAFFOLD_STAGE_ORDER[0]).toBe('blueprint');
    expect(SCAFFOLD_STAGE_ORDER[SCAFFOLD_STAGE_ORDER.length - 1]).toBe('dev_smoke');
  });

  it('has publish after pre_publish', () => {
    const pre = SCAFFOLD_STAGE_ORDER.indexOf('pre_publish');
    const pub = SCAFFOLD_STAGE_ORDER.indexOf('publish');
    expect(pub).toBeGreaterThan(pre);
  });
});
