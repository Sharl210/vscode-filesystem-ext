import type { GatewayExecutor } from '../executor/contracts';
import type { ExportJobFormatDto } from '../types/api';
import type { RouterResponse } from './response';
import { resolveTerminalCwdPath } from '../workspace/pathResolver';

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

interface McpRouterDependencies {
  executor: Pick<GatewayExecutor, 'reads' | 'files' | 'exports' | 'terminal'>;
}

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const MCP_PROTOCOL_VERSION = '2024-11-05';
const MCP_SERVER_NAME = 'vscode-filesystem-ext-mcp';

const MCP_TOOLS: McpToolDefinition[] = [
  defineTool('list_workspaces', '返回当前网关可访问的工作区列表与连接信息。', {}),
  defineTool('list_directory', '列出某个工作区目录下的文件与子目录。', {
    workspaceId: { type: 'string' },
    path: { type: 'string' }
  }, ['workspaceId']),
  defineTool('read_text_file', '按文本方式读取任意文件内容；即使不可编辑也尽量返回字符串内容。', {
    workspaceId: { type: 'string' },
    path: { type: 'string' }
  }, ['workspaceId', 'path']),
  defineTool('write_text_file', '写入文本文件内容。', {
    workspaceId: { type: 'string' },
    path: { type: 'string' },
    content: { type: 'string' }
  }, ['workspaceId', 'path', 'content']),
  defineTool('read_binary_file', '读取文件原始字节并返回 Base64。', {
    workspaceId: { type: 'string' },
    path: { type: 'string' }
  }, ['workspaceId', 'path']),
  defineTool('write_binary_file', '以 Base64 写入文件原始字节内容。', {
    workspaceId: { type: 'string' },
    path: { type: 'string' },
    contentBase64: { type: 'string' }
  }, ['workspaceId', 'path', 'contentBase64']),
  defineTool('create_file', '创建空文件。', {
    workspaceId: { type: 'string' },
    path: { type: 'string' }
  }, ['workspaceId', 'path']),
  defineTool('create_directory', '创建目录。', {
    workspaceId: { type: 'string' },
    path: { type: 'string' }
  }, ['workspaceId', 'path']),
  defineTool('delete_entry', '删除文件或目录。', {
    workspaceId: { type: 'string' },
    path: { type: 'string' }
  }, ['workspaceId', 'path']),
  defineTool('rename_entry', '在同一工作区内重命名文件或目录。', {
    workspaceId: { type: 'string' },
    fromPath: { type: 'string' },
    toPath: { type: 'string' }
  }, ['workspaceId', 'fromPath', 'toPath']),
  defineTool('copy_entry', '复制文件或目录，可跨工作区。', {
    fromWorkspaceId: { type: 'string' },
    fromPath: { type: 'string' },
    toWorkspaceId: { type: 'string' },
    toPath: { type: 'string' }
  }, ['fromWorkspaceId', 'fromPath', 'toWorkspaceId', 'toPath']),
  defineTool('move_entry', '移动文件或目录，可跨工作区。', {
    fromWorkspaceId: { type: 'string' },
    fromPath: { type: 'string' },
    toWorkspaceId: { type: 'string' },
    toPath: { type: 'string' }
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
  defineTool('cancel_export_job', '取消导出任务。', {
    jobId: { type: 'string' }
  }, ['jobId']),
  defineTool('terminal_execute', '当文件工具不足时，执行终端命令并返回 stdout/stderr。', {
    workspaceId: { type: 'string' },
    command: { type: 'string' },
    cwdPath: { type: 'string' },
    timeoutMs: { type: 'number' }
  }, ['workspaceId', 'command'])
];

export function createMcpRouter(dependencies: McpRouterDependencies) {
  return {
    async handle(request: McpRouterRequest): Promise<RouterResponse> {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname !== '/mcp') {
        return sendJson({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32601,
            message: 'Method not found'
          }
        }, 404);
      }

      if (request.method === 'GET') {
        return sendJson({
          name: MCP_SERVER_NAME,
          transport: 'streamable-http',
          endpoint: '/mcp',
          protocolVersion: MCP_PROTOCOL_VERSION
        });
      }

      if (request.method !== 'POST') {
        return sendJson({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32600,
            message: 'Invalid Request'
          }
        }, 400);
      }

      const payload = parseJson<JsonRpcRequest>(request.body);
      if (!payload.ok || typeof payload.data.method !== 'string') {
        return sendJson({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Parse error'
          }
        }, 400);
      }

      const id = payload.data.id ?? null;

      if (id === null && payload.data.method === 'notifications/initialized') {
        return {
          status: 202,
          headers: {},
          body: new Uint8Array()
        };
      }

      try {
        const result = await handleMethod(payload.data, dependencies);
        return sendJson({ jsonrpc: '2.0', id, result });
      } catch (error) {
        if (error instanceof McpInvalidParamsError) {
          return sendJson({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32602,
              message: error.message
            }
          }, 400);
        }

        return sendJson({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : 'Internal MCP error'
          }
        }, 500);
      }
    }
  };
}

async function handleMethod(request: JsonRpcRequest, dependencies: McpRouterDependencies): Promise<unknown> {
  if (request.method === 'initialize') {
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: MCP_SERVER_NAME,
        version: '0.0.6'
      }
    };
  }

  if (request.method === 'tools/list') {
    return {
      tools: MCP_TOOLS
    };
  }

  if (request.method === 'tools/call') {
    const params = asRecord(request.params);
    const toolName = getRequiredString(params, 'name');
    const toolArguments = asRecord(params.arguments);
    const toolResult = await handleToolCall(toolName, toolArguments, dependencies);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(toolResult, null, 2)
        }
      ],
      structuredContent: toolResult
    };
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

  if (toolName === 'terminal_execute') {
    const workspace = resolveWorkspace(reads, getRequiredString(toolArguments, 'workspaceId'));
    const cwdPath = getOptionalString(toolArguments, 'cwdPath');
    const cwd = resolveTerminalCwdPath(workspace.uri, cwdPath);
    return terminal.execute({
      command: getRequiredString(toolArguments, 'command'),
      cwd,
      timeoutMs: getOptionalNumber(toolArguments, 'timeoutMs')
    });
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

function sendJson(payload: unknown, status = 200): RouterResponse {
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8'
    },
    body: new TextEncoder().encode(JSON.stringify(payload)),
    jsonBody: payload
  };
}

class McpInvalidParamsError extends Error {}
