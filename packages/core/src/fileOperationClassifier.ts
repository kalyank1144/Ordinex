/**
 * File Operation Classifier
 * 
 * Classifies file operations as create vs modify based on existence checks.
 * Ensures we don't try to modify non-existent files or blindly retry.
 */

import * as path from 'path';
import * as fs from 'fs';

/**
 * File operation classification result
 */
export interface FileOperationClass {
  /** Absolute path to the file */
  absolutePath: string;
  
  /** Relative path from workspace root */
  relativePath: string;
  
  /** Does the file currently exist? */
  exists: boolean;
  
  /** Classified operation type */
  operation: 'create' | 'modify';
  
  /** Parent directory exists? */
  parentDirExists: boolean;
  
  /** Additional context */
  context: {
    /** Is this path under the workspace root? */
    isUnderWorkspace: boolean;
    
    /** File size if exists (bytes) */
    sizeBytes?: number;
    
    /** Last modified time if exists */
    lastModified?: Date;
  };
}

/**
 * Classify a file operation based on existence
 * 
 * @param workspaceRoot - Absolute path to workspace root
 * @param relativePath - Relative path from workspace root
 * @returns Classification result
 */
export function classifyFileOperation(
  workspaceRoot: string,
  relativePath: string
): FileOperationClass {
  const absolutePath = path.resolve(workspaceRoot, relativePath);
  const parentDir = path.dirname(absolutePath);
  
  // Check if path is under workspace (security check)
  const isUnderWorkspace = absolutePath.startsWith(workspaceRoot);
  
  // Check if file exists
  let exists = false;
  let sizeBytes: number | undefined;
  let lastModified: Date | undefined;
  
  try {
    const stats = fs.statSync(absolutePath);
    if (stats.isFile()) {
      exists = true;
      sizeBytes = stats.size;
      lastModified = stats.mtime;
    }
  } catch (error) {
    // File doesn't exist or not accessible
    exists = false;
  }
  
  // Check if parent directory exists
  let parentDirExists = false;
  try {
    const parentStats = fs.statSync(parentDir);
    parentDirExists = parentStats.isDirectory();
  } catch (error) {
    parentDirExists = false;
  }
  
  // Classify operation
  const operation: 'create' | 'modify' = exists ? 'modify' : 'create';
  
  return {
    absolutePath,
    relativePath,
    exists,
    operation,
    parentDirExists,
    context: {
      isUnderWorkspace,
      sizeBytes,
      lastModified
    }
  };
}

/**
 * Classify multiple file operations in batch
 */
export function classifyFileOperations(
  workspaceRoot: string,
  relativePaths: string[]
): FileOperationClass[] {
  return relativePaths.map(relPath => 
    classifyFileOperation(workspaceRoot, relPath)
  );
}

/**
 * Validate file operations before execution
 * Returns issues that would prevent safe execution
 */
export interface FileOperationIssue {
  path: string;
  severity: 'error' | 'warning';
  code: 'path_outside_workspace' | 'parent_dir_missing' | 'permission_denied' | 'path_traversal';
  message: string;
  suggestion?: string;
}

export function validateFileOperations(
  workspaceRoot: string,
  relativePaths: string[]
): FileOperationIssue[] {
  const issues: FileOperationIssue[] = [];
  
  for (const relPath of relativePaths) {
    // Check for path traversal attempts
    if (relPath.includes('..')) {
      issues.push({
        path: relPath,
        severity: 'error',
        code: 'path_traversal',
        message: `Path contains '..' (potential path traversal): ${relPath}`,
        suggestion: 'Use paths relative to workspace root without parent directory references'
      });
      continue;
    }
    
    const classification = classifyFileOperation(workspaceRoot, relPath);
    
    // Check if path is outside workspace
    if (!classification.context.isUnderWorkspace) {
      issues.push({
        path: relPath,
        severity: 'error',
        code: 'path_outside_workspace',
        message: `Path resolves outside workspace root: ${classification.absolutePath}`,
        suggestion: `Ensure path is relative to ${workspaceRoot}`
      });
      continue;
    }
    
    // Check if parent directory exists (for creates)
    if (classification.operation === 'create' && !classification.parentDirExists) {
      issues.push({
        path: relPath,
        severity: 'warning',
        code: 'parent_dir_missing',
        message: `Parent directory does not exist: ${path.dirname(classification.absolutePath)}`,
        suggestion: 'Parent directories will be created automatically'
      });
    }
    
    // ROBUST permission check - test actual write capability
    try {
      if (classification.exists) {
        // File exists - check if we can write to it
        fs.accessSync(classification.absolutePath, fs.constants.W_OK);
      } else {
        // File doesn't exist - check parent directory write permission
        const parentDir = path.dirname(classification.absolutePath);
        
        // First check if parent exists and is writable
        fs.accessSync(parentDir, fs.constants.W_OK);
        
        // CRITICAL: Test actual write capability with a temp file
        // This catches cases where fs.access passes but write still fails
        const testFile = path.join(parentDir, `.ordinex-write-test-${Date.now()}`);
        try {
          fs.writeFileSync(testFile, '', { flag: 'wx' }); // wx = fail if exists
          fs.unlinkSync(testFile); // Clean up immediately
        } catch (writeError: any) {
          // Actual write failed even though access check passed
          throw new Error(`Write test failed: ${writeError.code || writeError.message}`);
        }
      }
    } catch (error: any) {
      const errorCode = error.code || 'UNKNOWN';
      const errorMsg = error.message || 'Unknown error';
      
      // Distinguish between "directory doesn't exist" vs "no permission"
      if (errorCode === 'ENOENT') {
        // Parent directory doesn't exist - this is NOT a permission error
        // The system should auto-create parent directories, so this is just a warning
        issues.push({
          path: relPath,
          severity: 'warning',
          code: 'parent_dir_missing',
          message: `Parent directory will be created: ${path.dirname(classification.absolutePath)}`,
          suggestion: 'Parent directories will be created automatically during file operation'
        });
      } else {
        // Actual permission error (EACCES, EPERM, etc.)
        issues.push({
          path: relPath,
          severity: 'error',
          code: 'permission_denied',
          message: `No write permission for: ${classification.absolutePath} (${errorCode}: ${errorMsg})`,
          suggestion: `Check directory permissions for ${path.dirname(classification.absolutePath)} and ensure you have write access. You may need to change permissions or select a different workspace.`
        });
      }
    }
  }
  
  return issues;
}

/**
 * Generate safe file patches with proper operation classification
 * 
 * @param workspaceRoot - Absolute path to workspace root
 * @param files - Files to generate patches for
 * @returns Array of patches with correct create/modify operations
 */
export function generateSafePatches(
  workspaceRoot: string,
  files: Array<{ path: string; content: string }>
): Array<{
  path: string;
  operation: 'create' | 'modify';
  content: string;
  existed: boolean;
}> {
  return files.map(file => {
    const classification = classifyFileOperation(workspaceRoot, file.path);
    
    return {
      path: file.path,
      operation: classification.operation,
      content: file.content,
      existed: classification.exists
    };
  });
}
