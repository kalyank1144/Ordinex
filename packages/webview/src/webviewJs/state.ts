// R3: Webview state and DOM element cache
// Extracted from index.ts lines 2225-2308

export function getStateJs(): string {
  return `
      // ===== ATTACHMENT CONSTANTS =====
      const ATTACHMENT_CONFIG = {
        MAX_FILES: 10,
        MAX_SIZE_BYTES: 5 * 1024 * 1024,
        ALLOWED_MIME_TYPES: [
          'image/png', 'image/jpeg', 'image/gif', 'image/webp',
          'text/plain', 'application/json', 'application/pdf',
          'text/markdown', 'text/csv'
        ],
        ALLOWED_EXTENSIONS: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt', '.json', '.pdf', '.md', '.csv']
      };

      // State
      const state = {
        activeTab: 'mission',
        taskStatus: 'ready',
        currentStage: 'none',
        currentMode: 'ANSWER',
        narrationCards: [],
        pendingAttachments: [],
        scopeSummary: {
          contract: {
            max_files: 10,
            max_lines: 1000,
            allowed_tools: ['read', 'write', 'exec'],
            budgets: {
              max_iterations: 10,
              max_tool_calls: 100,
              max_time_ms: 300000
            }
          },
          in_scope_files: [],
          touched_files: [],
          lines_retrieved: 0,
          tools_used: []
        },
        latestCheckpoint: null,
        pendingScopeExpansion: null,
        events: [],
        evidence: {},
        evidenceContent: {},
        expandedEvents: new Set(),
        selectedModel: 'claude-3-haiku',
        streamingAnswer: null,
        // A6: Streaming state for PLAN mode (thinking bubble while generating plan)
        streamingPlan: null,
        // A6: Streaming state for MISSION edit step (sequential blocks model)
        streamingMission: null,
        // Streaming perf/autoscroll state
        _missionRafPending: false,
        _missionDeltaCount: 0,
        _missionLastParsedText: '',
        _missionLastParsedHtml: '',
        _missionUserPinnedScroll: false,
        // Completed streaming blocks history (persisted across step transitions)
        _completedMissionBlocks: [],
        counters: {
          filesInScope: 0,
          filesTouched: 0,
          linesIncluded: 0,
          toolCallsUsed: 0,
          toolCallsMax: 100
        },
        missionStartPending: null,
        logsFilter: {
          search: '',
          eventType: 'all',
          stage: 'all',
          mode: 'all',
          tool: 'all'
        },
        expandedLogEvents: new Set(),
        expandedStreamGroups: new Set(),
        streamGroupViewMode: {}
      };

      // DOM Elements
      const statusPill = document.getElementById('statusPill');
      const stageLabel = document.getElementById('stageLabel');
      const tabs = document.querySelectorAll('.tab');
      const tabContents = document.querySelectorAll('.tab-content');
      const missionTab = document.getElementById('missionTab');
      const eventLogList = document.getElementById('eventLogList');
      const promptInput = document.getElementById('promptInput');
      const sendBtn = document.getElementById('sendBtn');
      const stopBtn = document.getElementById('stopBtn');
      const clearBtn = document.getElementById('clearBtn');
      const modeSelect = document.getElementById('modeSelect');
      const modelSelect = document.getElementById('modelSelect');
      const exportRunBtn = document.getElementById('exportRunBtn');
      const sendStopBtn = document.getElementById('sendStopBtn');
      const attachBtn = document.getElementById('attachBtn');
      const newChatBtn = document.getElementById('newChatBtn');
  `;
}
