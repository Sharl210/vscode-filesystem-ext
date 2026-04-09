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
    },
    exports: {
      startJob: vi.fn(() => ({
        jobId: 'job-1',
        status: 'running',
        format: 'archive',
        progress: 10,
        stage: 'preparing',
        currentMessage: 'running',
        messages: ['running'],
        fileName: null,
        error: null
      })),
      getJob: vi.fn(() => null),
      getDownload: vi.fn(() => ({
        data: new TextEncoder().encode('archive-bytes'),
        mimeType: 'application/x-tar',
        fileName: 'archive.tar'
      })),
      consumeDownload: vi.fn(() => ({
        data: new TextEncoder().encode('archive-bytes'),
        mimeType: 'application/x-tar',
        fileName: 'archive.tar'
      })),
      cancelJob: vi.fn(() => true)
    },
    terminal: {
      execute: vi.fn(async () => ({
        command: 'pwd',
        cwd: '/workspace/demo',
        exitCode: 0,
        stdout: '/workspace/demo\n',
        stderr: '',
        combinedOutput: '/workspace/demo\n',
        timedOut: false
      }))
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
      name: 'vscode-filesystem-ext-mcp',
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
          }),
          expect.objectContaining({
            name: 'create_file'
          }),
          expect.objectContaining({
            name: 'terminal_execute'
          })
        ])
      }
    });
  });

  it('exposes file mutation, export job, and terminal fallback tools', async () => {
    const router = createRouterForTest();

    const fileResponse = await router.handle({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json'
      },
      body: new TextEncoder().encode(JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'create_file',
          arguments: {
            workspaceId: 'ws_demo',
            path: 'src/new.ts'
          }
        }
      }))
    });

    expect(fileResponse.status).toBe(200);
    expect(fileResponse.jsonBody).toMatchObject({
      jsonrpc: '2.0',
      id: 3,
      result: {
        structuredContent: {
          created: true,
          path: 'src/new.ts'
        }
      }
    });

    const exportResponse = await router.handle({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json'
      },
      body: new TextEncoder().encode(JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'start_export_job',
          arguments: {
            workspaceId: 'ws_demo',
            format: 'archive',
            paths: ['src']
          }
        }
      }))
    });

    expect(exportResponse.status).toBe(200);
    expect(exportResponse.jsonBody).toMatchObject({
      jsonrpc: '2.0',
      id: 4,
      result: {
        structuredContent: {
          jobId: 'job-1'
        }
      }
    });

    const terminalResponse = await router.handle({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json'
      },
      body: new TextEncoder().encode(JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'terminal_execute',
          arguments: {
            workspaceId: 'ws_demo',
            command: 'pwd'
          }
        }
      }))
    });

    expect(terminalResponse.status).toBe(200);
    expect(terminalResponse.jsonBody).toMatchObject({
      jsonrpc: '2.0',
      id: 5,
      result: {
        structuredContent: {
          command: 'pwd',
          exitCode: 0,
          stdout: '/workspace/demo\n'
        }
      }
    });
  });

  it('maps terminal cwdPath to a workspace-contained filesystem path before execution', async () => {
    const terminalExecute = vi.fn(async () => ({
      command: 'pwd',
      cwd: 'z:/home/harl/at_parser',
      exitCode: 0,
      stdout: 'z:/home/harl/at_parser\n',
      stderr: '',
      combinedOutput: 'z:/home/harl/at_parser\n',
      timedOut: false
    }));
    const router = createMcpRouter({
      executor: {
        reads: {
          getWorkspaces: vi.fn(() => []),
          getInitialLocation: vi.fn(() => null),
          getConnectionInfo: vi.fn(() => ({ kind: 'local', label: '本机', host: 'local', remoteName: null, authority: null })),
          getWorkspaceById: vi.fn(() => ({
            id: 'ws_demo',
            name: 'demo',
            uri: 'file:///z%3A/home/harl/at_parser',
            source: 'workspace' as const
          })),
          resolveWorkspacePath: vi.fn(() => {
            throw new Error('relative resolver should not be used for absolute cwdPath');
          })
        },
        files: {
          listDirectory: vi.fn(),
          readTextFile: vi.fn(),
          writeTextFile: vi.fn(),
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
        },
        exports: {
          startJob: vi.fn(),
          getJob: vi.fn(),
          getDownload: vi.fn(),
          consumeDownload: vi.fn(),
          cancelJob: vi.fn()
        },
        terminal: {
          execute: terminalExecute
        }
      } as never
    });

    const response = await router.handle({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode(JSON.stringify({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'terminal_execute',
          arguments: {
            workspaceId: 'ws_demo',
            cwdPath: 'z:/home/harl/at_parser',
            command: 'pwd'
          }
        }
      }))
    });

    expect(response.status).toBe(200);
    expect(terminalExecute).toHaveBeenCalledWith(expect.objectContaining({
      cwd: 'z:/home/harl/at_parser',
      command: 'pwd'
    }));
  });

  it('accepts notifications/initialized without returning a JSON-RPC error', async () => {
    const router = createRouterForTest();

    const response = await router.handle({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json'
      },
      body: new TextEncoder().encode(JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized'
      }))
    });

    expect(response.status).toBe(202);
    expect(response.body.byteLength).toBe(0);
    expect(response.jsonBody).toBeUndefined();
  });
});
