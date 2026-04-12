import { describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}));

describe('terminal executor', () => {
  it('falls back to a secondary shell when the preferred shell is missing', async () => {
    const firstChild = createMockChild();
    const secondChild = createMockChild();

    spawnMock
      .mockImplementationOnce((_command: string, _options: { shell?: string }) => {
        queueMicrotask(() => {
          firstChild.emitError(Object.assign(new Error('spawn missing shell ENOENT'), { code: 'ENOENT' }));
        });
        return firstChild.child;
      })
      .mockImplementationOnce((_command: string, _options: { shell?: string }) => {
        queueMicrotask(() => {
          secondChild.emitStdout('/workspace/demo\\n');
          secondChild.emitClose(0);
        });
        return secondChild.child;
      });

    const { createTerminalExecutor } = await import('../../src/executor/terminalExecutor.js');
    const executor = createTerminalExecutor({
      shellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
    });

    const result = await executor.execute({
      command: 'pwd',
      cwd: '/workspace/demo'
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls[0]?.[1]).toMatchObject({
      shell: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
    });
    expect(spawnMock.mock.calls[1]?.[1]).toMatchObject({
      shell: expect.any(String)
    });
    expect(result).toMatchObject({
      command: 'pwd',
      exitCode: 0,
      stdout: '/workspace/demo\\n'
    });
  });

  it('wraps Windows shell commands to force UTF-8 terminal output', async () => {
    const child = createMockChild();

    spawnMock.mockImplementationOnce((_command: string, _options: { shell?: string }) => {
      queueMicrotask(() => {
        child.emitClose(0);
      });
      return child.child;
    });

    const { createTerminalExecutor } = await import('../../src/executor/terminalExecutor.js');
    const executor = createTerminalExecutor({
      shellPath: 'powershell.exe'
    });

    await executor.execute({
      command: 'Write-Output 你好',
      cwd: 'C:/workspace/demo'
    });

    expect(spawnMock).toHaveBeenCalled();
    expect(spawnMock.mock.calls.at(-1)?.[0]).toContain('Write-Output 你好');
    expect(spawnMock.mock.calls.at(-1)?.[0]).toContain('$OutputEncoding');
  });

  it('aborts compatibility execution when the abort signal is triggered', async () => {
    const child = createMockChild();

    spawnMock.mockImplementationOnce((_command: string, _options: { shell?: string }) => child.child);

    const { createTerminalExecutor } = await import('../../src/executor/terminalExecutor.js');
    const executor = createTerminalExecutor({
      shellPath: '/bin/sh'
    });
    const controller = new AbortController();

    const running = executor.execute({
      command: 'sleep 10',
      cwd: '/workspace/demo',
      signal: controller.signal
    });
    controller.abort();
    queueMicrotask(() => {
      child.emitClose(null);
    });

    await expect(running).rejects.toMatchObject({
      name: 'AbortError',
      message: 'TERMINAL_EXECUTION_ABORTED'
    });
    expect(child.child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});

function createMockChild() {
  const stdoutListeners: Array<(chunk: Buffer) => void> = [];
  const stderrListeners: Array<(chunk: Buffer) => void> = [];
  const errorListeners: Array<(error: Error) => void> = [];
  const closeListeners: Array<(code: number | null) => void> = [];

  return {
    child: {
      stdout: {
        on(event: string, listener: (chunk: Buffer) => void) {
          if (event === 'data') {
            stdoutListeners.push(listener);
          }
        }
      },
      stderr: {
        on(event: string, listener: (chunk: Buffer) => void) {
          if (event === 'data') {
            stderrListeners.push(listener);
          }
        }
      },
      on(event: string, listener: ((error: Error) => void) | ((code: number | null) => void)) {
        if (event === 'error') {
          errorListeners.push(listener as (error: Error) => void);
        }

        if (event === 'close') {
          closeListeners.push(listener as (code: number | null) => void);
        }
      },
      kill: vi.fn()
    },
    emitStdout(text: string) {
      stdoutListeners.forEach((listener) => {
        listener(Buffer.from(text));
      });
    },
    emitStderr(text: string) {
      stderrListeners.forEach((listener) => {
        listener(Buffer.from(text));
      });
    },
    emitError(error: Error) {
      errorListeners.forEach((listener) => {
        listener(error);
      });
    },
    emitClose(code: number | null) {
      closeListeners.forEach((listener) => {
        listener(code);
      });
    }
  };
}
