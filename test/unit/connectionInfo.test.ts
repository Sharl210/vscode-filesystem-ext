import { describe, expect, it } from 'vitest';
import { resolveConnectionInfo } from '../../src/workspace/connectionInfo';

describe('connection info', () => {
  it('describes a local extension host clearly', () => {
    expect(
      resolveConnectionInfo({
        remoteName: undefined,
        hostName: 'local-machine',
        workspaceAuthorities: []
      })
    ).toEqual({
      kind: 'local',
      label: '本机 · local-machine',
      host: 'local-machine',
      remoteName: null,
      authority: null
    });
  });

  it('describes a remote ssh extension host with authority details', () => {
    expect(
      resolveConnectionInfo({
        remoteName: 'ssh-remote',
        hostName: 'ubuntu-devbox',
        workspaceAuthorities: ['ssh-remote+prod-server']
      })
    ).toEqual({
      kind: 'remote',
      label: '远程 · ssh-remote · prod-server',
      host: 'ubuntu-devbox',
      remoteName: 'ssh-remote',
      authority: 'ssh-remote+prod-server'
    });
  });
});
