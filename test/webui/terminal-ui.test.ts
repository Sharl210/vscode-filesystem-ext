// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('webui terminal page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    window.history.replaceState({}, '', '/');
    window.localStorage.clear();
    document.body.innerHTML = `
      <div id="rootTree"></div>
      <div id="fileList"></div>
      <p id="connectionInfo"></p>
      <div id="statusMessage"></div>
      <div id="clipboardStatus"></div>
      <div id="breadcrumbs"></div>
      <input id="pathInput" />
      <input id="searchInput" />
      <span id="selectionSummary"></span>
      <div id="tabStrip"></div>
      <div id="viewerToolbar"></div>
      <div id="viewerSurface"></div>
      <div id="contextMenu"></div>
      <input id="uploadInput" type="file" />
      <input id="uploadFolderInput" type="file" />
      <button id="refreshButton"></button>
      <button id="upButton"></button>
      <button id="newFileButton"></button>
      <button id="mkdirButton"></button>
      <button id="renameButton"></button>
      <button id="deleteButton"></button>
      <button id="copyButton"></button>
      <button id="cutButton"></button>
      <button id="pasteButton"></button>
      <button id="downloadButton"></button>
      <button id="exportArchiveButton"></button>
      <button id="exportDisguisedImageButton"></button>
      <button id="settingsButton"></button>
      <button id="uploadTriggerButton"></button>
      <div id="uploadChoiceDialog" hidden>
        <button id="uploadFileChoiceButton"></button>
        <button id="uploadFolderChoiceButton"></button>
        <button id="uploadChoiceCloseButton"></button>
      </div>
      <div id="disguiseSettingsDialog" hidden>
        <div id="disguiseTemplateList"></div>
        <img id="disguiseCurrentPreview" />
        <input id="disguiseCustomInput" type="file" />
        <div id="disguiseSelectedFileName"></div>
        <div id="disguiseArchiveFormatDescription"></div>
        <button id="disguiseSettingsSaveButton"></button>
        <button id="disguiseSettingsCloseButton"></button>
      </div>
      <div id="exportProgressDialog" hidden>
        <div id="exportProgressTitle"></div>
        <div id="exportProgressStage"></div>
        <div id="exportProgressPercent"></div>
        <div id="exportProgressBar"></div>
        <div id="exportProgressCurrentMessage"></div>
        <div id="exportProgressMessages"></div>
        <button id="exportProgressCloseButton"></button>
        <button id="exportProgressCancelButton"></button>
      </div>
      <input id="selectAllCheckbox" type="checkbox" />
      <button data-sort-key="name"></button>
      <button data-sort-key="type"></button>
      <button data-sort-key="size"></button>
      <button data-sort-key="mtime"></button>
    `;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders terminal tabs with a green running indicator', async () => {
    vi.stubGlobal('fetch', createTerminalFetchMock());
    vi.stubGlobal('open', vi.fn());
    vi.stubGlobal('prompt', vi.fn(() => 'ignored.txt'));
    vi.stubGlobal('confirm', vi.fn(() => true));

    await import('../../src/webui/app.js');
    await flush();

    document.querySelector<HTMLButtonElement>('#openTerminalButton')?.click();
    await flush();

    expect(document.querySelector('.terminal-tab-item .tab-title')?.textContent).toBe('tab-1');
    expect(document.querySelector('.terminal-tab-running-dot')).toBeTruthy();
    expect(document.querySelector('.terminal-command-input')).toBeTruthy();
  });

  it('filters shell integration control sequences from terminal display content', async () => {
    vi.stubGlobal('fetch', createTerminalFetchMock([], {
      terminalContent: '$ echo terminal_sync_ok\n\u001b]633;Cecho terminal_sync_ok\u0007terminal_sync_ok\n'
    }));
    vi.stubGlobal('open', vi.fn());
    vi.stubGlobal('prompt', vi.fn(() => 'ignored.txt'));
    vi.stubGlobal('confirm', vi.fn(() => true));

    await import('../../src/webui/app.js');
    await flush();

    document.querySelector<HTMLButtonElement>('#openTerminalButton')?.click();
    await flush();

    const output = document.querySelector<HTMLPreElement>('.terminal-output');
    expect(output?.textContent).toContain('terminal_sync_ok');
    expect(output?.textContent).not.toContain(']633;C');
  });

  it('refreshes terminal state every 1 second while the terminal page is active', async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const intervalCallbacks: Array<TimerHandler> = [];
    const intervalDelays: number[] = [];
    vi.spyOn(window, 'setInterval').mockImplementation(((handler: TimerHandler, timeout?: number) => {
      intervalCallbacks.push(handler);
      intervalDelays.push(Number(timeout));
      return 1;
    }) as typeof window.setInterval);
    vi.stubGlobal('fetch', createTerminalFetchMock(requests));
    vi.stubGlobal('open', vi.fn());
    vi.stubGlobal('prompt', vi.fn(() => 'ignored.txt'));
    vi.stubGlobal('confirm', vi.fn(() => true));

    await import('../../src/webui/app.js');
    await flush();

    expect(intervalDelays[0]).toBe(1000);

    document.querySelector<HTMLButtonElement>('#openTerminalButton')?.click();
    await flush();
    const initialTerminalRequests = requests.filter((request) => request.url === '/api/terminal/tabs').length;

    const refreshCallback = intervalCallbacks[0];
    if (typeof refreshCallback !== 'function') {
      throw new Error('terminal refresh interval was not registered');
    }

    refreshCallback();
    await flush();

    const refreshedTerminalRequests = requests.filter((request) => request.url === '/api/terminal/tabs').length;
    expect(refreshedTerminalRequests).toBeGreaterThan(initialTerminalRequests);
  });
});

function createTerminalFetchMock(
  requests: Array<{ url: string; body: string }> = [],
  options: { terminalContent?: string } = {}
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    requests.push({ url, body: typeof init?.body === 'string' ? init.body : '' });

    if (url === '/api/workspaces') {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          accessToken: 'secret-token',
          items: [{ id: 'workspace-root', name: '工作区 · demo', uri: 'file:///demo', source: 'workspace' }],
          connection: { kind: 'local', label: '本机 · test', host: 'test', remoteName: null, authority: null }
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (url.startsWith('/api/tree')) {
      return new Response(JSON.stringify({ ok: true, data: { path: '', items: [] } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (url === '/api/terminal/tabs' && method === 'GET') {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          tabs: [{
            tabId: 'tab-1',
            title: 'Ubuntu',
            cwd: '/workspace/demo',
            status: 'running',
            isDefault: true,
            lastActiveAt: '2026-04-10T10:00:00.000Z',
            recentCommands: ['pwd']
          }],
          defaultTabId: 'tab-1'
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (url === '/api/terminal/tabs/tab-1/content') {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          tabId: 'tab-1',
          title: 'Ubuntu',
          status: 'running',
          content: options.terminalContent ?? '$ pwd\n/workspace/demo\n',
          recentCommands: ['pwd'],
          historyVersion: 1
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (url === '/api/terminal/tabs' && method === 'POST') {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          tabId: 'tab-1',
          title: 'Terminal',
          cwd: '/workspace/demo',
          status: 'idle',
          isDefault: true,
          lastActiveAt: '2026-04-10T10:00:00.000Z',
          recentCommands: []
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (url === '/api/terminal/execute' && method === 'POST') {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          tabId: 'tab-1',
          command: 'pwd',
          cwd: '/workspace/demo',
          stdout: '/workspace/demo\n',
          stderr: '',
          combinedOutput: '/workspace/demo\n',
          exitCode: 0,
          timedOut: false
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
