import http from 'node:http';
import type { RequestShape, RunningServer, ServerStartOptions } from '../state/serviceState';
import type { RouterResponse } from './response';

export function createNodeServerFactory() {
  return {
    async start(handler: (request: RequestShape) => Promise<RouterResponse>, options: ServerStartOptions = {}): Promise<RunningServer> {
      const server = http.createServer(async (request, response) => {
        try {
          const body = await readBody(request);
          const result = await handler({
            method: request.method ?? 'GET',
            url: request.url ?? '/',
            headers: normalizeHeaders(request.headers),
            body
          });

          response.writeHead(result.status, result.headers);
          response.end(Buffer.from(result.body));
        } catch {
          response.writeHead(500, {
            'content-type': 'application/json; charset=utf-8'
          });
          response.end(JSON.stringify({
            ok: false,
            error: {
              code: 'INTERNAL_ERROR',
              message: '服务端处理请求时发生内部错误'
            }
          }));
        }
      });

      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => resolve());
      });

      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to resolve server address.');
      }

      return {
        port: address.port,
        async stop() {
          await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          });
        }
      };
    }
  };
}

async function readBody(request: http.IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return new Uint8Array(Buffer.concat(chunks));
}

function normalizeHeaders(headers: http.IncomingHttpHeaders): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value])
  );
}
