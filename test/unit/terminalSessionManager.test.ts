import { describe, expect, it, vi } from 'vitest';

describe('terminal session manager', () => {
  it('clears the default tab when the default tab is closed', async () => {
    const { createTerminalSessionManager } = await import('../../src/terminal/sessionManager.js');
    const manager = createTerminalSessionManager(createBackendStub());

    const first = await manager.newTab({ title: 'Ubuntu' });
    expect(first.isDefault).toBe(true);

    const closed = await manager.closeTab(first.tabId, { initiatedBy: 'web' });

    expect(closed.defaultTabId).toBeNull();
    expect(manager.listTabs().defaultTabId).toBeNull();
  });

  it('creates a new tab when execute is called without tabId and no default exists', async () => {
    const { createTerminalSessionManager } = await import('../../src/terminal/sessionManager.js');
    const backend = createBackendStub();
    const manager = createTerminalSessionManager(backend);

    const result = await manager.execute({ command: 'pwd', cwd: '/workspace/demo' });
    const snapshot = manager.listTabs();

    expect(result.tabId).toBeTruthy();
    expect(backend.execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ timeoutMs: 120000 })
    );
    expect(snapshot.defaultTabId).toBe(result.tabId);
    expect(snapshot.tabs).toHaveLength(1);
    expect(snapshot.tabs[0]).toEqual({
      tabId: result.tabId,
      title: result.tabId,
      cwd: '/workspace/demo',
      status: 'idle',
      isDefault: true,
      lastActiveAt: expect.any(String),
      recentCommands: ['pwd']
    });
  });

  it('writes a queued background command into terminal history before output is finished', async () => {
    const { createTerminalSessionManager } = await import('../../src/terminal/sessionManager.js');
    let releaseExecution: (() => void) | undefined;
    const manager = createTerminalSessionManager({
      async createSession(input: { tabId: string; cwd: string }) {
        return { sessionId: input.tabId, cwd: input.cwd };
      },
      async execute(_session: { cwd: string }, input: { command: string; cwd: string; signal?: AbortSignal }) {
        await new Promise<void>((resolve) => {
          releaseExecution = resolve;
        });
        return {
          command: input.command,
          cwd: input.cwd,
          stdout: 'done\n',
          stderr: '',
          combinedOutput: 'done\n',
          exitCode: 0,
          timedOut: false
        };
      },
      async closeSession() {}
    });

    const tab = await manager.newTab({ cwd: '/workspace/demo' });
    const started = await manager.startExecution({ tabId: tab.tabId, command: 'echo queued' });

    await waitFor(async () => manager.getExecution(started.executionId)?.status === 'running');
    expect(manager.getTabContent(tab.tabId).content).toContain('$ echo queued');

    releaseExecution?.();
    await waitFor(async () => manager.getExecution(started.executionId)?.status === 'completed');
    expect(manager.getTabContent(tab.tabId).content).toContain('done');
  });

  it('does not transition a queued cancelled execution into running when earlier work finishes', async () => {
    const { createTerminalSessionManager } = await import('../../src/terminal/sessionManager.js');
    let releaseFirstExecution: (() => void) | undefined;
    const manager = createTerminalSessionManager({
      async createSession(input: { tabId: string; cwd: string }) {
        return {
          sessionId: input.tabId,
          cwd: input.cwd
        };
      },
      async execute(_session: { cwd: string }, input: { command: string; cwd: string; signal?: AbortSignal }) {
        if (input.command === 'first') {
          await new Promise<void>((resolve) => {
            releaseFirstExecution = resolve;
          });
          return {
            command: input.command,
            cwd: input.cwd,
            stdout: 'first\n',
            stderr: '',
            combinedOutput: 'first\n',
            exitCode: 0,
            timedOut: false
          };
        }

        if (input.signal?.aborted) {
          throw new Error('TERMINAL_EXECUTION_ABORTED');
        }

        return {
          command: input.command,
          cwd: input.cwd,
          stdout: `${input.command}\n`,
          stderr: '',
          combinedOutput: `${input.command}\n`,
          exitCode: 0,
          timedOut: false
        };
      },
      async closeSession() {}
    });

    const tab = await manager.newTab({ title: 'Ubuntu', cwd: '/workspace/demo' });
    const first = await manager.startExecution({ tabId: tab.tabId, command: 'first' });
    const queued = await manager.startExecution({ tabId: tab.tabId, command: 'queued' });

    await waitFor(async () => manager.getExecution(first.executionId)?.status === 'running');
    expect(manager.cancelExecution(queued.executionId)).toBe(true);
    expect(manager.getExecution(queued.executionId)).toMatchObject({
      executionId: queued.executionId,
      status: 'cancelled',
      startedAt: null
    });

    releaseFirstExecution?.();
    await waitFor(async () => manager.getExecution(first.executionId)?.status === 'completed');

    expect(manager.getExecution(queued.executionId)).toMatchObject({
      executionId: queued.executionId,
      status: 'cancelled',
      startedAt: null
    });
  });
});

async function waitFor(check: () => boolean | Promise<boolean>, attempts = 30) {
  for (let index = 0; index < attempts; index += 1) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error('Timed out waiting for terminal execution state');
}

function createBackendStub() {
  return {
    execute: vi.fn(async (session: { cwd: string }, input: { command: string; cwd: string }) => {
      return {
        command: input.command,
        cwd: input.cwd || session.cwd,
        stdout: '',
        stderr: '',
        combinedOutput: '',
        exitCode: 0,
        timedOut: false
      };
    }),
    async createSession(input: { tabId: string; cwd: string }) {
      return {
        sessionId: input.tabId,
        cwd: input.cwd
      };
    },
    async closeSession() {}
  };
}
