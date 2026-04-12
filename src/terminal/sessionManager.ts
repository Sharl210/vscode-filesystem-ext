import type { GatewayTerminalExecutionResult } from '../executor/contracts';
import type { TerminalPoolSnapshotDto, TerminalTabContentDto, TerminalTabSnapshotDto, TerminalTabStatusDto } from '../types/api';

interface TerminalSessionBackend {
  createSession(input: { tabId: string; title: string; cwd: string }): Promise<TerminalBackendSession>;
  execute(
    session: TerminalBackendSession,
    input: { command: string; cwd: string; timeoutMs?: number; env?: Record<string, string>; signal?: AbortSignal }
  ): Promise<GatewayTerminalExecutionResult>;
  closeSession(session: TerminalBackendSession, input: { initiatedBy: string }): Promise<void>;
}

interface TerminalBackendSession {
  sessionId: string;
  cwd: string;
}

interface TerminalTabState {
  tabId: string;
  title: string;
  cwd: string;
  status: TerminalTabStatusDto;
  lastActiveAt: string;
  recentCommands: string[];
  content: string;
  historyVersion: number;
  pendingExecutions: number;
  executionChain: Promise<void>;
  session: TerminalBackendSession;
}

type TerminalExecutionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

interface TerminalExecutionState {
  executionId: string;
  tabId: string;
  command: string;
  cwd: string;
  status: TerminalExecutionStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  timedOut: boolean;
  error: string | null;
  result: GatewayTerminalExecutionResult | null;
}

const MAX_RECENT_COMMANDS = 15;

export function createTerminalSessionManager(backend: TerminalSessionBackend) {
  const tabs = new Map<string, TerminalTabState>();
  const executions = new Map<string, TerminalExecutionState>();
  const executionControllers = new Map<string, AbortController>();
  let defaultTabId: string | null = null;
  let nextTabId = 1;
  let nextExecutionId = 1;

  return {
    listTabs(): TerminalPoolSnapshotDto {
      return {
        tabs: [...tabs.values()].map((tab) => toSnapshot(tab, defaultTabId)),
        defaultTabId
      };
    },
    getTabContent(tabId: string): TerminalTabContentDto {
      const tab = tabs.get(tabId);
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
    },
    async newTab(input: { title?: string; cwd?: string } = {}): Promise<TerminalTabSnapshotDto> {
      const tabId = `tab-${nextTabId++}`;
      const now = new Date().toISOString();
      const title = input.title ?? 'Terminal';
      const cwd = input.cwd ?? '';
      const session = await backend.createSession({ tabId, title, cwd });
      const tab: TerminalTabState = {
        tabId,
        title,
        cwd,
        status: 'idle',
        lastActiveAt: now,
        recentCommands: [],
        content: '',
        historyVersion: 0,
        pendingExecutions: 0,
        executionChain: Promise.resolve(),
        session
      };

      tabs.set(tabId, tab);

      if (!defaultTabId) {
        defaultTabId = tabId;
      }

      return toSnapshot(tab, defaultTabId);
    },
    async closeTab(tabId: string, input: { initiatedBy: string }): Promise<TerminalPoolSnapshotDto> {
      const tab = tabs.get(tabId);
      if (!tab) {
        return this.listTabs();
      }

      await backend.closeSession(tab.session, input);
      tabs.delete(tabId);

      if (defaultTabId === tabId) {
        defaultTabId = null;
      }

      return this.listTabs();
    },
    async execute(input: {
      command: string;
      cwd?: string;
      tabId?: string;
      timeoutMs?: number;
      env?: Record<string, string>;
    }): Promise<GatewayTerminalExecutionResult & { tabId: string }> {
      let tabId = input.tabId ?? defaultTabId;

      if (!tabId) {
        tabId = (await this.newTab({ cwd: input.cwd })).tabId;
      }

      const tab = tabs.get(tabId);
      if (!tab) {
        throw new Error(`Unknown terminal tab: ${tabId}`);
      }

      tab.pendingExecutions += 1;
      tab.status = 'running';

      const run = async () => {
        const executionCwd = input.cwd ?? tab.cwd;
        tab.cwd = executionCwd;
        tab.session.cwd = executionCwd;

        try {
          const result = await backend.execute(tab.session, {
            command: input.command,
            cwd: executionCwd,
            timeoutMs: input.timeoutMs,
            env: input.env
          });

          tab.cwd = result.cwd;
          tab.session.cwd = result.cwd;
          tab.lastActiveAt = new Date().toISOString();
          tab.recentCommands.push(input.command);
          tab.content = appendTerminalHistory(tab.content, input.command, result.combinedOutput);
          tab.historyVersion += 1;
          if (tab.recentCommands.length > MAX_RECENT_COMMANDS) {
            tab.recentCommands.splice(0, tab.recentCommands.length - MAX_RECENT_COMMANDS);
          }

          return {
            ...result,
            tabId
          };
        } finally {
          tab.pendingExecutions -= 1;
          tab.status = tab.pendingExecutions > 0 ? 'running' : 'idle';
        }
      };

      const execution = tab.executionChain.then(run, run);
      tab.executionChain = execution.then(
        () => undefined,
        () => undefined
      );
      return execution;
    },
    async startExecution(input: {
      command: string;
      cwd?: string;
      tabId?: string;
      timeoutMs?: number;
      env?: Record<string, string>;
    }) {
      const tab = await resolveTabForExecution({
        tabs,
        defaultTabId,
        input,
        createTab: (payload) => this.newTab(payload)
      });
      if (!defaultTabId) {
        defaultTabId = tab.tabId;
      }

      const executionCwd = input.cwd ?? tab.cwd;
      const executionId = `exec-${nextExecutionId++}`;
      const createdAt = new Date().toISOString();
      const executionState: TerminalExecutionState = {
        executionId,
        tabId: tab.tabId,
        command: input.command,
        cwd: executionCwd,
        status: 'queued',
        createdAt,
        startedAt: null,
        finishedAt: null,
        exitCode: null,
        timedOut: false,
        error: null,
        result: null
      };
      executions.set(executionId, executionState);

      const abortController = new AbortController();
      executionControllers.set(executionId, abortController);

      tab.pendingExecutions += 1;
      tab.status = 'running';

      const run = async () => {
        const currentExecution = executions.get(executionId);
        if (abortController.signal.aborted || currentExecution?.status === 'cancelled') {
          return;
        }

        const startedAt = new Date().toISOString();
        updateExecutionState(executions, executionId, {
          status: 'running',
          startedAt,
          cwd: executionCwd
        });
        tab.cwd = executionCwd;
        tab.session.cwd = executionCwd;

        if (abortController.signal.aborted) {
          updateExecutionState(executions, executionId, {
            status: 'cancelled',
            finishedAt: new Date().toISOString(),
            error: '执行已取消'
          });
          return;
        }

        try {
          const result = await backend.execute(tab.session, {
            command: input.command,
            cwd: executionCwd,
            timeoutMs: input.timeoutMs,
            env: input.env,
            signal: abortController.signal
          });

          if (abortController.signal.aborted) {
            updateExecutionState(executions, executionId, {
              status: 'cancelled',
              finishedAt: new Date().toISOString(),
              error: '执行已取消',
              result: null
            });
            return;
          }

          tab.cwd = result.cwd;
          tab.session.cwd = result.cwd;
          tab.lastActiveAt = new Date().toISOString();
          tab.recentCommands.push(input.command);
          tab.content = appendTerminalHistory(tab.content, input.command, result.combinedOutput);
          tab.historyVersion += 1;
          if (tab.recentCommands.length > MAX_RECENT_COMMANDS) {
            tab.recentCommands.splice(0, tab.recentCommands.length - MAX_RECENT_COMMANDS);
          }

          updateExecutionState(executions, executionId, {
            status: 'completed',
            finishedAt: new Date().toISOString(),
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            result
          });
        } catch (error) {
          if (abortController.signal.aborted || isTerminalExecutionCancelledError(error)) {
            updateExecutionState(executions, executionId, {
              status: 'cancelled',
              finishedAt: new Date().toISOString(),
              error: '执行已取消'
            });
            return;
          }

          updateExecutionState(executions, executionId, {
            status: 'failed',
            finishedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Terminal execution failed'
          });
        } finally {
          executionControllers.delete(executionId);
          tab.pendingExecutions -= 1;
          tab.status = tab.pendingExecutions > 0 ? 'running' : 'idle';
        }
      };

      const execution = tab.executionChain.then(run, run);
      tab.executionChain = execution.then(
        () => undefined,
        () => undefined
      );

      return toExecutionSnapshot(executionState);
    },
    getExecution(executionId: string) {
      const execution = executions.get(executionId);
      return execution ? toExecutionSnapshot(execution) : null;
    },
    getExecutionOutput(executionId: string) {
      const execution = executions.get(executionId);
      if (!execution || execution.status !== 'completed' || !execution.result) {
        return null;
      }

      return {
        executionId,
        tabId: execution.tabId,
        command: execution.command,
        cwd: execution.result.cwd,
        stdout: execution.result.stdout,
        stderr: execution.result.stderr,
        combinedOutput: execution.result.combinedOutput,
        exitCode: execution.result.exitCode,
        timedOut: execution.result.timedOut,
        finishedAt: execution.finishedAt
      };
    },
    cancelExecution(executionId: string) {
      const controller = executionControllers.get(executionId);
      const existed = controller !== undefined || executions.has(executionId);
      if (existed) {
        updateExecutionState(executions, executionId, {
          status: 'cancelled',
          finishedAt: new Date().toISOString(),
          error: '执行已取消',
          result: null
        });
      }
      controller?.abort();
      return existed;
    }
  };
}

async function resolveTabForExecution(input: {
  tabs: Map<string, TerminalTabState>;
  defaultTabId: string | null;
  input: { tabId?: string; cwd?: string };
  createTab: (payload: { cwd?: string }) => Promise<TerminalTabSnapshotDto>;
}) {
  let tabId = input.input.tabId ?? input.defaultTabId;
  if (!tabId) {
    tabId = (await input.createTab({ cwd: input.input.cwd })).tabId;
  }

  const tab = input.tabs.get(tabId);
  if (!tab) {
    throw new Error(`Unknown terminal tab: ${tabId}`);
  }

  return tab;
}

function updateExecutionState(
  executions: Map<string, TerminalExecutionState>,
  executionId: string,
  patch: Partial<TerminalExecutionState>
) {
  const current = executions.get(executionId);
  if (!current) {
    return;
  }

  executions.set(executionId, {
    ...current,
    ...patch
  });
}

function toExecutionSnapshot(execution: TerminalExecutionState) {
  return {
    executionId: execution.executionId,
    tabId: execution.tabId,
    command: execution.command,
    cwd: execution.cwd,
    status: execution.status,
    createdAt: execution.createdAt,
    startedAt: execution.startedAt,
    finishedAt: execution.finishedAt,
    exitCode: execution.exitCode,
    timedOut: execution.timedOut,
    error: execution.error
  };
}

function isTerminalExecutionCancelledError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === 'AbortError' || error.message === 'TERMINAL_EXECUTION_ABORTED';
}

function toSnapshot(tab: TerminalTabState, defaultTabId: string | null): TerminalTabSnapshotDto {
  return {
    tabId: tab.tabId,
    title: tab.title,
    cwd: tab.cwd,
    status: tab.status,
    isDefault: tab.tabId === defaultTabId,
    lastActiveAt: tab.lastActiveAt,
    recentCommands: [...tab.recentCommands]
  };
}

function appendTerminalHistory(existingContent: string, command: string, output: string): string {
  let nextChunk = `$ ${command}\n`;
  if (output.length > 0) {
    nextChunk += output;
  }
  if (!nextChunk.endsWith('\n')) {
    nextChunk += '\n';
  }

  return `${existingContent}${nextChunk}`;
}
