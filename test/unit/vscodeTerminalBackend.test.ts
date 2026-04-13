import { describe, expect, it, vi } from 'vitest';

describe('vscode terminal backend', () => {
  it('sends Ctrl+C to the VS Code terminal when execution is cancelled', async () => {
    const sendText = vi.fn();
    const terminal = {
      show: vi.fn(),
      dispose: vi.fn(),
      sendText
    };

    const { createVsCodeTerminalBackend } = await import('../../src/terminal/vscodeTerminalBackend.js');
    const backend = createVsCodeTerminalBackend({
      createTerminal: vi.fn(() => terminal),
      compatibilityBackend: {
        createSession: vi.fn(async ({ tabId, title, cwd }) => ({ sessionId: tabId, title, cwd })),
        execute: vi.fn(async () => {
          throw new Error('compatibility backend should not be used');
        })
      }
    });
    const session = await backend.createSession({ tabId: 'tab-1', title: 'tab-1', cwd: '/workspace/demo' });
    const controller = new AbortController();

    const running = backend.execute(session, {
      command: 'sleep 10',
      cwd: '/workspace/demo',
      signal: controller.signal
    });

    controller.abort();

    await expect(running).rejects.toMatchObject({
      name: 'AbortError',
      message: 'TERMINAL_EXECUTION_ABORTED'
    });
    expect(sendText).toHaveBeenCalledWith('', false);
  });
});
