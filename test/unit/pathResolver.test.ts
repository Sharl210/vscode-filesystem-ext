import { describe, expect, it } from 'vitest';
import { PathForbiddenError, resolveWorkspacePath } from '../../src/workspace/pathResolver';

describe('path resolver', () => {
  it('resolves an empty path to the workspace root', () => {
    expect(resolveWorkspacePath('file:///workspace/demo', '')).toBe('file:///workspace/demo');
  });

  it('resolves a nested relative path inside the workspace', () => {
    expect(resolveWorkspacePath('file:///workspace/demo', 'src/server/index.ts')).toBe(
      'file:///workspace/demo/src/server/index.ts'
    );
  });

  it('rejects parent traversal that escapes the workspace root', () => {
    expect(() => resolveWorkspacePath('file:///workspace/demo', '../outside')).toThrow(PathForbiddenError);
  });

  it('rejects absolute filesystem paths', () => {
    expect(() => resolveWorkspacePath('file:///workspace/demo', '/etc/passwd')).toThrow(PathForbiddenError);
  });
});
