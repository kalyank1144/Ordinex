/**
 * Plan Context Collector
 * Collects read-only project context for PLAN mode
 * 
 * Differences from ANSWER mode:
 * - Slightly broader scope (more files, deeper tree)
 * - Includes stack inference
 * - No tool execution or file modification
 * 
 * PLAN mode = thinking + proposing, not doing
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ReferenceTokens } from './types';
import { buildCompactSummary } from './vision/referenceContextSummary';

export interface PlanContextBundle {
  project_summary: string;
  files: Array<{
    path: string;
    excerpt: string;
  }>;
  open_files: Array<{
    path: string;
    excerpt: string;
  }>;
  inferred_stack: string[];
  file_tree: string;
  total_files_scanned: number;
  total_lines_included: number;
}

export interface PlanContextCollectionOptions {
  workspaceRoot: string;
  openFiles?: Array<{ path: string; content?: string }>;
  maxFileLines?: number;
  maxTreeDepth?: number;
  maxFilesToInclude?: number;
}

/**
 * Collect read-only context for PLAN mode
 * Broader than ANSWER mode but still read-only
 */
export async function collectPlanContext(
  options: PlanContextCollectionOptions
): Promise<PlanContextBundle> {
  const {
    workspaceRoot,
    openFiles = [],
    maxFileLines = 300,  // Slightly more than ANSWER mode
    maxTreeDepth = 3,     // Deeper than ANSWER mode
    maxFilesToInclude = 10
  } = options;

  const files: Array<{ path: string; excerpt: string }> = [];
  const inferredStack: string[] = [];
  let projectSummary = 'No project information available.';
  let totalLines = 0;

  // 1. Read package.json (high priority)
  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const content = fs.readFileSync(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content);
      
      const lines = content.split('\n');
      const excerpt = lines.slice(0, Math.min(maxFileLines, lines.length)).join('\n');
      totalLines += Math.min(maxFileLines, lines.length);
      
      files.push({
        path: 'package.json',
        excerpt
      });

      // Infer stack from package.json
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.react) inferredStack.push('React');
      if (deps.vue) inferredStack.push('Vue');
      if (deps.angular) inferredStack.push('Angular');
      if (deps.express) inferredStack.push('Express');
      if (deps.typescript) inferredStack.push('TypeScript');
      if (deps.webpack) inferredStack.push('Webpack');
      if (deps.vite) inferredStack.push('Vite');
      if (deps.next) inferredStack.push('Next.js');
      if (deps.nuxt) inferredStack.push('Nuxt');
      if (deps['@types/node']) inferredStack.push('Node.js');
      
      projectSummary = `Project: ${pkg.name || 'Unknown'}\n`;
      if (pkg.description) projectSummary += `Description: ${pkg.description}\n`;
      if (inferredStack.length > 0) projectSummary += `Stack: ${inferredStack.join(', ')}`;
    } catch (error) {
      console.warn('Failed to read package.json:', error);
    }
  }

  // 2. Read README.md (high priority)
  const readmePath = path.join(workspaceRoot, 'README.md');
  if (fs.existsSync(readmePath)) {
    try {
      const content = fs.readFileSync(readmePath, 'utf-8');
      const lines = content.split('\n');
      const excerpt = lines.slice(0, Math.min(maxFileLines, lines.length)).join('\n');
      totalLines += Math.min(maxFileLines, lines.length);
      
      files.push({
        path: 'README.md',
        excerpt
      });
    } catch (error) {
      console.warn('Failed to read README.md:', error);
    }
  }

  // 3. Read tsconfig.json or other config files if present
  const configFiles = ['tsconfig.json', 'vite.config.ts', 'webpack.config.js', '.eslintrc.json'];
  for (const configFile of configFiles) {
    if (files.length >= maxFilesToInclude) break;
    
    const configPath = path.join(workspaceRoot, configFile);
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        const lines = content.split('\n');
        const excerpt = lines.slice(0, Math.min(100, lines.length)).join('\n'); // Less lines for config
        totalLines += Math.min(100, lines.length);
        
        files.push({
          path: configFile,
          excerpt
        });
      } catch (error) {
        console.warn(`Failed to read ${configFile}:`, error);
      }
    }
  }

  // 4. Build file tree (deeper than ANSWER mode)
  const fileTree = buildFileTree(workspaceRoot, maxTreeDepth) || '(file tree unavailable)';

  // 5. Process open files
  const openFileExcerpts = openFiles.slice(0, maxFilesToInclude).map(file => {
    const content = file.content || '';
    const lines = content.split('\n');
    const excerpt = lines.slice(0, Math.min(maxFileLines, lines.length)).join('\n');
    totalLines += Math.min(maxFileLines, lines.length);
    
    return {
      path: file.path,
      excerpt: excerpt || '(content not available)'
    };
  });

  return {
    project_summary: projectSummary,
    files,
    open_files: openFileExcerpts,
    inferred_stack: inferredStack,
    file_tree: fileTree,
    total_files_scanned: files.length + openFileExcerpts.length,
    total_lines_included: totalLines
  };
}

/**
 * Build a file tree representation up to specified depth
 */
function buildFileTree(rootPath: string, maxDepth: number): string | null {
  try {
    const tree: string[] = [];
    
    function traverse(currentPath: string, depth: number, prefix: string = '') {
      if (depth > maxDepth) return;
      
      const items = fs.readdirSync(currentPath);
      const filtered = items.filter(item => {
        // Skip common ignore patterns
        if (item.startsWith('.') && item !== '.gitignore') return false;
        if (item === 'node_modules') return false;
        if (item === 'dist') return false;
        if (item === 'build') return false;
        if (item === 'out') return false;
        if (item === 'coverage') return false;
        if (item === '__pycache__') return false;
        if (item === '.next') return false;
        if (item === '.nuxt') return false;
        return true;
      });

      filtered.forEach((item, index) => {
        const isLast = index === filtered.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const itemPath = path.join(currentPath, item);
        
        try {
          const stats = fs.statSync(itemPath);
          
          if (stats.isDirectory()) {
            tree.push(`${prefix}${connector}${item}/`);
            const newPrefix = prefix + (isLast ? '    ' : '│   ');
            traverse(itemPath, depth + 1, newPrefix);
          } else {
            tree.push(`${prefix}${connector}${item}`);
          }
        } catch (error) {
          // Skip items we can't access
        }
      });
    }

    tree.push(path.basename(rootPath) + '/');
    traverse(rootPath, 0);
    
    return tree.join('\n');
  } catch (error) {
    console.warn('Failed to build file tree:', error);
    return null;
  }
}

/**
 * Build system message with project context for PLAN mode
 */
export function buildPlanModeSystemMessage(context: PlanContextBundle): string {
  const parts: string[] = [];

  parts.push('# PLAN MODE - Project-Aware Planning');
  parts.push('');
  parts.push('You are analyzing a REAL, EXISTING codebase and creating a plan specific to THIS project.');
  parts.push('');
  parts.push('⚠️ CRITICAL INSTRUCTIONS - READ CAREFULLY ⚠️');
  parts.push('');
  parts.push('YOUR PLAN MUST BE PROJECT-SPECIFIC:');
  parts.push('1. READ the project context below carefully - this is the ACTUAL project you are planning for');
  parts.push('2. ANALYZE the real files, technologies, and structure shown below');
  parts.push('3. REFERENCE specific files, packages, directories, and components from the context in your plan');
  parts.push('4. PROPOSE features/changes based on what you ACTUALLY see in the codebase');
  parts.push('5. If the user\'s request is vague, first analyze the codebase then suggest specific improvements');
  parts.push('');
  parts.push('🚫 STRICTLY FORBIDDEN:');
  parts.push('- Generic plans that could apply to any project');
  parts.push('- Making assumptions not supported by the project context');
  parts.push('- Suggesting features without analyzing what already exists');
  parts.push('- Ignoring the actual project structure and files provided');
  parts.push('- Proposing edits or commands (PLAN mode = analysis + proposal only)');
  parts.push('');
  parts.push('✅ REQUIRED IN EVERY PLAN:');
  parts.push('- Specific file paths from the project context');
  parts.push('- Specific package names from dependencies');
  parts.push('- Specific existing components/modules to work with');
  parts.push('- Analysis of CURRENT state before proposing changes');
  parts.push('- Next steps that reference actual project structure');
  parts.push('');
  parts.push('📋 EXAMPLE OF GOOD vs BAD:');
  parts.push('❌ BAD: "Add user authentication to improve security"');
  parts.push('✅ GOOD: "Add user authentication to src/components/Login.tsx using the existing AuthContext in src/contexts/AuthContext.tsx"');
  parts.push('');
  parts.push('❌ BAD: "Implement new features that align with project goals"');
  parts.push('✅ GOOD: "Extend the WorkoutManager component (src/components/WorkoutManager.tsx) with exercise tracking by adding a new ExerciseLog component"');
  parts.push('');
  parts.push('OUTPUT FORMAT (MANDATORY):');
  parts.push('You must output ONLY valid JSON matching this exact schema:');
  parts.push('{');
  parts.push('  "goal": string,');
  parts.push('  "assumptions": string[],');
  parts.push('  "success_criteria": string[],');
  parts.push('  "scope_contract": {');
  parts.push('    "max_files": number,');
  parts.push('    "max_lines": number,');
  parts.push('    "allowed_tools": string[]');
  parts.push('  },');
  parts.push('  "steps": Array<{');
  parts.push('    "id": string,');
  parts.push('    "description": string,');
  parts.push('    "expected_evidence": string[]');
  parts.push('  }>,');
  parts.push('  "risks": string[],');
  parts.push('  "planMeta": {                         // REQUIRED - Plan complexity metadata');
  parts.push('    "estimatedFileTouch": number,       // Estimated files this plan will modify');
  parts.push('    "estimatedDevHours": number,        // Estimated hours for senior developer');
  parts.push('    "riskAreas": string[],              // e.g. ["auth", "migration", "payments"]');
  parts.push('    "domains": string[],                // e.g. ["web", "mobile", "backend", "database"]');
  parts.push('    "confidence": "low" | "medium" | "high"  // Your confidence in scope accuracy');
  parts.push('  }');
  parts.push('}');
  parts.push('');
  parts.push('PLANMETA GUIDANCE:');
  parts.push('- estimatedFileTouch: Count files that will be created OR modified');
  parts.push('- estimatedDevHours: Be realistic; complex auth = 8-16hrs, simple UI = 1-4hrs');
  parts.push('- riskAreas: Include "auth", "payments", "migration", "security" if applicable');
  parts.push('- domains: List all areas this plan touches (web, mobile, backend, database, infra)');
  parts.push('- confidence: Use "low" if scope is unclear or plan may need breaking down');
  parts.push('');
  parts.push('---');
  parts.push('');

  // Project summary
  if (context.project_summary) {
    parts.push('## Project Summary');
    parts.push(context.project_summary);
    parts.push('');
  }

  // Stack
  if (context.inferred_stack.length > 0) {
    parts.push('## Technology Stack');
    parts.push(context.inferred_stack.join(', '));
    parts.push('');
  }

  // File tree
  if (context.file_tree) {
    parts.push('## Project Structure');
    parts.push('```');
    parts.push(context.file_tree);
    parts.push('```');
    parts.push('');
  }

  // Key files
  if (context.files.length > 0) {
    parts.push('## Key Files');
    context.files.forEach(file => {
      parts.push(`### ${file.path}`);
      parts.push('```');
      parts.push(file.excerpt);
      parts.push('```');
      parts.push('');
    });
  }

  // Open files
  if (context.open_files.length > 0) {
    parts.push('## Currently Open Files');
    context.open_files.forEach(file => {
      parts.push(`### ${file.path}`);
      parts.push('```');
      parts.push(file.excerpt);
      parts.push('```');
      parts.push('');
    });
  }

  parts.push('---');
  parts.push('');
  parts.push('Now generate the plan in JSON format for the user\'s request.');

  return parts.join('\n');
}

// ============================================================================
// STEP 38: REFERENCE TOKENS INTEGRATION FOR PLAN MODE
// ============================================================================

/**
 * Extended plan context bundle with reference tokens (Step 38)
 */
export interface PlanContextBundleWithTokens extends PlanContextBundle {
  /** Reference style tokens from vision analysis */
  referenceTokens?: ReferenceTokens;
  /** Reference tokens summary (compact string) */
  referenceStyleSummary?: string;
}

/**
 * Extended options with reference tokens support (Step 38)
 */
export interface PlanContextCollectionOptionsWithTokens extends PlanContextCollectionOptions {
  /** Reference tokens from vision analysis */
  referenceTokens?: ReferenceTokens;
}

/**
 * Collect plan context with optional reference tokens (Step 38)
 * 
 * @param options - Collection options with optional reference tokens
 * @returns Extended context bundle with reference info
 */
export async function collectPlanContextWithTokens(
  options: PlanContextCollectionOptionsWithTokens
): Promise<PlanContextBundleWithTokens> {
  // Collect base context
  const baseContext = await collectPlanContext(options);
  
  // If no reference tokens, return base context
  if (!options.referenceTokens) {
    return baseContext;
  }
  
  // Build compact summary from tokens
  const referenceStyleSummary = buildCompactSummary(options.referenceTokens);
  
  return {
    ...baseContext,
    referenceTokens: options.referenceTokens,
    referenceStyleSummary,
  };
}

/**
 * Build system message with reference style hints (Step 38)
 * 
 * Includes a "Reference Style Hints" section if tokens are present.
 * ~120 chars, moods + primary/accent + confidence only.
 * NEVER includes raw images or huge text.
 * 
 * @param context - Extended context bundle with reference tokens
 * @returns System message string
 */
export function buildPlanModeSystemMessageWithTokens(context: PlanContextBundleWithTokens): string {
  const parts: string[] = [];

  parts.push('# PLAN MODE - Project-Aware Planning');
  parts.push('');
  parts.push('You are analyzing a REAL, EXISTING codebase and creating a plan specific to THIS project.');
  parts.push('');
  
  // Step 38: Add reference style hints if present
  if (context.referenceStyleSummary) {
    parts.push('## 🎨 Reference Style Hints');
    parts.push('');
    parts.push('The user has provided visual references to guide the design direction:');
    parts.push('');
    parts.push(`**${context.referenceStyleSummary}**`);
    parts.push('');
    parts.push('Consider these style hints when proposing UI/design-related aspects of your plan.');
    parts.push('');
    parts.push('---');
    parts.push('');
  }
  
  parts.push('⚠️ CRITICAL INSTRUCTIONS - READ CAREFULLY ⚠️');
  parts.push('');
  parts.push('YOUR PLAN MUST BE PROJECT-SPECIFIC:');
  parts.push('1. READ the project context below carefully - this is the ACTUAL project you are planning for');
  parts.push('2. ANALYZE the real files, technologies, and structure shown below');
  parts.push('3. REFERENCE specific files, packages, directories, and components from the context in your plan');
  parts.push('4. PROPOSE features/changes based on what you ACTUALLY see in the codebase');
  parts.push('5. If the user\'s request is vague, first analyze the codebase then suggest specific improvements');
  if (context.referenceStyleSummary) {
    parts.push('6. For UI/design tasks, align with the reference style hints provided above');
  }
  parts.push('');
  parts.push('🚫 STRICTLY FORBIDDEN:');
  parts.push('- Generic plans that could apply to any project');
  parts.push('- Making assumptions not supported by the project context');
  parts.push('- Suggesting features without analyzing what already exists');
  parts.push('- Ignoring the actual project structure and files provided');
  parts.push('- Proposing edits or commands (PLAN mode = analysis + proposal only)');
  parts.push('');
  parts.push('✅ REQUIRED IN EVERY PLAN:');
  parts.push('- Specific file paths from the project context');
  parts.push('- Specific package names from dependencies');
  parts.push('- Specific existing components/modules to work with');
  parts.push('- Analysis of CURRENT state before proposing changes');
  parts.push('- Next steps that reference actual project structure');
  parts.push('');
  parts.push('📋 EXAMPLE OF GOOD vs BAD:');
  parts.push('❌ BAD: "Add user authentication to improve security"');
  parts.push('✅ GOOD: "Add user authentication to src/components/Login.tsx using the existing AuthContext in src/contexts/AuthContext.tsx"');
  parts.push('');
  parts.push('❌ BAD: "Implement new features that align with project goals"');
  parts.push('✅ GOOD: "Extend the WorkoutManager component (src/components/WorkoutManager.tsx) with exercise tracking by adding a new ExerciseLog component"');
  parts.push('');
  parts.push('OUTPUT FORMAT (MANDATORY):');
  parts.push('You must output ONLY valid JSON matching this exact schema:');
  parts.push('{');
  parts.push('  "goal": string,');
  parts.push('  "assumptions": string[],');
  parts.push('  "success_criteria": string[],');
  parts.push('  "scope_contract": {');
  parts.push('    "max_files": number,');
  parts.push('    "max_lines": number,');
  parts.push('    "allowed_tools": string[]');
  parts.push('  },');
  parts.push('  "steps": Array<{');
  parts.push('    "id": string,');
  parts.push('    "description": string,');
  parts.push('    "expected_evidence": string[]');
  parts.push('  }>,');
  parts.push('  "risks": string[],');
  parts.push('  "planMeta": {                         // REQUIRED - Plan complexity metadata');
  parts.push('    "estimatedFileTouch": number,       // Estimated files this plan will modify');
  parts.push('    "estimatedDevHours": number,        // Estimated hours for senior developer');
  parts.push('    "riskAreas": string[],              // e.g. ["auth", "migration", "payments"]');
  parts.push('    "domains": string[],                // e.g. ["web", "mobile", "backend", "database"]');
  parts.push('    "confidence": "low" | "medium" | "high"  // Your confidence in scope accuracy');
  parts.push('  }');
  parts.push('}');
  parts.push('');
  parts.push('PLANMETA GUIDANCE:');
  parts.push('- estimatedFileTouch: Count files that will be created OR modified');
  parts.push('- estimatedDevHours: Be realistic; complex auth = 8-16hrs, simple UI = 1-4hrs');
  parts.push('- riskAreas: Include "auth", "payments", "migration", "security" if applicable');
  parts.push('- domains: List all areas this plan touches (web, mobile, backend, database, infra)');
  parts.push('- confidence: Use "low" if scope is unclear or plan may need breaking down');
  parts.push('');
  parts.push('---');
  parts.push('');

  // Project summary
  if (context.project_summary) {
    parts.push('## Project Summary');
    parts.push(context.project_summary);
    parts.push('');
  }

  // Stack
  if (context.inferred_stack.length > 0) {
    parts.push('## Technology Stack');
    parts.push(context.inferred_stack.join(', '));
    parts.push('');
  }

  // File tree
  if (context.file_tree) {
    parts.push('## Project Structure');
    parts.push('```');
    parts.push(context.file_tree);
    parts.push('```');
    parts.push('');
  }

  // Key files
  if (context.files.length > 0) {
    parts.push('## Key Files');
    context.files.forEach(file => {
      parts.push(`### ${file.path}`);
      parts.push('```');
      parts.push(file.excerpt);
      parts.push('```');
      parts.push('');
    });
  }

  // Open files
  if (context.open_files.length > 0) {
    parts.push('## Currently Open Files');
    context.open_files.forEach(file => {
      parts.push(`### ${file.path}`);
      parts.push('```');
      parts.push(file.excerpt);
      parts.push('```');
      parts.push('');
    });
  }

  parts.push('---');
  parts.push('');
  parts.push('Now generate the plan in JSON format for the user\'s request.');

  return parts.join('\n');
}

/**
 * Build a quick action style hint string from reference tokens
 * ~120 chars max for injection into QUICK_ACTION prompts
 * 
 * @param tokens - Reference tokens from vision analysis
 * @returns Compact style hint string
 */
export function buildQuickActionStyleHint(tokens: ReferenceTokens): string {
  return buildCompactSummary(tokens);
}
