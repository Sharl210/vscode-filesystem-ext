import { describe, expect, it, vi } from 'vitest';
import { createMcpRouter } from '../../src/server/mcpRouter';

function createRouterForTest() {
  const executor = {
    reads: {
      getWorkspaces: vi.fn(() => [
        {
          id: 'ws_demo',
          name: 'demo',
          uri: 'file:///workspace/demo',
          source: 'workspace' as const
        }
      ]),
      getInitialLocation: vi.fn(() => null),
      getConnectionInfo: vi.fn(() => ({
        kind: 'local' as const,
        label: '本机',
        host: 'local-host',
        remoteName: null,
        authority: null
      })),
      getWorkspaceById: vi.fn((id: string) => (id === 'ws_demo'
        ? {
            id: 'ws_demo',
            name: 'demo',
            uri: 'file:///workspace/demo',
            source: 'workspace' as const
          }
        : undefined)),
      resolveWorkspacePath: vi.fn((workspaceUri: string, relativePath: string) => `${workspaceUri}/${relativePath}`)
    },
    files: {
      listDirectory: vi.fn(async () => []),
      readTextFile: vi.fn(async () => ({
        file: {
          name: 'a.ts',
          path: 'a.ts',
          type: 'file' as const,
          size: 1,
          mtime: 1,
          mimeType: 'text/typescript',
          isText: true,
          downloadable: true
        },
        content: 'export const a = 1;',
        encoding: 'utf-8' as const,
        editable: true
      })),
      writeTextFile: vi.fn(async () => {}),
      readBinaryFile: vi.fn(),
      exportArchive: vi.fn(),
      exportDisguisedImage: vi.fn(),
      uploadFile: vi.fn(),
      createFile: vi.fn(),
      writeFileBytes: vi.fn(),
      deleteEntry: vi.fn(),
      createDirectory: vi.fn(),
      renameEntry: vi.fn(),
      copyEntry: vi.fn(),
      moveEntry: vi.fn()
    }
  };

  return createMcpRouter({
    executor: executor as never
  });
}

describe('mcp router', () => {
  it('returns mcp endpoint metadata on GET /mcp', async () => {
    const router = createRouterForTest();
    const response = await router.handle({
      method: 'GET',
      url: '/mcp',
      headers: {},
      body: new Uint8Array()
    });

    expect(response.status).toBe(200);
    expect(response.jsonBody).toMatchObject({
      name: 'workspace-web-gateway-mcp',
      transport: 'streamable-http',
      endpoint: '/mcp'
    });
  });

  it('supports initialize and tools/list JSON-RPC methods', async () => {
    const router = createRouterForTest();

    const initializeResponse = await router.handle({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json'
      },
      body: new TextEncoder().encode(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {}
      }))
    });

    expect(initializeResponse.status).toBe(200);
    expect(initializeResponse.jsonBody).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        capabilities: {
          tools: {}
        }
      }
    });

    const listResponse = await router.handle({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json'
      },
      body: new TextEncoder().encode(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list'
      }))
    });

    expect(listResponse.status).toBe(200);
    expect(listResponse.jsonBody).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: 'list_workspaces'
          })
        ])
      }
    });
  });
});
