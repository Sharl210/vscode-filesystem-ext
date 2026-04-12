import { describe, expect, it, vi } from 'vitest';
import { createMcpRouter } from '../../src/server/mcpRouter';

function createRouterForTest(options: { path?: string } = {}) {
  const tabs: Array<{
    tabId: string;
    title: string;
    cwd: string;
    status: 'idle' | 'running';
    isDefault: boolean;
    lastActiveAt: string;
    recentCommands: string[];
    content: string;
    historyVersion: number;
  }> = [];
  const executions = new Map<string, {
    snapshot: {
      executionId: string;
      tabId: string;
      command: string;
      cwd: string;
      status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
      createdAt: string;
      startedAt: string | null;
      finishedAt: string | null;
      exitCode: number | null;
      timedOut: boolean;
      error: string | null;
    };
    output: {
      executionId: string;
      tabId: string;
      command: string;
      cwd: string;
      stdout: string;
      stderr: string;
      combinedOutput: string;
      exitCode: number | null;
      timedOut: boolean;
      finishedAt: string | null;
    } | null;
  }>();
  let nextTabId = 1;
  let nextExecutionId = 1;
  let defaultTabId: string | null = null;

  function syncDefaultFlags() {
    for (const tab of tabs) {
      tab.isDefault = tab.tabId === defaultTabId;
    }
  }

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
      listTabs: vi.fn(() => ({
        tabs: tabs.map(({ content: _content, historyVersion: _historyVersion, ...tab }) => ({ ...tab })),
        defaultTabId
      })),
      getTabContent: vi.fn((tabId: string) => {
        const tab = tabs.find((item) => item.tabId === tabId);
        if (!tab) {
          throw new Error(`Unknown terminal tab: ${tabId}`);
        }

        return {
          tabId: tab.tabId,
          title: tab.title,
          status: tab.status,
          content: tab.content,
          recentCommands: [...tab.recentCommands],
          historyVersion: tab.historyVersion
        };
      }),
      newTab: vi.fn(async (input?: { title?: string; cwd?: string }) => {
        const tabId = `tab-${nextTabId++}`;
        if (!defaultTabId) {
          defaultTabId = tabId;
        }
        const tab = {
          tabId,
          title: input?.title ?? 'Terminal',
          cwd: input?.cwd ?? '',
          status: 'idle' as const,
          isDefault: false,
          lastActiveAt: new Date().toISOString(),
          recentCommands: [],
          content: '',
          historyVersion: 0
        };
        tabs.push(tab);
        syncDefaultFlags();
        return {
          tabId: tab.tabId,
          title: tab.title,
          cwd: tab.cwd,
          status: tab.status,
          isDefault: tab.isDefault,
          lastActiveAt: tab.lastActiveAt,
          recentCommands: [...tab.recentCommands]
        };
      }),
      closeTab: vi.fn(async (tabId: string) => {
        const index = tabs.findIndex((tab) => tab.tabId === tabId);
        if (index >= 0) {
          tabs.splice(index, 1);
          if (defaultTabId === tabId) {
            defaultTabId = null;
          }
          syncDefaultFlags();
        }

        return {
          tabs: tabs.map(({ content: _content, historyVersion: _historyVersion, ...tab }) => ({ ...tab })),
          defaultTabId
        };
      }),
      execute: vi.fn(async (input: { command: string; cwd?: string; tabId?: string }) => {
        let tab = input.tabId ? tabs.find((item) => item.tabId === input.tabId) : tabs.find((item) => item.tabId === defaultTabId);
        if (!tab) {
          const created = await executor.terminal.newTab({ cwd: input.cwd ?? '/workspace/demo' });
          const createdTab = tabs.find((item) => item.tabId === created.tabId);
          if (!createdTab) {
            throw new Error(`Failed to create terminal tab: ${created.tabId}`);
          }
          tab = createdTab;
        }

        tab.cwd = input.cwd ?? (tab.cwd || '/workspace/demo');
        tab.recentCommands.push(input.command);
        tab.content += `$ ${input.command}\n${tab.cwd}\n`;
        tab.historyVersion += 1;
        tab.lastActiveAt = new Date().toISOString();

        return {
          tabId: tab.tabId,
          command: input.command,
          cwd: tab.cwd,
          exitCode: 0,
          stdout: `${tab.cwd}\n`,
          stderr: '',
          combinedOutput: `${tab.cwd}\n`,
          timedOut: false
        };
      }),
      startExecution: vi.fn(async (input: { command: string; cwd?: string; tabId?: string }) => {
        let tab = input.tabId ? tabs.find((item) => item.tabId === input.tabId) : tabs.find((item) => item.tabId === defaultTabId);
        if (!tab) {
          const created = await executor.terminal.newTab({ cwd: input.cwd ?? '/workspace/demo' });
          const createdTab = tabs.find((item) => item.tabId === created.tabId);
          if (!createdTab) {
            throw new Error(`Failed to create terminal tab: ${created.tabId}`);
          }
          tab = createdTab;
        }

        tab.cwd = input.cwd ?? (tab.cwd || '/workspace/demo');
        const now = new Date().toISOString();
        const executionId = `exec-${nextExecutionId++}`;
        const output = `${tab.cwd}\n`;
        const snapshot = {
          executionId,
          tabId: tab.tabId,
          command: input.command,
          cwd: tab.cwd,
          status: 'completed' as const,
          createdAt: now,
          startedAt: now,
          finishedAt: now,
          exitCode: 0,
          timedOut: false,
          error: null
        };
        executions.set(executionId, {
          snapshot,
          output: {
            executionId,
            tabId: tab.tabId,
            command: input.command,
            cwd: tab.cwd,
            stdout: output,
            stderr: '',
            combinedOutput: output,
            exitCode: 0,
            timedOut: false,
            finishedAt: now
          }
        });

        return snapshot;
      }),
      getExecution: vi.fn((executionId: string) => {
        const execution = executions.get(executionId);
        return execution ? { ...execution.snapshot } : null;
      }),
      getExecutionOutput: vi.fn((executionId: string) => {
        const execution = executions.get(executionId);
        return execution?.output ? { ...execution.output } : null;
      }),
      cancelExecution: vi.fn((executionId: string) => {
        const existing = executions.get(executionId);
        if (!existing) {
          return false;
        }

        existing.snapshot.status = 'cancelled';
        existing.snapshot.error = '执行已取消';
        existing.snapshot.finishedAt = new Date().toISOString();
        existing.output = null;
        executions.set(executionId, existing);
        return true;
      })
    }
  };

  return createMcpRouter({
    executor: executor as never,
    path: options.path
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
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.jsonBody).toMatchObject({
      name: 'vscode-filesystem-ext-mcp',
      transport: 'streamable-http',
      endpoint: '/mcp'
    });
  });

  it('returns 405 for GET /mcp when the client requests an SSE stream', async () => {
    const router = createRouterForTest();

    const response = await router.handle({
      method: 'GET',
      url: '/mcp',
      headers: { accept: 'text/event-stream' },
      body: new Uint8Array()
    });

    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe('POST, OPTIONS');
    expect(response.headers['mcp-protocol-version']).toBe('2025-11-25');
    expect(response.body.byteLength).toBe(0);
  });

  it('supports configured MCP path and CORS preflight', async () => {
    const router = createRouterForTest({ path: '/gateway-mcp' });

    const preflight = await router.handle({
      method: 'OPTIONS',
      url: '/gateway-mcp',
      headers: {},
      body: new Uint8Array()
    });
    const metadata = await router.handle({
      method: 'GET',
      url: '/gateway-mcp',
      headers: {},
      body: new Uint8Array()
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-methods']).toContain('POST');
    expect(metadata.status).toBe(200);
    expect(metadata.jsonBody).toMatchObject({ endpoint: '/gateway-mcp' });
  });

  it('accepts legacy /mcp and trailing-slash variants for compatibility', async () => {
    const router = createRouterForTest({ path: '/gateway-mcp/' });

    const legacy = await router.handle({
      method: 'GET',
      url: '/mcp',
      headers: {},
      body: new Uint8Array()
    });
    const trailingSlash = await router.handle({
      method: 'GET',
      url: '/gateway-mcp/',
      headers: {},
      body: new Uint8Array()
    });

    expect(legacy.status).toBe(200);
    expect(trailingSlash.status).toBe(200);
    expect(trailingSlash.jsonBody).toMatchObject({ endpoint: '/gateway-mcp' });
  });

  it('supports initialize and tools/list JSON-RPC methods', async () => {
    const router = createRouterForTest();

    const initializeResponse = await router.handle({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
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
      headers: { 'content-type': 'application/json' },
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
          expect.objectContaining({ name: 'list_workspaces' }),
          expect.objectContaining({ name: 'listWorkspaces' }),
          expect.objectContaining({ name: 'create_file' }),
          expect.objectContaining({
            name: 'createFile',
            inputSchema: expect.objectContaining({
              properties: expect.objectContaining({
                path: expect.objectContaining({ description: expect.stringContaining('相对 workspaceId 根目录') })
              })
            })
          }),
          expect.objectContaining({ name: 'new_terminal_tab' }),
          expect.objectContaining({ name: 'terminalExecute' }),
          expect.objectContaining({ name: 'terminal_execute' }),
          expect.objectContaining({ name: 'start_terminal_execution' }),
          expect.objectContaining({ name: 'cancelTerminalExecution' })
        ])
      }
    });
  });

  it('exposes file mutation, export job, and terminal tools', async () => {
    const router = createRouterForTest();

    const fileResponse = await router.handle({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode(JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'create_file',
          arguments: { workspaceId: 'ws_demo', path: 'src/new.ts' }
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
      headers: { 'content-type': 'application/json' },
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
      headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode(JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'terminal_execute',
          arguments: { workspaceId: 'ws_demo', command: 'pwd' }
        }
      }))
    });

    expect(terminalResponse.status).toBe(200);
    expect(terminalResponse.jsonBody).toMatchObject({
      jsonrpc: '2.0',
      id: 5,
      result: {
        structuredContent: {
          tabId: 'tab-1',
          command: 'pwd',
          exitCode: 0,
          stdout: '/workspace/demo\n'
        }
      }
    });
  });

  it('accepts camelCase aliases for file and terminal tools', async () => {
    const router = createRouterForTest();

    const createFileResult = await callTool<Record<string, unknown>>(router, 'createFile', {
      workspaceId: 'ws_demo',
      path: 'test.txt'
    });
    const terminalResult = await callTool<Record<string, unknown>>(router, 'terminalExecute', {
      workspaceId: 'ws_demo',
      command: 'pwd'
    });

    expect(createFileResult).toMatchObject({ created: true, path: 'test.txt' });
    expect(terminalResult).toMatchObject({ tabId: 'tab-1', command: 'pwd' });
  });

  it('creates and lists terminal tabs through MCP', async () => {
    const router = createRouterForTest();

    const created = await callTool<Record<string, unknown>>(router, 'new_terminal_tab', {
      title: 'Ubuntu',
      cwdPath: 'src',
      workspaceId: 'ws_demo'
    });
    const listed = await callTool<{ defaultTabId: string | null; tabs: Array<Record<string, unknown>> }>(router, 'list_terminal_tabs', {});

    expect(created.tabId).toBe('tab-1');
    expect(created.title).toBe('Ubuntu');
    expect(created.cwd).toBe('/workspace/demo/src');
    expect(listed.defaultTabId).toBe('tab-1');
    expect(listed.tabs).toHaveLength(1);
    expect(listed.tabs[0]).toMatchObject({ tabId: 'tab-1', title: 'Ubuntu', isDefault: true });
  });

  it('shows terminal tab history content through MCP', async () => {
    const router = createRouterForTest();

    await callTool(router, 'new_terminal_tab', { title: 'Ubuntu', workspaceId: 'ws_demo' });
    await callTool(router, 'terminal_execute', { tabId: 'tab-1', command: 'pwd' });
    const content = await callTool<Record<string, unknown>>(router, 'show_terminal_tab_content', { tabId: 'tab-1' });

    expect(content).toMatchObject({
      tabId: 'tab-1',
      title: 'Ubuntu',
      historyVersion: 1,
      recentCommands: ['pwd']
    });
    expect(content.content).toContain('$ pwd');
    expect(content.content).toContain('/workspace/demo');
  });

  it('starts, gets, reads output, and cancels terminal executions through MCP tools', async () => {
    const router = createRouterForTest();

    const created = await callTool<Record<string, unknown>>(router, 'new_terminal_tab', { workspaceId: 'ws_demo' });
    const started = await callTool<Record<string, unknown>>(router, 'start_terminal_execution', {
      workspaceId: 'ws_demo',
      tabId: String(created.tabId),
      command: 'pwd'
    });

    const executionId = String(started.executionId);
    const snapshot = await callTool<Record<string, unknown>>(router, 'get_terminal_execution', { executionId });
    const output = await callTool<Record<string, unknown> | null>(router, 'get_terminal_execution_output', { executionId });
    const cancelled = await callTool<Record<string, unknown>>(router, 'cancel_terminal_execution', { executionId });

    expect(started).toMatchObject({ executionId: expect.any(String), command: 'pwd' });
    expect(snapshot).toMatchObject({ executionId, status: 'completed' });
    expect(output).toMatchObject({ executionId, stdout: '/workspace/demo\n' });
    expect(cancelled).toEqual({ executionId, cancelled: true });
  });

  it('returns text-only MCP tool results when terminal execution output is still unavailable', async () => {
    const router = createRouterForTest();

    const started = await callTool<Record<string, unknown>>(router, 'start_terminal_execution', {
      workspaceId: 'ws_demo',
      command: 'sleep'
    });
    const executionId = String(started.executionId);

    const response = await router.handle({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode(JSON.stringify({
        jsonrpc: '2.0',
        id: 1001,
        method: 'tools/call',
        params: {
          name: 'get_terminal_execution_output',
          arguments: { executionId: `pending-${executionId}` }
        }
      }))
    });

    expect(response.status).toBe(200);
    expect(response.jsonBody).toMatchObject({
      result: {
        content: [{ type: 'text', text: 'null' }]
      }
    });
    expect((response.jsonBody as { result: Record<string, unknown> }).result).not.toHaveProperty('structuredContent');
  });

  it('accepts notifications/initialized without returning a JSON-RPC error', async () => {
    const router = createRouterForTest();

    const response = await router.handle({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode(JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized'
      }))
    });

    expect(response.status).toBe(202);
    expect(response.body.byteLength).toBe(0);
    expect(response.jsonBody).toBeUndefined();
  });

  it('supports lightweight MCP methods often called during client handshake', async () => {
    const router = createRouterForTest();

    const ping = await callMethod(router, 'ping');
    const prompts = await callMethod(router, 'prompts/list');
    const resources = await callMethod(router, 'resources/list');
    const templates = await callMethod(router, 'resources/templates/list');

    expect(ping).toEqual({});
    expect(prompts).toEqual({ prompts: [] });
    expect(resources).toEqual({ resources: [] });
    expect(templates).toEqual({ resourceTemplates: [] });
  });

  it('handles JSON-RPC batch requests', async () => {
    const router = createRouterForTest();

    const response = await router.handle({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode(JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' }
      ]))
    });

    expect(response.status).toBe(200);
    const body = response.jsonBody as Array<{ id: number; result?: unknown; error?: unknown }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ id: 1 });
    expect(body[1]).toMatchObject({ id: 2 });
  });
});

async function callTool<T>(router: ReturnType<typeof createMcpRouter>, name: string, args: Record<string, unknown>): Promise<T> {
  const response = await router.handle({
    method: 'POST',
    url: '/mcp',
    headers: { 'content-type': 'application/json' },
    body: new TextEncoder().encode(JSON.stringify({
      jsonrpc: '2.0',
      id: 900,
      method: 'tools/call',
      params: { name, arguments: args }
    }))
  });

  expect(response.status).toBe(200);
  return (response.jsonBody as { result: { structuredContent?: T } }).result.structuredContent as T;
}

async function callMethod<T>(router: ReturnType<typeof createMcpRouter>, method: string): Promise<T> {
  const response = await router.handle({
    method: 'POST',
    url: '/mcp',
    headers: { 'content-type': 'application/json' },
    body: new TextEncoder().encode(JSON.stringify({
      jsonrpc: '2.0',
      id: 901,
      method,
      params: {}
    }))
  });

  expect(response.status).toBe(200);
  return (response.jsonBody as { result: T }).result;
}
