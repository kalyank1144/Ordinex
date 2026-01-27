/**
 * Workspace Resolver
 * 
 * Determines the correct target workspace for file operations in multi-root scenarios.
 * Priority order:
 * 1. Previously selected workspace for this task
 * 2. Workspace containing active editor file
 * 3. Heuristic-based selection (prefer project roots, exclude Ordinex dev repo)
 * 4. User prompt if ambiguous
 */

import * as path from 'path';
import * as fs from 'fs';

/**
 * WorkspaceCandidate represents a potential target workspace
 */
export interface WorkspaceCandidate {
  /** Absolute path to workspace root */
  path: string;
  
  /** Name of the workspace folder */
  name: string;
  
  /** Score based on heuristics (higher = better candidate) */
  score: number;
  
  /** Reasons for this score */
  reasons: string[];
  
  /** Is this the Ordinex extension development repo? */
  isOrdinexRepo: boolean;
  
  /** Does it look like a project root? */
  hasProjectMarkers: boolean;
}

/**
 * Workspace selection result
 */
export interface WorkspaceSelection {
  /** Selected workspace path */
  path: string;
  
  /** Selection method used */
  method: 'stored' | 'active_editor' | 'heuristic' | 'user_prompt';
  
  /** Confidence level */
  confidence: 'high' | 'medium' | 'low';
  
  /** Reason for selection */
  reason: string;
}

/**
 * Score a workspace candidate based on heuristics
 */
export function scoreWorkspaceCandidate(workspacePath: string, workspaceName: string): WorkspaceCandidate {
  let score = 0;
  const reasons: string[] = [];
  let isOrdinexRepo = false;
  let hasProjectMarkers = false;

  try {
    // Check if this is the Ordinex extension repo
    const extensionManifestPath = path.join(workspacePath, 'packages', 'extension', 'package.json');
    const rootPackageJson = path.join(workspacePath, 'package.json');
    
    if (fs.existsSync(extensionManifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(extensionManifestPath, 'utf-8'));
      if (manifest.name === '@ordinex/extension' || manifest.name === 'ordinex-extension') {
        isOrdinexRepo = true;
        score -= 100; // Strong penalty
        reasons.push('❌ Detected as Ordinex dev repo (excluded)');
      }
    }
    
    // Check for pnpm-workspace.yaml + packages/ structure (monorepo pattern like Ordinex)
    if (fs.existsSync(path.join(workspacePath, 'pnpm-workspace.yaml')) && 
        fs.existsSync(path.join(workspacePath, 'packages'))) {
      // Check if it has core/extension/webview pattern
      const hasCorePackage = fs.existsSync(path.join(workspacePath, 'packages', 'core'));
      const hasExtensionPackage = fs.existsSync(path.join(workspacePath, 'packages', 'extension'));
      const hasWebviewPackage = fs.existsSync(path.join(workspacePath, 'packages', 'webview'));
      
      if (hasCorePackage && hasExtensionPackage && hasWebviewPackage) {
        isOrdinexRepo = true;
        score -= 100;
        reasons.push('❌ Matches Ordinex monorepo structure (excluded)');
      }
    }
    
    // Check root package.json name
    if (fs.existsSync(rootPackageJson) && !isOrdinexRepo) {
      const pkg = JSON.parse(fs.readFileSync(rootPackageJson, 'utf-8'));
      if (pkg.name?.toLowerCase().includes('ordinex')) {
        isOrdinexRepo = true;
        score -= 100;
        reasons.push('❌ Package name contains "ordinex" (excluded)');
      }
    }

    // If already identified as Ordinex repo, skip positive scoring
    if (isOrdinexRepo) {
      return {
        path: workspacePath,
        name: workspaceName,
        score,
        reasons,
        isOrdinexRepo: true,
        hasProjectMarkers: false
      };
    }

    // Check for project markers (positive signals)
    const projectMarkers = [
      { file: 'package.json', points: 10, label: 'Has package.json' },
      { file: 'src', points: 15, label: 'Has src/ directory' },
      { file: 'app', points: 15, label: 'Has app/ directory' },
      { file: 'tsconfig.json', points: 5, label: 'Has TypeScript config' },
      { file: 'vite.config.ts', points: 5, label: 'Has Vite config' },
      { file: 'next.config.js', points: 5, label: 'Has Next.js config' },
      { file: '.git', points: 5, label: 'Is a Git repository' },
      { file: 'README.md', points: 3, label: 'Has README' },
    ];

    for (const marker of projectMarkers) {
      if (fs.existsSync(path.join(workspacePath, marker.file))) {
        score += marker.points;
        reasons.push(`✓ ${marker.label} (+${marker.points})`);
        hasProjectMarkers = true;
      }
    }

    // Boost if src/ contains typical structure
    const srcPath = path.join(workspacePath, 'src');
    if (fs.existsSync(srcPath)) {
      const srcContents = fs.readdirSync(srcPath);
      const typicalDirs = ['components', 'pages', 'services', 'utils', 'api', 'server'];
      const foundDirs = srcContents.filter(item => typicalDirs.includes(item));
      
      if (foundDirs.length >= 2) {
        score += 10;
        reasons.push(`✓ src/ has typical project structure (+10)`);
      }
    }

  } catch (error) {
    // Ignore errors during scoring
    reasons.push(`⚠️ Error during analysis: ${error}`);
  }

  return {
    path: workspacePath,
    name: workspaceName,
    score,
    reasons,
    isOrdinexRepo,
    hasProjectMarkers
  };
}

/**
 * Resolve target workspace from multiple candidates
 * 
 * @param candidates - Available workspace folders
 * @param activeEditorPath - Path of currently active editor file (if any)
 * @param storedSelection - Previously stored selection for this task (if any)
 * @returns Workspace selection or null if user prompt needed
 */
export function resolveTargetWorkspace(
  candidates: Array<{ path: string; name: string }>,
  activeEditorPath?: string,
  storedSelection?: string
): WorkspaceSelection | null {
  // 1. Use stored selection if available
  if (storedSelection) {
    const match = candidates.find(c => c.path === storedSelection);
    if (match) {
      return {
        path: storedSelection,
        method: 'stored',
        confidence: 'high',
        reason: 'Using previously selected workspace for this task'
      };
    }
  }

  // 2. Use active editor's workspace if available
  if (activeEditorPath) {
    for (const candidate of candidates) {
      if (activeEditorPath.startsWith(candidate.path)) {
        return {
          path: candidate.path,
          method: 'active_editor',
          confidence: 'high',
          reason: `Active editor file is in this workspace`
        };
      }
    }
  }

  // 3. Score all candidates using heuristics
  const scored = candidates.map(c => 
    scoreWorkspaceCandidate(c.path, c.name)
  );

  // Filter out Ordinex repos
  const validCandidates = scored.filter(c => !c.isOrdinexRepo);

  if (validCandidates.length === 0) {
    // All candidates are Ordinex repos - this is an error state
    return null;
  }

  if (validCandidates.length === 1) {
    // Only one valid candidate
    const winner = validCandidates[0];
    return {
      path: winner.path,
      method: 'heuristic',
      confidence: winner.hasProjectMarkers ? 'high' : 'medium',
      reason: `Only valid workspace (score: ${winner.score}). ${winner.reasons.join(', ')}`
    };
  }

  // Multiple valid candidates - pick highest score
  validCandidates.sort((a, b) => b.score - a.score);
  const winner = validCandidates[0];
  const runnerUp = validCandidates[1];

  // Check if winner is clearly better
  const scoreDiff = winner.score - runnerUp.score;
  
  if (scoreDiff >= 15) {
    // Clear winner
    return {
      path: winner.path,
      method: 'heuristic',
      confidence: 'high',
      reason: `Best match (score: ${winner.score} vs ${runnerUp.score}). ${winner.reasons.slice(0, 3).join(', ')}`
    };
  } else if (scoreDiff >= 5) {
    // Moderate confidence
    return {
      path: winner.path,
      method: 'heuristic',
      confidence: 'medium',
      reason: `Likely match (score: ${winner.score} vs ${runnerUp.score}). ${winner.reasons.slice(0, 2).join(', ')}`
    };
  } else {
    // Too ambiguous - need user prompt
    return null;
  }
}

/**
 * Get user-friendly display info for workspace candidates
 * Used for disambiguation prompts
 */
export function getWorkspaceCandidateInfo(workspacePath: string, workspaceName: string): {
  displayName: string;
  details: string;
  scored: WorkspaceCandidate;
} {
  const scored = scoreWorkspaceCandidate(workspacePath, workspaceName);
  
  let details = '';
  if (scored.isOrdinexRepo) {
    details = '❌ Ordinex dev repo (not recommended)';
  } else if (scored.hasProjectMarkers) {
    details = `✓ Project workspace (score: ${scored.score})`;
  } else {
    details = `Empty or minimal workspace (score: ${scored.score})`;
  }

  return {
    displayName: workspaceName,
    details,
    scored
  };
}
