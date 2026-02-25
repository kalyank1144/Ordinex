/**
 * Layer 2: Memory Document Tests
 */

import { describe, it, expect } from 'vitest';
import {
  generateFactId,
  parseMemoryDocument,
  serializeMemoryDocument,
  serializeMetadata,
  addFact,
  updateFact,
  removeFact,
  listFacts,
  markFactReferenced,
  getMemoryContext,
  migrateFromFactsMd,
  createEmptyDocument,
} from '../memory/memoryDocument';

// ============================================================================
// generateFactId Tests
// ============================================================================

describe('generateFactId', () => {
  it('generates a 4-char hex ID', () => {
    const id = generateFactId('test content');
    expect(id).toMatch(/^[a-f0-9]{4}$/);
  });

  it('generates deterministic IDs for same content', () => {
    const id1 = generateFactId('same content');
    const id2 = generateFactId('same content');
    expect(id1).toBe(id2);
  });

  it('generates different IDs for different content', () => {
    const id1 = generateFactId('content A');
    const id2 = generateFactId('content B');
    expect(id1).not.toBe(id2);
  });

  it('extends to 6 chars on collision', () => {
    const id1 = generateFactId('content A');
    const existing = new Set([id1]);
    const id2 = generateFactId('content A', existing);
    expect(id2.length).toBeGreaterThanOrEqual(6);
  });

  it('trims whitespace before hashing', () => {
    const id1 = generateFactId('hello');
    const id2 = generateFactId('  hello  ');
    expect(id1).toBe(id2);
  });
});

// ============================================================================
// parseMemoryDocument Tests
// ============================================================================

describe('parseMemoryDocument', () => {
  it('parses facts with IDs and sections', () => {
    const raw = `# Project Memory

## Architecture
- [id:a1b2] This is a monorepo

## Stack
- [id:c3d4] TypeScript + Node.js
`;
    const doc = parseMemoryDocument(raw);
    expect(doc.facts).toHaveLength(2);
    expect(doc.facts[0]).toMatchObject({ id: 'a1b2', section: 'architecture', content: 'This is a monorepo' });
    expect(doc.facts[1]).toMatchObject({ id: 'c3d4', section: 'stack', content: 'TypeScript + Node.js' });
  });

  it('defaults to general section for facts before any header', () => {
    const raw = `- [id:a1b2] Some fact before any section header`;
    const doc = parseMemoryDocument(raw);
    expect(doc.facts[0].section).toBe('general');
  });

  it('handles empty document', () => {
    const doc = parseMemoryDocument('');
    expect(doc.facts).toEqual([]);
  });

  it('ignores lines without ID pattern', () => {
    const raw = `## Architecture
- This line has no ID
- [id:a1b2] This one does
Some random text`;
    const doc = parseMemoryDocument(raw);
    expect(doc.facts).toHaveLength(1);
  });

  it('loads metadata when provided', () => {
    const raw = `## General\n- [id:abc1] A fact`;
    const metadata = {
      facts: {
        abc1: { createdAt: '2026-01-01T00:00:00Z', referenceCount: 5, lastReferencedAt: '2026-02-01T00:00:00Z' },
      },
    };
    const doc = parseMemoryDocument(raw, metadata);
    expect(doc.facts[0].createdAt).toBe('2026-01-01T00:00:00Z');
    expect(doc.facts[0].referenceCount).toBe(5);
    expect(doc.facts[0].lastReferencedAt).toBe('2026-02-01T00:00:00Z');
  });
});

// ============================================================================
// serializeMemoryDocument Tests
// ============================================================================

describe('serializeMemoryDocument', () => {
  it('serializes facts grouped by section', () => {
    const doc = createEmptyDocument();
    addFact(doc, 'architecture', 'Monorepo structure');
    addFact(doc, 'stack', 'TypeScript');

    const serialized = serializeMemoryDocument(doc);
    expect(serialized).toContain('## Architecture');
    expect(serialized).toContain('## Stack');
    expect(serialized).toContain('Monorepo structure');
    expect(serialized).toContain('TypeScript');
  });

  it('omits empty sections', () => {
    const doc = createEmptyDocument();
    addFact(doc, 'stack', 'Node.js');

    const serialized = serializeMemoryDocument(doc);
    expect(serialized).not.toContain('## Architecture');
    expect(serialized).toContain('## Stack');
  });

  it('orders facts by referenceCount within section', () => {
    const doc = createEmptyDocument();
    const id1 = addFact(doc, 'general', 'Low priority');
    const id2 = addFact(doc, 'general', 'High priority');
    markFactReferenced(doc, id2);
    markFactReferenced(doc, id2);
    markFactReferenced(doc, id2);

    const serialized = serializeMemoryDocument(doc);
    const highIdx = serialized.indexOf('High priority');
    const lowIdx = serialized.indexOf('Low priority');
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it('roundtrips through parse -> serialize', () => {
    const doc = createEmptyDocument();
    addFact(doc, 'architecture', 'Event-sourced');
    addFact(doc, 'stack', 'TypeScript');
    addFact(doc, 'conventions', 'Use vitest');

    const serialized = serializeMemoryDocument(doc);
    const reparsed = parseMemoryDocument(serialized);
    expect(reparsed.facts).toHaveLength(3);
    expect(reparsed.facts.map(f => f.content).sort())
      .toEqual(['Event-sourced', 'TypeScript', 'Use vitest'].sort());
  });
});

// ============================================================================
// CRUD Tests
// ============================================================================

describe('addFact', () => {
  it('adds a fact to the document', () => {
    const doc = createEmptyDocument();
    const id = addFact(doc, 'stack', 'Node.js 20');
    expect(id).toMatch(/^[a-f0-9]+$/);
    expect(doc.facts).toHaveLength(1);
    expect(doc.facts[0].content).toBe('Node.js 20');
    expect(doc.facts[0].section).toBe('stack');
  });

  it('auto-generates unique IDs', () => {
    const doc = createEmptyDocument();
    const id1 = addFact(doc, 'general', 'Fact one');
    const id2 = addFact(doc, 'general', 'Fact two');
    expect(id1).not.toBe(id2);
  });

  it('trims content', () => {
    const doc = createEmptyDocument();
    addFact(doc, 'general', '  spaces around  ');
    expect(doc.facts[0].content).toBe('spaces around');
  });

  it('initializes referenceCount to 0', () => {
    const doc = createEmptyDocument();
    addFact(doc, 'general', 'test');
    expect(doc.facts[0].referenceCount).toBe(0);
  });
});

describe('updateFact', () => {
  it('updates content of existing fact', () => {
    const doc = createEmptyDocument();
    const id = addFact(doc, 'general', 'Old content');
    const result = updateFact(doc, id, 'New content');
    expect(result).toBe(true);
    expect(doc.facts[0].content).toBe('New content');
  });

  it('returns false for non-existent ID', () => {
    const doc = createEmptyDocument();
    expect(updateFact(doc, 'nonexistent', 'content')).toBe(false);
  });
});

describe('removeFact', () => {
  it('removes a fact by ID', () => {
    const doc = createEmptyDocument();
    const id = addFact(doc, 'general', 'To be removed');
    addFact(doc, 'general', 'Stays');

    expect(removeFact(doc, id)).toBe(true);
    expect(doc.facts).toHaveLength(1);
    expect(doc.facts[0].content).toBe('Stays');
  });

  it('returns false for non-existent ID', () => {
    const doc = createEmptyDocument();
    expect(removeFact(doc, 'nope')).toBe(false);
  });
});

describe('listFacts', () => {
  it('lists all facts when no section filter', () => {
    const doc = createEmptyDocument();
    addFact(doc, 'architecture', 'A');
    addFact(doc, 'stack', 'B');
    expect(listFacts(doc)).toHaveLength(2);
  });

  it('filters by section', () => {
    const doc = createEmptyDocument();
    addFact(doc, 'architecture', 'A');
    addFact(doc, 'stack', 'B');
    addFact(doc, 'architecture', 'C');
    expect(listFacts(doc, 'architecture')).toHaveLength(2);
    expect(listFacts(doc, 'stack')).toHaveLength(1);
  });
});

describe('markFactReferenced', () => {
  it('increments reference count', () => {
    const doc = createEmptyDocument();
    const id = addFact(doc, 'general', 'test');
    markFactReferenced(doc, id);
    markFactReferenced(doc, id);
    expect(doc.facts[0].referenceCount).toBe(2);
  });

  it('updates lastReferencedAt', () => {
    const doc = createEmptyDocument();
    const id = addFact(doc, 'general', 'test');
    expect(doc.facts[0].lastReferencedAt).toBeUndefined();
    markFactReferenced(doc, id);
    expect(doc.facts[0].lastReferencedAt).toBeDefined();
  });

  it('no-ops for non-existent ID', () => {
    const doc = createEmptyDocument();
    markFactReferenced(doc, 'nope');
    expect(doc.facts).toHaveLength(0);
  });
});

// ============================================================================
// getMemoryContext Tests
// ============================================================================

describe('getMemoryContext', () => {
  it('returns full content when under max lines', () => {
    const doc = createEmptyDocument();
    addFact(doc, 'general', 'One fact');
    const ctx = getMemoryContext(doc, 200);
    expect(ctx).toContain('One fact');
  });

  it('truncates to maxLines', () => {
    const doc = createEmptyDocument();
    for (let i = 0; i < 50; i++) {
      addFact(doc, 'general', `Fact number ${i} with unique content ${Math.random()}`);
    }
    const ctx = getMemoryContext(doc, 10);
    const lines = ctx.split('\n');
    expect(lines.length).toBeLessThanOrEqual(10);
  });
});

// ============================================================================
// Migration Tests
// ============================================================================

describe('migrateFromFactsMd', () => {
  it('migrates plain text lines to general section', () => {
    const facts = `Project uses React
TypeScript is required
Testing with vitest`;
    const doc = migrateFromFactsMd(facts);
    expect(doc.facts).toHaveLength(3);
    expect(doc.facts.every(f => f.section === 'general')).toBe(true);
    expect(doc.facts[0].content).toBe('Project uses React');
  });

  it('strips leading dashes from lines', () => {
    const facts = `- Fact with dash\n- Another fact`;
    const doc = migrateFromFactsMd(facts);
    expect(doc.facts[0].content).toBe('Fact with dash');
  });

  it('skips empty lines and headings', () => {
    const facts = `# Header\n\nFact one\n\n  \nFact two`;
    const doc = migrateFromFactsMd(facts);
    expect(doc.facts).toHaveLength(2);
  });

  it('generates unique IDs for each line', () => {
    const facts = `A\nB\nC`;
    const doc = migrateFromFactsMd(facts);
    const ids = doc.facts.map(f => f.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('handles empty input', () => {
    const doc = migrateFromFactsMd('');
    expect(doc.facts).toHaveLength(0);
  });
});

// ============================================================================
// Metadata Tests
// ============================================================================

describe('serializeMetadata', () => {
  it('serializes fact metadata', () => {
    const doc = createEmptyDocument();
    const id = addFact(doc, 'general', 'test');
    markFactReferenced(doc, id);

    const meta = serializeMetadata(doc);
    expect(meta.facts[id]).toBeDefined();
    expect(meta.facts[id].referenceCount).toBe(1);
    expect(meta.facts[id].createdAt).toBeDefined();
  });
});
