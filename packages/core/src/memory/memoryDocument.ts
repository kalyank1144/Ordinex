/**
 * Layer 2: Memory Document — ID-Based CRUD for MEMORY.md
 *
 * Structured project memory with deterministic short-hash IDs.
 * Replaces append-only facts.md with a section-organized document
 * supporting add, update, remove, and list operations.
 */

import { createHash } from 'crypto';

// ============================================================================
// TYPES
// ============================================================================

export type MemorySection = 'architecture' | 'stack' | 'conventions' | 'patterns' | 'general';

export const MEMORY_SECTIONS: MemorySection[] = [
  'architecture', 'stack', 'conventions', 'patterns', 'general',
];

const SECTION_HEADERS: Record<MemorySection, string> = {
  architecture: '## Architecture',
  stack: '## Stack',
  conventions: '## Conventions',
  patterns: '## Patterns',
  general: '## General',
};

export interface MemoryFact {
  id: string;
  section: MemorySection;
  content: string;
  createdAt: string;
  lastReferencedAt?: string;
  referenceCount: number;
}

export interface MemoryDocument {
  facts: MemoryFact[];
  raw: string;
}

export interface MemoryMetadata {
  facts: Record<string, {
    createdAt: string;
    lastReferencedAt?: string;
    referenceCount: number;
  }>;
}

// ============================================================================
// ID GENERATION
// ============================================================================

/**
 * Deterministic short-hash: first 4 hex chars of sha256(content).
 * If collision detected against existing IDs, extends to 6 chars, then 8.
 */
export function generateFactId(content: string, existingIds?: Set<string>): string {
  const hash = createHash('sha256').update(content.trim()).digest('hex');

  for (const len of [4, 6, 8]) {
    const candidate = hash.substring(0, len);
    if (!existingIds || !existingIds.has(candidate)) {
      return candidate;
    }
  }

  return hash.substring(0, 12);
}

// ============================================================================
// PARSING
// ============================================================================

const FACT_LINE_PATTERN = /^-\s*\[id:([a-f0-9]+)\]\s*(.+)$/;

/**
 * Parse MEMORY.md content into a MemoryDocument.
 */
export function parseMemoryDocument(raw: string, metadata?: MemoryMetadata): MemoryDocument {
  const facts: MemoryFact[] = [];
  let currentSection: MemorySection = 'general';

  const lines = raw.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    const sectionEntry = Object.entries(SECTION_HEADERS).find(
      ([, header]) => trimmed === header,
    );
    if (sectionEntry) {
      currentSection = sectionEntry[0] as MemorySection;
      continue;
    }

    const match = trimmed.match(FACT_LINE_PATTERN);
    if (match) {
      const id = match[1];
      const content = match[2].trim();
      const meta = metadata?.facts[id];

      facts.push({
        id,
        section: currentSection,
        content,
        createdAt: meta?.createdAt || new Date().toISOString(),
        lastReferencedAt: meta?.lastReferencedAt,
        referenceCount: meta?.referenceCount || 0,
      });
    }
  }

  return { facts, raw };
}

// ============================================================================
// SERIALIZATION
// ============================================================================

/**
 * Serialize a MemoryDocument back to MEMORY.md format.
 * Facts are ordered by referenceCount (descending) within each section.
 */
export function serializeMemoryDocument(doc: MemoryDocument): string {
  const lines: string[] = ['# Project Memory', ''];

  for (const section of MEMORY_SECTIONS) {
    const sectionFacts = doc.facts
      .filter(f => f.section === section)
      .sort((a, b) => b.referenceCount - a.referenceCount);

    if (sectionFacts.length === 0) continue;

    lines.push(SECTION_HEADERS[section]);
    for (const fact of sectionFacts) {
      lines.push(`- [id:${fact.id}] ${fact.content}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

/**
 * Serialize metadata sidecar (JSON).
 */
export function serializeMetadata(doc: MemoryDocument): MemoryMetadata {
  const facts: MemoryMetadata['facts'] = {};
  for (const fact of doc.facts) {
    facts[fact.id] = {
      createdAt: fact.createdAt,
      lastReferencedAt: fact.lastReferencedAt,
      referenceCount: fact.referenceCount,
    };
  }
  return { facts };
}

// ============================================================================
// CRUD OPERATIONS (pure — operate on MemoryDocument in memory)
// ============================================================================

/**
 * Add a fact to the document. Returns the new fact's ID.
 */
export function addFact(doc: MemoryDocument, section: MemorySection, content: string): string {
  const existingIds = new Set(doc.facts.map(f => f.id));
  const id = generateFactId(content, existingIds);

  doc.facts.push({
    id,
    section,
    content: content.trim(),
    createdAt: new Date().toISOString(),
    referenceCount: 0,
  });

  doc.raw = serializeMemoryDocument(doc);
  return id;
}

/**
 * Update a fact's content. Returns true if found and updated.
 */
export function updateFact(doc: MemoryDocument, id: string, newContent: string): boolean {
  const fact = doc.facts.find(f => f.id === id);
  if (!fact) return false;

  fact.content = newContent.trim();
  doc.raw = serializeMemoryDocument(doc);
  return true;
}

/**
 * Remove a fact by ID. Returns true if found and removed.
 */
export function removeFact(doc: MemoryDocument, id: string): boolean {
  const idx = doc.facts.findIndex(f => f.id === id);
  if (idx === -1) return false;

  doc.facts.splice(idx, 1);
  doc.raw = serializeMemoryDocument(doc);
  return true;
}

/**
 * List facts, optionally filtered by section.
 */
export function listFacts(doc: MemoryDocument, section?: MemorySection): MemoryFact[] {
  if (!section) return [...doc.facts];
  return doc.facts.filter(f => f.section === section);
}

/**
 * Record that a fact was referenced (bumps count and timestamp).
 */
export function markFactReferenced(doc: MemoryDocument, id: string): void {
  const fact = doc.facts.find(f => f.id === id);
  if (fact) {
    fact.referenceCount++;
    fact.lastReferencedAt = new Date().toISOString();
  }
}

/**
 * Get context string: first N lines of serialized MEMORY.md.
 */
export function getMemoryContext(doc: MemoryDocument, maxLines: number = 200): string {
  const serialized = serializeMemoryDocument(doc);
  const lines = serialized.split('\n');
  if (lines.length <= maxLines) return serialized;
  return lines.slice(0, maxLines).join('\n');
}

// ============================================================================
// MIGRATION
// ============================================================================

/**
 * Migrate legacy facts.md content into a MemoryDocument.
 * Each non-empty line becomes a fact in the 'general' section.
 */
export function migrateFromFactsMd(factsContent: string): MemoryDocument {
  const doc: MemoryDocument = { facts: [], raw: '' };

  const lines = factsContent.split('\n').filter(l => l.trim().length > 0);
  const existingIds = new Set<string>();

  for (const line of lines) {
    const content = line.trim();
    if (content.startsWith('#')) continue;

    const stripped = content.replace(/^-\s*/, '');
    if (stripped.length === 0) continue;

    const id = generateFactId(stripped, existingIds);
    existingIds.add(id);

    doc.facts.push({
      id,
      section: 'general',
      content: stripped,
      createdAt: new Date().toISOString(),
      referenceCount: 0,
    });
  }

  doc.raw = serializeMemoryDocument(doc);
  return doc;
}

/**
 * Create an empty MemoryDocument.
 */
export function createEmptyDocument(): MemoryDocument {
  return { facts: [], raw: '# Project Memory\n' };
}
