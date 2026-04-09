import type { GatewayExecutor } from '../executor/contracts';
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

interface McpRouterDependencies {
  executor: Pick<GatewayExecutor, 'reads' | 'files'>;
}

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const MCP_PROTOCOL_VERSION = '2024-11-05';

const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'list_workspaces',
    description: '返回当前网关可访问的工作区列表与连接信息。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: 'list_directory',
    description: '列出某个工作区目录下的文件与子目录。',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        path: { type: 'string' }
      },
      required: ['workspaceId'],
      additionalProperties: false
    }
  },
  {
    name: 'read_text_file',
    description: '读取文本文件内容。',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        path: { type: 'string' }
      },
      required: ['workspaceId', 'path'],
      additionalProperties: false
    }
  },
  {
    name: 'write_text_file',
    description: '写入文本文件内容。',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        path: { type: 'string' },
        content: { type: 'string' }
      },
      required: ['workspaceId', 'path', 'content'],
      additionalProperties: false
    }
  }
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
          name: 'workspace-web-gateway-mcp',
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
            message: 'Internal MCP error'
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
        name: 'workspace-web-gateway-mcp',
        version: '0.0.4'
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
  const { reads, files } = dependencies.executor;

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
    const items = await files.listDirectory(directoryUri, path);
    return {
      workspace,
      path,
      items
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

  throw new McpInvalidParamsError(`Unsupported tool: ${toolName}`);
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
