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
   * Handles create, update, and delete operations
   * 
   * FIXED: Properly handles file creation by creating file with content in one step
   */
  async applyPatches(patches: FilePatch[]): Promise<void> {
    if (patches.length === 0) {
      return;
    }

    // Process patches sequentially to ensure proper handling
    for (const patch of patches) {
      const uri = vscode.Uri.file(path.join(this.workspaceRoot, patch.path));

      switch (patch.action) {
        case 'create':
          await this.createFile(uri, patch.newContent || '');
          break;

        case 'update':
          await this.updateFile(uri, patch.newContent || '');
          break;

        case 'delete':
          await this.deleteFile(uri);
          break;

        default:
          throw new Error(`Unknown action: ${(patch as any).action}`);
      }
    }
  }

  /**
   * Create a new file with content
   * Uses fs.writeFile for reliable file creation
   */
  private async createFile(uri: vscode.Uri, content: string): Promise<void> {
    // Ensure parent directory exists
    const dirPath = path.dirname(uri.fsPath);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));

    // Write file content using VS Code's fs API
    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(uri, encoder.encode(content));

    // Open the file in editor
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Active,
        preserveFocus: true,
        preview: false,
      });
    } catch (openError) {
      console.warn(`[VSCodeWorkspaceWriter] Could not open newly created file: ${uri.fsPath}`, openError);
    }
  }

  /**
   * Update an existing file with new content
   * Opens the file, replaces all content, and saves
   */
  private async updateFile(uri: vscode.Uri, content: string): Promise<void> {
    try {
      // Try to open existing document
      const doc = await vscode.workspace.openTextDocument(uri);
      
      // Create edit to replace entire content
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        new vscode.Position(0, 0),
        doc.lineAt(doc.lineCount - 1).range.end
      );
      edit.replace(uri, fullRange, content);
      
      // Apply the edit
      const success = await vscode.workspace.applyEdit(edit);
      if (!success) {
        throw new Error(`Failed to apply edit to ${uri.fsPath}`);
      }
      
      // Save the document
      if (doc.isDirty) {
        await doc.save();
      }
      
      // Show the document
      await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Active,
        preserveFocus: true,
        preview: false,
      });
    } catch (error) {
      // File might not exist - fall back to create
      console.warn(`[VSCodeWorkspaceWriter] File doesn't exist, creating: ${uri.fsPath}`);
      await this.createFile(uri, content);
    }
  }

  /**
   * Delete a file
   */
  private async deleteFile(uri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: true });
    } catch (error) {
      // File might not exist - that's OK
      console.warn(`[VSCodeWorkspaceWriter] Could not delete file (may not exist): ${uri.fsPath}`, error);
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
