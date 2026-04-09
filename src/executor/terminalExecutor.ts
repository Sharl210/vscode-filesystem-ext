import { spawn } from 'node:child_process';
import type { GatewayTerminalExecutor, GatewayTerminalExecutionResult } from './contracts';

interface TerminalExecutorOptions {
  shellPath: string;
}

export function createTerminalExecutor(options: TerminalExecutorOptions): GatewayTerminalExecutor {
  return {
    execute(input) {
      return runCommand({
        shellPath: options.shellPath,
        ...input
      });
    }
  };
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
