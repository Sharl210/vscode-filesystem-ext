import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeMock = vi.hoisted(() => ({
  statusBarItem: {
    text: '',
    tooltip: '',
    command: '',
    show: vi.fn(),
    dispose: vi.fn()
  },
  registerCommand: vi.fn((_command: string, handler: (...args: unknown[]) => unknown) => ({
    dispose: vi.fn(),
    handler
  })),
  createStatusBarItem: vi.fn(() => vscodeMock.statusBarItem),
  openExternal: vi.fn(),
  copyText: vi.fn(),
  showInformationMessage: vi.fn(),
  asExternalUri: vi.fn(async (uri: { toString(): string }) => uri),
  workspaceFolders: [] as Array<{ name: string; uri: { scheme: string; authority: string; toString(): string } }>,
  activeTextEditor: null as { document: { uri: { toString(): string } } } | null,
  remoteName: undefined as string | undefined
}));

vi.mock('vscode', () => ({
  commands: {
    registerCommand: vscodeMock.registerCommand
  },
  env: {
    openExternal: vscodeMock.openExternal,
    asExternalUri: vscodeMock.asExternalUri,
    clipboard: {
      writeText: vscodeMock.copyText
    },
    get remoteName() {
      return vscodeMock.remoteName;
    }
  },
  window: {
    showInformationMessage: vscodeMock.showInformationMessage,
    createStatusBarItem: vscodeMock.createStatusBarItem,
    get activeTextEditor() {
      return vscodeMock.activeTextEditor;
    }
  },
  workspace: {
    workspaceFolders: vscodeMock.workspaceFolders
  },
  StatusBarAlignment: {
    Left: 1,
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

import * as extension from '../../src/extension';

function createExtensionContext() {
  const state = new Map<string, unknown>();

  return {
    subscriptions: [] as Array<{ dispose(): void }>,
    extensionPath: '/tmp/workspace-web-gateway',
    globalState: {
      async get<T>(key: string) {
        return state.get(key) as T | undefined;
      },
      async update(key: string, value: unknown) {
        state.set(key, value);
      }
    }
  };
}

function createMockUri(value: string) {
  const parsed = new URL(value);
  return {
    scheme: parsed.protocol.replace(':', ''),
    authority: parsed.host,
    toString() {
      return value;
    }
  };
}

describe('extension entry', () => {
  beforeEach(() => {
    vscodeMock.statusBarItem.text = '';
    vscodeMock.statusBarItem.tooltip = '';
    vscodeMock.statusBarItem.command = '';
    vscodeMock.statusBarItem.show.mockClear();
    vscodeMock.statusBarItem.dispose.mockClear();
    vscodeMock.registerCommand.mockClear();
    vscodeMock.createStatusBarItem.mockClear();
    vscodeMock.openExternal.mockClear();
    vscodeMock.copyText.mockClear();
    vscodeMock.showInformationMessage.mockClear();
    vscodeMock.asExternalUri.mockClear();
    vscodeMock.asExternalUri.mockImplementation(async (uri: { toString(): string }) => uri);
    vscodeMock.workspaceFolders.length = 0;
    vscodeMock.activeTextEditor = null;
    vscodeMock.remoteName = undefined;
  });

  afterEach(async () => {
    await extension.deactivate();
  });

  it('exports activate and deactivate', () => {
    expect(typeof extension.activate).toBe('function');
    expect(typeof extension.deactivate).toBe('function');
  });

  it('registers commands and creates a Chinese status bar launch button on activation', async () => {
    const context = createExtensionContext();

    await extension.activate(context as never);

    expect(vscodeMock.registerCommand).toHaveBeenCalledTimes(4);
    expect(vscodeMock.createStatusBarItem).toHaveBeenCalledTimes(1);
    expect(vscodeMock.statusBarItem.text).toBe('$(globe) 工作区网关：启动');
    expect(vscodeMock.statusBarItem.command).toBe('workspaceWebGateway.openWebUi');
    expect(context.subscriptions).toHaveLength(6);
  });

  it('updates the status bar button to stop mode after opening the web ui', async () => {
    const context = createExtensionContext();

    await extension.activate(context as never);

    const openCommandCall = vscodeMock.registerCommand.mock.calls.find(
      ([command]) => command === 'workspaceWebGateway.openWebUi'
    );

    expect(openCommandCall).toBeDefined();

    const openCommand = openCommandCall?.[1] as () => Promise<void>;
    await openCommand();

    expect(vscodeMock.openExternal).toHaveBeenCalledTimes(1);
    expect(vscodeMock.statusBarItem.command).toBe('workspaceWebGateway.stopService');
    expect(vscodeMock.statusBarItem.text).toContain('工作区网关：');
    expect(vscodeMock.statusBarItem.text).toContain('停止');
  });

  it('opens the forwarded external uri instead of exposing the internal localhost url', async () => {
    const context = createExtensionContext();
    const forwardedUri = {
      toString() {
        return 'https://vscode-remote.test/tunnel/52526/?token=shared-token';
      }
    };
    vscodeMock.asExternalUri.mockResolvedValue(forwardedUri);

    await extension.activate(context as never);

    const openCommandCall = vscodeMock.registerCommand.mock.calls.find(
      ([command]) => command === 'workspaceWebGateway.openWebUi'
    );
    expect(openCommandCall).toBeDefined();

    const openCommand = openCommandCall?.[1] as () => Promise<void>;
    await openCommand();

    expect(vscodeMock.asExternalUri).toHaveBeenCalledTimes(1);
    const internalUri = vscodeMock.asExternalUri.mock.calls[0]?.[0] as { toString(): string };
    const openedUri = vscodeMock.openExternal.mock.calls[0]?.[0] as { toString(): string };

    expect(internalUri.toString()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=.+$/);
    expect(openedUri.toString()).toBe(forwardedUri.toString());
    expect(openedUri.toString()).not.toBe(internalUri.toString());
  });

  it('copies the forwarded external uri instead of exposing the internal localhost url', async () => {
    const context = createExtensionContext();
    const forwardedUri = {
      toString() {
        return 'https://vscode-remote.test/tunnel/52526/?token=shared-token';
      }
    };
    vscodeMock.asExternalUri.mockResolvedValue(forwardedUri);

    await extension.activate(context as never);

    const copyCommandCall = vscodeMock.registerCommand.mock.calls.find(
      ([command]) => command === 'workspaceWebGateway.copyAccessUrl'
    );
    expect(copyCommandCall).toBeDefined();

    const copyCommand = copyCommandCall?.[1] as () => Promise<void>;
    await copyCommand();

    expect(vscodeMock.asExternalUri).toHaveBeenCalledTimes(1);
    const internalUri = vscodeMock.asExternalUri.mock.calls[0]?.[0] as { toString(): string };

    expect(internalUri.toString()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=.+$/);
    expect(vscodeMock.copyText).toHaveBeenCalledWith('https://vscode-remote.test/tunnel/52526/?token=shared-token');
    expect(vscodeMock.copyText).not.toHaveBeenCalledWith(internalUri.toString());
  });

  it('shows the forwarded external uri in the start service message', async () => {
    const context = createExtensionContext();
    const forwardedUri = {
      toString() {
        return 'https://browser.test/gateway/?token=shared-token';
      }
    };
    vscodeMock.asExternalUri.mockResolvedValue(forwardedUri);

    await extension.activate(context as never);

    const startCommandCall = vscodeMock.registerCommand.mock.calls.find(
      ([command]) => command === 'workspaceWebGateway.startService'
    );
    expect(startCommandCall).toBeDefined();

    const startCommand = startCommandCall?.[1] as () => Promise<void>;
    await startCommand();

    expect(vscodeMock.asExternalUri).toHaveBeenCalledTimes(1);
    const internalUri = vscodeMock.asExternalUri.mock.calls[0]?.[0] as { toString(): string };

    expect(internalUri.toString()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=.+$/);
    expect(vscodeMock.showInformationMessage).toHaveBeenCalledWith(
      'Workspace Web Gateway 已启动：https://browser.test/gateway/?token=shared-token'
    );
    expect(vscodeMock.showInformationMessage).not.toHaveBeenCalledWith(
      expect.stringContaining(internalUri.toString())
    );
  });

  it('returns the active file bootstrap from the longest matching workspace prefix', async () => {
    const context = createExtensionContext();
    vscodeMock.workspaceFolders.push(
      { name: 'demo', uri: createMockUri('file:///demo') },
      { name: 'demo/src', uri: createMockUri('file:///demo/src') }
    );
    vscodeMock.activeTextEditor = {
      document: {
        uri: createMockUri('file:///demo/src/components/App.tsx')
      }
    };

    await extension.activate(context as never);

    const startCommandCall = vscodeMock.registerCommand.mock.calls.find(
      ([command]) => command === 'workspaceWebGateway.startService'
    );
    expect(startCommandCall).toBeDefined();

    const startCommand = startCommandCall?.[1] as () => Promise<void>;
    await startCommand();

    const internalUri = vscodeMock.asExternalUri.mock.calls[0]?.[0] as { toString(): string };
    const baseUrl = new URL(internalUri.toString());
    const token = baseUrl.searchParams.get('token');
    const response = await fetch(`${baseUrl.origin}/api/workspaces?token=${token}`);
    const payload = await response.json() as {
      ok: boolean;
      data: {
        initialLocation: { rootId: string; path: string; activeFilePath: string | null; expandedPaths: string[] };
        items: Array<{ id: string; uri: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    const nestedWorkspace = payload.data.items.find((item) => item.uri === 'file:///demo/src');
    const parentWorkspace = payload.data.items.find((item) => item.uri === 'file:///demo');
    expect(nestedWorkspace).toBeDefined();
    expect(parentWorkspace).toBeDefined();
    expect(payload.data.initialLocation).toEqual({
      rootId: nestedWorkspace?.id ?? '',
      path: 'components',
      activeFilePath: 'components/App.tsx',
      expandedPaths: ['', 'components']
    });
    expect(payload.data.initialLocation.rootId).not.toBe(parentWorkspace?.id);
  });
});
