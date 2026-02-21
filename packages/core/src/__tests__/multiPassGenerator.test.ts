import { describe, it, expect } from 'vitest';
import {
  planGeneration,
  buildPassManifest,
  parseMultiFileResponse,
  passToStage,
} from '../scaffold/multiPassGenerator';
import type { AppBlueprint } from '../scaffold/blueprintSchema';

const SMALL_BLUEPRINT: AppBlueprint = {
  app_type: 'landing_page',
  app_name: 'Landing',
  primary_layout: 'full_width',
  pages: [
    { name: 'Home', path: '/', description: 'Landing', key_components: ['Hero'], layout: 'full_width', is_auth_required: false },
  ],
  data_models: [],
  shadcn_components: ['button'],
  features: [],
};

const LARGE_BLUEPRINT: AppBlueprint = {
  app_type: 'dashboard_saas',
  app_name: 'Dashboard',
  primary_layout: 'sidebar',
  pages: [
    { name: 'Dashboard', path: '/', description: 'KPIs', key_components: ['Stats'], layout: 'sidebar', is_auth_required: true },
    { name: 'Projects', path: '/projects', description: 'List', key_components: ['Table'], layout: 'sidebar', is_auth_required: true },
    { name: 'Users', path: '/users', description: 'Users', key_components: ['Table'], layout: 'sidebar', is_auth_required: true },
    { name: 'Settings', path: '/settings', description: 'Settings', key_components: ['Form'], layout: 'sidebar', is_auth_required: true },
    { name: 'Reports', path: '/reports', description: 'Reports', key_components: ['Chart'], layout: 'sidebar', is_auth_required: true },
  ],
  data_models: [{ name: 'Project', fields: ['id', 'name'] }],
  shadcn_components: ['card', 'button', 'table', 'dialog'],
  features: [{ name: 'CRUD', description: 'CRUD ops', complexity: 'high' }],
};

describe('planGeneration', () => {
  it('uses single-pass for <= 3 pages', () => {
    const plan = planGeneration(SMALL_BLUEPRINT);
    expect(plan.singlePass).toBe(true);
    expect(plan.passes).toEqual(['single']);
  });

  it('uses multi-pass for >= 5 pages', () => {
    const plan = planGeneration(LARGE_BLUEPRINT);
    expect(plan.singlePass).toBe(false);
    expect(plan.passes).toHaveLength(5);
    expect(plan.passes).toContain('layout');
    expect(plan.passes).toContain('polish');
  });

  it('estimates file count', () => {
    const plan = planGeneration(LARGE_BLUEPRINT);
    expect(plan.totalFiles).toBeGreaterThan(10);
  });
});

describe('buildPassManifest', () => {
  it('creates manifest with create entries for new files', () => {
    const files = [
      { relativePath: 'app/page.tsx', content: 'export default function Home() {}' },
    ];
    const manifest = buildPassManifest('gen_pages', files, '/nonexistent/dir');
    expect(manifest.create).toHaveLength(1);
    expect(manifest.modify).toHaveLength(0);
    expect(manifest.stage).toBe('gen_pages');
    expect(manifest.create[0].newSha256).toBeTruthy();
  });
});

describe('parseMultiFileResponse', () => {
  it('parses delimited multi-file format', () => {
    const response = `--- FILE: app/page.tsx ---
export default function Home() {
  return <div>Hello</div>
}
--- END FILE ---

--- FILE: components/Header.tsx ---
export function Header() {
  return <header>Header</header>
}
--- END FILE ---`;

    const files = parseMultiFileResponse(response);
    expect(files).toHaveLength(2);
    expect(files[0].relativePath).toBe('app/page.tsx');
    expect(files[1].relativePath).toBe('components/Header.tsx');
  });

  it('falls back to code block extraction', () => {
    const response = '```tsx\nexport default function App() { return null }\n```';
    const files = parseMultiFileResponse(response);
    expect(files).toHaveLength(1);
  });

  it('returns empty for no content', () => {
    const files = parseMultiFileResponse('');
    expect(files).toHaveLength(0);
  });
});

describe('passToStage', () => {
  it('maps layout to gen_layout', () => {
    expect(passToStage('layout')).toBe('gen_layout');
  });

  it('maps pages to gen_pages', () => {
    expect(passToStage('pages')).toBe('gen_pages');
  });

  it('maps single to gen_pages', () => {
    expect(passToStage('single')).toBe('gen_pages');
  });
});
