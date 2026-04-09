import { describe, expect, it, vi } from 'vitest';
import { createServiceState } from '../../src/state/serviceState';

describe('service state', () => {
  it('uses the provided auth token in the generated local url', async () => {
    const serviceState = createServiceState(
      {
        async start() {
          return {
            port: 5020,
            async stop() {}
          };
        }
      },
      'shared-token'
    );

    const result = await serviceState.ensureStarted(async () => ({
      status: 200,
      headers: {},
      body: new Uint8Array()
    }));

    expect(result.token).toBe('shared-token');
    expect(result.localUrl).toBe('http://127.0.0.1:5020/?token=shared-token');
  });

  it('starts at most once when ensureStarted is called concurrently', async () => {
    let resolveStart: (value: { port: number; stop(): Promise<void> }) => void = () => {
      throw new Error('start resolver not captured');
    };
    const start = vi.fn(
      () =>
        new Promise<{ port: number; stop(): Promise<void> }>((resolve) => {
          resolveStart = resolve;
        })
    );
    const serviceState = createServiceState({ start }, 'shared-token');
    const handler = async () => ({
      status: 200,
      headers: {},
      body: new Uint8Array()
    });

    const firstStart = serviceState.ensureStarted(handler);
    const secondStart = serviceState.ensureStarted(handler);

    await Promise.resolve();

    expect(start).toHaveBeenCalledTimes(1);

    resolveStart({
      port: 5020,
      async stop() {}
    });

    await expect(firstStart).resolves.toEqual({
      token: 'shared-token',
      localUrl: 'http://127.0.0.1:5020/?token=shared-token'
    });
    await expect(secondStart).resolves.toEqual({
      token: 'shared-token',
      localUrl: 'http://127.0.0.1:5020/?token=shared-token'
    });
  });

  it('clears the snapshot on stop and allows the service to start again', async () => {
    let nextPort = 5020;
    const stop = vi.fn(async () => {});
    const serviceState = createServiceState(
      {
        async start() {
          return {
            port: nextPort++,
            stop
          };
        }
      },
      'shared-token'
    );

    expect(serviceState.getSnapshot()).toEqual({ token: null, localUrl: null });

    const firstStart = await serviceState.ensureStarted(async () => ({
      status: 200,
      headers: {},
      body: new Uint8Array()
    }));

    expect(serviceState.getSnapshot()).toEqual(firstStart);

    await serviceState.stop();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(serviceState.getSnapshot()).toEqual({ token: null, localUrl: null });

    const secondStart = await serviceState.ensureStarted(async () => ({
      status: 200,
      headers: {},
      body: new Uint8Array()
    }));

    expect(secondStart.token).toBe('shared-token');
    expect(secondStart.localUrl).toBe('http://127.0.0.1:5021/?token=shared-token');
  });

  it('clears the snapshot and allows restart even when stop rejects', async () => {
    let nextPort = 5020;
    let shouldRejectOnStop = true;
    const serviceState = createServiceState(
      {
        async start() {
          return {
            port: nextPort++,
            async stop() {
              if (shouldRejectOnStop) {
                shouldRejectOnStop = false;
                throw new Error('close failed');
              }
            }
          };
        }
      },
      'shared-token'
    );

    await serviceState.ensureStarted(async () => ({
      status: 200,
      headers: {},
      body: new Uint8Array()
    }));

    await expect(serviceState.stop()).rejects.toThrow('close failed');
    expect(serviceState.getSnapshot()).toEqual({ token: null, localUrl: null });

    const restarted = await serviceState.ensureStarted(async () => ({
      status: 200,
      headers: {},
      body: new Uint8Array()
    }));

    expect(restarted.localUrl).toBe('http://127.0.0.1:5021/?token=shared-token');
  });

  it('reuses an existing service on a fixed port when the address is already in use', async () => {
    const fetchMock = vi.fn(async (_input: URL | RequestInfo) => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const serviceState = createServiceState(
      {
        async start() {
          const error = new Error('address in use') as Error & { code: string };
          error.code = 'EADDRINUSE';
          throw error;
        }
      },
      'shared-token',
      {
        host: '127.0.0.1',
        port: 21080,
        preferExistingOnPortInUse: true,
        healthCheckPath: '/mcp',
        includeTokenInHealthCheck: false,
        requireJsonOkField: false
      }
    );

    const started = await serviceState.ensureStarted(async () => ({
      status: 200,
      headers: {},
      body: new Uint8Array()
    }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) {
      throw new Error('fetch call was not captured');
    }

    const fetchUrl = firstCall[0] as URL;
    expect(fetchUrl.toString()).toBe('http://127.0.0.1:21080/mcp');
    expect(started.localUrl).toBe('http://127.0.0.1:21080/?token=shared-token');
    vi.unstubAllGlobals();
  });
});
