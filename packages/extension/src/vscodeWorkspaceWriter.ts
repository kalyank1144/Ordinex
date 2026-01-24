/**
 * VS Code WorkspaceWriter Implementation
 * 
 * Implements WorkspaceWriter interface using VS Code APIs
 * Handles real file operations: create, update, delete
 */

import * as vscode from 'vscode';
import * as path from 'path';

// Inline types from core/workspaceAdapter to avoid cross-package import issues
interface FilePatch {
  path: string;
  action: 'create' | 'update' | 'delete';
  newContent?: string;
  baseSha?: string | null;
}

interface WorkspaceWriter {
  applyPatches(patches: FilePatch[]): Promise<void>;
  openFilesBeside(paths: string[]): Promise<void>;
}

export class VSCodeWorkspaceWriter implements WorkspaceWriter {
  constructor(private readonly workspaceRoot: string) {}

  /**
   * Apply file patches to workspace using VS Code APIs
   * This method is ATOMIC: either all succeed or all fail
   */
  async applyPatches(patches: FilePatch[]): Promise<void> {
    if (patches.length === 0) {
      return;
    }

    // Build WorkspaceEdit
    const edit = new vscode.WorkspaceEdit();

    for (const patch of patches) {
      const uri = vscode.Uri.file(path.join(this.workspaceRoot, patch.path));

      switch (patch.action) {
        case 'create':
        case 'update':
          if (!patch.newContent) {
            throw new Error(`newContent required for ${patch.action} on ${patch.path}`);
          }
          
          // For create: create file if doesn't exist, then replace content
          // For update: just replace content
          edit.createFile(uri, { 
            overwrite: patch.action === 'update',
            ignoreIfExists: patch.action === 'update'
          });
          
          // Replace entire file content
          const fullRange = new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(Number.MAX_SAFE_INTEGER, 0)
          );
          edit.replace(uri, fullRange, patch.newContent);
          break;

        case 'delete':
          edit.deleteFile(uri, { 
            ignoreIfNotExists: true,
            recursive: false
          });
          break;

        default:
          throw new Error(`Unknown action: ${(patch as any).action}`);
      }
    }

    // Apply edit atomically
    const success = await vscode.workspace.applyEdit(edit);
    
    if (!success) {
      throw new Error('Failed to apply workspace edit');
    }

    // Save all affected documents
    for (const patch of patches) {
      if (patch.action !== 'delete') {
        const uri = vscode.Uri.file(path.join(this.workspaceRoot, patch.path));
        const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
        if (doc && doc.isDirty) {
          await doc.save();
        }
      }
    }
  }

  /**
   * Open files in editor beside current view
   * Opens with preserveFocus so user sees changes without losing focus
   */
  async openFilesBeside(paths: string[]): Promise<void> {
    if (paths.length === 0) {
      return;
    }

    for (const filePath of paths) {
      const uri = vscode.Uri.file(path.join(this.workspaceRoot, filePath));
      
      try {
        await vscode.window.showTextDocument(uri, {
          viewColumn: vscode.ViewColumn.Beside,
          preserveFocus: true,
          preview: false,
        });
      } catch (error) {
        console.warn(`[VSCodeWorkspaceWriter] Could not open ${filePath}:`, error);
        // Non-fatal - continue
      }
    }
  }
}
