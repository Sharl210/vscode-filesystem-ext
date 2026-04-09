import { beforeEach, describe, expect, it, vi } from 'vitest';

interface CapturedRouterDependencies {
  auth: unknown;
  executor: unknown;
  getDisguiseImageSettings(): Promise<unknown>;
  saveDisguiseImageSettings(settings: {
    selectedSource: 'template' | 'custom';
    selectedTemplateId: string;
    customImageDataUrl: string | null;
  }): Promise<void>;
  getIndexHtml(): string;
  getStaticAsset(pathname: string): unknown;
}

const mocked = vi.hoisted(() => {
  const executorWorkspace = {
    id: 'ws_executor',
    name: 'executor-workspace',
    uri: 'file:///workspace/executor',
    source: 'workspace'
  };
  const localWorkspace = {
    id: 'ws_local',
    name: 'local-workspace',
    uri: 'file:///workspace/local',
    source: 'workspace'
  };
  const executorInitialLocation = {
    rootId: 'ws_executor',
    path: 'src',
    activeFilePath: 'src/index.ts',
    expandedPaths: ['', 'src']
  };
  const executorConnectionInfo = {
    kind: 'remote',
    label: 'Executor connection',
    host: 'executor-host',
    remoteName: 'ssh-remote',
    authority: 'ssh-remote+executor'
  };
  const localConnectionInfo = {
    kind: 'local',
    label: 'Local connection',
    host: 'local-host',
    remoteName: null,
    authority: null
  };
  const disguiseImageSettings = {
    selectedSource: 'template' as const,
    selectedTemplateId: 'template-1',
    customImageDataUrl: null,
    templates: [
      {
        id: 'template-1',
        label: 'Template 1',
        dataUrl: 'data:image/png;base64,AAAA'
      }
    ]
  };
  const staticAsset = {
    body: Uint8Array.from([1, 2, 3]),
    contentType: 'application/javascript'
  };
  const fileService = { kind: 'local-file-service' };
  const exportJobs = { kind: 'local-export-jobs' };
  const authState = {
    token: 'shared-token',
    validateUiToken: vi.fn(),
    validateRequest: vi.fn()
  };
  const statusBarItem = {
    text: '',
    tooltip: '',
    command: '',
    show: vi.fn(),
    dispose: vi.fn()
  };
  const terminal = {
    show: vi.fn(),
    dispose: vi.fn()
  };
  const extensionConfigurationValues: Record<string, unknown> = {
    'mcpServer.command': 'node',
    'mcpServer.args': ['./dist/mcp-server.js'],
    'mcpServer.cwd': '/tmp/mcp',
    'mcpServer.env': {
      MCP_TRANSPORT: 'stdio'
    },
    'mcpServer.terminalName': 'Workspace Web Gateway MCP'
  };
  const commandHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const serviceState = {
    ensureStarted: vi.fn(async () => ({
      token: 'shared-token',
      localUrl: 'http://127.0.0.1:3344/?token=shared-token'
    })),
    stop: vi.fn(),
    getSnapshot: vi.fn(() => ({ token: null, localUrl: null }))
  };
  const disguiseImageSettingsStore = {
    getSettings: vi.fn(async () => disguiseImageSettings),
    saveSettings: vi.fn(async () => {})
  };
  const staticAssets = {
    getIndexHtml: vi.fn(() => '<html />'),
    getStaticAsset: vi.fn(() => staticAsset)
  };
  const executor = {
    reads: {
      getWorkspaces: vi.fn(() => [executorWorkspace]),
      getInitialLocation: vi.fn(() => executorInitialLocation),
      getConnectionInfo: vi.fn(() => executorConnectionInfo),
      getWorkspaceById: vi.fn((id: string) => (id === executorWorkspace.id ? executorWorkspace : undefined)),
      resolveWorkspacePath: vi.fn((_workspaceUri: string, relativePath: string) => `executor://resolved/${relativePath}`)
    },
    files: { kind: 'executor-files' },
    exports: { kind: 'executor-exports' }
  };
  const router = {
    handle: vi.fn(async () => ({
      status: 200,
      headers: {},
      body: new Uint8Array()
    }))
  };

  return {
    authState,
    createAuthState: vi.fn(() => authState),
    createDisguiseImageSettingsStore: vi.fn(() => disguiseImageSettingsStore),
    createExportJobsManager: vi.fn(() => exportJobs),
    createFileService: vi.fn(() => fileService),
    createLocalGatewayExecutor: vi.fn(() => executor),
    createNodeServerFactory: vi.fn(() => ({ start: vi.fn() })),
    createRouter: vi.fn((dependencies: unknown) => {
      void dependencies;
      return router;
    }),
    createServiceState: vi.fn(() => serviceState),
    createStaticAssets: vi.fn(() => staticAssets),
    createStatusBarItem: vi.fn(() => statusBarItem),
    createTerminal: vi.fn(() => terminal),
    createWorkspaceRegistry: vi.fn(() => ({
      sync: vi.fn(() => [localWorkspace])
    })),
    commandHandlers,
    disguiseImageSettings,
    disguiseImageSettingsStore,
    extensionConfigurationValues,
    executor,
    executorConnectionInfo,
    executorInitialLocation,
    executorWorkspace,
    exportJobs,
    fileService,
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, fallbackValue?: unknown) =>
        key in extensionConfigurationValues ? extensionConfigurationValues[key] : fallbackValue
      )
    })),
    localConnectionInfo,
    registerCommand: vi.fn((command: string, handler: (...args: unknown[]) => unknown) => {
      commandHandlers.set(command, handler);
      return {
        dispose: vi.fn()
      };
    }),
    resolveConnectionInfo: vi.fn(() => localConnectionInfo),
    resolveWorkspacePath: vi.fn(() => 'resolved-directly'),
    router,
    staticAsset,
    staticAssets,
    statusBarItem,
    terminal,
    serviceState,
    syncAccessibleRoots: vi.fn(() => [localWorkspace])
  };
});

vi.mock('vscode', () => ({
  commands: {
    registerCommand: mocked.registerCommand
  },
  env: {
    asExternalUri: vi.fn(async (uri: { toString(): string }) => uri),
    openExternal: vi.fn(),
    clipboard: {
      writeText: vi.fn()
    }
  },
  window: {
    activeTextEditor: null,
    createTerminal: mocked.createTerminal,
    createStatusBarItem: mocked.createStatusBarItem,
    showInformationMessage: vi.fn()
  },
  workspace: {
    workspaceFolders: [],
    getConfiguration: mocked.getConfiguration,
    fs: {
      readDirectory: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      stat: vi.fn(),
      delete: vi.fn(),
      createDirectory: vi.fn(),
      rename: vi.fn(),
      copy: vi.fn()
    }
  },
  StatusBarAlignment: {
    Right: 2
  },
  Uri: {
    parse(value: string) {
      return {
        toString() {
          return value;
        }
      };
    }
  }
}));

vi.mock('../../src/executor/localGatewayExecutor', () => ({
  createLocalGatewayExecutor: mocked.createLocalGatewayExecutor
}));

vi.mock('../../src/server/auth', () => ({
  createAuthState: mocked.createAuthState
}));

vi.mock('../../src/server/createServer', () => ({
  createNodeServerFactory: mocked.createNodeServerFactory
}));

vi.mock('../../src/server/router', () => ({
  createRouter: mocked.createRouter
}));

vi.mock('../../src/server/staticAssets', () => ({
  createStaticAssets: mocked.createStaticAssets
}));

vi.mock('../../src/state/disguiseImageSettings', () => ({
  createDisguiseImageSettingsStore: mocked.createDisguiseImageSettingsStore
}));

vi.mock('../../src/state/exportJobs', () => ({
  createExportJobsManager: mocked.createExportJobsManager
}));

vi.mock('../../src/state/serviceState', () => ({
  createServiceState: mocked.createServiceState
}));

vi.mock('../../src/workspace/accessibleRoots', () => ({
  collectAccessibleRoots: mocked.syncAccessibleRoots
}));

vi.mock('../../src/workspace/connectionInfo', () => ({
  resolveConnectionInfo: mocked.resolveConnectionInfo
}));

vi.mock('../../src/workspace/fileService', () => ({
  createFileService: mocked.createFileService
}));

vi.mock('../../src/workspace/pathResolver', () => ({
  resolveWorkspacePath: mocked.resolveWorkspacePath
}));

vi.mock('../../src/workspace/workspaceRegistry', () => ({
  createWorkspaceRegistry: mocked.createWorkspaceRegistry
}));

describe('gateway command composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.commandHandlers.clear();
    mocked.statusBarItem.text = '';
    mocked.statusBarItem.tooltip = '';
    mocked.statusBarItem.command = '';
  });

  it('builds router dependencies from executor ports while keeping host-only concerns local', async () => {
    const { registerGatewayCommands } = await import('../../src/commands.js');

    registerGatewayCommands({
      extensionPath: '/tmp/workspace-web-gateway',
      globalState: {}
    } as never);

    expect(mocked.createLocalGatewayExecutor).toHaveBeenCalledTimes(1);
    expect(mocked.createLocalGatewayExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        fileService: mocked.fileService,
        exportJobs: mocked.exportJobs,
        reads: expect.objectContaining({
          getWorkspaces: expect.any(Function),
          getInitialLocation: expect.any(Function),
          getConnectionInfo: expect.any(Function),
          getWorkspaceById: expect.any(Function),
          resolveWorkspacePath: expect.any(Function)
        })
      })
    );

    expect(mocked.createRouter).toHaveBeenCalledTimes(1);

    const routerDependencies = mocked.createRouter.mock.calls.at(0)?.[0] as CapturedRouterDependencies | undefined;
    expect(routerDependencies).toBeDefined();

    if (!routerDependencies) {
      throw new Error('router dependencies were not captured');
    }

    expect(routerDependencies.auth).toBe(mocked.authState);
    expect(routerDependencies.executor).toBe(mocked.executor);
    expect(routerDependencies).not.toHaveProperty('exportJobs');
    expect(routerDependencies).not.toHaveProperty('exportFiles');
    await expect(routerDependencies.getDisguiseImageSettings()).resolves.toBe(mocked.disguiseImageSettings);
    await expect(
      routerDependencies.saveDisguiseImageSettings({
        selectedSource: 'template',
        selectedTemplateId: 'template-1',
        customImageDataUrl: null
      })
    ).resolves.toBeUndefined();
    expect(routerDependencies.getIndexHtml()).toBe('<html />');
    expect(routerDependencies.getStaticAsset('/app.js')).toBe(mocked.staticAsset);
    expect(mocked.disguiseImageSettingsStore.getSettings).toHaveBeenCalledTimes(1);
    expect(mocked.disguiseImageSettingsStore.saveSettings).toHaveBeenCalledWith({
      selectedSource: 'template',
      selectedTemplateId: 'template-1',
      customImageDataUrl: null
    });
    expect(mocked.staticAssets.getIndexHtml).toHaveBeenCalledTimes(1);
    expect(mocked.staticAssets.getStaticAsset).toHaveBeenCalledWith('/app.js');
  });

  it('starts MCP server via VS Code terminal and injects gateway env variables', async () => {
    const { registerGatewayCommands } = await import('../../src/commands.js');

    registerGatewayCommands({
      extensionPath: '/tmp/workspace-web-gateway',
      globalState: {}
    } as never);

    const command = mocked.commandHandlers.get('workspaceWebGateway.startMcpServer');
    expect(command).toBeTypeOf('function');

    if (!command) {
      throw new Error('workspaceWebGateway.startMcpServer command was not captured');
    }

    await command();

    expect(mocked.createTerminal).toHaveBeenCalledTimes(1);
    expect(mocked.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Workspace Web Gateway MCP',
        shellPath: 'node',
        shellArgs: ['./dist/mcp-server.js'],
        cwd: '/tmp/mcp',
        env: expect.objectContaining({
          MCP_TRANSPORT: 'stdio',
          WORKSPACE_WEB_GATEWAY_TOKEN: 'shared-token',
          WORKSPACE_WEB_GATEWAY_LOCAL_URL: 'http://127.0.0.1:3344/?token=shared-token',
          WORKSPACE_WEB_GATEWAY_URL: 'http://127.0.0.1:3344/?token=shared-token',
          WORKSPACE_WEB_GATEWAY_PORT: '3344'
        })
      })
    );
    expect(mocked.terminal.show).toHaveBeenCalledTimes(1);
  });
});
