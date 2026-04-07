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
  asExternalUri: vi.fn(async (uri: { toString(): string }) => uri)
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
    }
  },
  window: {
    showInformationMessage: vscodeMock.showInformationMessage,
    createStatusBarItem: vscodeMock.createStatusBarItem
  },
  workspace: {
    workspaceFolders: []
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
});
