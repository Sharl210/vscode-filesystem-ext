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
}): Promise<GatewayTerminalExecutionResult> {
  const shellCandidates = buildShellCandidates(input.preferredShellPath);
  let lastError: unknown;

  for (const shellPath of shellCandidates) {
    try {
      return await runCommand({
        shellPath,
        command: input.command,
        cwd: input.cwd,
        timeoutMs: input.timeoutMs,
        env: input.env
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
}): Promise<GatewayTerminalExecutionResult> {
  return new Promise((resolve, reject) => {
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
    let timeoutHandle: NodeJS.Timeout | undefined;

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
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      reject(error);
    });

    child.on('close', (exitCode) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      resolve({
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
