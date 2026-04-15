import os from 'node:os';
import * as vscode from 'vscode';
import type {
  GatewayCodeActionItem,
  GatewayDiagnosticItem,
  GatewayDocumentSymbolItem,
  GatewayHoverItem,
  GatewayLanguageLocation,
  GatewayRenameChange,
  GatewayRenamePreparation,
  GatewayWorkspaceSymbolItem
} from './executor/contracts';
import { createLocalGatewayExecutor } from './executor/localGatewayExecutor';
import { createAuthState } from './server/auth';
import { createNodeServerFactory } from './server/createServer';
import { createMcpRouter } from './server/mcpRouter';
import { createRouter } from './server/router';
import { createStaticAssets } from './server/staticAssets';
import { createDisguiseImageSettingsStore } from './state/disguiseImageSettings';
import { createExportJobsManager } from './state/exportJobs';
import { createServiceState } from './state/serviceState';
import { createCompatibilityTerminalBackend } from './terminal/compatibilityTerminalBackend';
import { createTerminalSessionManager } from './terminal/sessionManager';
import { createVsCodeTerminalBackend } from './terminal/vscodeTerminalBackend';
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
  const mcpConfig = getMcpServiceConfig();
  const mcpServiceState = createServiceState(createNodeServerFactory(), 'workspace-web-gateway-mcp', {
    host: mcpConfig.host,
    port: mcpConfig.port,
    preferExistingOnPortInUse: true,
    healthCheckPath: mcpConfig.path,
    includeTokenInHealthCheck: false,
    requireJsonOkField: false,
    includeTokenInLocalUrl: false
  });
  const disguiseImageSettingsStore = createDisguiseImageSettingsStore(context.globalState);
  const terminalManager = createTerminalSessionManager(
    createVsCodeTerminalBackend({
      createTerminal: (options) => vscode.window.createTerminal(options),
      compatibilityBackend: createCompatibilityTerminalBackend({
        shellPath: vscode.env.shell || (process.platform === 'win32' ? 'cmd.exe' : '/bin/sh')
      })
    })
  );
  const exportJobs = createExportJobsManager({
    fileService,
    getDisguiseImageSettings() {
      return disguiseImageSettingsStore.getSettings();
    },
    resolveWorkspacePath
  });
  const executor = createLocalGatewayExecutor({
    reads: {
      getWorkspaces() {
        return syncWorkspaceRegistry(workspaceRegistry);
      },
      getInitialLocation() {
        return getInitialLocation(workspaceRegistry);
      },
      getConnectionInfo() {
        return getConnectionInfo();
      },
      getActiveEditor() {
        return getActiveEditor(workspaceRegistry);
      },
      listOpenDocuments() {
        return listOpenDocuments(workspaceRegistry);
      },
      findFiles(input) {
        return findFiles(workspaceRegistry, input);
      },
      getWorkspaceById(id) {
        return syncWorkspaceRegistry(workspaceRegistry).find((item) => item.id === id);
      },
      resolveWorkspacePath
    },
    fileService,
    exportJobs,
    language: createVsCodeLanguageAdapter(workspaceRegistry),
    terminal: terminalManager
  });

  const router = createRouter({
    auth: authState,
    executor,
    terminalManager,
    getDisguiseImageSettings() {
      return disguiseImageSettingsStore.getSettings();
    },
    saveDisguiseImageSettings(settings) {
      return disguiseImageSettingsStore.saveSettings(settings);
    },
    getIndexHtml() {
      return staticAssets.getIndexHtml();
    },
    getStaticAsset(pathname) {
      return staticAssets.getStaticAsset(pathname);
    }
  });
  const mcpRouter = createMcpRouter({
    executor,
    path: mcpConfig.path
  });
  let mcpEndpoint: string | null = null;
  let mcpStatusDetail: string | null = null;

  const ensureServiceStarted = async () => {
    const snapshot = await serviceState.ensureStarted((request) => router.handle(request));
    updateStatusBar(snapshot.localUrl);
    return {
      ...snapshot,
      externalUri: await vscode.env.asExternalUri(vscode.Uri.parse(snapshot.localUrl))
    };
  };

  const ensureMcpServiceStarted = async () => {
    const snapshot = await mcpServiceState.ensureStarted((request) => mcpRouter.handle(request));
    const baseUrl = new URL(snapshot.localUrl);
    mcpEndpoint = `${baseUrl.origin}${mcpConfig.path}`;
    mcpStatusDetail = null;
    updateStatusBar(serviceState.getSnapshot().localUrl);
    return mcpEndpoint;
  };

  const ensureMcpServiceStartedInBackground = async () => {
    try {
      await ensureMcpServiceStarted();
    } catch (error) {
      mcpEndpoint = null;
      mcpStatusDetail = error instanceof Error ? error.message : 'unknown error';
      updateStatusBar(serviceState.getSnapshot().localUrl);
    }
  };

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  updateStatusBar(null);
  statusBarItem.show();
  void ensureMcpServiceStartedInBackground();
  const mcpKeepAliveTimer = setInterval(() => {
    void ensureMcpServiceStartedInBackground();
  }, 5000);
  mcpKeepAliveTimer.unref?.();

  function updateStatusBar(localUrl: string | null) {
    const mcpLine = mcpEndpoint
      ? `MCP：${mcpEndpoint}`
      : mcpStatusDetail
        ? `MCP：启动失败（${mcpStatusDetail}）`
        : `MCP：准备中（目标 ${mcpConfig.host}:${mcpConfig.port}${mcpConfig.path}）`;

    if (!localUrl) {
      statusBarItem.command = 'workspaceWebGateway.openWebUi';
      statusBarItem.text = '$(globe) 工作区网关：启动';
      statusBarItem.tooltip = `点击启动并打开工作区网页网关\n${getConnectionInfo().label}\n${mcpLine}`;
      return;
    }

    const url = new URL(localUrl);
    const connectionInfo = getConnectionInfo();
    statusBarItem.command = 'workspaceWebGateway.stopService';
    statusBarItem.text = `$(broadcast) 工作区网关：${url.port} 停止`;
    statusBarItem.tooltip = `${connectionInfo.label}\n服务运行中，端口 ${url.port}。点击停止服务。\n${mcpLine}`;
  }

  return [
    vscode.commands.registerCommand('workspaceWebGateway.startService', async () => {
      const { externalUri } = await ensureServiceStarted();
      updateStatusBar(serviceState.getSnapshot().localUrl);
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
      updateStatusBar(serviceState.getSnapshot().localUrl);
    }),
    vscode.commands.registerCommand('workspaceWebGateway.copyAccessUrl', async () => {
      const { externalUri } = await ensureServiceStarted();
      await vscode.env.clipboard.writeText(externalUri.toString());
      updateStatusBar(serviceState.getSnapshot().localUrl);
      vscode.window.showInformationMessage('访问地址已复制到剪贴板。');
    }),
    vscode.commands.registerCommand('workspaceWebGateway.startMcpServer', async () => {
      const endpoint = await ensureMcpServiceStarted();
      await vscode.env.clipboard.writeText(endpoint);
      vscode.window.showInformationMessage(`MCP HTTP 入口已就绪并复制：${endpoint}`);
    }),
    statusBarItem,
    {
      dispose() {
        clearInterval(mcpKeepAliveTimer);
        void serviceState.stop();
        void mcpServiceState.stop();
      }
    }
  ];
}

function getMcpServiceConfig() {
  const configuration = vscode.workspace.getConfiguration('workspaceWebGateway');
  const host = normalizeLoopbackHost(configuration.get<string>('mcp.host', '127.0.0.1'));
  const port = normalizePort(configuration.get<number>('mcp.port', 21080), 21080);
  const path = normalizeHttpPath(configuration.get<string>('mcp.path', '/mcp'));
  return {
    host,
    port,
    path
  };
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

function createVsCodeLanguageAdapter(workspaceRegistry: ReturnType<typeof createWorkspaceRegistry>) {
  return {
    async getDiagnostics(input: { uri?: string }) {
      if (input.uri) {
        const uri = vscode.Uri.parse(input.uri);
        await vscode.workspace.openTextDocument(uri, undefined);
        const diagnostics = vscode.languages.getDiagnostics(uri);
        return {
          items: diagnostics.map((item) => mapDiagnostic(workspaceRegistry, uri, item))
        };
      }

      const diagnostics = vscode.languages.getDiagnostics().flatMap(([uri, items]) => items.map((item) => ({ uri, item })));

      return {
        items: diagnostics.map(({ uri, item }) => mapDiagnostic(workspaceRegistry, uri, item))
      };
    },
    async getDefinition(input: { uri: string; line: number; character: number }) {
      const uri = vscode.Uri.parse(input.uri);
      await vscode.workspace.openTextDocument(uri, undefined);
      const locations = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
        'vscode.executeDefinitionProvider',
        uri,
        new vscode.Position(input.line - 1, input.character)
      ) ?? [];
      return {
        items: locations.map((item) => mapLocation(workspaceRegistry, isLocationLink(item) ? item.targetUri : item.uri, isLocationLink(item) ? item.targetRange : item.range))
      };
    },
    async findReferences(input: { uri: string; line: number; character: number }) {
      const uri = vscode.Uri.parse(input.uri);
      await vscode.workspace.openTextDocument(uri, undefined);
      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        uri,
        new vscode.Position(input.line - 1, input.character)
      ) ?? [];
      return {
        items: locations.map((item) => mapLocation(workspaceRegistry, item.uri, item.range))
      };
    },
    async getDocumentSymbols(input: { uri: string }) {
      const uri = vscode.Uri.parse(input.uri);
      await vscode.workspace.openTextDocument(uri, undefined);
      const symbols = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
        'vscode.executeDocumentSymbolProvider',
        uri
      ) ?? [];
      return {
        items: symbols.map((item) => mapDocumentSymbol(workspaceRegistry, uri, item))
      };
    },
    async getWorkspaceSymbols(input: { query: string }) {
      const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        'vscode.executeWorkspaceSymbolProvider',
        input.query
      ) ?? [];
      return {
        items: symbols.map((item) => mapWorkspaceSymbol(workspaceRegistry, item))
      };
    },
    async getHover(input: { uri: string; line: number; character: number }) {
      const uri = vscode.Uri.parse(input.uri);
      await vscode.workspace.openTextDocument(uri, undefined);
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        uri,
        new vscode.Position(input.line - 1, input.character)
      ) ?? [];
      return {
        items: hovers.map((item) => mapHover(workspaceRegistry, uri, item))
      };
    },
    async getCodeActions(input: { uri: string; line: number; character: number }) {
      const uri = vscode.Uri.parse(input.uri);
      const document = await vscode.workspace.openTextDocument(uri, undefined);
      const line = Math.max(0, input.line - 1);
      const position = new vscode.Position(line, input.character);
      const range = document.getWordRangeAtPosition(position) ?? new vscode.Range(position, position);
      const actions = await vscode.commands.executeCommand<(vscode.Command | vscode.CodeAction)[]>(
        'vscode.executeCodeActionProvider',
        uri,
        range
      ) ?? [];
      return {
        items: actions.map(mapCodeAction)
      };
    },
    async prepareRename(input: { uri: string; line: number; character: number }) {
      const uri = vscode.Uri.parse(input.uri);
      await vscode.workspace.openTextDocument(uri, undefined);
      const result = await vscode.commands.executeCommand<vscode.Range | { range: vscode.Range; placeholder: string }>(
        'vscode.prepareRename',
        uri,
        new vscode.Position(input.line - 1, input.character)
      );
      if (!result) {
        return null;
      }

      return mapRenamePreparation(result);
    },
    async getRenameEdits(input: { uri: string; line: number; character: number; newName: string }) {
      const uri = vscode.Uri.parse(input.uri);
      await vscode.workspace.openTextDocument(uri, undefined);
      const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
        'vscode.executeDocumentRenameProvider',
        uri,
        new vscode.Position(input.line - 1, input.character),
        input.newName
      );
      return {
        changes: edit ? mapWorkspaceEdit(workspaceRegistry, edit) : []
      };
    },
    async getFormatEdits(input: { uri: string }) {
      const uri = vscode.Uri.parse(input.uri);
      await vscode.workspace.openTextDocument(uri, undefined);
      const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
        'vscode.executeFormatDocumentProvider',
        uri,
        { insertSpaces: true, tabSize: 2 }
      ) ?? [];
      return {
        changes: edits.length === 0
          ? []
          : [{
              path: getWorkspaceRelativePath(workspaceRegistry, uri.toString()),
              edits: edits.map((item) => ({ range: mapRange(item.range), newText: item.newText }))
            }]
      };
    }
  };
}

function getActiveEditor(workspaceRegistry: ReturnType<typeof createWorkspaceRegistry>) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return null;
  }

  return {
    uri: editor.document.uri.toString(),
    path: getWorkspaceRelativePath(workspaceRegistry, editor.document.uri.toString()),
    languageId: editor.document.languageId,
    version: editor.document.version,
    isDirty: editor.document.isDirty,
    lineCount: editor.document.lineCount,
    selections: editor.selections.map((selection) => mapRange(new vscode.Range(selection.start, selection.end)))
  };
}

function listOpenDocuments(workspaceRegistry: ReturnType<typeof createWorkspaceRegistry>) {
  return {
    items: vscode.workspace.textDocuments.map((document) => ({
      uri: document.uri.toString(),
      path: getWorkspaceRelativePath(workspaceRegistry, document.uri.toString()),
      languageId: document.languageId,
      version: document.version,
      isDirty: document.isDirty,
      lineCount: document.lineCount
    }))
  };
}

async function findFiles(
  workspaceRegistry: ReturnType<typeof createWorkspaceRegistry>,
  input: { workspaceUri: string; includePattern: string; maxResults?: number }
) {
  const uris = await vscode.workspace.findFiles(input.includePattern, null, input.maxResults);
  return uris
    .filter((uri) => uri.toString().startsWith(ensureUriDirectoryPrefix(input.workspaceUri)))
    .map((uri) => ({
      uri: uri.toString(),
      path: getWorkspaceRelativePath(workspaceRegistry, uri.toString())
    }));
}

function ensureUriDirectoryPrefix(uri: string) {
  return uri.endsWith('/') ? uri : `${uri}/`;
}

function mapDiagnostic(
  workspaceRegistry: ReturnType<typeof createWorkspaceRegistry>,
  uri: vscode.Uri,
  diagnostic: vscode.Diagnostic
): GatewayDiagnosticItem {
  return {
    ...mapLocation(workspaceRegistry, uri, diagnostic.range),
    severity: mapDiagnosticSeverity(diagnostic.severity),
    message: diagnostic.message,
    source: diagnostic.source ?? null,
    code: diagnostic.code === undefined ? null : String(typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code)
  };
}

function mapLocation(
  workspaceRegistry: ReturnType<typeof createWorkspaceRegistry>,
  uri: vscode.Uri,
  range: vscode.Range
): GatewayLanguageLocation {
  return {
    uri: uri.toString(),
    path: getWorkspaceRelativePath(workspaceRegistry, uri.toString()),
    range: mapRange(range)
  };
}

function mapDocumentSymbol(
  workspaceRegistry: ReturnType<typeof createWorkspaceRegistry>,
  uri: vscode.Uri,
  symbol: vscode.DocumentSymbol | vscode.SymbolInformation
): GatewayDocumentSymbolItem {
  if (symbol instanceof vscode.DocumentSymbol) {
    return {
      name: symbol.name,
      kind: vscode.SymbolKind[symbol.kind].toLowerCase(),
      path: getWorkspaceRelativePath(workspaceRegistry, uri.toString()),
      range: mapRange(symbol.range),
      selectionRange: mapRange(symbol.selectionRange),
      children: symbol.children.map((child) => mapDocumentSymbol(workspaceRegistry, uri, child))
    };
  }

  return {
    name: symbol.name,
    kind: vscode.SymbolKind[symbol.kind].toLowerCase(),
    path: getWorkspaceRelativePath(workspaceRegistry, symbol.location.uri.toString()),
    range: mapRange(symbol.location.range),
    selectionRange: mapRange(symbol.location.range)
  };
}

function mapWorkspaceSymbol(
  workspaceRegistry: ReturnType<typeof createWorkspaceRegistry>,
  symbol: vscode.SymbolInformation
): GatewayWorkspaceSymbolItem {
  return {
    name: symbol.name,
    kind: vscode.SymbolKind[symbol.kind].toLowerCase(),
    path: getWorkspaceRelativePath(workspaceRegistry, symbol.location.uri.toString()),
    containerName: symbol.containerName ?? null,
    range: mapRange(symbol.location.range)
  };
}

function mapHover(
  workspaceRegistry: ReturnType<typeof createWorkspaceRegistry>,
  uri: vscode.Uri,
  hover: vscode.Hover
): GatewayHoverItem {
  return {
    path: getWorkspaceRelativePath(workspaceRegistry, uri.toString()),
    range: mapRange(hover.range ?? new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0))),
    contents: hover.contents.map(renderMarkdownLikeContent).join('\n\n')
  };
}

function mapCodeAction(action: vscode.Command | vscode.CodeAction): GatewayCodeActionItem {
  if ('title' in action && 'kind' in action) {
    return {
      title: action.title,
      kind: action.kind?.value ?? null,
      disabledReason: action.disabled?.reason ?? null
    };
  }

  return {
    title: action.title,
    kind: null,
    disabledReason: null
  };
}

function mapRenamePreparation(input: vscode.Range | { range: vscode.Range; placeholder: string }): GatewayRenamePreparation {
  if (input instanceof vscode.Range) {
    return {
      range: mapRange(input),
      placeholder: null
    };
  }

  return {
    range: mapRange(input.range),
    placeholder: input.placeholder ?? null
  };
}

function mapWorkspaceEdit(
  workspaceRegistry: ReturnType<typeof createWorkspaceRegistry>,
  edit: vscode.WorkspaceEdit
): GatewayRenameChange[] {
  const changes: GatewayRenameChange[] = [];
  for (const [uri, edits] of edit.entries()) {
    const textEdits = edits.filter((item): item is vscode.TextEdit => item instanceof vscode.TextEdit);
    if (textEdits.length === 0) {
      continue;
    }

    changes.push({
      path: getWorkspaceRelativePath(workspaceRegistry, uri.toString()),
      edits: textEdits.map((item) => ({
        range: mapRange(item.range),
        newText: item.newText
      }))
    });
  }

  return changes;
}

function renderMarkdownLikeContent(content: vscode.MarkdownString | vscode.MarkedString) {
  if (typeof content === 'string') {
    return content;
  }

  if (content instanceof vscode.MarkdownString) {
    return content.value;
  }

  return `\`\`\`${content.language}\n${content.value}\n\`\`\``;
}

function mapRange(range: vscode.Range) {
  return {
    start: { line: range.start.line + 1, character: range.start.character },
    end: { line: range.end.line + 1, character: range.end.character }
  };
}

function mapDiagnosticSeverity(severity: vscode.DiagnosticSeverity): GatewayDiagnosticItem['severity'] {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return 'error';
    case vscode.DiagnosticSeverity.Warning:
      return 'warning';
    case vscode.DiagnosticSeverity.Information:
      return 'information';
    default:
      return 'hint';
  }
}

function getWorkspaceRelativePath(workspaceRegistry: ReturnType<typeof createWorkspaceRegistry>, targetUri: string) {
  const workspaces = syncWorkspaceRegistry(workspaceRegistry);
  const matched = workspaces
    .map((workspace) => ({ workspace, relativePath: getRelativePath(workspace.uri, targetUri) }))
    .filter((entry): entry is { workspace: WorkspaceItemDto; relativePath: string } => entry.relativePath !== null)
    .sort((left, right) => right.workspace.uri.length - left.workspace.uri.length)[0];

  return matched ? normalizeRelativePath(matched.relativePath) : targetUri;
}

function isLocationLink(value: vscode.Location | vscode.LocationLink): value is vscode.LocationLink {
  return 'targetUri' in value;
}

function normalizeConfigString(value: string): string {
  return value.trim();
}

function normalizePort(value: number, fallback: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    return fallback;
  }

  return value;
}

function normalizeLoopbackHost(value: string): string {
  const normalized = normalizeConfigString(value).toLowerCase();
  if (normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1') {
    return normalized;
  }

  return '127.0.0.1';
}

function normalizeHttpPath(value: string): string {
  const normalized = normalizeConfigString(value);
  if (!normalized) {
    return '/mcp';
  }

  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}
