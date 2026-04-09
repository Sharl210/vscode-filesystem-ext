import { describe, expect, it } from 'vitest';
import { PathForbiddenError, resolveTerminalCwdPath, resolveWorkspacePath } from '../../src/workspace/pathResolver';

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

  it('allows an absolute Windows path when it stays inside the workspace root', () => {
    expect(resolveTerminalCwdPath('file:///z%3A/home/harl/at_parser', 'z:/home/harl/at_parser/src')).toBe('z:/home/harl/at_parser/src');
  });

  it('rejects an absolute Windows path when it escapes the workspace root', () => {
    expect(() => resolveTerminalCwdPath('file:///z%3A/home/harl/at_parser', 'z:/other-project')).toThrow(PathForbiddenError);
  });
});
