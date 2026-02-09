/**
 * Step 48: UndoStack — Pure in-memory undo stack for grouped file edits.
 *
 * Design:
 * - Unit of undo is an UndoGroup (all files from one diff application).
 * - Max depth enforced on push (oldest dropped).
 * - No disk I/O — purely in-memory, lost on restart.
 * - P1 compliant: no FS imports.
 */

export type UndoActionType = 'file_edit' | 'file_create' | 'file_delete';

export interface UndoableAction {
  action_id: string;
  type: UndoActionType;
  file_path: string;
  before_content: string | null;  // null for file_create
  after_content: string | null;   // null for file_delete
  timestamp: string;
  description: string;
}

export interface UndoGroup {
  group_id: string;               // correlation ID (proposal_id or diff_id)
  actions: UndoableAction[];
  description: string;
  timestamp: string;
  source_event_id: string;        // the diff_applied event_id
  undoable: boolean;              // false if before-content was missing or files were too large
}

export class UndoStack {
  private stack: UndoGroup[] = [];
  private readonly maxDepth: number;

  constructor(maxDepth: number = 50) {
    this.maxDepth = maxDepth;
  }

  /** Add group to stack, drop oldest if exceeds maxDepth. */
  push(group: UndoGroup): void {
    this.stack.push(group);
    while (this.stack.length > this.maxDepth) {
      this.stack.shift();
    }
  }

  /** True when top group exists and is undoable. */
  canUndo(): boolean {
    const top = this.peek();
    return top !== undefined && top.undoable;
  }

  /** Return top of stack without removing. */
  peek(): UndoGroup | undefined {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : undefined;
  }

  /** Remove and return top of stack. */
  pop(): UndoGroup | undefined {
    return this.stack.pop();
  }

  /** Empty the stack. */
  clear(): void {
    this.stack = [];
  }

  /** Current stack depth. */
  size(): number {
    return this.stack.length;
  }

  /** Read-only snapshot of all groups (bottom-to-top). */
  getAll(): readonly UndoGroup[] {
    return this.stack;
  }

  /** IDs of all groups where undoable === true. */
  getUndoableGroupIds(): string[] {
    return this.stack.filter(g => g.undoable).map(g => g.group_id);
  }

  /** ID of the top undoable group, or null if none. */
  topUndoableGroupId(): string | null {
    const top = this.peek();
    if (top && top.undoable) return top.group_id;
    return null;
  }
}
