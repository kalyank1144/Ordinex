/**
 * Anthropic Tool Schemas for Coding Assistant (A3)
 *
 * Defines the `tools` array for the Anthropic Messages API.
 * Each tool has a name, description, and JSON Schema for input_schema.
 *
 * These tools map to the existing ToolCategory types (read, exec, write)
 * and will be executed by the ToolExecutor infrastructure.
 */

// ---------------------------------------------------------------------------
// Tool schema type (matches Anthropic SDK tool definition)
// ---------------------------------------------------------------------------

export interface ToolSchema {
  name: string;
  description: string;
  /** When true, Anthropic constrains decoding to guarantee schema-valid output. */
  strict?: boolean;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export type ToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'tool'; name: string };

// ---------------------------------------------------------------------------
// Individual tool definitions
// ---------------------------------------------------------------------------

export const READ_FILE_TOOL: ToolSchema = {
  name: 'read_file',
  description:
    'Read the contents of a file at the given path. Returns the full file content as a string. ' +
    'Use this to understand existing code before making changes.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file from the workspace root (e.g. "src/index.ts")',
      },
      max_lines: {
        type: 'number',
        description: 'Optional maximum number of lines to return. If omitted, returns the entire file.',
      },
      offset: {
        type: 'number',
        description: 'Optional line offset (0-indexed) to start reading from.',
      },
    },
    required: ['path'],
  },
};

export const WRITE_FILE_TOOL: ToolSchema = {
  name: 'write_file',
  description:
    'Write content to a file, creating it if it does not exist or overwriting if it does. ' +
    'The content should be the COMPLETE file content. Use for creating new files or fully replacing existing ones.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file from the workspace root',
      },
      content: {
        type: 'string',
        description: 'The complete file content to write',
      },
    },
    required: ['path', 'content'],
  },
};

export const EDIT_FILE_TOOL: ToolSchema = {
  name: 'edit_file',
  description:
    'Apply a targeted edit to an existing file by specifying the old text to find and the new text to replace it with. ' +
    'Use this for surgical changes instead of rewriting the entire file. ' +
    'The old_text must be an exact match of the existing content (including whitespace and indentation).',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file from the workspace root',
      },
      old_text: {
        type: 'string',
        description: 'The exact text to find in the file (must be unique within the file)',
      },
      new_text: {
        type: 'string',
        description: 'The replacement text',
      },
    },
    required: ['path', 'old_text', 'new_text'],
  },
};

export const RUN_COMMAND_TOOL: ToolSchema = {
  name: 'run_command',
  description:
    'Execute a shell command in the workspace directory. ' +
    'Use for running tests, installing dependencies, building the project, or other terminal operations. ' +
    'Commands run with a timeout and their stdout/stderr is captured.',
  input_schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute (e.g. "npm test", "tsc --noEmit")',
      },
      timeout_ms: {
        type: 'number',
        description: 'Optional timeout in milliseconds (default: 30000)',
      },
      cwd: {
        type: 'string',
        description: 'Optional working directory relative to workspace root (default: workspace root)',
      },
    },
    required: ['command'],
  },
};

export const SEARCH_FILES_TOOL: ToolSchema = {
  name: 'search_files',
  description:
    'Search for files matching a pattern or search for text within files. ' +
    'Use "query" for content search (grep-like) and "glob" for file name matching.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Text or regex pattern to search for within file contents',
      },
      glob: {
        type: 'string',
        description: 'Glob pattern to filter which files to search (e.g. "src/**/*.ts")',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of results to return (default: 20)',
      },
    },
    required: ['query'],
  },
};

export const LIST_DIRECTORY_TOOL: ToolSchema = {
  name: 'list_directory',
  description:
    'List the contents of a directory. Returns file and subdirectory names with type indicators. ' +
    'Use this to explore the project structure.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the directory from the workspace root (default: ".")',
      },
      recursive: {
        type: 'boolean',
        description: 'If true, list contents recursively (default: false)',
      },
      max_depth: {
        type: 'number',
        description: 'Maximum recursion depth when recursive is true (default: 3)',
      },
    },
    required: [],
  },
};

// ---------------------------------------------------------------------------
// Tool collections
// ---------------------------------------------------------------------------

/** All coding tools available to the LLM */
export const ALL_TOOLS: ToolSchema[] = [
  READ_FILE_TOOL,
  WRITE_FILE_TOOL,
  EDIT_FILE_TOOL,
  RUN_COMMAND_TOOL,
  SEARCH_FILES_TOOL,
  LIST_DIRECTORY_TOOL,
];

/** Read-only tools (safe to use without approval) */
export const READ_ONLY_TOOLS: ToolSchema[] = [
  READ_FILE_TOOL,
  SEARCH_FILES_TOOL,
  LIST_DIRECTORY_TOOL,
];

/** Tools that modify the workspace (require approval in most modes) */
export const WRITE_TOOLS: ToolSchema[] = [
  WRITE_FILE_TOOL,
  EDIT_FILE_TOOL,
];

/** Tools that execute commands (require approval) */
export const EXEC_TOOLS: ToolSchema[] = [
  RUN_COMMAND_TOOL,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map tool name to ToolCategory (for integration with existing ToolExecutor) */
export function toolNameToCategory(name: string): 'read' | 'exec' | 'write' {
  switch (name) {
    case 'read_file':
    case 'search_files':
    case 'list_directory':
      return 'read';
    case 'write_file':
    case 'edit_file':
      return 'write';
    case 'run_command':
      return 'exec';
    default:
      return 'read';
  }
}

/** Get a tool schema by name */
export function getToolSchema(name: string): ToolSchema | undefined {
  return ALL_TOOLS.find(t => t.name === name);
}

/**
 * Build the tools array for an Anthropic API call.
 * Optionally filter to a subset of tools based on the current context.
 */
export function buildToolsParam(options?: {
  /** Only include read-only tools (safe for ANSWER/PLAN modes) */
  readOnly?: boolean;
  /** Specific tool names to include */
  include?: string[];
  /** Tool names to exclude */
  exclude?: string[];
}): ToolSchema[] {
  let tools = options?.readOnly ? READ_ONLY_TOOLS : ALL_TOOLS;

  if (options?.include) {
    tools = tools.filter(t => options.include!.includes(t.name));
  }
  if (options?.exclude) {
    tools = tools.filter(t => !options.exclude!.includes(t.name));
  }

  return tools;
}
