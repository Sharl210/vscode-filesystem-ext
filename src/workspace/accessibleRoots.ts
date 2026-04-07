import { existsSync } from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import type { WorkspaceInput } from './workspaceRegistry';

interface AccessibleRootsOptions {
  platform?: NodeJS.Platform;
  homeDir?: string;
  windowsDriveRoots?: string[];
  remoteAuthority?: string | null;
}

export function collectAccessibleRoots(
  workspaceFolders: WorkspaceInput[],
  options: AccessibleRootsOptions = {}
): WorkspaceInput[] {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const remoteAuthority = options.remoteAuthority ?? detectRemoteAuthority(workspaceFolders);
  const roots: WorkspaceInput[] = [];

  if (platform === 'win32') {
    const driveRoots = options.windowsDriveRoots ?? discoverWindowsDriveRoots();

    for (const driveRoot of driveRoots) {
      roots.push({
        name: `本机根目录 (${driveRoot.replace(/\\$/, '')})`,
        uri: pathToFileURL(driveRoot).toString(),
        source: 'local'
      });
    }
  } else {
    roots.push({
      name: '本机根目录',
      uri: pathToFileURL('/').toString(),
      source: 'local'
    });
  }

  if (homeDir) {
    roots.push({
      name: '本机主目录',
      uri: pathToFileURL(homeDir).toString(),
      source: 'local'
    });
  }

  roots.push(
    ...workspaceFolders.map((workspace) => ({
      name: `工作区 · ${workspace.name}`,
      uri: workspace.uri,
      source: 'workspace' as const
    }))
  );

  if (remoteAuthority) {
    roots.push({
      name: `远程主机根目录 (${describeRemoteAuthority(remoteAuthority)})`,
      uri: `vscode-remote://${remoteAuthority}/`,
      source: 'remote'
    });
  }

  return deduplicateByUri(roots);
}

function detectRemoteAuthority(workspaces: WorkspaceInput[]): string | null {
  for (const workspace of workspaces) {
    if (!workspace.uri.startsWith('vscode-remote://')) {
      continue;
    }

    const parsed = new URL(workspace.uri);
    return parsed.host || null;
  }

  return null;
}

function describeRemoteAuthority(authority: string): string {
  const plusIndex = authority.indexOf('+');
  return plusIndex >= 0 ? authority.slice(plusIndex + 1) : authority;
}

function deduplicateByUri(entries: WorkspaceInput[]): WorkspaceInput[] {
  const seen = new Set<string>();

  return entries.filter((entry) => {
    if (seen.has(entry.uri)) {
      return false;
    }

    seen.add(entry.uri);
    return true;
  });
}

function discoverWindowsDriveRoots(): string[] {
  const roots: string[] = [];

  for (let code = 67; code <= 90; code += 1) {
    const driveRoot = `${String.fromCharCode(code)}:\\`;

    if (existsSync(driveRoot)) {
      roots.push(driveRoot);
    }
  }

  return roots;
}
