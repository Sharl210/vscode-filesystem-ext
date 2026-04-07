import { describe, expect, it } from 'vitest';
import { collectAccessibleRoots } from '../../src/workspace/accessibleRoots';

describe('accessible roots', () => {
  it('returns local roots even when no workspace folder is open', () => {
    const roots = collectAccessibleRoots([], {
      platform: 'linux',
      homeDir: '/home/demo',
      remoteAuthority: null
    });

    expect(roots).toEqual([
      { name: '本机根目录', uri: 'file:///', source: 'local' },
      { name: '本机主目录', uri: 'file:///home/demo', source: 'local' }
    ]);
  });

  it('returns local roots, explorer roots, and remote host root together', () => {
    const roots = collectAccessibleRoots(
      [
        {
          name: 'AT_PARSER',
          uri: 'vscode-remote://ssh-remote+prod/home/user/AT_PARSER',
          source: 'workspace'
        },
        {
          name: '时间线',
          uri: 'vscode-remote://ssh-remote+prod/home/user/timeline',
          source: 'workspace'
        }
      ],
      {
        platform: 'linux',
        homeDir: '/home/demo',
        remoteAuthority: 'ssh-remote+prod'
      }
    );

    expect(roots).toEqual([
      { name: '本机根目录', uri: 'file:///', source: 'local' },
      { name: '本机主目录', uri: 'file:///home/demo', source: 'local' },
      {
        name: '工作区 · AT_PARSER',
        uri: 'vscode-remote://ssh-remote+prod/home/user/AT_PARSER',
        source: 'workspace'
      },
      {
        name: '工作区 · 时间线',
        uri: 'vscode-remote://ssh-remote+prod/home/user/timeline',
        source: 'workspace'
      },
      {
        name: '远程主机根目录 (prod)',
        uri: 'vscode-remote://ssh-remote+prod/',
        source: 'remote'
      }
    ]);
  });

  it('deduplicates roots by uri', () => {
    const roots = collectAccessibleRoots(
      [
        { name: '根目录', uri: 'file:///', source: 'workspace' },
        { name: '重复项目', uri: 'vscode-remote://ssh-remote+prod/', source: 'workspace' }
      ],
      {
        platform: 'linux',
        homeDir: '/',
        remoteAuthority: 'ssh-remote+prod'
      }
    );

    expect(roots).toEqual([
      { name: '本机根目录', uri: 'file:///', source: 'local' },
      { name: '工作区 · 重复项目', uri: 'vscode-remote://ssh-remote+prod/', source: 'workspace' }
    ]);
  });
});
