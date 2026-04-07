import { describe, expect, it } from 'vitest';
import { groupRootsBySource } from '../../src/webui/rootGrouping';

describe('root grouping', () => {
  it('groups roots into local, workspace, and remote buckets in a stable order', () => {
    const groups = groupRootsBySource([
      { id: '2', name: '远程主机根目录 (prod-server)', uri: 'vscode-remote://ssh-remote+prod/', source: 'remote' },
      { id: '1', name: '本机根目录', uri: 'file:///', source: 'local' },
      { id: '3', name: '工作区 · AT_PARSER', uri: 'vscode-remote://ssh-remote+prod/home/user/AT_PARSER', source: 'workspace' }
    ]);

    expect(groups).toEqual([
      {
        label: '本机',
        items: [{ id: '1', name: '本机根目录', uri: 'file:///', source: 'local' }]
      },
      {
        label: '工作区',
        items: [{ id: '3', name: '工作区 · AT_PARSER', uri: 'vscode-remote://ssh-remote+prod/home/user/AT_PARSER', source: 'workspace' }]
      },
      {
        label: '远程',
        items: [{ id: '2', name: '远程主机根目录 (prod-server)', uri: 'vscode-remote://ssh-remote+prod/', source: 'remote' }]
      }
    ]);
  });
});
