/**
 * FsEnhancedMemoryService — Enhanced file system memory service.
 *
 * Extends the existing FsMemoryService with Layer 2 capabilities:
 * - MEMORY.md with ID-based CRUD (replaces facts.md)
 * - Metadata sidecar (JSON) for reference tracking
 * - Automatic migration from facts.md to MEMORY.md
 * - Embedding sidecar support (Layer 5)
 *
 * Storage layout:
 *   .ordinex/memory/
 *     MEMORY.md              ← structured facts (replaces facts.md)
 *     memory-metadata.json   ← reference counts, timestamps
 *     embeddings.json        ← embedding vectors sidecar (Layer 5)
 *     facts.md               ← legacy (auto-migrated)
 *     solutions/             ← unchanged from original
 */

import * as path from 'path';
import { promises as fsp } from 'fs';
import type { MemoryDocument, MemoryMetadata, MemorySection, EmbeddingSidecar } from 'core';
import {
  parseMemoryDocument,
  serializeMemoryDocument,
  serializeMetadata,
  addFact,
  updateFact,
  removeFact,
  listFacts,
  migrateFromFactsMd,
  createEmptyDocument,
} from 'core';

export class FsEnhancedMemoryService {
  private readonly memoryMdPath: string;
  private readonly metadataPath: string;
  private readonly embeddingsPath: string;
  private readonly legacyFactsPath: string;
  private readonly memoryRoot: string;
  private initialized = false;
  private cachedDoc: MemoryDocument | null = null;

  constructor(memoryRoot: string) {
    this.memoryRoot = memoryRoot;
    this.memoryMdPath = path.join(memoryRoot, 'MEMORY.md');
    this.metadataPath = path.join(memoryRoot, 'memory-metadata.json');
    this.embeddingsPath = path.join(memoryRoot, 'embeddings.json');
    this.legacyFactsPath = path.join(memoryRoot, 'facts.md');
  }

  private async ensureDir(): Promise<void> {
    if (this.initialized) return;
    await fsp.mkdir(this.memoryRoot, { recursive: true });
    this.initialized = true;
  }

  // ========================================================================
  // MEMORY DOCUMENT (Layer 2)
  // ========================================================================

  /**
   * Load or initialize the memory document.
   * Auto-migrates from facts.md on first use.
   */
  async loadDocument(): Promise<MemoryDocument> {
    if (this.cachedDoc) return this.cachedDoc;
    await this.ensureDir();

    const memoryMdExists = await this.fileExists(this.memoryMdPath);

    if (memoryMdExists) {
      const raw = await fsp.readFile(this.memoryMdPath, 'utf-8');
      const metadata = await this.loadMetadata();
      this.cachedDoc = parseMemoryDocument(raw, metadata);
      return this.cachedDoc;
    }

    // Auto-migrate from legacy facts.md
    const legacyExists = await this.fileExists(this.legacyFactsPath);
    if (legacyExists) {
      const factsContent = await fsp.readFile(this.legacyFactsPath, 'utf-8');
      this.cachedDoc = migrateFromFactsMd(factsContent);
      await this.persistDocument(this.cachedDoc);
      console.log(`[Memory] Migrated ${this.cachedDoc.facts.length} facts from facts.md to MEMORY.md`);
      return this.cachedDoc;
    }

    this.cachedDoc = createEmptyDocument();
    return this.cachedDoc;
  }

  /**
   * Add a fact to the memory document and persist.
   */
  async addFact(section: MemorySection, content: string): Promise<string> {
    const doc = await this.loadDocument();
    const id = addFact(doc, section, content);
    await this.persistDocument(doc);
    return id;
  }

  /**
   * Update a fact and persist.
   */
  async updateFact(id: string, newContent: string): Promise<boolean> {
    const doc = await this.loadDocument();
    const result = updateFact(doc, id, newContent);
    if (result) await this.persistDocument(doc);
    return result;
  }

  /**
   * Remove a fact and persist.
   */
  async removeFact(id: string): Promise<boolean> {
    const doc = await this.loadDocument();
    const result = removeFact(doc, id);
    if (result) await this.persistDocument(doc);
    return result;
  }

  /**
   * List facts, optionally filtered by section.
   */
  async listFacts(section?: MemorySection): Promise<ReturnType<typeof listFacts>> {
    const doc = await this.loadDocument();
    return listFacts(doc, section);
  }

  /**
   * Get the full memory document content for context injection.
   */
  async getMemoryContext(maxLines: number = 200): Promise<string> {
    const doc = await this.loadDocument();
    const { getMemoryContext: getCtx } = await import('core');
    return getCtx(doc, maxLines);
  }

  // ========================================================================
  // PERSISTENCE
  // ========================================================================

  private async persistDocument(doc: MemoryDocument): Promise<void> {
    await this.ensureDir();
    const markdown = serializeMemoryDocument(doc);
    const metadata = serializeMetadata(doc);
    await Promise.all([
      fsp.writeFile(this.memoryMdPath, markdown, 'utf-8'),
      fsp.writeFile(this.metadataPath, JSON.stringify(metadata, null, 2), 'utf-8'),
    ]);
    this.cachedDoc = doc;
  }

  private async loadMetadata(): Promise<MemoryMetadata | undefined> {
    try {
      const content = await fsp.readFile(this.metadataPath, 'utf-8');
      return JSON.parse(content) as MemoryMetadata;
    } catch {
      return undefined;
    }
  }

  // ========================================================================
  // EMBEDDING SIDECAR (Layer 5)
  // ========================================================================

  async loadEmbeddingSidecar(): Promise<EmbeddingSidecar | null> {
    try {
      const content = await fsp.readFile(this.embeddingsPath, 'utf-8');
      return JSON.parse(content) as EmbeddingSidecar;
    } catch {
      return null;
    }
  }

  async saveEmbeddingSidecar(sidecar: EmbeddingSidecar): Promise<void> {
    await this.ensureDir();
    await fsp.writeFile(this.embeddingsPath, JSON.stringify(sidecar), 'utf-8');
  }

  // ========================================================================
  // COMPAT: Legacy MemoryService interface bridge
  // ========================================================================

  /**
   * Read facts as a plain string (backward compat with MemoryService).
   */
  async readFacts(): Promise<string> {
    const doc = await this.loadDocument();
    return serializeMemoryDocument(doc);
  }

  /**
   * Append facts (backward compat) — parses content and adds as general facts.
   */
  async appendFacts(lines: string): Promise<number> {
    const doc = await this.loadDocument();
    const newLines = lines.split('\n').filter(l => l.trim().length > 0);
    for (const line of newLines) {
      const stripped = line.replace(/^-\s*/, '').trim();
      if (stripped.length > 0) {
        addFact(doc, 'general', stripped);
      }
    }
    await this.persistDocument(doc);
    return doc.facts.length;
  }

  /** Invalidate cache so next read hits disk. */
  invalidateCache(): void {
    this.cachedDoc = null;
  }

  // ========================================================================
  // HELPERS
  // ========================================================================

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fsp.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
