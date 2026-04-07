import { describe, expect, it } from 'vitest';
import { createWorkspaceRegistry } from '../../src/workspace/workspaceRegistry';

describe('workspace registry', () => {
  it('keeps a stable id for the same workspace uri', () => {
    const registry = createWorkspaceRegistry();

    const first = registry.sync([
      { name: 'demo', uri: 'file:///demo', source: 'workspace' },
      { name: 'docs', uri: 'file:///docs', source: 'workspace' }
    ]);
    const second = registry.sync([{ name: 'demo', uri: 'file:///demo', source: 'workspace' }]);

    expect(second[0]?.id).toBe(first[0]?.id);
  });

  it('assigns distinct ids to different workspace uris', () => {
    const registry = createWorkspaceRegistry();

    const items = registry.sync([
      { name: 'demo', uri: 'file:///demo', source: 'workspace' },
      { name: 'docs', uri: 'file:///docs', source: 'workspace' }
    ]);

    expect(items[0]?.id).not.toBe(items[1]?.id);
  });

  it('returns an empty list when there are no workspaces', () => {
    const registry = createWorkspaceRegistry();

    expect(registry.sync([])).toEqual([]);
    expect(registry.list()).toEqual([]);
  });
});
