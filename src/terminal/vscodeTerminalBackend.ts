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
    input: { command: string; cwd: string; timeoutMs?: number; env?: Record<string, string>; signal?: AbortSignal }
  ): Promise<CompatibilityExecutionResult>;
}

interface VsCodeTerminalBackendDeps {
  createTerminal: (options: { name: string; cwd?: string }) => VsCodeTerminalLike;
  compatibilityBackend?: CompatibilityTerminalBackendLike;
}

const SHELL_INTEGRATION_WAIT_MS = 1_000;
const SHELL_INTEGRATION_POLL_MS = 20;

export function createVsCodeTerminalBackend(deps: VsCodeTerminalBackendDeps) {
  const compatibilityBackend = deps.compatibilityBackend ?? createCompatibilityTerminalBackend();

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
      input: { command: string; cwd: string; timeoutMs?: number; env?: Record<string, string>; signal?: AbortSignal }
    ): Promise<VsCodeExecutionResult | CompatibilityExecutionResult> {
      session.cwd = input.cwd;
      let shouldDisposeTerminal = false;
      let cancelVsCodeExecution: (() => void) | undefined;

      try {
        if (input.signal?.aborted) {
          throw createCancelledExecutionError();
        }

        const terminal = session.terminal ?? createTerminalForSession(session, deps.createTerminal);
        session.terminal = terminal;
        session.shellIntegrationWarmup ??= warmShellIntegration(terminal);
        terminal.show(false);
        cancelVsCodeExecution = () => {
          terminal.sendText?.('\u0003', false);
        };
        input.signal?.addEventListener('abort', cancelVsCodeExecution, { once: true });
        const execution = await waitForShellExecution(terminal, input.command, input.signal);
        if (!execution) {
          return executeInCompatibilityMode({
            compatibilityBackend,
            session,
            input
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
  input: { command: string; cwd: string; timeoutMs?: number; env?: Record<string, string>; signal?: AbortSignal };
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

  return fallbackResult;
}

function createTerminalForSession(
  session: VsCodeTerminalSession,
  createTerminal: (options: { name: string; cwd?: string }) => VsCodeTerminalLike
) {
  return createTerminal({
    name: session.title,
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

  while (Date.now() - startedAt <= SHELL_INTEGRATION_WAIT_MS) {
    if (terminal.shellIntegration?.executeCommand) {
      return;
    }

    await delay(SHELL_INTEGRATION_POLL_MS);
  }
}

async function waitForShellExecution(terminal: VsCodeTerminalLike, command: string, signal?: AbortSignal) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= SHELL_INTEGRATION_WAIT_MS) {
    if (signal?.aborted) {
      throw createCancelledExecutionError();
    }

    const execution = terminal.shellIntegration?.executeCommand?.(command);
    if (execution) {
      return execution;
    }

    await delay(SHELL_INTEGRATION_POLL_MS);
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
