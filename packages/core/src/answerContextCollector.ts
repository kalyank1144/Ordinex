/**
 * Answer Context Collector
 * Collects read-only project context for ANSWER mode
 * 
 * Features:
 * - No tools allowed
 * - No file modifications
 * - Only reads project structure and metadata
 */

import * as fs from 'fs';
import * as path from 'path';

export interface AnswerContextBundle {
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
}

export interface ContextCollectionOptions {
  workspaceRoot: string;
  openFiles?: Array<{ path: string; content?: string }>;
  maxFileLines?: number;
  maxTreeDepth?: number;
}

/**
 * Collect read-only context for ANSWER mode
 */
export async function collectAnswerContext(
  options: ContextCollectionOptions
): Promise<AnswerContextBundle> {
  const {
    workspaceRoot,
    openFiles = [],
    maxFileLines = 200,
    maxTreeDepth = 2
  } = options;

  const files: Array<{ path: string; excerpt: string }> = [];
  const inferredStack: string[] = [];
  let projectSummary = 'No project information available.';

  // 1. Try to read package.json
  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const content = fs.readFileSync(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content);
      
      files.push({
        path: 'package.json',
        excerpt: content.split('\n').slice(0, maxFileLines).join('\n')
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
      
      projectSummary = `Project: ${pkg.name || 'Unknown'}\n`;
      if (pkg.description) projectSummary += `Description: ${pkg.description}\n`;
      if (inferredStack.length > 0) projectSummary += `Stack: ${inferredStack.join(', ')}`;
    } catch (error) {
      console.warn('Failed to read package.json:', error);
    }
  }

  // 2. Try to read README.md
  const readmePath = path.join(workspaceRoot, 'README.md');
  if (fs.existsSync(readmePath)) {
    try {
      const content = fs.readFileSync(readmePath, 'utf-8');
      files.push({
        path: 'README.md',
        excerpt: content.split('\n').slice(0, maxFileLines).join('\n')
      });
    } catch (error) {
      console.warn('Failed to read README.md:', error);
    }
  }

  // 3. Get workspace root file tree (depth ≤ maxTreeDepth)
  const fileTree = buildFileTree(workspaceRoot, maxTreeDepth);
  if (fileTree) {
    files.push({
      path: '.file-tree',
      excerpt: fileTree
    });
  }

  // 4. Process open files
  const openFileExcerpts = openFiles.map(file => ({
    path: file.path,
    excerpt: file.content 
      ? file.content.split('\n').slice(0, maxFileLines).join('\n')
      : '(content not available)'
  }));

  return {
    project_summary: projectSummary,
    files,
    open_files: openFileExcerpts,
    inferred_stack: inferredStack
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
        if (item === '__pycache__') return false;
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
 * Build system message with project context
 */
export function buildAnswerModeSystemMessage(context: AnswerContextBundle): string {
  const parts: string[] = [];

  parts.push('You are answering questions about the following project.');
  parts.push('You MUST NOT suggest edits, tools, or any code changes.');
  parts.push('Answer using the provided context only.');
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
  const treeFile = context.files.find(f => f.path === '.file-tree');
  if (treeFile) {
    parts.push('## Project Structure');
    parts.push('```');
    parts.push(treeFile.excerpt);
    parts.push('```');
    parts.push('');
  }

  // Key files
  const keyFiles = context.files.filter(f => f.path !== '.file-tree');
  if (keyFiles.length > 0) {
    parts.push('## Key Files');
    keyFiles.forEach(file => {
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

  return parts.join('\n');
}
