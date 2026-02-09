/**
 * V6: FsToolRegistryService - File System Implementation of ToolRegistryService
 *
 * All FS operations for generated tools live here (not in core).
 *
 * Storage layout:
 *   .ordinex/tools/generated/
 *     registry.json          ← approved tool metadata (source of truth)
 *     <name>.js              ← individual tool code files
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ToolRegistryService, ToolRegistry, ToolEntry, ToolMetadata } from 'core';

export class FsToolRegistryService implements ToolRegistryService {
  private readonly registryPath: string;
  private readonly toolsDir: string;
  private initialized = false;

  constructor(generatedToolsRoot: string) {
    this.toolsDir = generatedToolsRoot;
    this.registryPath = path.join(generatedToolsRoot, 'registry.json');
  }

  private ensureDirs(): void {
    if (this.initialized) return;
    fs.mkdirSync(this.toolsDir, { recursive: true });
    this.initialized = true;
  }

  async saveTool(name: string, code: string, metadata: ToolMetadata): Promise<void> {
    this.ensureDirs();

    // Write code file
    const codePath = path.join(this.toolsDir, `${name}.js`);
    fs.writeFileSync(codePath, code, 'utf-8');

    // Compute SHA-256 hash of the code
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    // Build tool entry
    const entry: ToolEntry = {
      name,
      description: metadata.description,
      code_hash: codeHash,
      inputs_schema: metadata.inputs_schema,
      outputs_schema: metadata.outputs_schema,
      allow: metadata.allow,
      created_at: new Date().toISOString(),
    };

    // Load existing registry and upsert
    const registry = await this.loadRegistry();
    const existingIndex = registry.tools.findIndex(t => t.name === name);
    if (existingIndex >= 0) {
      registry.tools[existingIndex] = entry;
    } else {
      registry.tools.push(entry);
    }

    fs.writeFileSync(this.registryPath, JSON.stringify(registry, null, 2), 'utf-8');
  }

  async loadRegistry(): Promise<ToolRegistry> {
    try {
      const content = fs.readFileSync(this.registryPath, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed && parsed.version === 1 && Array.isArray(parsed.tools)) {
        return parsed as ToolRegistry;
      }
      return { version: 1, tools: [] };
    } catch {
      return { version: 1, tools: [] };
    }
  }

  async getTool(name: string): Promise<ToolEntry | null> {
    const registry = await this.loadRegistry();
    return registry.tools.find(t => t.name === name) ?? null;
  }

  async deleteTool(name: string): Promise<void> {
    this.ensureDirs();

    // Remove code file
    const codePath = path.join(this.toolsDir, `${name}.js`);
    try {
      fs.unlinkSync(codePath);
    } catch {
      // File may not exist — ignore
    }

    // Remove from registry
    const registry = await this.loadRegistry();
    registry.tools = registry.tools.filter(t => t.name !== name);
    fs.writeFileSync(this.registryPath, JSON.stringify(registry, null, 2), 'utf-8');
  }

  async loadToolCode(name: string): Promise<string | null> {
    try {
      const codePath = path.join(this.toolsDir, `${name}.js`);
      return fs.readFileSync(codePath, 'utf-8');
    } catch {
      return null;
    }
  }
}
