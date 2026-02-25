/**
 * Layer 1: Rules Loader
 *
 * Loads persistent rules from project (.ordinex/rules/*.md) and
 * global (~/.ordinex/rules.md) locations. Rules are always injected
 * into LLM context at session start.
 *
 * Rule files support optional scope comments:
 *   <!-- scope: **\/*.ts -->
 * Rules without scope are always active.
 */

import * as path from 'path';

// ============================================================================
// TYPES
// ============================================================================

export interface Rule {
  id: string;
  scope?: string;
  content: string;
  source: 'project' | 'global';
}

export interface RulesService {
  readDir(dirPath: string): Promise<string[]>;
  readFile(filePath: string): Promise<string | null>;
  exists(filePath: string): Promise<boolean>;
}

// ============================================================================
// SCOPE PARSING
// ============================================================================

const SCOPE_PATTERN = /<!--\s*scope:\s*(.+?)\s*-->/i;

function parseScope(content: string): string | undefined {
  const match = content.match(SCOPE_PATTERN);
  return match ? match[1].trim() : undefined;
}

function stripScopeComment(content: string): string {
  return content.replace(SCOPE_PATTERN, '').trim();
}

// ============================================================================
// GLOB MATCHING (lightweight, no external dependency)
// ============================================================================

/**
 * Minimal glob matcher supporting *, **, and ? patterns.
 * Uses placeholder tokenization to avoid collisions between
 * glob wildcards and regex metacharacters.
 */
export function globMatch(pattern: string, filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');

  let regexStr = pattern.replace(/\\/g, '/');

  // Tokenize glob patterns before escaping regex specials
  regexStr = regexStr.replace(/\*\*\//g, '\x00GS\x00');
  regexStr = regexStr.replace(/\*\*/g, '\x00GA\x00');
  regexStr = regexStr.replace(/\*/g, '\x00S\x00');
  regexStr = regexStr.replace(/\?/g, '\x00Q\x00');

  regexStr = regexStr.replace(/[.+^${}()|[\]\\]/g, '\\$&');

  regexStr = regexStr.replace(/\x00GS\x00/g, '(.+/)?');
  regexStr = regexStr.replace(/\x00GA\x00/g, '.*');
  regexStr = regexStr.replace(/\x00S\x00/g, '[^/]*');
  regexStr = regexStr.replace(/\x00Q\x00/g, '[^/]');

  try {
    const regex = new RegExp(`^${regexStr}$`);
    return regex.test(normalized);
  } catch {
    return false;
  }
}

// ============================================================================
// RULE LOADING
// ============================================================================

/**
 * Load all rules from project and global locations.
 * Project rules take precedence over global rules (injected after).
 */
export async function loadRules(
  workspaceRoot: string,
  service: RulesService,
  homeDir?: string,
): Promise<Rule[]> {
  const rules: Rule[] = [];

  // 1. Load global rules (~/.ordinex/rules.md)
  const home = homeDir || getHomeDir();
  if (home) {
    const globalPath = path.join(home, '.ordinex', 'rules.md');
    const globalContent = await service.readFile(globalPath);
    if (globalContent && globalContent.trim().length > 0) {
      rules.push({
        id: '_global',
        scope: undefined,
        content: globalContent.trim(),
        source: 'global',
      });
    }
  }

  // 2. Load project rules (.ordinex/rules/*.md)
  const rulesDir = path.join(workspaceRoot, '.ordinex', 'rules');
  const dirExists = await service.exists(rulesDir);
  if (!dirExists) return rules;

  let files: string[];
  try {
    files = await service.readDir(rulesDir);
  } catch {
    return rules;
  }

  const mdFiles = files
    .filter(f => f.endsWith('.md'))
    .sort();

  for (const file of mdFiles) {
    const filePath = path.join(rulesDir, file);
    const content = await service.readFile(filePath);
    if (!content || content.trim().length === 0) continue;

    const scope = parseScope(content);
    const cleanContent = stripScopeComment(content);

    if (cleanContent.length === 0) continue;

    rules.push({
      id: file.replace(/\.md$/, ''),
      scope,
      content: cleanContent,
      source: 'project',
    });
  }

  return rules;
}

// ============================================================================
// CONTEXT BUILDING
// ============================================================================

/**
 * Build rules context string for injection into system prompt.
 * Filters rules by scope (glob match against activeFile).
 * Global rules come first, project rules after.
 */
export function buildRulesContext(rules: Rule[], activeFile?: string): string {
  if (rules.length === 0) return '';

  const applicable = rules.filter(rule => {
    if (!rule.scope) return true;
    if (!activeFile) return false;
    return globMatch(rule.scope, activeFile);
  });

  if (applicable.length === 0) return '';

  const globalRules = applicable.filter(r => r.source === 'global');
  const projectRules = applicable.filter(r => r.source === 'project');

  const parts: string[] = [];

  if (globalRules.length > 0) {
    parts.push(globalRules.map(r => r.content).join('\n\n'));
  }
  if (projectRules.length > 0) {
    parts.push(projectRules.map(r => r.content).join('\n\n'));
  }

  return parts.join('\n\n');
}

// ============================================================================
// HELPERS
// ============================================================================

function getHomeDir(): string | undefined {
  return process.env.HOME || process.env.USERPROFILE;
}
