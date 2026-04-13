import type { GatewayTerminalExecutionResult } from '../executor/contracts';
import {
  createCompatibilityTerminalBackend,
  type CompatibilityExecutionResult
} from './compatibilityTerminalBackend';

interface VsCodeTerminalLike {
  show(preserveFocus?: boolean): void;
  dispose(): void;
  sendText?(text: string, addNewLine?: boolean): void;
  shellIntegration?: {
    executeCommand?: (command: string) => {
      read(): AsyncIterable<string>;
      exitCode?: number | null | Promise<number | null>;
    };
  };
}

export interface VsCodeTerminalSession {
  sessionId: string;
  cwd: string;
  title: string;
  terminal?: VsCodeTerminalLike;
  shellIntegrationWarmup?: Promise<void>;
}

export interface VsCodeExecutionResult extends GatewayTerminalExecutionResult {
  mode: 'vscode-terminal';
  warning?: undefined;
}

interface CompatibilityTerminalBackendLike {
  createSession(input: { tabId: string; title: string; cwd: string }): Promise<{ sessionId: string; cwd: string; title: string }>;
  execute(
    session: { sessionId: string; cwd: string; title: string },
    input: {
      command: string;
      cwd: string;
      timeoutMs?: number;
      env?: Record<string, string>;
      signal?: AbortSignal;
      mode?: 'auto' | 'compatibility';
      shellIntegrationWaitMs?: number;
    }
  ): Promise<CompatibilityExecutionResult>;
}

interface VsCodeTerminalBackendDeps {
  createTerminal: (options: { name: string; cwd?: string }) => VsCodeTerminalLike;
  compatibilityBackend?: CompatibilityTerminalBackendLike;
  shellIntegrationWaitMs?: number;
  shellIntegrationPollMs?: number;
}

const DEFAULT_SHELL_INTEGRATION_WAIT_MS = 30_000;
const DEFAULT_SHELL_INTEGRATION_POLL_MS = 1_000;

export function createVsCodeTerminalBackend(deps: VsCodeTerminalBackendDeps) {
  const compatibilityBackend = deps.compatibilityBackend ?? createCompatibilityTerminalBackend();
  const defaultWaitMs = deps.shellIntegrationWaitMs ?? DEFAULT_SHELL_INTEGRATION_WAIT_MS;
  const defaultPollMs = deps.shellIntegrationPollMs ?? DEFAULT_SHELL_INTEGRATION_POLL_MS;

  return {
    async createSession(input: { tabId: string; title: string; cwd: string }): Promise<VsCodeTerminalSession> {
      const session: VsCodeTerminalSession = {
        sessionId: input.tabId,
        cwd: input.cwd,
        title: input.title
      };

      try {
        session.terminal = createTerminalForSession(session, deps.createTerminal);
        session.shellIntegrationWarmup = warmShellIntegration(session.terminal);
      } catch {
        session.terminal = undefined;
        session.shellIntegrationWarmup = undefined;
      }

      return session;
    },
    async execute(
      session: VsCodeTerminalSession,
      input: {
        command: string;
        cwd: string;
        timeoutMs?: number;
        env?: Record<string, string>;
        signal?: AbortSignal;
        mode?: 'auto' | 'compatibility';
        shellIntegrationWaitMs?: number;
      }
    ): Promise<VsCodeExecutionResult | CompatibilityExecutionResult> {
      session.cwd = input.cwd;
      let shouldDisposeTerminal = false;
      let cancelVsCodeExecution: (() => void) | undefined;
      const waitMs = normalizeShellIntegrationWaitMs(input.shellIntegrationWaitMs, defaultWaitMs);

      try {
        if (input.signal?.aborted) {
          throw createCancelledExecutionError();
        }

        if (input.mode === 'compatibility') {
          return executeInCompatibilityMode({
            compatibilityBackend,
            session,
            input,
            warning: buildForcedCompatibilityWarning()
          });
        }

        const terminal = session.terminal ?? createTerminalForSession(session, deps.createTerminal);
        session.terminal = terminal;
        session.shellIntegrationWarmup ??= warmShellIntegration(terminal);
        cancelVsCodeExecution = () => {
          terminal.sendText?.('\u0003', false);
        };
        input.signal?.addEventListener('abort', cancelVsCodeExecution, { once: true });
        terminal.show(false);
        const execution = await waitForShellExecution(terminal, input.command, waitMs, defaultPollMs, input.signal);
        if (!execution) {
          return executeInCompatibilityMode({
            compatibilityBackend,
            session,
            input,
            warning: buildShellIntegrationTimeoutWarning(waitMs)
          });
        }

        let stdout = '';
        for await (const chunk of execution.read()) {
          if (input.signal?.aborted) {
            throw createCancelledExecutionError();
          }
          stdout += chunk;
        }

        if (input.signal?.aborted) {
          throw createCancelledExecutionError();
        }

        const resolvedExitCode = await execution.exitCode;
        const sanitizedStdout = sanitizeVsCodeTerminalOutput(stdout);

        return {
          command: input.command,
          cwd: session.cwd,
          stdout: sanitizedStdout,
          stderr: '',
          combinedOutput: sanitizedStdout,
          exitCode: resolvedExitCode ?? null,
          timedOut: false,
          mode: 'vscode-terminal'
        };
      } catch {
        if (input.signal?.aborted) {
          throw createCancelledExecutionError();
        }

        shouldDisposeTerminal = true;
        return executeInCompatibilityMode({
          compatibilityBackend,
          session,
          input
        });
      } finally {
        if (cancelVsCodeExecution) {
          input.signal?.removeEventListener('abort', cancelVsCodeExecution);
        }
        if (shouldDisposeTerminal) {
          disposeTerminal(session);
        }
      }
    },
    async closeSession(session: VsCodeTerminalSession, _input: { initiatedBy: string }) {
      disposeTerminal(session);
    }
  };
}

async function executeInCompatibilityMode(input: {
  compatibilityBackend: CompatibilityTerminalBackendLike;
  session: VsCodeTerminalSession;
  input: {
    command: string;
    cwd: string;
    timeoutMs?: number;
    env?: Record<string, string>;
    signal?: AbortSignal;
    mode?: 'auto' | 'compatibility';
    shellIntegrationWaitMs?: number;
  };
  warning?: string;
}) {
  const compatibilitySession = await input.compatibilityBackend.createSession({
    tabId: input.session.sessionId,
    title: input.session.title,
    cwd: input.session.cwd
  });
  const fallbackResult = await input.compatibilityBackend.execute(compatibilitySession, {
    command: input.input.command,
    cwd: input.session.cwd,
    timeoutMs: input.input.timeoutMs,
    env: input.input.env,
    signal: input.input.signal
  });

  input.session.cwd = fallbackResult.cwd;

  return {
    ...fallbackResult,
    warning: input.warning ?? fallbackResult.warning
  };
}

function createTerminalForSession(
  session: VsCodeTerminalSession,
  createTerminal: (options: { name: string; cwd?: string }) => VsCodeTerminalLike
) {
  return createTerminal({
    name: session.sessionId,
    cwd: session.cwd
  });
}

function disposeTerminal(session: VsCodeTerminalSession) {
  session.terminal?.dispose();
  session.terminal = undefined;
  session.shellIntegrationWarmup = undefined;
}

async function warmShellIntegration(terminal: VsCodeTerminalLike) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= DEFAULT_SHELL_INTEGRATION_WAIT_MS) {
    if (terminal.shellIntegration?.executeCommand) {
      return;
    }

    await delay(DEFAULT_SHELL_INTEGRATION_POLL_MS);
  }
}

async function waitForShellExecution(
  terminal: VsCodeTerminalLike,
  command: string,
  waitMs: number,
  pollMs: number,
  signal?: AbortSignal
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= waitMs) {
    if (signal?.aborted) {
      throw createCancelledExecutionError();
    }

    const execution = terminal.shellIntegration?.executeCommand?.(command);
    if (execution) {
      return execution;
    }

    await delay(pollMs);
  }

  return null;
}

function delay(timeoutMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

function createCancelledExecutionError() {
  const error = new Error('TERMINAL_EXECUTION_ABORTED');
  error.name = 'AbortError';
  return error;
}

function sanitizeVsCodeTerminalOutput(value: string) {
  return value
    .replace(new RegExp('\\u001b\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\)', 'g'), '')
    .replace(new RegExp('\\u001b\\[[0-9;?]*[ -/]*[@-~]', 'g'), '');
}

function normalizeShellIntegrationWaitMs(value: number | undefined, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.round(value);
}

function buildShellIntegrationTimeoutWarning(waitMs: number) {
  const seconds = Math.round(waitMs / 1000);
  return `真实 VS Code 终端已等待 ${seconds} 秒仍未拿到 shell integration，已自动回退到 compatibility。下次可直接设置 mode=compatibility，或把 shellIntegrationWaitMs 提高到更大的值（例如 60000）。`;
}

function buildForcedCompatibilityWarning() {
  return '已按 mode=compatibility 直接使用系统终端执行，未尝试 VS Code shell integration。';
}
