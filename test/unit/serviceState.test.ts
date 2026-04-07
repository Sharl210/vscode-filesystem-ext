import { describe, expect, it } from 'vitest';
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
});
