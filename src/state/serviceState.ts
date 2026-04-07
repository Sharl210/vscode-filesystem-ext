import type { RouterResponse } from '../server/response';

export interface RunningServer {
  port: number;
  stop(): Promise<void>;
}

export interface ServerFactory {
  start(handler: (request: RequestShape) => Promise<RouterResponse>): Promise<RunningServer>;
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

export function createServiceState(serverFactory: ServerFactory, authToken: string): ServiceState {
  let token: string | null = null;
  let localUrl: string | null = null;
  let server: RunningServer | null = null;
  let startPromise: Promise<void> | null = null;

  return {
    async ensureStarted(handler) {
      if (!server) {
        if (!startPromise) {
          startPromise = (async () => {
            token = authToken;
            const startedServer = await serverFactory.start(handler);
            server = startedServer;
            localUrl = `http://127.0.0.1:${startedServer.port}/?token=${token}`;
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
