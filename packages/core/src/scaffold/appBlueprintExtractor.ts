/**
 * App Blueprint Extractor — LLM-powered structured JSON extraction.
 *
 * Takes a user prompt and produces an AppBlueprint with confidence score.
 * If confidence is below thresholds, routes to archetype fallback flow.
 */

import type {
  AppBlueprint,
  AppType,
  BlueprintExtractionResult,
  BlueprintConfidenceTier,
} from './blueprintSchema';
import { validateBlueprint, classifyConfidence } from './blueprintSchema';

// ============================================================================
// ARCHETYPE SKELETONS
// ============================================================================

export const ARCHETYPE_SKELETONS: Record<string, AppBlueprint> = {
  dashboard_saas: {
    app_type: 'dashboard_saas',
    app_name: 'My Dashboard',
    primary_layout: 'sidebar',
    pages: [
      { name: 'Dashboard', path: '/', description: 'Overview with KPIs and recent activity', key_components: ['StatsCards', 'ActivityFeed'], layout: 'sidebar', is_auth_required: true },
      { name: 'Settings', path: '/settings', description: 'Account and app settings', key_components: ['SettingsForm', 'ProfileCard'], layout: 'sidebar', is_auth_required: true },
    ],
    data_models: [{ name: 'User', fields: ['id', 'email', 'name', 'role', 'createdAt'] }],
    shadcn_components: ['card', 'button', 'table', 'dialog', 'sheet', 'toast', 'avatar'],
    features: [
      { name: 'Authentication', description: 'Email/password login', complexity: 'medium' },
    ],
  },
  ecommerce: {
    app_type: 'ecommerce',
    app_name: 'My Store',
    primary_layout: 'header_only',
    pages: [
      { name: 'Home', path: '/', description: 'Landing with featured products', key_components: ['HeroBanner', 'ProductGrid', 'CategoryNav'], layout: 'full_width', is_auth_required: false },
      { name: 'Products', path: '/products', description: 'Product catalog with filters', key_components: ['ProductGrid', 'Filters', 'Pagination'], layout: 'full_width', is_auth_required: false },
      { name: 'Cart', path: '/cart', description: 'Shopping cart summary', key_components: ['CartItems', 'OrderSummary'], layout: 'centered', is_auth_required: false },
    ],
    data_models: [
      { name: 'Product', fields: ['id', 'name', 'price', 'description', 'imageUrl', 'category'] },
      { name: 'CartItem', fields: ['id', 'productId', 'quantity'] },
    ],
    shadcn_components: ['card', 'button', 'badge', 'dialog', 'sheet', 'toast', 'select'],
    features: [
      { name: 'Product Catalog', description: 'Browse and filter products', complexity: 'medium' },
      { name: 'Shopping Cart', description: 'Add/remove items', complexity: 'medium' },
    ],
  },
  blog_portfolio: {
    app_type: 'blog_portfolio',
    app_name: 'My Portfolio',
    primary_layout: 'header_only',
    pages: [
      { name: 'Home', path: '/', description: 'Hero with about section and featured work', key_components: ['Hero', 'FeaturedProjects', 'AboutSection'], layout: 'full_width', is_auth_required: false },
      { name: 'Blog', path: '/blog', description: 'Article listing', key_components: ['ArticleGrid', 'Categories'], layout: 'centered', is_auth_required: false },
      { name: 'Contact', path: '/contact', description: 'Contact form', key_components: ['ContactForm'], layout: 'centered', is_auth_required: false },
    ],
    data_models: [
      { name: 'Post', fields: ['id', 'title', 'slug', 'content', 'publishedAt', 'tags'] },
      { name: 'Project', fields: ['id', 'title', 'description', 'imageUrl', 'url'] },
    ],
    shadcn_components: ['card', 'button', 'badge', 'separator', 'avatar'],
    features: [
      { name: 'Blog', description: 'Markdown-based blog posts', complexity: 'medium' },
    ],
  },
  landing_page: {
    app_type: 'landing_page',
    app_name: 'My Landing Page',
    primary_layout: 'full_width',
    pages: [
      { name: 'Home', path: '/', description: 'Marketing landing page with sections', key_components: ['Hero', 'Features', 'Testimonials', 'CTA', 'Footer'], layout: 'full_width', is_auth_required: false },
    ],
    data_models: [],
    shadcn_components: ['button', 'card', 'badge', 'separator'],
    features: [
      { name: 'Responsive Layout', description: 'Mobile-first design', complexity: 'low' },
    ],
  },
  admin_panel: {
    app_type: 'admin_panel',
    app_name: 'Admin Panel',
    primary_layout: 'sidebar',
    pages: [
      { name: 'Dashboard', path: '/', description: 'Admin overview with stats', key_components: ['StatsCards', 'RecentActivity', 'Charts'], layout: 'sidebar', is_auth_required: true },
      { name: 'Users', path: '/users', description: 'User management table', key_components: ['DataTable', 'UserDialog', 'Filters'], layout: 'sidebar', is_auth_required: true },
      { name: 'Settings', path: '/settings', description: 'System settings', key_components: ['SettingsForm', 'Tabs'], layout: 'sidebar', is_auth_required: true },
    ],
    data_models: [
      { name: 'User', fields: ['id', 'email', 'name', 'role', 'status', 'createdAt'] },
    ],
    shadcn_components: ['card', 'button', 'table', 'dialog', 'sheet', 'toast', 'tabs', 'select', 'badge'],
    features: [
      { name: 'User Management', description: 'CRUD operations for users', complexity: 'high' },
      { name: 'Authentication', description: 'Role-based access', complexity: 'medium' },
    ],
  },
  todo: {
    app_type: 'custom',
    app_name: 'Todo App',
    primary_layout: 'sidebar',
    pages: [
      { name: 'Dashboard', path: '/', description: 'Overview with task stats and recent activity', key_components: ['StatsCards', 'RecentTasks', 'QuickAdd'], layout: 'sidebar', is_auth_required: false },
      { name: 'All Todos', path: '/todos', description: 'List all tasks with filters and search', key_components: ['TodoList', 'FilterBar', 'SearchInput', 'SortDropdown', 'AddTodoDialog'], layout: 'sidebar', is_auth_required: false },
      { name: 'Todo Detail', path: '/todos/[id]', description: 'View and edit a single task', key_components: ['TodoDetail', 'SubtaskList', 'NotesEditor', 'DueDatePicker', 'PrioritySelect'], layout: 'sidebar', is_auth_required: false },
      { name: 'Categories', path: '/categories', description: 'Manage task categories and labels', key_components: ['CategoryList', 'CategoryForm', 'ColorPicker', 'CategoryStats'], layout: 'sidebar', is_auth_required: false },
      { name: 'Calendar View', path: '/calendar', description: 'Calendar view of tasks by due date', key_components: ['CalendarGrid', 'DayView', 'TaskPopover', 'MonthNav'], layout: 'sidebar', is_auth_required: false },
      { name: 'Settings', path: '/settings', description: 'App preferences and theme settings', key_components: ['SettingsForm', 'ThemeToggle', 'NotificationPrefs', 'ExportButton'], layout: 'sidebar', is_auth_required: false },
    ],
    data_models: [
      { name: 'Todo', fields: ['id', 'title', 'description', 'completed', 'priority', 'dueDate', 'categoryId', 'createdAt', 'updatedAt'] },
      { name: 'Category', fields: ['id', 'name', 'color', 'icon', 'todoCount'] },
      { name: 'Subtask', fields: ['id', 'todoId', 'title', 'completed', 'order'] },
    ],
    shadcn_components: ['card', 'button', 'input', 'dialog', 'select', 'badge', 'checkbox', 'calendar', 'popover', 'separator', 'tabs', 'toast', 'dropdown-menu'],
    features: [
      { name: 'Task CRUD', description: 'Create, read, update, delete tasks', complexity: 'medium' },
      { name: 'Categories & Labels', description: 'Organize tasks with categories', complexity: 'medium' },
      { name: 'Calendar View', description: 'View tasks by date on calendar', complexity: 'high' },
      { name: 'Priority System', description: 'High/Medium/Low priority levels', complexity: 'low' },
      { name: 'Search & Filter', description: 'Full-text search with category/status filters', complexity: 'medium' },
    ],
  },
  custom: {
    app_type: 'custom',
    app_name: 'My App',
    primary_layout: 'sidebar',
    pages: [
      { name: 'Dashboard', path: '/', description: 'Main overview page', key_components: ['StatsCards', 'RecentActivity'], layout: 'sidebar', is_auth_required: false },
      { name: 'Items', path: '/items', description: 'List and manage items', key_components: ['DataTable', 'FilterBar', 'AddItemDialog'], layout: 'sidebar', is_auth_required: false },
      { name: 'Settings', path: '/settings', description: 'App settings and preferences', key_components: ['SettingsForm', 'ThemeToggle'], layout: 'sidebar', is_auth_required: false },
    ],
    data_models: [{ name: 'Item', fields: ['id', 'title', 'description', 'status', 'createdAt'] }],
    shadcn_components: ['card', 'button', 'input', 'dialog', 'table', 'badge', 'separator'],
    features: [
      { name: 'Data Management', description: 'CRUD operations for items', complexity: 'medium' },
    ],
  },
};

// ============================================================================
// ARCHETYPE MATCHING (keyword-based fallback)
// ============================================================================

function matchArchetypeFromPrompt(prompt: string): AppBlueprint {
  const lower = prompt.toLowerCase();
  const keywords: Record<string, string> = {
    'todo': 'todo',
    'task': 'todo',
    'todo app': 'todo',
    'dashboard': 'dashboard_saas',
    'saas': 'dashboard_saas',
    'analytics': 'dashboard_saas',
    'shop': 'ecommerce',
    'store': 'ecommerce',
    'ecommerce': 'ecommerce',
    'e-commerce': 'ecommerce',
    'blog': 'blog_portfolio',
    'portfolio': 'blog_portfolio',
    'landing': 'landing_page',
    'marketing': 'landing_page',
    'admin': 'admin_panel',
    'cms': 'admin_panel',
  };
  for (const [kw, archetype] of Object.entries(keywords)) {
    if (lower.includes(kw)) {
      const skeleton = { ...ARCHETYPE_SKELETONS[archetype] };
      skeleton.app_name = extractAppNameFromPrompt(prompt) || skeleton.app_name;
      return skeleton;
    }
  }
  return ARCHETYPE_SKELETONS.custom;
}

function extractAppNameFromPrompt(prompt: string): string {
  const patterns = [
    /(?:create|build|make|start)\s+(?:a\s+)?(?:new\s+)?(.+?)(?:\s+app|\s+application|\s+project|\s+site|\s+website)/i,
    /(?:new\s+)(.+?)(?:\s+app|\s+project)/i,
  ];
  for (const pat of patterns) {
    const match = prompt.match(pat);
    if (match) {
      const name = match[1].trim().replace(/\b\w/g, c => c.toUpperCase());
      if (name.length > 2 && name.length < 40) return name;
    }
  }
  return '';
}

// ============================================================================
// EXTRACTION PROMPT
// ============================================================================

export function buildExtractionPrompt(userPrompt: string): string {
  return `You are an expert full-stack app architect. Given a user's app description, design a comprehensive, production-quality app blueprint as structured JSON.

USER PROMPT: "${userPrompt}"

IMPORTANT: Even if the prompt is brief (e.g. "todo app"), you must design a COMPLETE, feature-rich application with multiple pages, data models, and components — like a real production app a senior engineer would build. Think about what pages, features, and data models a real version of this app needs.

Return ONLY valid JSON matching this exact schema (no markdown, no explanation):

{
  "app_type": "dashboard_saas" | "ecommerce" | "blog_portfolio" | "social_community" | "landing_page" | "admin_panel" | "mobile_app" | "documentation" | "marketplace" | "custom",
  "app_name": "string (descriptive name derived from the prompt)",
  "primary_layout": "sidebar" | "header_only" | "full_width" | "centered" | "split",
  "pages": [
    {
      "name": "string",
      "path": "string (URL path like /dashboard)",
      "description": "string (what this page does)",
      "key_components": ["ComponentName1", "ComponentName2"],
      "layout": "sidebar" | "full_width" | "centered",
      "is_auth_required": true | false
    }
  ],
  "data_models": [
    { "name": "ModelName", "fields": ["field1", "field2", "field3"] }
  ],
  "shadcn_components": ["card", "button", "table", ...],
  "features": [
    { "name": "Feature Name", "description": "Brief description", "complexity": "low" | "medium" | "high" }
  ]
}

Rules:
- Design AT LEAST 4-8 pages for any real app (Dashboard, List view, Detail view, Settings, etc.)
- Extract all pages the user described AND infer pages they would reasonably need
- Each page must have 2-5 key_components (PascalCase names like TodoList, FilterBar, StatsCard)
- data_models must have 3+ fields each and reflect all domain objects the app needs
- shadcn_components should list ALL shadcn/ui components the pages would use (aim for 8+)
- features should include 3+ features with appropriate complexity ratings
- For "todo" apps: include Dashboard, All Todos, Todo Detail, Categories, Calendar View, Settings pages
- For "blog" apps: include Home, Posts, Post Detail, Categories, About, Contact pages
- For generic "app" requests: design a dashboard_saas with comprehensive pages
- Always set app_name to something specific (never "My App")
- Every page must have is_auth_required set based on context`;
}

// ============================================================================
// CONFIDENCE SCORING
// ============================================================================

/**
 * Compute a confidence score for an extracted blueprint based on
 * how well-specified the fields are relative to the prompt length.
 */
export function computeConfidence(bp: AppBlueprint, promptLength: number): { confidence: number; missing: string[] } {
  const missing: string[] = [];
  let score = 1.0;

  if (!bp.app_name || bp.app_name === 'My App') { score -= 0.1; missing.push('app_name'); }
  if (bp.pages.length === 0) { score -= 0.3; missing.push('pages'); }
  if (bp.pages.length === 1 && promptLength > 80) { score -= 0.1; missing.push('pages (only 1 for detailed prompt)'); }
  if (bp.data_models.length === 0 && bp.app_type !== 'landing_page') { score -= 0.1; missing.push('data_models'); }
  if (bp.features.length === 0) { score -= 0.1; missing.push('features'); }
  if (bp.shadcn_components.length < 3) { score -= 0.05; missing.push('shadcn_components'); }

  // Bonus for well-specified prompts
  if (promptLength > 200 && bp.pages.length >= 3) score += 0.05;

  return { confidence: Math.max(0, Math.min(1, score)), missing };
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Parse raw LLM output into a validated BlueprintExtractionResult.
 * If parsing/validation fails, returns a low-confidence result.
 */
export function parseBlueprintFromLLMResponse(
  rawResponse: string,
  originalPrompt: string,
): BlueprintExtractionResult {
  try {
    // Extract JSON from potential markdown code fences
    let jsonStr = rawResponse.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    const parsed = JSON.parse(jsonStr);
    const validation = validateBlueprint(parsed);

    if (!validation.valid) {
      return {
        blueprint: parsed as AppBlueprint,
        confidence: 0.2,
        missing_fields: validation.errors,
      };
    }

    const bp = parsed as AppBlueprint;
    const { confidence, missing } = computeConfidence(bp, originalPrompt.length);

    return { blueprint: bp, confidence, missing_fields: missing };
  } catch (err: any) {
    // Complete parse failure — use archetype matching as fallback
    const archetype = matchArchetypeFromPrompt(originalPrompt);
    return {
      blueprint: archetype,
      confidence: 0.3,
      missing_fields: [`JSON parse error: ${err.message}`],
    };
  }
}

/**
 * Get archetype skeleton for a given app type.
 */
export function getArchetypeSkeleton(appType: string): AppBlueprint {
  return ARCHETYPE_SKELETONS[appType] || ARCHETYPE_SKELETONS.custom;
}

/**
 * List available archetype names for the picker UI.
 */
export function listArchetypes(): Array<{ id: string; label: string; description: string }> {
  return [
    { id: 'dashboard_saas', label: 'Dashboard / SaaS', description: 'Sidebar layout with KPIs, tables, and settings' },
    { id: 'ecommerce', label: 'E-commerce', description: 'Product catalog, cart, and checkout flow' },
    { id: 'blog_portfolio', label: 'Blog / Portfolio', description: 'Content-focused with blog and project showcase' },
    { id: 'landing_page', label: 'Landing Page', description: 'Marketing page with hero, features, and CTA' },
    { id: 'admin_panel', label: 'Admin Panel', description: 'Data management with tables, forms, and RBAC' },
    { id: 'social_community', label: 'Social / Community', description: 'Feed, profiles, and social features' },
    { id: 'documentation', label: 'Documentation', description: 'Docs site with sidebar navigation and search' },
    { id: 'marketplace', label: 'Marketplace', description: 'Listings, search, and transaction management' },
    { id: 'custom', label: 'Custom', description: 'Start from a minimal base and describe your app' },
  ];
}
