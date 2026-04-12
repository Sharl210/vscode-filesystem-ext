import { spawn } from 'node:child_process';
import type { GatewayTerminalExecutor, GatewayTerminalExecutionResult } from './contracts';

interface TerminalExecutorOptions {
  shellPath: string;
}

export function createTerminalExecutor(options: TerminalExecutorOptions): GatewayTerminalExecutor {
  return {
    execute(input) {
      return runCommandWithFallback({
        preferredShellPath: options.shellPath,
        ...input
      });
    }
  };
}

async function runCommandWithFallback(input: {
  preferredShellPath: string;
  command: string;
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  signal?: AbortSignal;
}): Promise<GatewayTerminalExecutionResult> {
  const shellCandidates = buildShellCandidates(input.preferredShellPath);
  let lastError: unknown;

  for (const shellPath of shellCandidates) {
    try {
      return await runCommand({
        shellPath,
        command: wrapCommandForShell(shellPath, input.command),
        cwd: input.cwd,
        timeoutMs: input.timeoutMs,
        env: input.env,
        signal: input.signal
      });
    } catch (error) {
      lastError = error;
      if (!isMissingShellError(error)) {
        throw error;
      }
    }
  }

  throw lastError;
}

function runCommand(input: {
  shellPath: string;
  command: string;
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  signal?: AbortSignal;
}): Promise<GatewayTerminalExecutionResult> {
  if (input.signal?.aborted) {
    return Promise.reject(createCancelledExecutionError());
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(input.command, {
      cwd: input.cwd,
      env: {
        ...process.env,
        ...input.env
      },
      shell: input.shellPath
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let timeoutHandle: NodeJS.Timeout | undefined;

    const onAbort = () => {
      if (settled) {
        return;
      }

      cancelled = true;
      child.kill('SIGTERM');
    };

    input.signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      input.signal?.removeEventListener('abort', onAbort);
    };

    const finishResolve = (value: GatewayTerminalExecutionResult) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(value);
    };

    const finishReject = (error: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    };

    if (input.timeoutMs && input.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, input.timeoutMs);
      timeoutHandle.unref?.();
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (cancelled) {
        finishReject(createCancelledExecutionError());
        return;
      }

      finishReject(error);
    });

    child.on('close', (exitCode) => {
      if (cancelled) {
        finishReject(createCancelledExecutionError());
        return;
      }

      finishResolve({
        command: input.command,
        cwd: input.cwd,
        stdout,
        stderr,
        combinedOutput: `${stdout}${stderr}`,
        exitCode,
        timedOut
      });
    });
  });
}

function createCancelledExecutionError() {
  const error = new Error('TERMINAL_EXECUTION_ABORTED');
  error.name = 'AbortError';
  return error;
}

function buildShellCandidates(preferredShellPath: string): string[] {
  const candidates = new Set<string>();
  const push = (value: string | undefined) => {
    if (value && value.trim()) {
      candidates.add(value);
    }
  };

  push(preferredShellPath);

  if (process.platform === 'win32') {
    push(process.env.ComSpec);
    push('powershell.exe');
    push('cmd.exe');
  } else {
    push('/bin/sh');
    push('sh');
    push('bash');
  }

  return [...candidates];
}

function isMissingShellError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function wrapCommandForShell(shellPath: string, command: string): string {
  const normalized = shellPath.toLowerCase();

  if (normalized.includes('powershell') || normalized.includes('pwsh')) {
    return `[Console]::InputEncoding=[System.Text.UTF8Encoding]::new(); [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); $OutputEncoding=[System.Text.UTF8Encoding]::new(); ${command}`;
  }

  if (normalized.includes('cmd.exe') || normalized.endsWith('cmd')) {
    return `chcp 65001>nul & ${command}`;
  }

  return command;
}
