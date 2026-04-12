import { describe, expect, it, vi } from 'vitest';

describe('terminal router', () => {
  it('returns the current terminal pool snapshot', async () => {
    const { router } = await createTerminalRouterForTest();

    const response = await router.handle(
      {
        method: 'GET',
        url: '/api/terminal/tabs',
        headers: {},
        body: new Uint8Array()
      },
      new URL('http://127.0.0.1/api/terminal/tabs')
    );

    expect(response?.status).toBe(200);
    expect(response?.jsonBody).toEqual({
      ok: true,
      data: {
        tabs: [],
        defaultTabId: null
      }
    });
  });

  it('executes a command from POST /api/terminal/execute', async () => {
    const { router, terminalManager } = await createTerminalRouterForTest();

    const response = await router.handle(
      {
        method: 'POST',
        url: '/api/terminal/execute',
        headers: { 'content-type': 'application/json' },
        body: new TextEncoder().encode(JSON.stringify({
          tabId: 'tab-1',
          command: 'pwd',
          workspaceId: 'ws_demo',
          cwdPath: 'src'
        }))
      },
      new URL('http://127.0.0.1/api/terminal/execute')
    );

    expect(terminalManager.execute).toHaveBeenCalledWith({
      tabId: 'tab-1',
      command: 'pwd',
      cwd: '/workspace/demo/src',
      timeoutMs: undefined
    });
    expect(response?.status).toBe(200);
    expect(response?.jsonBody).toMatchObject({
      ok: true,
      data: {
        tabId: 'tab-1',
        stdout: '/workspace/demo/src\n'
      }
    });
  });
});

async function createTerminalRouterForTest() {
  const { createTerminalRouter } = await import('../../src/server/terminalRouter.js');
  const terminalManager = {
    listTabs: vi.fn(() => ({
      tabs: [],
      defaultTabId: null
    })),
    getTabContent: vi.fn(() => ({
      tabId: 'tab-1',
      title: 'Ubuntu',
      status: 'idle' as const,
      content: '$ pwd\n/workspace/demo\n',
      recentCommands: ['pwd'],
      historyVersion: 1
    })),
    newTab: vi.fn(async (input?: { title?: string; cwd?: string }) => ({
      tabId: 'tab-1',
      title: input?.title ?? 'Terminal',
      cwd: input?.cwd ?? '',
      status: 'idle' as const,
      isDefault: true,
      lastActiveAt: '2026-04-10T10:00:00.000Z',
      recentCommands: []
    })),
    closeTab: vi.fn(async () => ({
      tabs: [],
      defaultTabId: null
    })),
    execute: vi.fn(async (input: { tabId?: string; command: string; cwd?: string; timeoutMs?: number }) => ({
      tabId: input.tabId ?? 'tab-1',
      command: input.command,
      cwd: input.cwd ?? '/workspace/demo',
      stdout: `${input.cwd ?? '/workspace/demo'}\n`,
      stderr: '',
      combinedOutput: `${input.cwd ?? '/workspace/demo'}\n`,
      exitCode: 0,
      timedOut: false
    })),
    startExecution: vi.fn(async () => ({
      executionId: 'exec-1',
      tabId: 'tab-1',
      command: 'pwd',
      cwd: '/workspace/demo',
      status: 'queued' as const,
      createdAt: '2026-04-10T10:00:00.000Z',
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      timedOut: false,
      error: null
    })),
    getExecution: vi.fn(() => null),
    getExecutionOutput: vi.fn(() => null),
    cancelExecution: vi.fn(() => true)
  };

  return {
    terminalManager,
    router: createTerminalRouter({
      reads: {
        getWorkspaceById(id: string) {
          if (id === 'ws_demo') {
            return {
              id: 'ws_demo',
              name: 'demo',
              uri: 'file:///workspace/demo',
              source: 'workspace' as const
            };
          }

          return undefined;
        }
      },
      terminalManager: terminalManager as never
    })
  };
}
