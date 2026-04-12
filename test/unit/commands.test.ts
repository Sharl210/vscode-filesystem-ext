import { beforeEach, describe, expect, it, vi } from 'vitest';

interface CapturedRouterDependencies {
  auth: unknown;
  executor: unknown;
  terminalManager?: unknown;
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
  const clipboardWriteText = vi.fn(async () => {});
  const showInformationMessage = vi.fn();
  const extensionConfigurationValues: Record<string, unknown> = {
    'mcp.host': '127.0.0.1',
    'mcp.port': 21080,
    'mcp.path': '/mcp'
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
  const mcpServiceState = {
    ensureStarted: vi.fn(async () => ({
      token: 'workspace-web-gateway-mcp',
      localUrl: 'http://127.0.0.1:21080/'
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
  const terminalManager = {
    listTabs: vi.fn(() => ({ tabs: [], defaultTabId: null })),
    getTabContent: vi.fn(),
    newTab: vi.fn(),
    closeTab: vi.fn(),
    execute: vi.fn(),
    startExecution: vi.fn(),
    getExecution: vi.fn(),
    getExecutionOutput: vi.fn(),
    cancelExecution: vi.fn()
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
    exports: { kind: 'executor-exports' },
    terminal: { kind: 'executor-terminal' }
  };
  const router = {
    handle: vi.fn(async () => ({
      status: 200,
      headers: {},
      body: new Uint8Array()
    }))
  };
  const mcpRouter = {
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
    createCompatibilityTerminalBackend: vi.fn(() => ({ kind: 'compatibility-backend' })),
    createTerminalSessionManager: vi.fn(() => terminalManager),
    createVsCodeTerminalBackend: vi.fn(() => ({ kind: 'vscode-terminal-backend' })),
    createNodeServerFactory: vi.fn(() => ({ start: vi.fn() })),
    createMcpRouter: vi.fn(() => mcpRouter),
    createRouter: vi.fn((dependencies: unknown) => {
      void dependencies;
      return router;
    }),
    createServiceState: vi.fn((_factory: unknown, authToken: string) =>
      authToken === 'workspace-web-gateway-mcp' ? mcpServiceState : serviceState
    ),
    createStaticAssets: vi.fn(() => staticAssets),
    createStatusBarItem: vi.fn(() => statusBarItem),
    createWorkspaceRegistry: vi.fn(() => ({
      sync: vi.fn(() => [localWorkspace])
    })),
    clipboardWriteText,
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
    mcpRouter,
    router,
    staticAsset,
    staticAssets,
    statusBarItem,
    terminalManager,
    mcpServiceState,
    serviceState,
    showInformationMessage,
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
    shell: '/bin/sh',
    clipboard: {
      writeText: mocked.clipboardWriteText
    }
  },
  window: {
    activeTextEditor: null,
    createTerminal: vi.fn(),
    createStatusBarItem: mocked.createStatusBarItem,
    showInformationMessage: mocked.showInformationMessage
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

vi.mock('../../src/server/mcpRouter', () => ({
  createMcpRouter: mocked.createMcpRouter
}));

vi.mock('../../src/server/router', () => ({
  createRouter: mocked.createRouter
}));

vi.mock('../../src/terminal/compatibilityTerminalBackend', () => ({
  createCompatibilityTerminalBackend: mocked.createCompatibilityTerminalBackend
}));

vi.mock('../../src/terminal/sessionManager', () => ({
  createTerminalSessionManager: mocked.createTerminalSessionManager
}));

vi.mock('../../src/terminal/vscodeTerminalBackend', () => ({
  createVsCodeTerminalBackend: mocked.createVsCodeTerminalBackend
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

    await Promise.resolve();

    expect(mocked.createServiceState).toHaveBeenCalledTimes(2);
    const mcpServiceStateCall = mocked.createServiceState.mock.calls[1];
    if (!mcpServiceStateCall) {
      throw new Error('mcp service state creation was not captured');
    }

    const mcpServiceStateOptions = mcpServiceStateCall.at(2);
    expect(mcpServiceStateOptions).toEqual(
      expect.objectContaining({
        host: '127.0.0.1',
        port: 21080,
        includeTokenInHealthCheck: false,
        includeTokenInLocalUrl: false
      })
    );

    expect(mocked.createLocalGatewayExecutor).toHaveBeenCalledTimes(1);
    expect(mocked.createLocalGatewayExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        fileService: mocked.fileService,
        exportJobs: mocked.exportJobs,
        terminal: mocked.terminalManager,
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
    expect(routerDependencies.terminalManager).toBe(mocked.terminalManager);
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
    expect(mocked.createTerminalSessionManager).toHaveBeenCalledTimes(1);
    expect(mocked.createMcpRouter).toHaveBeenCalledWith({
      executor: mocked.executor,
      path: '/mcp'
    });
    expect(mocked.mcpServiceState.ensureStarted).toHaveBeenCalledTimes(1);
    expect(mocked.statusBarItem.tooltip).toContain('MCP：http://127.0.0.1:21080/mcp');
  });

  it('starts singleton MCP HTTP service and copies endpoint to clipboard', async () => {
    const { registerGatewayCommands } = await import('../../src/commands.js');

    registerGatewayCommands({
      extensionPath: '/tmp/workspace-web-gateway',
      globalState: {}
    } as never);

    await Promise.resolve();

    const command = mocked.commandHandlers.get('workspaceWebGateway.startMcpServer');
    expect(command).toBeTypeOf('function');

    if (!command) {
      throw new Error('workspaceWebGateway.startMcpServer command was not captured');
    }

    await command();

    expect(mocked.clipboardWriteText).toHaveBeenCalledTimes(1);
    expect(mocked.clipboardWriteText).toHaveBeenCalledWith('http://127.0.0.1:21080/mcp');
    expect(mocked.showInformationMessage).toHaveBeenCalledWith('MCP HTTP 入口已就绪并复制：http://127.0.0.1:21080/mcp');
  });
});
