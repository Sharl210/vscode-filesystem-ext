import * as vscode from 'vscode';
import os from 'node:os';
import { createAuthState } from './server/auth';
import { createNodeServerFactory } from './server/createServer';
import { createRouter } from './server/router';
import { createStaticAssets } from './server/staticAssets';
import { createDisguiseImageSettingsStore } from './state/disguiseImageSettings';
import { createExportJobsManager } from './state/exportJobs';
import { createServiceState } from './state/serviceState';
import type { InitialLocationDto, WorkspaceItemDto } from './types/api';
import { collectAccessibleRoots } from './workspace/accessibleRoots';
import { resolveConnectionInfo } from './workspace/connectionInfo';
import { createFileService } from './workspace/fileService';
import { resolveWorkspacePath } from './workspace/pathResolver';
import { createWorkspaceRegistry } from './workspace/workspaceRegistry';

export function registerGatewayCommands(context: vscode.ExtensionContext): Array<vscode.Disposable> {
  const workspaceRegistry = createWorkspaceRegistry();
  const fileService = createFileService(createVsCodeFileSystemAdapter());
  const staticAssets = createStaticAssets(context.extensionPath);
  const authState = createAuthState();
  const serviceState = createServiceState(createNodeServerFactory(), authState.token);
  const disguiseImageSettingsStore = createDisguiseImageSettingsStore(context.globalState);
  const exportJobs = createExportJobsManager({
    fileService,
    getDisguiseImageSettings() {
      return disguiseImageSettingsStore.getSettings();
    },
    resolveWorkspacePath
  });

  const router = createRouter({
    auth: authState,
    getWorkspaces() {
      return syncWorkspaceRegistry(workspaceRegistry);
    },
    getInitialLocation() {
      return getInitialLocation(workspaceRegistry);
    },
    getConnectionInfo() {
      return getConnectionInfo();
    },
    getWorkspaceById(id) {
      return syncWorkspaceRegistry(workspaceRegistry).find((item) => item.id === id);
    },
    getDisguiseImageSettings() {
      return disguiseImageSettingsStore.getSettings();
    },
    saveDisguiseImageSettings(settings) {
      return disguiseImageSettingsStore.saveSettings(settings);
    },
    exportJobs,
    resolveWorkspacePath,
    fileService,
    getIndexHtml() {
      return staticAssets.getIndexHtml();
    },
    getStaticAsset(pathname) {
      return staticAssets.getStaticAsset(pathname);
    }
  });

  const ensureServiceStarted = async () => {
    const snapshot = await serviceState.ensureStarted((request) => router.handle(request));
    updateStatusBar(snapshot.localUrl);
    return {
      ...snapshot,
      externalUri: await vscode.env.asExternalUri(vscode.Uri.parse(snapshot.localUrl))
    };
  };

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  updateStatusBar(null);
  statusBarItem.show();

  function updateStatusBar(localUrl: string | null) {
    if (!localUrl) {
      statusBarItem.command = 'workspaceWebGateway.openWebUi';
      statusBarItem.text = '$(globe) 工作区网关：启动';
      statusBarItem.tooltip = `点击启动并打开工作区网页网关\n${getConnectionInfo().label}`;
      return;
    }

    const url = new URL(localUrl);
    const connectionInfo = getConnectionInfo();
    statusBarItem.command = 'workspaceWebGateway.stopService';
    statusBarItem.text = `$(broadcast) 工作区网关：${url.port} 停止`;
    statusBarItem.tooltip = `${connectionInfo.label}\n服务运行中，端口 ${url.port}。点击停止服务。`;
  }

  return [
    vscode.commands.registerCommand('workspaceWebGateway.startService', async () => {
      const { externalUri } = await ensureServiceStarted();
      vscode.window.showInformationMessage(`Workspace Web Gateway 已启动：${externalUri.toString()}`);
    }),
    vscode.commands.registerCommand('workspaceWebGateway.stopService', async () => {
      await serviceState.stop();
      updateStatusBar(null);
      vscode.window.showInformationMessage('Workspace Web Gateway 已停止。');
    }),
    vscode.commands.registerCommand('workspaceWebGateway.openWebUi', async () => {
      const { externalUri } = await ensureServiceStarted();
      await vscode.env.openExternal(externalUri);
    }),
    vscode.commands.registerCommand('workspaceWebGateway.copyAccessUrl', async () => {
      const { externalUri } = await ensureServiceStarted();
      await vscode.env.clipboard.writeText(externalUri.toString());
      vscode.window.showInformationMessage('访问地址已复制到剪贴板。');
    }),
    statusBarItem,
    {
      dispose() {
        void serviceState.stop();
      }
    }
  ];
}

function syncWorkspaceRegistry(workspaceRegistry: ReturnType<typeof createWorkspaceRegistry>) {
  return workspaceRegistry.sync(
    collectAccessibleRoots(
      (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
        name: folder.name,
        uri: folder.uri.toString(),
        source: 'workspace'
      })),
      {
        remoteAuthority: (vscode.workspace.workspaceFolders ?? []).find((folder) => folder.uri.scheme === 'vscode-remote')
          ?.uri.authority ?? null
      }
    )
  );
}

function getConnectionInfo() {
  return resolveConnectionInfo({
    remoteName: vscode.env.remoteName,
    hostName: os.hostname(),
    workspaceAuthorities: (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.authority)
  });
}

function getInitialLocation(workspaceRegistry: ReturnType<typeof createWorkspaceRegistry>): InitialLocationDto | null {
  const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
  if (!activeUri) {
    return null;
  }

  const workspaces = syncWorkspaceRegistry(workspaceRegistry);
  const matchedWorkspace = workspaces
    .map((workspace) => ({
      workspace,
      relativePath: getRelativePath(workspace.uri, activeUri)
    }))
    .filter((entry): entry is { workspace: WorkspaceItemDto; relativePath: string } => entry.relativePath !== null)
    .sort((left, right) => right.workspace.uri.length - left.workspace.uri.length)[0];

  if (!matchedWorkspace) {
    return null;
  }

  const activeFilePath = normalizeRelativePath(matchedWorkspace.relativePath);
  const path = getParentPath(activeFilePath);

  return {
    rootId: matchedWorkspace.workspace.id,
    path,
    activeFilePath: activeFilePath || null,
    expandedPaths: collectExpandedPaths(path)
  };
}

function getRelativePath(rootUri: string, targetUri: string): string | null {
  const rootUrl = new URL(rootUri);
  const targetUrl = new URL(targetUri);
  if (rootUrl.protocol !== targetUrl.protocol || rootUrl.host !== targetUrl.host) {
    return null;
  }

  const normalizedRootPath = rootUrl.pathname.replace(/\/$/, '');
  if (targetUrl.pathname === normalizedRootPath) {
    return '';
  }

  const prefix = `${normalizedRootPath}/`;
  if (!targetUrl.pathname.startsWith(prefix)) {
    return null;
  }

  return decodeURIComponent(targetUrl.pathname.slice(prefix.length));
}

function normalizeRelativePath(value: string): string {
  return value.replace(/^\/+/, '').replace(/\/+/g, '/');
}

function getParentPath(path: string): string {
  const segments = normalizeRelativePath(path).split('/').filter(Boolean);
  segments.pop();
  return segments.join('/');
}

function collectExpandedPaths(path: string): string[] {
  const segments = normalizeRelativePath(path).split('/').filter(Boolean);
  const expandedPaths = [''];
  let currentPath = '';

  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    expandedPaths.push(currentPath);
  }

  return expandedPaths;
}

function createVsCodeFileSystemAdapter() {
  return {
    async readDirectory(uri: string) {
      return vscode.workspace.fs.readDirectory(vscode.Uri.parse(uri));
    },
    async readFile(uri: string) {
      return vscode.workspace.fs.readFile(vscode.Uri.parse(uri));
    },
    async writeFile(uri: string, content: Uint8Array) {
      await vscode.workspace.fs.writeFile(vscode.Uri.parse(uri), content);
    },
    async stat(uri: string) {
      return vscode.workspace.fs.stat(vscode.Uri.parse(uri));
    },
    async delete(uri: string) {
      await vscode.workspace.fs.delete(vscode.Uri.parse(uri), { recursive: true, useTrash: false });
    },
    async createDirectory(uri: string) {
      await vscode.workspace.fs.createDirectory(vscode.Uri.parse(uri));
    },
    async rename(fromUri: string, toUri: string) {
      await vscode.workspace.fs.rename(vscode.Uri.parse(fromUri), vscode.Uri.parse(toUri), { overwrite: false });
    },
    async copy(fromUri: string, toUri: string) {
      await vscode.workspace.fs.copy(vscode.Uri.parse(fromUri), vscode.Uri.parse(toUri), { overwrite: false });
    }
  };
}
