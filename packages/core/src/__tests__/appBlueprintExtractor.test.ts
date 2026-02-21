import { describe, it, expect } from 'vitest';
import {
  parseBlueprintFromLLMResponse,
  computeConfidence,
  getArchetypeSkeleton,
  listArchetypes,
  buildExtractionPrompt,
  ARCHETYPE_SKELETONS,
} from '../scaffold/appBlueprintExtractor';
import type { AppBlueprint } from '../scaffold/blueprintSchema';

const VALID_JSON = JSON.stringify({
  app_type: 'dashboard_saas',
  app_name: 'Project Tracker',
  primary_layout: 'sidebar',
  pages: [
    { name: 'Dashboard', path: '/', description: 'Overview', key_components: ['Stats'], layout: 'sidebar', is_auth_required: true },
    { name: 'Projects', path: '/projects', description: 'List', key_components: ['Table'], layout: 'sidebar', is_auth_required: true },
  ],
  data_models: [{ name: 'Project', fields: ['id', 'name', 'status'] }],
  shadcn_components: ['card', 'button', 'table'],
  features: [{ name: 'CRUD', description: 'Project management', complexity: 'high' }],
});

describe('parseBlueprintFromLLMResponse', () => {
  it('parses valid JSON response', () => {
    const result = parseBlueprintFromLLMResponse(VALID_JSON, 'Build a project tracker');
    expect(result.blueprint.app_type).toBe('dashboard_saas');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('parses JSON wrapped in code fences', () => {
    const fenced = '```json\n' + VALID_JSON + '\n```';
    const result = parseBlueprintFromLLMResponse(fenced, 'Build a project tracker');
    expect(result.blueprint.app_name).toBe('Project Tracker');
  });

  it('returns low confidence for invalid JSON', () => {
    const result = parseBlueprintFromLLMResponse('not json at all', 'some prompt');
    expect(result.confidence).toBeLessThan(0.4);
    expect(result.missing_fields.length).toBeGreaterThan(0);
  });

  it('returns low confidence for valid JSON with invalid schema', () => {
    const invalid = JSON.stringify({ app_type: 'unknown_type', app_name: '', pages: [] });
    const result = parseBlueprintFromLLMResponse(invalid, 'some prompt');
    expect(result.confidence).toBeLessThanOrEqual(0.2);
  });
});

describe('computeConfidence', () => {
  it('gives high confidence to well-specified blueprints', () => {
    const bp: AppBlueprint = {
      app_type: 'dashboard_saas',
      app_name: 'Real App Name',
      primary_layout: 'sidebar',
      pages: [
        { name: 'A', path: '/a', description: 'Page A', key_components: ['X'], layout: 'sidebar', is_auth_required: true },
        { name: 'B', path: '/b', description: 'Page B', key_components: ['Y'], layout: 'full_width', is_auth_required: false },
      ],
      data_models: [{ name: 'M', fields: ['id'] }],
      shadcn_components: ['card', 'button', 'table'],
      features: [{ name: 'F', description: 'Desc', complexity: 'medium' }],
    };
    const { confidence } = computeConfidence(bp, 100);
    expect(confidence).toBeGreaterThanOrEqual(0.75);
  });

  it('penalizes missing features', () => {
    const bp: AppBlueprint = {
      app_type: 'dashboard_saas',
      app_name: 'App',
      primary_layout: 'sidebar',
      pages: [{ name: 'Home', path: '/', description: 'Home', key_components: [], layout: 'sidebar', is_auth_required: false }],
      data_models: [],
      shadcn_components: [],
      features: [],
    };
    const { confidence } = computeConfidence(bp, 100);
    expect(confidence).toBeLessThan(0.75);
  });

  it('penalizes generic app name', () => {
    const bp: AppBlueprint = {
      ...ARCHETYPE_SKELETONS.custom,
      app_name: 'My App',
    };
    const { confidence, missing } = computeConfidence(bp, 50);
    expect(missing).toContain('app_name');
  });
});

describe('getArchetypeSkeleton', () => {
  it('returns skeleton for known types', () => {
    const bp = getArchetypeSkeleton('ecommerce');
    expect(bp.app_type).toBe('ecommerce');
    expect(bp.pages.length).toBeGreaterThan(0);
  });

  it('falls back to custom for unknown type', () => {
    const bp = getArchetypeSkeleton('unknown');
    expect(bp.app_type).toBe('custom');
  });
});

describe('listArchetypes', () => {
  it('returns at least 5 archetypes', () => {
    const archetypes = listArchetypes();
    expect(archetypes.length).toBeGreaterThanOrEqual(5);
    expect(archetypes[0]).toHaveProperty('id');
    expect(archetypes[0]).toHaveProperty('label');
  });
});

describe('buildExtractionPrompt', () => {
  it('includes the user prompt', () => {
    const prompt = buildExtractionPrompt('Build a todo app');
    expect(prompt).toContain('Build a todo app');
    expect(prompt).toContain('app_type');
    expect(prompt).toContain('is_auth_required');
  });
});
