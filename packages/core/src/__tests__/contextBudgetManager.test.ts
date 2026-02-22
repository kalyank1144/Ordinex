/**
 * ContextBudgetManager Tests — Dynamic system prompt budget allocation.
 */

import { describe, it, expect } from 'vitest';
import { ContextBudgetManager } from '../contextBudgetManager';
import { ConversationHistory } from '../conversationHistory';
import type { ContextLayer } from '../contextBudgetManager';

describe('ContextBudgetManager', () => {
  const manager = new ContextBudgetManager();

  function makeHistory(tokenEstimate: number): ConversationHistory {
    const h = new ConversationHistory({ charsPerToken: 1 });
    h.addUserMessage('x'.repeat(tokenEstimate));
    return h;
  }

  it('includes all layers when budget is ample', () => {
    const layers: ContextLayer[] = [
      { label: 'base', content: 'Base prompt', priority: 1 },
      { label: 'scaffold', content: 'Scaffold context', priority: 2 },
      { label: 'activity', content: 'Activity context', priority: 3 },
    ];

    const history = makeHistory(1000);
    const result = manager.build(layers, history, 200_000);

    expect(result.layersIncluded).toContain('base');
    expect(result.layersIncluded).toContain('scaffold');
    expect(result.layersIncluded).toContain('activity');
    expect(result.layersDropped).toHaveLength(0);
  });

  it('drops lower-priority layers when budget is tight', () => {
    const layers: ContextLayer[] = [
      { label: 'base', content: 'x'.repeat(4000), priority: 1 },
      { label: 'scaffold', content: 'x'.repeat(4000), priority: 2 },
      { label: 'activity', content: 'x'.repeat(80000), priority: 3 },
    ];

    // Very small window — only base fits
    const history = makeHistory(1000);
    const result = manager.build(layers, history, 25_000);

    expect(result.layersIncluded).toContain('base');
    expect(result.layersDropped.length).toBeGreaterThan(0);
  });

  it('respects priority ordering (lower priority number = higher priority)', () => {
    const layers: ContextLayer[] = [
      { label: 'low', content: 'Low priority', priority: 3 },
      { label: 'high', content: 'High priority', priority: 1 },
      { label: 'mid', content: 'Mid priority', priority: 2 },
    ];

    const history = makeHistory(0);
    const result = manager.build(layers, history, 200_000);

    expect(result.layersIncluded[0]).toBe('high');
    expect(result.layersIncluded[1]).toBe('mid');
    expect(result.layersIncluded[2]).toBe('low');
  });

  it('accounts for output and tool schema reserves', () => {
    const layers: ContextLayer[] = [
      { label: 'huge', content: 'x'.repeat(200_000 * 4), priority: 1 },
    ];

    const history = makeHistory(0);
    const result = manager.build(layers, history, 200_000);

    // Should be dropped because 200K tokens of content exceeds
    // 200K window minus 16K output minus 2K tools
    expect(result.layersDropped).toContain('huge');
  });

  it('handles empty layers gracefully', () => {
    const history = makeHistory(100);
    const result = manager.build([], history, 200_000);

    expect(result.systemPrompt).toBe('');
    expect(result.layersIncluded).toHaveLength(0);
    expect(result.layersDropped).toHaveLength(0);
  });
});
