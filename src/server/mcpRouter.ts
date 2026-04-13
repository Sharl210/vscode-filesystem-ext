import { randomUUID } from 'node:crypto';
import type { GatewayExecutor } from '../executor/contracts';
import type { ExportJobFormatDto } from '../types/api';
import { resolveTerminalCwdPath } from '../workspace/pathResolver';
import type { RouterResponse } from './response';

interface McpRouterRequest {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body: Uint8Array;
}

interface JsonRpcRequest {
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponseSuccess {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}

interface JsonRpcResponseError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: {
    code: number;
    message: string;
  };
}

interface McpRouterDependencies {
  executor: Pick<GatewayExecutor, 'reads' | 'files' | 'exports' | 'terminal'>;
  path?: string;
}

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const MCP_PROTOCOL_VERSION = '2025-11-25';
const MCP_SERVER_NAME = 'vscode-filesystem-ext-mcp';
const DEFAULT_CORS_ALLOW_HEADERS = 'content-type, accept, authorization, mcp-session-id, mcp-protocol-version, x-requested-with';

const RELATIVE_PATH_PROPERTY = {
  type: 'string',
  description: '相对 workspaceId 根目录的路径，例如 README.md 或 src/index.ts。不要传绝对路径。'
};

const OPTIONAL_RELATIVE_DIRECTORY_PROPERTY = {
  type: 'string',
  description: '相对 workspaceId 根目录的目录路径；留空表示工作区根目录。不要传绝对路径。'
};

const WORKSPACE_ID_PROPERTY = {
  type: 'string',
  description: '工作区 ID。先调用 list_workspaces 获取。填错会报 Workspace not found。'
};

const TAB_ID_PROPERTY = {
  type: 'string',
  description: '终端 Tab ID，例如 tab-1。填错会报 Unknown terminal tab。'
};

const EXECUTION_ID_PROPERTY = {
  type: 'string',
  description: '后台终端任务 ID，例如 exec-1。填错会查不到任务。'
};

const JOB_ID_PROPERTY = {
  type: 'string',
  description: '后台导出任务 ID。填错会查不到任务或下载结果。'
};

const COMMAND_PROPERTY = {
  type: 'string',
  description: '要执行的终端命令。空字符串无效。命令在目标 cwd 中执行。'
};

const TIMEOUT_MS_PROPERTY = {
  type: 'number',
  description: '可选超时毫秒数。必须是正数；不填默认 120000（120 秒），过短可能导致任务被提前终止。'
};

const TERMINAL_MODE_PROPERTY = {
  type: 'string',
  enum: ['auto', 'compatibility'],
  description: '可选终端模式。auto 为默认值，优先尝试 VS Code 终端；compatibility 表示直接使用系统终端。'
};

const SHELL_WAIT_PROPERTY = {
  type: 'number',
  description: '可选 shellIntegrationWaitMs，控制等待 shell integration 注入的毫秒数。不填默认 30000，可提高到 60000。'
};

const TITLE_PROPERTY = {
  type: 'string',
  description: '可选终端标题。留空时默认直接使用 tabId。'
};

const CWD_PATH_PROPERTY = {
  type: 'string',
  description: '可选终端工作目录，相对 workspaceId 根目录；留空表示沿用当前 cwd。'
};

const CONTENT_PROPERTY = {
  type: 'string',
  description: '要写入的 UTF-8 文本内容。缺失或非字符串会报 Invalid or missing parameter。'
};

const CONTENT_BASE64_PROPERTY = {
  type: 'string',
  description: 'Base64 编码后的二进制内容。非法 Base64 会导致写入失败。'
};

const EXPORT_FORMAT_PROPERTY = {
  type: 'string',
  enum: ['archive', 'disguised-image'],
  description: '导出格式。只能填 archive 或 disguised-image。'
};

const PATHS_ARRAY_PROPERTY = {
  type: 'array',
  items: { type: 'string' },
  description: '相对 workspaceId 根目录的路径数组。不能为空，任一路径越界都会失败。'
};

const IMAGE_DATA_URL_PROPERTY = {
  type: 'string',
  description: '伪装图片 Data URL。仅 export_disguised_image 需要。'
};

const PARAM_SUMMARY_BY_KEY: Record<string, string> = {
  workspaceId: '先用 list_workspaces 获取',
  fromWorkspaceId: '源工作区 ID',
  toWorkspaceId: '目标工作区 ID',
  path: '相对工作区根目录路径',
  fromPath: '源相对路径',
  toPath: '目标相对路径',
  paths: '非空路径数组',
  content: 'UTF-8 文本',
  contentBase64: 'Base64 二进制',
  imageDataUrl: 'Data URL',
  format: 'archive 或 disguised-image',
  jobId: '后台导出任务 ID',
  tabId: '终端 Tab ID',
  command: '终端命令',
  cwdPath: '相对 cwd 路径',
  timeoutMs: '默认 120000',
  mode: '默认 auto',
  shellIntegrationWaitMs: '默认 30000，可提到 60000',
  executionId: '后台终端任务 ID',
  title: '留空默认 tabId'
};

const TOOL_NAME_ALIASES: Record<string, string> = {
  listWorkspaces: 'list_workspaces',
  listDirectory: 'list_directory',
  readTextFile: 'read_text_file',
  writeTextFile: 'write_text_file',
  readBinaryFile: 'read_binary_file',
  writeBinaryFile: 'write_binary_file',
  createFile: 'create_file',
  createDirectory: 'create_directory',
  deleteEntry: 'delete_entry',
  renameEntry: 'rename_entry',
  copyEntry: 'copy_entry',
  moveEntry: 'move_entry',
  exportArchive: 'export_archive',
  exportDisguisedImage: 'export_disguised_image',
  startExportJob: 'start_export_job',
  getExportJob: 'get_export_job',
  downloadExportJob: 'download_export_job',
  cancelExportJob: 'cancel_export_job',
  newTerminalTab: 'new_terminal_tab',
  closeTerminalTab: 'close_terminal_tab',
  listTerminalTabs: 'list_terminal_tabs',
  showTerminalTabContent: 'show_terminal_tab_content',
  terminalExecute: 'terminal_execute',
  startTerminalExecution: 'start_terminal_execution',
  getTerminalExecution: 'get_terminal_execution',
  getTerminalExecutionOutput: 'get_terminal_execution_output',
  cancelTerminalExecution: 'cancel_terminal_execution'
};

const MCP_TOOLS: McpToolDefinition[] = [
  defineTool('list_workspaces', '列出当前可访问的工作区、连接信息与初始定位。先用它拿 workspaceId。', {}),
  defineTool('listWorkspaces', 'list_workspaces 的 camelCase 别名。', {}),
  defineTool('list_directory', '列出目录内容。适合先探路，再决定读取、写入或导出。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    path: OPTIONAL_RELATIVE_DIRECTORY_PROPERTY
  }, ['workspaceId']),
  defineTool('listDirectory', 'list_directory 的 camelCase 别名。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    path: OPTIONAL_RELATIVE_DIRECTORY_PROPERTY
  }, ['workspaceId']),
  defineTool('read_text_file', '读取文本文件内容。必填 workspaceId 和 path。若路径不存在或越界会失败。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    path: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'path']),
  defineTool('readTextFile', 'read_text_file 的 camelCase 别名。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    path: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'path']),
  defineTool('write_text_file', '写入文本文件。必填 workspaceId、path、content。常见错误是 path 越界或 content 不是字符串。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    path: RELATIVE_PATH_PROPERTY,
    content: CONTENT_PROPERTY
  }, ['workspaceId', 'path', 'content']),
  defineTool('writeTextFile', 'write_text_file 的 camelCase 别名。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    path: RELATIVE_PATH_PROPERTY,
    content: CONTENT_PROPERTY
  }, ['workspaceId', 'path', 'content']),
  defineTool('read_binary_file', '读取文件原始字节并返回 Base64。适合图片、压缩包等二进制文件。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    path: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'path']),
  defineTool('readBinaryFile', 'read_binary_file 的 camelCase 别名。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    path: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'path']),
  defineTool('write_binary_file', '按 Base64 写入二进制文件。必填 workspaceId、path、contentBase64。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    path: RELATIVE_PATH_PROPERTY,
    contentBase64: CONTENT_BASE64_PROPERTY
  }, ['workspaceId', 'path', 'contentBase64']),
  defineTool('writeBinaryFile', 'write_binary_file 的 camelCase 别名。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    path: RELATIVE_PATH_PROPERTY,
    contentBase64: CONTENT_BASE64_PROPERTY
  }, ['workspaceId', 'path', 'contentBase64']),
  defineTool('create_file', '创建空文件。必填 workspaceId 和 path。父目录不存在时会失败。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    path: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'path']),
  defineTool('createFile', 'create_file 的 camelCase 别名。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    path: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'path']),
  defineTool('create_directory', '创建目录。必填 workspaceId 和 path。路径越界会失败。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    path: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'path']),
  defineTool('createDirectory', 'create_directory 的 camelCase 别名。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    path: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'path']),
  defineTool('delete_entry', '删除文件或目录。必填 workspaceId 和 path。删除目录会递归删除其内容。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    path: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'path']),
  defineTool('deleteEntry', 'delete_entry 的 camelCase 别名。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    path: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'path']),
  defineTool('rename_entry', '同一工作区内重命名。必填 workspaceId、fromPath、toPath；toPath 已存在时通常会失败。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    fromPath: RELATIVE_PATH_PROPERTY,
    toPath: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'fromPath', 'toPath']),
  defineTool('renameEntry', 'rename_entry 的 camelCase 别名。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    fromPath: RELATIVE_PATH_PROPERTY,
    toPath: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'fromPath', 'toPath']),
  defineTool('copy_entry', '复制文件或目录，可跨工作区。四个路径参数都必填，任一路径越界都会失败。', {
    fromWorkspaceId: WORKSPACE_ID_PROPERTY,
    fromPath: RELATIVE_PATH_PROPERTY,
    toWorkspaceId: WORKSPACE_ID_PROPERTY,
    toPath: RELATIVE_PATH_PROPERTY
  }, ['fromWorkspaceId', 'fromPath', 'toWorkspaceId', 'toPath']),
  defineTool('copyEntry', 'copy_entry 的 camelCase 别名。', {
    fromWorkspaceId: WORKSPACE_ID_PROPERTY,
    fromPath: RELATIVE_PATH_PROPERTY,
    toWorkspaceId: WORKSPACE_ID_PROPERTY,
    toPath: RELATIVE_PATH_PROPERTY
  }, ['fromWorkspaceId', 'fromPath', 'toWorkspaceId', 'toPath']),
  defineTool('move_entry', '移动文件或目录，可跨工作区。四个路径参数都必填；跨工作区会走复制再删除。', {
    fromWorkspaceId: WORKSPACE_ID_PROPERTY,
    fromPath: RELATIVE_PATH_PROPERTY,
    toWorkspaceId: WORKSPACE_ID_PROPERTY,
    toPath: RELATIVE_PATH_PROPERTY
  }, ['fromWorkspaceId', 'fromPath', 'toWorkspaceId', 'toPath']),
  defineTool('moveEntry', 'move_entry 的 camelCase 别名。', {
    fromWorkspaceId: WORKSPACE_ID_PROPERTY,
    fromPath: RELATIVE_PATH_PROPERTY,
    toWorkspaceId: WORKSPACE_ID_PROPERTY,
    toPath: RELATIVE_PATH_PROPERTY
  }, ['fromWorkspaceId', 'fromPath', 'toWorkspaceId', 'toPath']),
  defineTool('export_archive', '把路径数组导出为 tar 归档并返回 Base64。必填 workspaceId 和非空 paths。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    paths: PATHS_ARRAY_PROPERTY
  }, ['workspaceId', 'paths']),
  defineTool('export_disguised_image', '把路径数组导出为伪装图片并返回 Base64。必填 workspaceId、paths、imageDataUrl。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    paths: PATHS_ARRAY_PROPERTY,
    imageDataUrl: IMAGE_DATA_URL_PROPERTY
  }, ['workspaceId', 'paths', 'imageDataUrl']),
  defineTool('start_export_job', '启动后台导出任务。必填 workspaceId、format、paths；先调 get_export_job 查进度。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    format: EXPORT_FORMAT_PROPERTY,
    paths: PATHS_ARRAY_PROPERTY
  }, ['workspaceId', 'format', 'paths']),
  defineTool('get_export_job', '查询导出任务状态。必填 jobId；可看到 queued、running、completed、failed。', {
    jobId: JOB_ID_PROPERTY
  }, ['jobId']),
  defineTool('download_export_job', '读取后台导出结果。必填 jobId；任务未完成或结果已被消费时会失败。', {
    jobId: JOB_ID_PROPERTY
  }, ['jobId']),
  defineTool('cancel_export_job', '取消后台导出任务。必填 jobId；取消后建议再用 get_export_job 确认最终状态。', {
    jobId: JOB_ID_PROPERTY
  }, ['jobId']),
  defineTool('new_terminal_tab', '创建终端 Tab。workspaceId 与 cwdPath 可选；留空时沿用默认工作区，title 留空则终端名直接用 tabId。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    title: TITLE_PROPERTY,
    cwdPath: CWD_PATH_PROPERTY
  }),
  defineTool('newTerminalTab', 'new_terminal_tab 的 camelCase 别名。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    title: TITLE_PROPERTY,
    cwdPath: CWD_PATH_PROPERTY
  }),
  defineTool('close_terminal_tab', '关闭指定终端 Tab。必填 tabId；填错会报 Unknown terminal tab。', {
    tabId: TAB_ID_PROPERTY
  }, ['tabId']),
  defineTool('closeTerminalTab', 'close_terminal_tab 的 camelCase 别名。', {
    tabId: TAB_ID_PROPERTY
  }, ['tabId']),
  defineTool('list_terminal_tabs', '列出所有终端 Tab、当前 cwd、默认 Tab 和运行状态。无参数。', {}),
  defineTool('listTerminalTabs', 'list_terminal_tabs 的 camelCase 别名。', {}),
  defineTool('show_terminal_tab_content', '读取指定终端 Tab 的历史内容、最近命令和 historyVersion。', {
    tabId: TAB_ID_PROPERTY
  }, ['tabId']),
  defineTool('showTerminalTabContent', 'show_terminal_tab_content 的 camelCase 别名。', {
    tabId: TAB_ID_PROPERTY
  }, ['tabId']),
  defineTool('terminal_execute', '同步执行终端命令并等待结果。必填 command；可选 tabId、workspaceId、cwdPath、timeoutMs、mode、shellIntegrationWaitMs。timeoutMs 默认 120 秒；shellIntegrationWaitMs 默认 30000。在 vscode-terminal 模式下 exitCode 可能为 null。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    command: COMMAND_PROPERTY,
    tabId: TAB_ID_PROPERTY,
    cwdPath: CWD_PATH_PROPERTY,
    timeoutMs: TIMEOUT_MS_PROPERTY,
    mode: TERMINAL_MODE_PROPERTY,
    shellIntegrationWaitMs: SHELL_WAIT_PROPERTY
  }, ['command']),
  defineTool('terminalExecute', 'terminal_execute 的 camelCase 别名。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    command: COMMAND_PROPERTY,
    tabId: TAB_ID_PROPERTY,
    cwdPath: CWD_PATH_PROPERTY,
    timeoutMs: TIMEOUT_MS_PROPERTY,
    mode: TERMINAL_MODE_PROPERTY,
    shellIntegrationWaitMs: SHELL_WAIT_PROPERTY
  }, ['command']),
  defineTool('start_terminal_execution', '启动后台终端任务，立即返回 executionId。后续配合 get_terminal_execution 与 get_terminal_execution_output。timeoutMs 默认 120 秒；shellIntegrationWaitMs 默认 30000。在 vscode-terminal 模式下最终 exitCode 可能为 null。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    command: COMMAND_PROPERTY,
    tabId: TAB_ID_PROPERTY,
    cwdPath: CWD_PATH_PROPERTY,
    timeoutMs: TIMEOUT_MS_PROPERTY,
    mode: TERMINAL_MODE_PROPERTY,
    shellIntegrationWaitMs: SHELL_WAIT_PROPERTY
  }, ['command']),
  defineTool('startTerminalExecution', 'start_terminal_execution 的 camelCase 别名。', {
    workspaceId: WORKSPACE_ID_PROPERTY,
    command: COMMAND_PROPERTY,
    tabId: TAB_ID_PROPERTY,
    cwdPath: CWD_PATH_PROPERTY,
    timeoutMs: TIMEOUT_MS_PROPERTY,
    mode: TERMINAL_MODE_PROPERTY,
    shellIntegrationWaitMs: SHELL_WAIT_PROPERTY
  }, ['command']),
  defineTool('get_terminal_execution', '查询后台终端任务状态。必填 executionId；可看到 queued、running、completed、cancelled。', {
    executionId: EXECUTION_ID_PROPERTY
  }, ['executionId']),
  defineTool('getTerminalExecution', 'get_terminal_execution 的 camelCase 别名。', {
    executionId: EXECUTION_ID_PROPERTY
  }, ['executionId']),
  defineTool('get_terminal_execution_output', '读取后台终端任务输出。未完成时返回 null；已取消任务通常也返回 null。', {
    executionId: EXECUTION_ID_PROPERTY
  }, ['executionId']),
  defineTool('getTerminalExecutionOutput', 'get_terminal_execution_output 的 camelCase 别名。', {
    executionId: EXECUTION_ID_PROPERTY
  }, ['executionId']),
  defineTool('cancel_terminal_execution', '取消后台终端任务。调用成功后应再用 get_terminal_execution 确认最终状态。', {
    executionId: EXECUTION_ID_PROPERTY
  }, ['executionId']),
  defineTool('cancelTerminalExecution', 'cancel_terminal_execution 的 camelCase 别名。', {
    executionId: EXECUTION_ID_PROPERTY
  }, ['executionId'])
];

export function createMcpRouter(dependencies: McpRouterDependencies) {
  const mcpPath = normalizeMcpPath(dependencies.path);
  const sessionId = randomUUID();
  const canonicalPaths = new Set<string>([
    canonicalizePathForMatch(mcpPath),
    canonicalizePathForMatch('/mcp')
  ]);

  return {
    async handle(request: McpRouterRequest): Promise<RouterResponse> {
      const corsHeaders = buildCorsHeaders(request.headers);
      const url = new URL(request.url, 'http://127.0.0.1');
      if (!canonicalPaths.has(canonicalizePathForMatch(url.pathname))) {
        return sendJson({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32601,
            message: 'Method not found'
          }
        }, 404, corsHeaders, sessionId);
      }

      if (request.method === 'OPTIONS') {
        return {
          status: 204,
          headers: {
            ...corsHeaders,
            ...buildMcpHeaders(sessionId)
          },
          body: new Uint8Array()
        };
      }

      if (request.method === 'GET') {
        if (acceptsEventStream(request.headers.accept)) {
          return {
            status: 405,
            headers: {
              ...corsHeaders,
              ...buildMcpHeaders(sessionId),
              allow: 'POST, OPTIONS'
            },
            body: new Uint8Array()
          };
        }

        return sendJson({
          name: MCP_SERVER_NAME,
          transport: 'streamable-http',
          endpoint: mcpPath,
          protocolVersion: MCP_PROTOCOL_VERSION
        }, 200, corsHeaders, sessionId);
      }

      if (request.method !== 'POST') {
        return sendJson({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32600,
            message: 'Invalid Request'
          }
        }, 400, corsHeaders, sessionId);
      }

      const payload = parseJson<unknown>(request.body);
      if (!payload.ok) {
        return sendJson({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Parse error'
          }
        }, 400, corsHeaders, sessionId);
      }

      if (Array.isArray(payload.data)) {
        if (payload.data.length === 0) {
          return sendJson({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32600,
              message: 'Invalid Request'
            }
          }, 400, corsHeaders, sessionId);
        }

        const responses: Array<JsonRpcResponseSuccess | JsonRpcResponseError> = [];
        for (const requestPayload of payload.data) {
          const responsePayload = await handleJsonRpcRequest(requestPayload, dependencies);
          if (responsePayload) {
            responses.push(responsePayload);
          }
        }

        if (responses.length === 0) {
          return {
            status: 202,
            headers: {
              ...corsHeaders,
              ...buildMcpHeaders(sessionId)
            },
            body: new Uint8Array()
          };
        }

        return sendJson(responses, 200, corsHeaders, sessionId);
      }

      const responsePayload = await handleJsonRpcRequest(payload.data, dependencies);
      if (!responsePayload) {
        return {
          status: 202,
          headers: {
            ...corsHeaders,
            ...buildMcpHeaders(sessionId)
          },
          body: new Uint8Array()
        };
      }

      return sendJson(responsePayload, 200, corsHeaders, sessionId);
    }
  };
}

async function handleJsonRpcRequest(
  payload: unknown,
  dependencies: McpRouterDependencies
): Promise<JsonRpcResponseSuccess | JsonRpcResponseError | null> {
  if (!isJsonRpcRequest(payload)) {
    return {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32600,
        message: 'Invalid Request'
      }
    };
  }

  const id = payload.id ?? null;

  if (id === null && payload.method.startsWith('notifications/')) {
    return null;
  }

  try {
    const result = await handleMethod(payload, dependencies);
    return { jsonrpc: '2.0', id, result };
  } catch (error) {
    if (error instanceof McpInvalidParamsError) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32602,
          message: error.message
        }
      };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : 'Internal MCP error'
      }
    };
  }
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const method = (value as { method?: unknown }).method;
  return typeof method === 'string' && method.length > 0;
}

function normalizeMcpPath(path: string | undefined): string {
  const normalized = (path ?? '').trim();
  if (!normalized) {
    return '/mcp';
  }

  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return canonicalizePathForMatch(withLeadingSlash);
}

function canonicalizePathForMatch(path: string): string {
  if (path === '/') {
    return '/';
  }

  return path.replace(/\/+$/, '') || '/';
}

async function handleMethod(request: JsonRpcRequest, dependencies: McpRouterDependencies): Promise<unknown> {
  if (request.method === 'initialize') {
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: {},
        prompts: {},
        resources: {}
      },
      serverInfo: {
        name: MCP_SERVER_NAME,
        version: '0.0.10'
      }
    };
  }

  if (request.method === 'ping') {
    return {};
  }

  if (request.method === 'prompts/list') {
    return {
      prompts: []
    };
  }

  if (request.method === 'resources/list') {
    return {
      resources: []
    };
  }

  if (request.method === 'resources/templates/list') {
    return {
      resourceTemplates: []
    };
  }

  if (request.method === 'logging/setLevel') {
    return {};
  }

  if (request.method === 'tools/list') {
    return {
      tools: MCP_TOOLS
    };
  }

  if (request.method === 'tools/call') {
    const params = asRecord(request.params);
    const toolName = canonicalizeToolName(getRequiredString(params, 'name'));
    const toolArguments = asRecord(params.arguments);
    const toolResult = await handleToolCall(toolName, toolArguments, dependencies);
    return buildToolCallResult(toolResult);
  }

  throw new McpInvalidParamsError(`Unsupported method: ${request.method}`);
}

async function handleToolCall(
  toolName: string,
  toolArguments: Record<string, unknown>,
  dependencies: McpRouterDependencies
): Promise<unknown> {
  const { reads, files, exports, terminal } = dependencies.executor;

  if (toolName === 'list_workspaces') {
    return {
      workspaces: reads.getWorkspaces(),
      connection: reads.getConnectionInfo(),
      initialLocation: reads.getInitialLocation()
    };
  }

  if (toolName === 'list_directory') {
    const workspace = resolveWorkspace(reads, getRequiredString(toolArguments, 'workspaceId'));
    const path = getOptionalString(toolArguments, 'path');
    const directoryUri = resolveWorkspacePath(reads, workspace.uri, path);
    return {
      workspace,
      path,
      items: await files.listDirectory(directoryUri, path)
    };
  }

  if (toolName === 'read_text_file') {
    const workspace = resolveWorkspace(reads, getRequiredString(toolArguments, 'workspaceId'));
    const path = getRequiredString(toolArguments, 'path');
    const fileUri = resolveWorkspacePath(reads, workspace.uri, path);
    return files.readTextFile(fileUri, path);
  }

  if (toolName === 'write_text_file') {
    const workspace = resolveWorkspace(reads, getRequiredString(toolArguments, 'workspaceId'));
    const path = getRequiredString(toolArguments, 'path');
    const content = getRequiredString(toolArguments, 'content');
    const fileUri = resolveWorkspacePath(reads, workspace.uri, path);
    await files.writeTextFile(fileUri, content);
    return {
      saved: true,
      workspaceId: workspace.id,
      path
    };
  }

  if (toolName === 'read_binary_file') {
    const workspace = resolveWorkspace(reads, getRequiredString(toolArguments, 'workspaceId'));
    const path = getRequiredString(toolArguments, 'path');
    const fileUri = resolveWorkspacePath(reads, workspace.uri, path);
    const payload = await files.readBinaryFile(fileUri, path);
    return encodeBinaryPayload(payload);
  }

  if (toolName === 'write_binary_file') {
    const workspace = resolveWorkspace(reads, getRequiredString(toolArguments, 'workspaceId'));
    const path = getRequiredString(toolArguments, 'path');
    const contentBase64 = getRequiredString(toolArguments, 'contentBase64');
    const fileUri = resolveWorkspacePath(reads, workspace.uri, path);
    await files.writeFileBytes(fileUri, decodeBase64(contentBase64));
    return {
      saved: true,
      workspaceId: workspace.id,
      path
    };
  }

  if (toolName === 'create_file') {
    const workspace = resolveWorkspace(reads, getRequiredString(toolArguments, 'workspaceId'));
    const path = getRequiredString(toolArguments, 'path');
    const fileUri = resolveWorkspacePath(reads, workspace.uri, path);
    await files.createFile(fileUri);
    return {
      created: true,
      workspaceId: workspace.id,
      path
    };
  }

  if (toolName === 'create_directory') {
    const workspace = resolveWorkspace(reads, getRequiredString(toolArguments, 'workspaceId'));
    const path = getRequiredString(toolArguments, 'path');
    const targetUri = resolveWorkspacePath(reads, workspace.uri, path);
    await files.createDirectory(targetUri);
    return {
      created: true,
      workspaceId: workspace.id,
      path
    };
  }

  if (toolName === 'delete_entry') {
    const workspace = resolveWorkspace(reads, getRequiredString(toolArguments, 'workspaceId'));
    const path = getRequiredString(toolArguments, 'path');
    const targetUri = resolveWorkspacePath(reads, workspace.uri, path);
    await files.deleteEntry(targetUri);
    return {
      deleted: true,
      workspaceId: workspace.id,
      path
    };
  }

  if (toolName === 'rename_entry') {
    const workspace = resolveWorkspace(reads, getRequiredString(toolArguments, 'workspaceId'));
    const fromPath = getRequiredString(toolArguments, 'fromPath');
    const toPath = getRequiredString(toolArguments, 'toPath');
    await files.renameEntry(
      resolveWorkspacePath(reads, workspace.uri, fromPath),
      resolveWorkspacePath(reads, workspace.uri, toPath)
    );
    return {
      renamed: true,
      workspaceId: workspace.id,
      fromPath,
      toPath
    };
  }

  if (toolName === 'copy_entry' || toolName === 'move_entry') {
    const fromWorkspace = resolveWorkspace(reads, getRequiredString(toolArguments, 'fromWorkspaceId'));
    const toWorkspace = resolveWorkspace(reads, getRequiredString(toolArguments, 'toWorkspaceId'));
    const fromPath = getRequiredString(toolArguments, 'fromPath');
    const toPath = getRequiredString(toolArguments, 'toPath');
    const fromUri = resolveWorkspacePath(reads, fromWorkspace.uri, fromPath);
    const toUri = resolveWorkspacePath(reads, toWorkspace.uri, toPath);

    if (toolName === 'copy_entry') {
      await files.copyEntry(fromUri, toUri);
      return {
        copied: true,
        fromWorkspaceId: fromWorkspace.id,
        toWorkspaceId: toWorkspace.id,
        fromPath,
        toPath
      };
    }

    await files.moveEntry(fromUri, toUri);
    return {
      moved: true,
      fromWorkspaceId: fromWorkspace.id,
      toWorkspaceId: toWorkspace.id,
      fromPath,
      toPath
    };
  }

  if (toolName === 'export_archive' || toolName === 'export_disguised_image') {
    const workspace = resolveWorkspace(reads, getRequiredString(toolArguments, 'workspaceId'));
    const paths = getRequiredStringArray(toolArguments, 'paths');
    const exportEntries = resolveExportEntries(reads, workspace.uri, paths);

    if (toolName === 'export_archive') {
      return encodeBinaryPayload(await files.exportArchive(exportEntries));
    }

    return encodeBinaryPayload(
      await files.exportDisguisedImage(exportEntries, getRequiredString(toolArguments, 'imageDataUrl'))
    );
  }

  if (toolName === 'start_export_job') {
    const workspace = resolveWorkspace(reads, getRequiredString(toolArguments, 'workspaceId'));
    const format = getRequiredFormat(toolArguments, 'format');
    const paths = getRequiredStringArray(toolArguments, 'paths');
    return exports.startJob({
      workspaceUri: workspace.uri,
      paths,
      format
    });
  }

  if (toolName === 'get_export_job') {
    return exports.getJob(getRequiredString(toolArguments, 'jobId'));
  }

  if (toolName === 'download_export_job') {
    const download = exports.consumeDownload(getRequiredString(toolArguments, 'jobId'));
    if (!download) {
      throw new McpInvalidParamsError('Export job download is unavailable');
    }

    return encodeBinaryPayload(download);
  }

  if (toolName === 'cancel_export_job') {
    return {
      cancelled: exports.cancelJob(getRequiredString(toolArguments, 'jobId'))
    };
  }

  if (toolName === 'new_terminal_tab') {
    return terminal.newTab({
      title: getOptionalStringOrUndefined(toolArguments, 'title'),
      cwd: resolveOptionalTerminalCwd(reads, toolArguments)
    });
  }

  if (toolName === 'close_terminal_tab') {
    const tabId = getRequiredString(toolArguments, 'tabId');
    const snapshot = await terminal.closeTab(tabId, { initiatedBy: 'mcp' });
    return {
      closed: true,
      closedTabId: tabId,
      defaultTabId: snapshot.defaultTabId,
      tabs: snapshot.tabs
    };
  }

  if (toolName === 'list_terminal_tabs') {
    return terminal.listTabs();
  }

  if (toolName === 'show_terminal_tab_content') {
    return terminal.getTabContent(getRequiredString(toolArguments, 'tabId'));
  }

  if (toolName === 'terminal_execute') {
    const tabId = getOptionalStringOrUndefined(toolArguments, 'tabId');
    const cwd = resolveOptionalTerminalCwd(reads, toolArguments);
    return terminal.execute({
      command: getRequiredString(toolArguments, 'command'),
      tabId,
      cwd,
      timeoutMs: getOptionalNumber(toolArguments, 'timeoutMs'),
      mode: getOptionalMode(toolArguments),
      shellIntegrationWaitMs: getOptionalNumber(toolArguments, 'shellIntegrationWaitMs')
    });
  }

  if (toolName === 'start_terminal_execution') {
    const tabId = getOptionalStringOrUndefined(toolArguments, 'tabId');
    const cwd = resolveOptionalTerminalCwd(reads, toolArguments);
    return terminal.startExecution({
      command: getRequiredString(toolArguments, 'command'),
      tabId,
      cwd,
      timeoutMs: getOptionalNumber(toolArguments, 'timeoutMs'),
      mode: getOptionalMode(toolArguments),
      shellIntegrationWaitMs: getOptionalNumber(toolArguments, 'shellIntegrationWaitMs')
    });
  }

  if (toolName === 'get_terminal_execution') {
    return terminal.getExecution(getRequiredString(toolArguments, 'executionId'));
  }

  if (toolName === 'get_terminal_execution_output') {
    return terminal.getExecutionOutput(getRequiredString(toolArguments, 'executionId'));
  }

  if (toolName === 'cancel_terminal_execution') {
    const executionId = getRequiredString(toolArguments, 'executionId');
    return {
      executionId,
      cancelled: terminal.cancelExecution(executionId)
    };
  }

  throw new McpInvalidParamsError(`Unsupported tool: ${toolName}`);
}

function defineTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = []
): McpToolDefinition {
  const propertyNames = Object.keys(properties);
  const optional = propertyNames.filter((key) => !required.includes(key));

  return {
    name,
    description: buildToolDescription(description, required, optional),
    inputSchema: {
      type: 'object',
      properties,
      required,
      additionalProperties: false
    }
  };
}

function buildToolDescription(description: string, required: string[], optional: string[]) {
  const segments = [description.trim()];

  if (required.length === 0 && optional.length === 0) {
    segments.push('参数：无。');
    return segments.join(' ');
  }

  if (required.length > 0) {
    segments.push(`必填：${required.map(formatParamSummary).join('，')}。`);
  }

  if (optional.length > 0) {
    segments.push(`可选：${optional.map(formatParamSummary).join('，')}。`);
  }

  return segments.join(' ');
}

function formatParamSummary(name: string) {
  const summary = PARAM_SUMMARY_BY_KEY[name];
  return summary ? `${name}（${summary}）` : name;
}


function canonicalizeToolName(toolName: string): string {
  return TOOL_NAME_ALIASES[toolName] ?? toolName;
}

function resolveWorkspace(
  reads: Pick<GatewayExecutor['reads'], 'getWorkspaceById'>,
  workspaceId: string
) {
  const workspace = reads.getWorkspaceById(workspaceId);
  if (!workspace) {
    throw new McpInvalidParamsError(`Workspace not found: ${workspaceId}`);
  }

  return workspace;
}

function resolveWorkspacePath(
  reads: Pick<GatewayExecutor['reads'], 'resolveWorkspacePath'>,
  workspaceUri: string,
  relativePath: string
): string {
  try {
    return reads.resolveWorkspacePath(workspaceUri, relativePath);
  } catch {
    throw new McpInvalidParamsError('Path is outside workspace scope');
  }
}

function resolveExportEntries(
  reads: Pick<GatewayExecutor['reads'], 'resolveWorkspacePath'>,
  workspaceUri: string,
  paths: string[]
) {
  return paths.map((path) => ({
    uri: resolveWorkspacePath(reads, workspaceUri, path),
    path
  }));
}

function parseJson<T>(body: Uint8Array): { ok: true; data: T } | { ok: false } {
  if (body.byteLength === 0) {
    return { ok: false };
  }

  try {
    return {
      ok: true,
      data: JSON.parse(new TextDecoder().decode(body)) as T
    };
  } catch {
    return { ok: false };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function getRequiredString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new McpInvalidParamsError(`Invalid or missing parameter: ${key}`);
  }

  return value;
}

function getOptionalString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string') {
    return '';
  }

  return value;
}

function getOptionalStringOrUndefined(payload: Record<string, unknown>, key: string): string | undefined {
  const value = getOptionalString(payload, key).trim();
  return value === '' ? undefined : value;
}

function getOptionalNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return value;
}

function getOptionalMode(payload: Record<string, unknown>): 'auto' | 'compatibility' | undefined {
  const value = payload.mode;
  return value === 'auto' || value === 'compatibility' ? value : undefined;
}

function getRequiredStringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new McpInvalidParamsError(`Invalid or missing parameter: ${key}`);
  }

  return value;
}

function getRequiredFormat(payload: Record<string, unknown>, key: string): ExportJobFormatDto {
  const value = getRequiredString(payload, key);
  if (value !== 'archive' && value !== 'disguised-image') {
    throw new McpInvalidParamsError(`Invalid export format: ${value}`);
  }

  return value;
}

function resolveOptionalTerminalCwd(
  reads: Pick<GatewayExecutor['reads'], 'getWorkspaceById'>,
  payload: Record<string, unknown>
): string | undefined {
  const workspaceId = getOptionalStringOrUndefined(payload, 'workspaceId');
  const cwdPath = getOptionalString(payload, 'cwdPath');

  if (!workspaceId) {
    return cwdPath === '' ? undefined : cwdPath;
  }

  const workspace = resolveWorkspace(reads, workspaceId);
  return resolveTerminalCwdPath(workspace.uri, cwdPath);
}

function encodeBinaryPayload(payload: { data: Uint8Array; mimeType: string; fileName: string }) {
  return {
    fileName: payload.fileName,
    mimeType: payload.mimeType,
    contentBase64: Buffer.from(payload.data).toString('base64')
  };
}

function decodeBase64(contentBase64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(contentBase64, 'base64'));
}

function buildCorsHeaders(requestHeaders: Record<string, string | undefined>) {
  const origin = requestHeaders.origin?.trim();
  const requestedHeaders = requestHeaders['access-control-request-headers']?.trim();
  const privateNetworkRequested = requestHeaders['access-control-request-private-network']?.trim().toLowerCase() === 'true';

  const headers: Record<string, string> = {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': requestedHeaders || DEFAULT_CORS_ALLOW_HEADERS,
    'access-control-max-age': '600',
    'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version'
  };

  if (origin) {
    headers.vary = 'origin, access-control-request-headers, access-control-request-private-network';
  }
  if (privateNetworkRequested) {
    headers['access-control-allow-private-network'] = 'true';
  }

  return headers;
}

function sendJson(
  payload: unknown,
  status = 200,
  corsHeaders: Record<string, string> = buildCorsHeaders({}),
  sessionId = randomUUID()
): RouterResponse {
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders,
      ...buildMcpHeaders(sessionId)
    },
    body: new TextEncoder().encode(JSON.stringify(payload)),
    jsonBody: payload
  };
}

function buildMcpHeaders(sessionId: string) {
  return {
    'mcp-protocol-version': MCP_PROTOCOL_VERSION,
    'mcp-session-id': sessionId
  };
}

function buildToolCallResult(toolResult: unknown) {
  const response: {
    content: Array<{ type: 'text'; text: string }>;
    structuredContent?: unknown;
  } = {
    content: [
      {
        type: 'text',
        text: JSON.stringify(toolResult, null, 2)
      }
    ]
  };

  if (toolResult !== null) {
    response.structuredContent = toolResult;
  }

  return response;
}

function acceptsEventStream(acceptHeader: string | undefined) {
  if (!acceptHeader) {
    return false;
  }

  return acceptHeader
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .some((value) => value === 'text/event-stream' || value.startsWith('text/event-stream;'));
}

class McpInvalidParamsError extends Error {}
