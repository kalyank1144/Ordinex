import { describe, it, expect, beforeEach } from 'vitest';
import { UndoStack, UndoGroup } from '../undoStack';

function makeGroup(overrides: Partial<UndoGroup> = {}): UndoGroup {
  return {
    group_id: overrides.group_id || `g-${Math.random().toString(36).slice(2, 8)}`,
    actions: overrides.actions || [],
    description: overrides.description || 'test group',
    timestamp: overrides.timestamp || new Date().toISOString(),
    source_event_id: overrides.source_event_id || 'evt-1',
    undoable: overrides.undoable ?? true,
  };
}

describe('UndoStack', () => {
  let stack: UndoStack;

  beforeEach(() => {
    stack = new UndoStack();
  });

  it('push() adds group to stack', () => {
    const group = makeGroup();
    stack.push(group);
    expect(stack.size()).toBe(1);
    expect(stack.peek()).toBe(group);
  });

  it('pop() removes and returns top group', () => {
    const g1 = makeGroup({ group_id: 'g1' });
    const g2 = makeGroup({ group_id: 'g2' });
    stack.push(g1);
    stack.push(g2);

    const popped = stack.pop();
    expect(popped).toBe(g2);
    expect(stack.size()).toBe(1);
    expect(stack.peek()).toBe(g1);
  });

  it('pop() returns undefined when empty', () => {
    expect(stack.pop()).toBeUndefined();
  });

  it('canUndo() returns true when top group is undoable', () => {
    stack.push(makeGroup({ undoable: true }));
    expect(stack.canUndo()).toBe(true);
  });

  it('canUndo() returns false when empty', () => {
    expect(stack.canUndo()).toBe(false);
  });

  it('canUndo() returns false when top group is undoable: false', () => {
    stack.push(makeGroup({ undoable: false }));
    expect(stack.canUndo()).toBe(false);
  });

  it('peek() returns top without removing', () => {
    const group = makeGroup();
    stack.push(group);
    expect(stack.peek()).toBe(group);
    expect(stack.size()).toBe(1);
  });

  it('peek() returns undefined when empty', () => {
    expect(stack.peek()).toBeUndefined();
  });

  it('maxDepth enforced — push 51 groups, verify 50 remain, oldest dropped', () => {
    const groups: UndoGroup[] = [];
    for (let i = 0; i < 51; i++) {
      const g = makeGroup({ group_id: `g-${i}` });
      groups.push(g);
      stack.push(g);
    }
    expect(stack.size()).toBe(50);
    // Oldest (g-0) should be dropped, g-1 is now the bottom
    const all = stack.getAll();
    expect(all[0].group_id).toBe('g-1');
    expect(all[49].group_id).toBe('g-50');
  });

  it('clear() empties stack', () => {
    stack.push(makeGroup());
    stack.push(makeGroup());
    stack.clear();
    expect(stack.size()).toBe(0);
    expect(stack.peek()).toBeUndefined();
  });

  it('size() returns correct count', () => {
    expect(stack.size()).toBe(0);
    stack.push(makeGroup());
    expect(stack.size()).toBe(1);
    stack.push(makeGroup());
    expect(stack.size()).toBe(2);
    stack.pop();
    expect(stack.size()).toBe(1);
  });

  it('getAll() returns read-only snapshot', () => {
    const g1 = makeGroup({ group_id: 'g1' });
    const g2 = makeGroup({ group_id: 'g2' });
    stack.push(g1);
    stack.push(g2);
    const all = stack.getAll();
    expect(all).toHaveLength(2);
    expect(all[0]).toBe(g1);
    expect(all[1]).toBe(g2);
  });

  it('getUndoableGroupIds() returns only IDs where undoable: true', () => {
    stack.push(makeGroup({ group_id: 'a', undoable: true }));
    stack.push(makeGroup({ group_id: 'b', undoable: false }));
    stack.push(makeGroup({ group_id: 'c', undoable: true }));
    expect(stack.getUndoableGroupIds()).toEqual(['a', 'c']);
  });

  it('topUndoableGroupId() returns top undoable group ID', () => {
    stack.push(makeGroup({ group_id: 'a', undoable: true }));
    expect(stack.topUndoableGroupId()).toBe('a');
  });

  it('topUndoableGroupId() returns null when top is non-undoable', () => {
    stack.push(makeGroup({ group_id: 'a', undoable: true }));
    stack.push(makeGroup({ group_id: 'b', undoable: false }));
    expect(stack.topUndoableGroupId()).toBeNull();
  });

  it('topUndoableGroupId() returns null when empty', () => {
    expect(stack.topUndoableGroupId()).toBeNull();
  });
});
