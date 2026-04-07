import { describe, expect, it } from 'vitest';
import { PathForbiddenError, resolveWorkspacePath } from '../../src/workspace/pathResolver';

describe('path resolver remote uri support', () => {
  it('resolves nested paths under a vscode-remote root', () => {
    expect(
      resolveWorkspacePath('vscode-remote://ssh-remote+prod/home/user/project', 'src/index.ts')
    ).toBe('vscode-remote://ssh-remote+prod/home/user/project/src/index.ts');
  });

  it('rejects remote paths that escape the root', () => {
    expect(() =>
      resolveWorkspacePath('vscode-remote://ssh-remote+prod/home/user/project', '../outside')
    ).toThrow(PathForbiddenError);
  });
});
