import type { GatewayTerminalExecutionResult, GatewayTerminalExecutor } from '../executor/contracts';
import { createTerminalExecutor } from '../executor/terminalExecutor';

export const COMPATIBILITY_WARNING =
  '当前不是 VS Code 终端模式（看到这条提示说明此模式失败了，回退到系统终端执行模式)，是使用系统终端执行的结果，请注意！';

export interface CompatibilityTerminalSession {
  sessionId: string;
  cwd: string;
  title: string;
}

export interface CompatibilityExecutionResult extends GatewayTerminalExecutionResult {
  mode: 'compatibility';
  warning: string;
}

interface CompatibilityTerminalBackendOptions {
  executor?: GatewayTerminalExecutor;
  shellPath?: string;
}

export function createCompatibilityTerminalBackend(options: CompatibilityTerminalBackendOptions = {}) {
  const executor =
    options.executor ??
    createTerminalExecutor({
      shellPath: options.shellPath ?? (process.platform === 'win32' ? 'cmd.exe' : '/bin/sh')
    });

  return {
    async createSession(input: { tabId: string; title: string; cwd: string }): Promise<CompatibilityTerminalSession> {
      return {
        sessionId: input.tabId,
        cwd: input.cwd,
        title: input.title
      };
    },
    async execute(
      session: CompatibilityTerminalSession,
      input: {
        command: string;
        cwd: string;
        timeoutMs?: number;
        env?: Record<string, string>;
        signal?: AbortSignal;
        mode?: 'auto' | 'compatibility';
        shellIntegrationWaitMs?: number;
      }
    ): Promise<CompatibilityExecutionResult> {
      const result = await executor.execute({
        command: input.command,
        cwd: input.cwd,
        timeoutMs: input.timeoutMs,
        env: input.env,
        signal: input.signal
      });

      session.cwd = result.cwd;

      return {
        ...result,
        mode: 'compatibility',
        warning: COMPATIBILITY_WARNING
      };
    },
    async closeSession(_session: CompatibilityTerminalSession, _input: { initiatedBy: string }) {}
  };
}
