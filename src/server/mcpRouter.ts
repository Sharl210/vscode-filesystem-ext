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
  defineTool('list_workspaces', '返回当前网关可访问的工作区列表与连接信息。', {}),
  defineTool('listWorkspaces', 'list_workspaces 的 camelCase 别名。', {}),
  defineTool('list_directory', '列出某个工作区目录下的文件与子目录。', {
    workspaceId: { type: 'string' },
    path: OPTIONAL_RELATIVE_DIRECTORY_PROPERTY
  }, ['workspaceId']),
  defineTool('listDirectory', 'list_directory 的 camelCase 别名。', {
    workspaceId: { type: 'string' },
    path: OPTIONAL_RELATIVE_DIRECTORY_PROPERTY
  }, ['workspaceId']),
  defineTool('read_text_file', '按文本方式读取任意文件内容；即使不可编辑也尽量返回字符串内容。', {
    workspaceId: { type: 'string' },
    path: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'path']),
  defineTool('readTextFile', 'read_text_file 的 camelCase 别名。', {
    workspaceId: { type: 'string' },
    path: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'path']),
  defineTool('write_text_file', '写入文本文件内容。', {
    workspaceId: { type: 'string' },
    path: RELATIVE_PATH_PROPERTY,
    content: { type: 'string' }
  }, ['workspaceId', 'path', 'content']),
  defineTool('writeTextFile', 'write_text_file 的 camelCase 别名。', {
    workspaceId: { type: 'string' },
    path: RELATIVE_PATH_PROPERTY,
    content: { type: 'string' }
  }, ['workspaceId', 'path', 'content']),
  defineTool('read_binary_file', '读取文件原始字节并返回 Base64。', {
    workspaceId: { type: 'string' },
    path: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'path']),
  defineTool('readBinaryFile', 'read_binary_file 的 camelCase 别名。', {
    workspaceId: { type: 'string' },
    path: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'path']),
  defineTool('write_binary_file', '以 Base64 写入文件原始字节内容。', {
    workspaceId: { type: 'string' },
    path: RELATIVE_PATH_PROPERTY,
    contentBase64: { type: 'string' }
  }, ['workspaceId', 'path', 'contentBase64']),
  defineTool('writeBinaryFile', 'write_binary_file 的 camelCase 别名。', {
    workspaceId: { type: 'string' },
    path: RELATIVE_PATH_PROPERTY,
    contentBase64: { type: 'string' }
  }, ['workspaceId', 'path', 'contentBase64']),
  defineTool('create_file', '创建空文件。', {
    workspaceId: { type: 'string' },
    path: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'path']),
  defineTool('createFile', 'create_file 的 camelCase 别名。', {
    workspaceId: { type: 'string' },
    path: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'path']),
  defineTool('create_directory', '创建目录。', {
    workspaceId: { type: 'string' },
    path: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'path']),
  defineTool('createDirectory', 'create_directory 的 camelCase 别名。', {
    workspaceId: { type: 'string' },
    path: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'path']),
  defineTool('delete_entry', '删除文件或目录。', {
    workspaceId: { type: 'string' },
    path: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'path']),
  defineTool('deleteEntry', 'delete_entry 的 camelCase 别名。', {
    workspaceId: { type: 'string' },
    path: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'path']),
  defineTool('rename_entry', '在同一工作区内重命名文件或目录。', {
    workspaceId: { type: 'string' },
    fromPath: RELATIVE_PATH_PROPERTY,
    toPath: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'fromPath', 'toPath']),
  defineTool('renameEntry', 'rename_entry 的 camelCase 别名。', {
    workspaceId: { type: 'string' },
    fromPath: RELATIVE_PATH_PROPERTY,
    toPath: RELATIVE_PATH_PROPERTY
  }, ['workspaceId', 'fromPath', 'toPath']),
  defineTool('copy_entry', '复制文件或目录，可跨工作区。', {
    fromWorkspaceId: { type: 'string' },
    fromPath: RELATIVE_PATH_PROPERTY,
    toWorkspaceId: { type: 'string' },
    toPath: RELATIVE_PATH_PROPERTY
  }, ['fromWorkspaceId', 'fromPath', 'toWorkspaceId', 'toPath']),
  defineTool('copyEntry', 'copy_entry 的 camelCase 别名。', {
    fromWorkspaceId: { type: 'string' },
    fromPath: RELATIVE_PATH_PROPERTY,
    toWorkspaceId: { type: 'string' },
    toPath: RELATIVE_PATH_PROPERTY
  }, ['fromWorkspaceId', 'fromPath', 'toWorkspaceId', 'toPath']),
  defineTool('move_entry', '移动文件或目录，可跨工作区。', {
    fromWorkspaceId: { type: 'string' },
    fromPath: RELATIVE_PATH_PROPERTY,
    toWorkspaceId: { type: 'string' },
    toPath: RELATIVE_PATH_PROPERTY
  }, ['fromWorkspaceId', 'fromPath', 'toWorkspaceId', 'toPath']),
  defineTool('moveEntry', 'move_entry 的 camelCase 别名。', {
    fromWorkspaceId: { type: 'string' },
    fromPath: RELATIVE_PATH_PROPERTY,
    toWorkspaceId: { type: 'string' },
    toPath: RELATIVE_PATH_PROPERTY
  }, ['fromWorkspaceId', 'fromPath', 'toWorkspaceId', 'toPath']),
  defineTool('export_archive', '导出路径集合为 tar 归档，返回 Base64。', {
    workspaceId: { type: 'string' },
    paths: {
      type: 'array',
      items: { type: 'string' }
    }
  }, ['workspaceId', 'paths']),
  defineTool('export_disguised_image', '导出路径集合为伪装图片，返回 Base64。', {
    workspaceId: { type: 'string' },
    paths: {
      type: 'array',
      items: { type: 'string' }
    },
    imageDataUrl: { type: 'string' }
  }, ['workspaceId', 'paths', 'imageDataUrl']),
  defineTool('start_export_job', '启动后台导出任务。', {
    workspaceId: { type: 'string' },
    format: { type: 'string', enum: ['archive', 'disguised-image'] },
    paths: {
      type: 'array',
      items: { type: 'string' }
    }
  }, ['workspaceId', 'format', 'paths']),
  defineTool('get_export_job', '查询导出任务状态。', {
    jobId: { type: 'string' }
  }, ['jobId']),
  defineTool('download_export_job', '获取后台导出任务的 Base64 结果。', {
    jobId: { type: 'string' }
  }, ['jobId']),
  defineTool('cancel_export_job', '取消后台导出任务。', {
    jobId: { type: 'string' }
  }, ['jobId']),
  defineTool('new_terminal_tab', '创建新的终端 Tab。', {
    workspaceId: { type: 'string' },
    title: { type: 'string' },
    cwdPath: { type: 'string' }
  }),
  defineTool('newTerminalTab', 'new_terminal_tab 的 camelCase 别名。', {
    workspaceId: { type: 'string' },
    title: { type: 'string' },
    cwdPath: { type: 'string' }
  }),
  defineTool('close_terminal_tab', '关闭指定终端 Tab。', {
    tabId: { type: 'string' }
  }, ['tabId']),
  defineTool('closeTerminalTab', 'close_terminal_tab 的 camelCase 别名。', {
    tabId: { type: 'string' }
  }, ['tabId']),
  defineTool('list_terminal_tabs', '列出所有终端 Tab。', {}),
  defineTool('listTerminalTabs', 'list_terminal_tabs 的 camelCase 别名。', {}),
  defineTool('show_terminal_tab_content', '查看指定终端 Tab 的完整历史输入输出内容。', {
    tabId: { type: 'string' }
  }, ['tabId']),
  defineTool('showTerminalTabContent', 'show_terminal_tab_content 的 camelCase 别名。', {
    tabId: { type: 'string' }
  }, ['tabId']),
  defineTool('terminal_execute', '当文件工具不足时，执行终端命令并返回 stdout/stderr。', {
    workspaceId: { type: 'string' },
    command: { type: 'string' },
    tabId: { type: 'string' },
    cwdPath: { type: 'string' },
    timeoutMs: { type: 'number' }
  }, ['command']),
  defineTool('terminalExecute', 'terminal_execute 的 camelCase 别名。', {
    workspaceId: { type: 'string' },
    command: { type: 'string' },
    tabId: { type: 'string' },
    cwdPath: { type: 'string' },
    timeoutMs: { type: 'number' }
  }, ['command']),
  defineTool('start_terminal_execution', '启动后台终端执行任务，返回 executionId。', {
    workspaceId: { type: 'string' },
    command: { type: 'string' },
    tabId: { type: 'string' },
    cwdPath: { type: 'string' },
    timeoutMs: { type: 'number' }
  }, ['command']),
  defineTool('startTerminalExecution', 'start_terminal_execution 的 camelCase 别名。', {
    workspaceId: { type: 'string' },
    command: { type: 'string' },
    tabId: { type: 'string' },
    cwdPath: { type: 'string' },
    timeoutMs: { type: 'number' }
  }, ['command']),
  defineTool('get_terminal_execution', '查询后台终端执行任务状态。', {
    executionId: { type: 'string' }
  }, ['executionId']),
  defineTool('getTerminalExecution', 'get_terminal_execution 的 camelCase 别名。', {
    executionId: { type: 'string' }
  }, ['executionId']),
  defineTool('get_terminal_execution_output', '查询后台终端执行任务输出。未完成时返回 null。', {
    executionId: { type: 'string' }
  }, ['executionId']),
  defineTool('getTerminalExecutionOutput', 'get_terminal_execution_output 的 camelCase 别名。', {
    executionId: { type: 'string' }
  }, ['executionId']),
  defineTool('cancel_terminal_execution', '取消后台终端执行任务。', {
    executionId: { type: 'string' }
  }, ['executionId']),
  defineTool('cancelTerminalExecution', 'cancel_terminal_execution 的 camelCase 别名。', {
    executionId: { type: 'string' }
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
      timeoutMs: getOptionalNumber(toolArguments, 'timeoutMs')
    });
  }

  if (toolName === 'start_terminal_execution') {
    const tabId = getOptionalStringOrUndefined(toolArguments, 'tabId');
    const cwd = resolveOptionalTerminalCwd(reads, toolArguments);
    return terminal.startExecution({
      command: getRequiredString(toolArguments, 'command'),
      tabId,
      cwd,
      timeoutMs: getOptionalNumber(toolArguments, 'timeoutMs')
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
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties,
      required,
      additionalProperties: false
    }
  };
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
