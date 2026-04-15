import { describe, expect, it } from 'vitest';
import manifest from '../../package.json';

describe('extension manifest', () => {
  it('prefers the workspace extension host for remote windows', () => {
    expect(manifest.extensionKind).toEqual(['workspace']);
  });
});
