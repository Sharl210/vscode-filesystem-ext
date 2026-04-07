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

  return {
    async ensureStarted(handler) {
      if (!server) {
        token = authToken;
        server = await serverFactory.start(handler);
        localUrl = `http://127.0.0.1:${server.port}/?token=${token}`;
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
      if (server) {
        await server.stop();
      }

      token = null;
      localUrl = null;
      server = null;
    },
    getSnapshot() {
      return {
        token,
        localUrl
      };
    }
  };
}
