import type { GatewayExecutor, GatewayTerminalManager } from '../executor/contracts';
import { sendJsonError, sendJsonSuccess, type RouterResponse } from './response';
import { resolveTerminalCwdPath } from '../workspace/pathResolver';

interface TerminalRouterRequest {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body: Uint8Array;
}

interface TerminalRouterDependencies {
  reads: Pick<GatewayExecutor['reads'], 'getWorkspaceById'>;
  terminalManager: GatewayTerminalManager;
}

export function createTerminalRouter(dependencies: TerminalRouterDependencies) {
  return {
    async handle(request: TerminalRouterRequest, url: URL): Promise<RouterResponse | null> {
      if (url.pathname === '/api/terminal/tabs' && request.method === 'GET') {
        return sendJsonSuccess(dependencies.terminalManager.listTabs());
      }

      if (url.pathname === '/api/terminal/tabs' && request.method === 'POST') {
        const payloadResult = parseJson<Record<string, unknown>>(request.body);
        if (!payloadResult.ok) {
          return sendJsonError('INVALID_REQUEST', '请求体不是合法的 JSON');
        }

        return sendJsonSuccess(
          await dependencies.terminalManager.newTab({
            title: getOptionalStringOrUndefined(payloadResult.data, 'title'),
            cwd: resolveOptionalTerminalCwd(dependencies.reads, payloadResult.data)
          })
        );
      }

      const contentMatch = url.pathname.match(/^\/api\/terminal\/tabs\/([^/]+)\/content$/);
      if (contentMatch && request.method === 'GET') {
        return sendJsonSuccess(dependencies.terminalManager.getTabContent(decodeURIComponent(contentMatch[1] ?? '')));
      }

      const tabMatch = url.pathname.match(/^\/api\/terminal\/tabs\/([^/]+)$/);
      if (tabMatch && request.method === 'DELETE') {
        const tabId = decodeURIComponent(tabMatch[1] ?? '');
        const snapshot = await dependencies.terminalManager.closeTab(tabId, { initiatedBy: 'web' });
        return sendJsonSuccess({
          closed: true,
          closedTabId: tabId,
          defaultTabId: snapshot.defaultTabId,
          tabs: snapshot.tabs
        });
      }

      if (url.pathname === '/api/terminal/execute' && request.method === 'POST') {
        const payloadResult = parseJson<Record<string, unknown>>(request.body);
        if (!payloadResult.ok) {
          return sendJsonError('INVALID_REQUEST', '请求体不是合法的 JSON');
        }

        const payload = payloadResult.data;
        const command = getRequiredString(payload, 'command');
        return sendJsonSuccess(
          await dependencies.terminalManager.execute({
            tabId: getOptionalStringOrUndefined(payload, 'tabId'),
            command,
            cwd: resolveOptionalTerminalCwd(dependencies.reads, payload),
            timeoutMs: getOptionalNumber(payload, 'timeoutMs')
          })
        );
      }

      if (url.pathname === '/api/terminal/executions' && request.method === 'POST') {
        const payloadResult = parseJson<Record<string, unknown>>(request.body);
        if (!payloadResult.ok) {
          return sendJsonError('INVALID_REQUEST', '请求体不是合法的 JSON');
        }

        const payload = payloadResult.data;
        const command = getRequiredString(payload, 'command');
        return sendJsonSuccess(
          await dependencies.terminalManager.startExecution({
            tabId: getOptionalStringOrUndefined(payload, 'tabId'),
            command,
            cwd: resolveOptionalTerminalCwd(dependencies.reads, payload),
            timeoutMs: getOptionalNumber(payload, 'timeoutMs')
          })
        );
      }

      const executionOutputMatch = url.pathname.match(/^\/api\/terminal\/executions\/([^/]+)\/output$/);
      if (executionOutputMatch && request.method === 'GET') {
        return sendJsonSuccess(
          dependencies.terminalManager.getExecutionOutput(decodeURIComponent(executionOutputMatch[1] ?? ''))
        );
      }

      const executionMatch = url.pathname.match(/^\/api\/terminal\/executions\/([^/]+)$/);
      if (executionMatch && request.method === 'GET') {
        const executionId = decodeURIComponent(executionMatch[1] ?? '');
        const snapshot = dependencies.terminalManager.getExecution(executionId);
        if (!snapshot) {
          return sendJsonError('ENTRY_NOT_FOUND', `Unknown terminal execution: ${executionId}`);
        }

        return sendJsonSuccess(snapshot);
      }

      if (executionMatch && request.method === 'DELETE') {
        const executionId = decodeURIComponent(executionMatch[1] ?? '');
        return sendJsonSuccess({
          executionId,
          cancelled: dependencies.terminalManager.cancelExecution(executionId)
        });
      }

      return null;
    }
  };
}

function parseJson<T>(body: Uint8Array): { ok: true; data: T } | { ok: false } {
  if (body.byteLength === 0) {
    return {
      ok: true,
      data: {} as T
    };
  }

  try {
    return {
      ok: true,
      data: JSON.parse(new TextDecoder().decode(body)) as T
    };
  } catch {
    return { ok: false };
  }
}

function getRequiredString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid or missing parameter: ${key}`);
  }

  return value;
}

function getOptionalString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

function getOptionalStringOrUndefined(payload: Record<string, unknown>, key: string): string | undefined {
  const value = getOptionalString(payload, key).trim();
  return value === '' ? undefined : value;
}

function getOptionalNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function resolveOptionalTerminalCwd(
  reads: Pick<GatewayExecutor['reads'], 'getWorkspaceById'>,
  payload: Record<string, unknown>
): string | undefined {
  const workspaceId = getOptionalStringOrUndefined(payload, 'workspaceId');
  const cwdPath = getOptionalString(payload, 'cwdPath');

  if (!workspaceId) {
    return cwdPath === '' ? undefined : cwdPath;
  }

  const workspace = reads.getWorkspaceById(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  return resolveTerminalCwdPath(workspace.uri, cwdPath);
}
