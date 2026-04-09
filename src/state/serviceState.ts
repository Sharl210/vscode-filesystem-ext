import type { RouterResponse } from '../server/response';

export interface RunningServer {
  port: number;
  stop(): Promise<void>;
}

export interface ServerStartOptions {
  host?: string;
  port?: number;
}

export interface ServerFactory {
  start(handler: (request: RequestShape) => Promise<RouterResponse>, options?: ServerStartOptions): Promise<RunningServer>;
}

export interface RequestShape {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body: Uint8Array;
}

export interface ServiceState {
  ensureStarted(handler: (request: RequestShape) => Promise<RouterResponse>): Promise<{ token: string; localUrl: string }>;
  stop(): Promise<void>;
  getSnapshot(): { token: string | null; localUrl: string | null };
}

export interface ServiceStateOptions {
  host?: string;
  port?: number;
  preferExistingOnPortInUse?: boolean;
  healthCheckPath?: string;
  includeTokenInHealthCheck?: boolean;
  requireJsonOkField?: boolean;
  includeTokenInLocalUrl?: boolean;
}

export function createServiceState(serverFactory: ServerFactory, authToken: string, options: ServiceStateOptions = {}): ServiceState {
  let token: string | null = null;
  let localUrl: string | null = null;
  let server: RunningServer | null = null;
  let startPromise: Promise<void> | null = null;
  const host = options.host ?? '127.0.0.1';
  const configuredPort = options.port;
  const preferExistingOnPortInUse = options.preferExistingOnPortInUse ?? false;
  const healthCheckPath = options.healthCheckPath ?? '/api/workspaces';
  const includeTokenInHealthCheck = options.includeTokenInHealthCheck ?? true;
  const requireJsonOkField = options.requireJsonOkField ?? true;
  const includeTokenInLocalUrl = options.includeTokenInLocalUrl ?? true;

  return {
    async ensureStarted(handler) {
      if (!server) {
        if (!startPromise) {
          startPromise = (async () => {
            token = authToken;
            try {
              const startedServer = await serverFactory.start(handler, {
                host,
                port: configuredPort
              });
              server = startedServer;
              localUrl = buildLocalUrl(host, startedServer.port, token, includeTokenInLocalUrl);
            } catch (error) {
              if (!preferExistingOnPortInUse || !configuredPort || !isAddressInUseError(error)) {
                throw error;
              }

              const existingServiceAvailable = await verifyExistingService(
                host,
                configuredPort,
                token,
                healthCheckPath,
                includeTokenInHealthCheck,
                requireJsonOkField
              );
              if (!existingServiceAvailable) {
                throw error;
              }

              server = null;
              localUrl = buildLocalUrl(host, configuredPort, token, includeTokenInLocalUrl);
            }
          })().finally(() => {
            startPromise = null;
          });
        }

        await startPromise;
      }

      if (!token || !localUrl) {
        throw new Error('Service state is unavailable after startup.');
      }

      return {
        token,
        localUrl
      };
    },
    async stop() {
      const runningServer = server;

      try {
        if (runningServer) {
          await runningServer.stop();
        }
      } finally {
        if (server === runningServer) {
          token = null;
          localUrl = null;
          server = null;
        }
        startPromise = null;
      }
    },
    getSnapshot() {
      return {
        token,
        localUrl
      };
    }
  };
}

function isAddressInUseError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  return 'code' in error && error.code === 'EADDRINUSE';
}

function buildLocalUrl(host: string, port: number, token: string, includeToken: boolean): string {
  const baseUrl = new URL(`http://${host}:${port}/`);
  if (includeToken) {
    baseUrl.searchParams.set('token', token);
  }

  return baseUrl.toString();
}

async function verifyExistingService(
  host: string,
  port: number,
  token: string,
  healthCheckPath: string,
  includeTokenInHealthCheck: boolean,
  requireJsonOkField: boolean
): Promise<boolean> {
  try {
    const healthCheckUrl = new URL(`http://${host}:${port}${healthCheckPath.startsWith('/') ? healthCheckPath : `/${healthCheckPath}`}`);
    if (includeTokenInHealthCheck) {
      healthCheckUrl.searchParams.set('token', token);
    }

    const response = await fetch(healthCheckUrl);
    if (!response.ok) {
      return false;
    }

    if (!requireJsonOkField) {
      return true;
    }

    const body = await response.json() as unknown;
    return typeof body === 'object' && body !== null && 'ok' in body && body.ok === true;
  } catch {
    return false;
  }
}
