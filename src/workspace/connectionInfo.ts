import type { ConnectionInfoDto } from '../types/api';

interface ConnectionInfoOptions {
  remoteName: string | undefined;
  hostName: string;
  workspaceAuthorities: string[];
}

export function resolveConnectionInfo(options: ConnectionInfoOptions): ConnectionInfoDto {
  const authority = options.workspaceAuthorities.find(Boolean) ?? null;

  if (!options.remoteName) {
    return {
      kind: 'local',
      label: `本机 · ${options.hostName}`,
      host: options.hostName,
      remoteName: null,
      authority: null
    };
  }

  return {
    kind: 'remote',
    label: `远程 · ${options.remoteName} · ${simplifyAuthority(authority) ?? options.hostName}`,
    host: options.hostName,
    remoteName: options.remoteName,
    authority
  };
}

function simplifyAuthority(authority: string | null): string | null {
  if (!authority) {
    return null;
  }

  const plusIndex = authority.indexOf('+');
  return plusIndex >= 0 ? authority.slice(plusIndex + 1) : authority;
}
