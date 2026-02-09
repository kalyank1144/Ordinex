/**
 * GeneratedToolManager Tests
 *
 * Uses mock ToolRegistryService + mock EventPublisher.
 * Verifies proposal lifecycle, approval flow, event-sourced rebuild, and delegation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeneratedToolManager } from '../intelligence/generatedToolManager';
import type {
  ToolRegistryService,
  ToolProposal,
  ToolRegistry,
  ToolEntry,
  ToolMetadata,
} from '../intelligence/toolRegistryService';
import type { EventPublisher } from '../intelligence/memoryService';
import type { Event, Mode } from '../types';

// ============================================================================
// MOCKS
// ============================================================================

function createMockRegistryService(
  overrides: Partial<ToolRegistryService> = {},
): ToolRegistryService {
  return {
    saveTool: vi.fn().mockResolvedValue(undefined),
    loadRegistry: vi.fn().mockResolvedValue({ version: 1, tools: [] } as ToolRegistry),
    getTool: vi.fn().mockResolvedValue(null),
    deleteTool: vi.fn().mockResolvedValue(undefined),
    loadToolCode: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function createMockPublisher(): EventPublisher & { events: Event[] } {
  const events: Event[] = [];
  return {
    events,
    publish: vi.fn(async (event: Event) => {
      events.push(event);
    }),
  };
}

function createToolProposal(overrides: Partial<ToolProposal> = {}): ToolProposal {
  return {
    name: 'format_date',
    description: 'Formats a date to ISO string',
    code: 'const input = JSON.parse(require("fs").readFileSync(0, "utf-8"));\nconsole.log(new Date(input.date).toISOString());',
    readme: 'Pass { date: "2024-01-01" } via stdin',
    inputs_schema: { type: 'object', properties: { date: { type: 'string' } } },
    outputs_schema: { type: 'object', properties: { result: { type: 'string' } } },
    allow: { network: false },
    ...overrides,
  };
}

function makeEvent(type: string, payload: Record<string, unknown>): Event {
  return {
    event_id: `evt_${Math.random().toString(36).substring(2)}`,
    task_id: 'task_1',
    timestamp: new Date().toISOString(),
    type: type as Event['type'],
    mode: 'MISSION' as Mode,
    stage: 'edit',
    payload,
    evidence_ids: [],
    parent_event_id: null,
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('GeneratedToolManager', () => {
  let registryService: ToolRegistryService;
  let publisher: EventPublisher & { events: Event[] };
  let manager: GeneratedToolManager;

  beforeEach(() => {
    registryService = createMockRegistryService();
    publisher = createMockPublisher();
    manager = new GeneratedToolManager(registryService, publisher);
  });

  // --------------------------------------------------------------------------
  // proposeTool
  // --------------------------------------------------------------------------

  describe('proposeTool', () => {
    it('should return a proposal_id', async () => {
      const proposal = createToolProposal();
      const id = await manager.proposeTool(proposal, 'task_1', 'MISSION');
      expect(id).toMatch(/^tp_/);
    });

    it('should emit generated_tool_proposed event', async () => {
      const proposal = createToolProposal();
      await manager.proposeTool(proposal, 'task_1', 'MISSION');

      expect(publisher.events).toHaveLength(1);
      const event = publisher.events[0];
      expect(event.type).toBe('generated_tool_proposed');
      expect(event.payload.name).toBe('format_date');
      expect(event.payload.description).toBe('Formats a date to ISO string');
      expect(event.payload.code).toBeTruthy();
      expect(event.payload.proposal_id).toMatch(/^tp_/);
      expect(event.mode).toBe('MISSION');
      expect(event.stage).toBe('edit');
    });

    it('should store proposal in pending map', async () => {
      const proposal = createToolProposal();
      const id = await manager.proposeTool(proposal, 'task_1', 'MISSION');

      const pending = manager.getPendingProposal(id);
      expect(pending).toBeDefined();
      expect(pending?.name).toBe('format_date');
    });

    it('should include all optional fields in event payload', async () => {
      const proposal = createToolProposal({
        readme: 'Usage notes',
        inputs_schema: { type: 'object' },
        outputs_schema: { type: 'string' },
        allow: { network: true, commands: ['node'] },
      });
      await manager.proposeTool(proposal, 'task_1', 'MISSION');

      const event = publisher.events[0];
      expect(event.payload.readme).toBe('Usage notes');
      expect(event.payload.inputs_schema).toEqual({ type: 'object' });
      expect(event.payload.outputs_schema).toEqual({ type: 'string' });
      expect(event.payload.allow).toEqual({ network: true, commands: ['node'] });
    });
  });

  // --------------------------------------------------------------------------
  // approveTool
  // --------------------------------------------------------------------------

  describe('approveTool', () => {
    it('should save tool via registry service and emit generated_tool_saved', async () => {
      const proposal = createToolProposal();
      const id = await manager.proposeTool(proposal, 'task_1', 'MISSION');

      await manager.approveTool(id, 'task_1', 'MISSION');

      // Verify registryService.saveTool was called correctly
      expect(registryService.saveTool).toHaveBeenCalledWith(
        'format_date',
        proposal.code,
        {
          description: proposal.description,
          inputs_schema: proposal.inputs_schema,
          outputs_schema: proposal.outputs_schema,
          allow: proposal.allow,
        },
      );

      // Verify generated_tool_saved event emitted
      const savedEvent = publisher.events.find(e => e.type === 'generated_tool_saved');
      expect(savedEvent).toBeDefined();
      expect(savedEvent?.payload.proposal_id).toBe(id);
      expect(savedEvent?.payload.name).toBe('format_date');
    });

    it('should remove proposal from pending map after approval', async () => {
      const proposal = createToolProposal();
      const id = await manager.proposeTool(proposal, 'task_1', 'MISSION');

      await manager.approveTool(id, 'task_1', 'MISSION');

      expect(manager.getPendingProposal(id)).toBeUndefined();
      expect(manager.getPendingProposalIds()).not.toContain(id);
    });

    it('should throw if proposal not found', async () => {
      await expect(
        manager.approveTool('tp_nonexistent', 'task_1', 'MISSION'),
      ).rejects.toThrow('No pending proposal found');
    });
  });

  // --------------------------------------------------------------------------
  // rejectTool
  // --------------------------------------------------------------------------

  describe('rejectTool', () => {
    it('should remove proposal from pending map', async () => {
      const proposal = createToolProposal();
      const id = await manager.proposeTool(proposal, 'task_1', 'MISSION');

      manager.rejectTool(id);

      expect(manager.getPendingProposal(id)).toBeUndefined();
    });

    it('should not throw if proposal already removed', () => {
      expect(() => manager.rejectTool('tp_nonexistent')).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // getPendingProposalIds
  // --------------------------------------------------------------------------

  describe('getPendingProposalIds', () => {
    it('should return empty array initially', () => {
      expect(manager.getPendingProposalIds()).toEqual([]);
    });

    it('should track multiple proposals', async () => {
      const p1 = createToolProposal({ name: 'tool_a' });
      const p2 = createToolProposal({ name: 'tool_b' });
      const id1 = await manager.proposeTool(p1, 'task_1', 'MISSION');
      const id2 = await manager.proposeTool(p2, 'task_1', 'MISSION');

      const ids = manager.getPendingProposalIds();
      expect(ids).toContain(id1);
      expect(ids).toContain(id2);
      expect(ids).toHaveLength(2);
    });
  });

  // --------------------------------------------------------------------------
  // rebuildPendingProposals (event-sourced state recovery)
  // --------------------------------------------------------------------------

  describe('rebuildPendingProposals', () => {
    it('should restore pending proposals from events', () => {
      const events: Event[] = [
        makeEvent('generated_tool_proposed', {
          proposal_id: 'tp_1',
          name: 'tool_a',
          description: 'Tool A',
          code: 'console.log("a")',
        }),
        makeEvent('generated_tool_proposed', {
          proposal_id: 'tp_2',
          name: 'tool_b',
          description: 'Tool B',
          code: 'console.log("b")',
        }),
      ];

      manager.rebuildPendingProposals(events);

      expect(manager.getPendingProposalIds()).toHaveLength(2);
      expect(manager.getPendingProposal('tp_1')?.name).toBe('tool_a');
      expect(manager.getPendingProposal('tp_2')?.name).toBe('tool_b');
    });

    it('should exclude proposals that have been saved', () => {
      const events: Event[] = [
        makeEvent('generated_tool_proposed', {
          proposal_id: 'tp_1',
          name: 'tool_a',
          code: 'console.log("a")',
        }),
        makeEvent('generated_tool_saved', {
          proposal_id: 'tp_1',
          name: 'tool_a',
        }),
        makeEvent('generated_tool_proposed', {
          proposal_id: 'tp_2',
          name: 'tool_b',
          code: 'console.log("b")',
        }),
      ];

      manager.rebuildPendingProposals(events);

      expect(manager.getPendingProposalIds()).toEqual(['tp_2']);
    });

    it('should exclude proposals rejected via approval_resolved(denied)', () => {
      const events: Event[] = [
        makeEvent('generated_tool_proposed', {
          proposal_id: 'tp_1',
          name: 'tool_a',
          code: 'console.log("a")',
        }),
        makeEvent('approval_resolved', {
          approval_id: 'tp_1',
          decision: 'denied',
        }),
      ];

      manager.rebuildPendingProposals(events);

      expect(manager.getPendingProposalIds()).toEqual([]);
    });

    it('should restore optional fields from event payload', () => {
      const events: Event[] = [
        makeEvent('generated_tool_proposed', {
          proposal_id: 'tp_1',
          name: 'tool_a',
          description: 'Tool A',
          code: 'code here',
          readme: 'Usage: ...',
          inputs_schema: { type: 'object' },
          outputs_schema: { type: 'string' },
          allow: { network: true },
        }),
      ];

      manager.rebuildPendingProposals(events);

      const proposal = manager.getPendingProposal('tp_1');
      expect(proposal?.readme).toBe('Usage: ...');
      expect(proposal?.inputs_schema).toEqual({ type: 'object' });
      expect(proposal?.outputs_schema).toEqual({ type: 'string' });
      expect(proposal?.allow).toEqual({ network: true });
    });

    it('should clear existing pending proposals before rebuilding', async () => {
      // Add a proposal manually first
      await manager.proposeTool(createToolProposal(), 'task_1', 'MISSION');
      expect(manager.getPendingProposalIds()).toHaveLength(1);

      // Rebuild with empty events
      manager.rebuildPendingProposals([]);
      expect(manager.getPendingProposalIds()).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Delegation methods
  // --------------------------------------------------------------------------

  describe('delegation', () => {
    it('getRegistry should delegate to registryService', async () => {
      const mockRegistry: ToolRegistry = {
        version: 1,
        tools: [
          {
            name: 'tool_a',
            description: 'Test',
            code_hash: 'abc',
            created_at: new Date().toISOString(),
          },
        ],
      };
      (registryService.loadRegistry as ReturnType<typeof vi.fn>).mockResolvedValue(mockRegistry);

      const result = await manager.getRegistry();
      expect(result).toBe(mockRegistry);
      expect(registryService.loadRegistry).toHaveBeenCalledOnce();
    });

    it('getTool should delegate to registryService', async () => {
      const entry: ToolEntry = {
        name: 'test_tool',
        description: 'A test',
        code_hash: 'def',
        created_at: new Date().toISOString(),
      };
      (registryService.getTool as ReturnType<typeof vi.fn>).mockResolvedValue(entry);

      const result = await manager.getTool('test_tool');
      expect(result).toBe(entry);
      expect(registryService.getTool).toHaveBeenCalledWith('test_tool');
    });

    it('getToolCode should delegate to registryService', async () => {
      (registryService.loadToolCode as ReturnType<typeof vi.fn>).mockResolvedValue('console.log("hello")');

      const result = await manager.getToolCode('my_tool');
      expect(result).toBe('console.log("hello")');
      expect(registryService.loadToolCode).toHaveBeenCalledWith('my_tool');
    });

    it('deleteTool should delegate to registryService', async () => {
      await manager.deleteTool('old_tool');
      expect(registryService.deleteTool).toHaveBeenCalledWith('old_tool');
    });
  });

  // --------------------------------------------------------------------------
  // Event payload snake_case consistency
  // --------------------------------------------------------------------------

  describe('snake_case event payloads', () => {
    it('proposed event uses snake_case fields', async () => {
      await manager.proposeTool(createToolProposal(), 'task_1', 'MISSION');
      const event = publisher.events[0];

      // All payload keys should be snake_case
      for (const key of Object.keys(event.payload)) {
        expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    });

    it('saved event uses snake_case fields', async () => {
      const id = await manager.proposeTool(createToolProposal(), 'task_1', 'MISSION');
      await manager.approveTool(id, 'task_1', 'MISSION');

      const savedEvent = publisher.events.find(e => e.type === 'generated_tool_saved');
      for (const key of Object.keys(savedEvent!.payload)) {
        expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    });
  });
});
