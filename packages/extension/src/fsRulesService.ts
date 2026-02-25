/**
 * FsRulesService — File system implementation of RulesService.
 *
 * Reads rule files from .ordinex/rules/*.md (project) and
 * ~/.ordinex/rules.md (global). Used by Layer 1 of the memory system.
 */

import { promises as fsp } from 'fs';
import type { RulesService } from 'core';

export class FsRulesService implements RulesService {
  async readDir(dirPath: string): Promise<string[]> {
    try {
      return await fsp.readdir(dirPath);
    } catch {
      return [];
    }
  }

  async readFile(filePath: string): Promise<string | null> {
    try {
      return await fsp.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fsp.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
