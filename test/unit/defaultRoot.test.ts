import { describe, expect, it } from 'vitest';
import { pickInitialRootId } from '../../src/webui/defaultRoot';

describe('pickInitialRootId', () => {
  it('prefers workspace roots over local roots', () => {
    expect(
      pickInitialRootId([
        { id: 'local-root', source: 'local' },
        { id: 'workspace-root', source: 'workspace' }
      ])
    ).toBe('workspace-root');
  });

  it('falls back to local roots when no workspace exists', () => {
    expect(
      pickInitialRootId([
        { id: 'local-root', source: 'local' },
        { id: 'remote-root', source: 'remote' }
      ])
    ).toBe('local-root');
  });
});
