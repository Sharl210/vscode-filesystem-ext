// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('webui entry actions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
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

  it('creates, renames, and uploads through UI entry points', async () => {
    const operations: string[] = [];
    const entries = [{
      name: 'sample.txt',
      path: 'sample.txt',
      type: 'file',
      size: 5,
      mtime: 1,
      mimeType: 'text/plain',
      isText: true,
      downloadable: true
    }];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

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
        return new Response(JSON.stringify({ ok: true, data: { path: '', items: entries } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url.startsWith('/api/file?') && init?.method === 'PUT') {
        operations.push('save');
        return new Response(JSON.stringify({ ok: true, data: { saved: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url.startsWith('/api/file?')) {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            file: entries[0],
            content: 'hello',
            editable: true
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url === '/api/new-file') {
        operations.push('new-file');
        entries.push({
          name: 'ui-created.txt',
          path: 'ui-created.txt',
          type: 'file',
          size: 0,
          mtime: 2,
          mimeType: 'text/plain',
          isText: true,
          downloadable: true
        });
        return new Response(JSON.stringify({ ok: true, data: { created: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url === '/api/rename') {
        operations.push('rename');
        entries[0] = {
          ...entries[0],
          name: 'renamed.txt',
          path: 'renamed.txt'
        };
        return new Response(JSON.stringify({ ok: true, data: { renamed: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url === '/api/upload') {
        operations.push('upload');
        entries.push({
          name: 'uploaded.txt',
          path: 'uploaded.txt',
          type: 'file',
          size: 11,
          mtime: 3,
          mimeType: 'text/plain',
          isText: true,
          downloadable: true
        });
        return new Response(JSON.stringify({ ok: true, data: { uploaded: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('open', vi.fn());

    let promptValue = 'ui-created.txt';
    vi.stubGlobal('prompt', vi.fn(() => promptValue));
    vi.stubGlobal('confirm', vi.fn(() => true));

    await import('../../src/webui/app.js');
    await flush();

    document.querySelector<HTMLButtonElement>('#newFileButton')?.click();
    await flush();

    expect(operations).toContain('new-file');

    document.querySelector<HTMLElement>('.file-row')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    promptValue = 'renamed.txt';
    document.querySelector<HTMLButtonElement>('#renameButton')?.click();
    await flush();

    expect(operations).toContain('rename');

    const uploadInput = document.querySelector<HTMLInputElement>('#uploadInput');
    const file = new File(['upload body'], 'uploaded.txt', { type: 'text/plain' });
    Object.defineProperty(uploadInput, 'files', { value: [file], configurable: true });
    uploadInput?.dispatchEvent(new Event('change'));
    await flush();

    expect(operations).toContain('upload');
  });

  it('shows export progress in a dialog and downloads the artifact after completion', async () => {
    const operations: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:export'),
      configurable: true,
      writable: true
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
      writable: true
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

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
        return new Response(JSON.stringify({
          ok: true,
          data: {
            path: '',
            items: [{
              name: 'sample.txt',
              path: 'sample.txt',
              type: 'file',
              size: 5,
              mtime: 1,
              mimeType: 'text/plain',
              isText: true,
              downloadable: true
            }]
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url.startsWith('/api/file?')) {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            file: {
              name: 'sample.txt',
              path: 'sample.txt',
              type: 'file',
              size: 5,
              mtime: 1,
              mimeType: 'text/plain',
              isText: true,
              downloadable: true
            },
            content: 'hello',
            editable: true
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url === '/api/export/jobs' && method === 'POST') {
        operations.push('start-job');
        return new Response(JSON.stringify({
          ok: true,
          data: {
            jobId: 'job-1',
            status: 'running',
            format: 'archive',
            progress: 5,
            stage: 'preparing',
            currentMessage: '正在准备导出',
            messages: ['正在准备导出'],
            fileName: null,
            error: null
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url === '/api/export/jobs/job-1' && method === 'GET') {
        operations.push('poll-job');
        return new Response(JSON.stringify({
          ok: true,
          data: {
            jobId: 'job-1',
            status: 'completed',
            format: 'archive',
            progress: 100,
            stage: 'completed',
            currentMessage: '导出完成',
            messages: ['正在准备导出', '正在生成压缩包', '导出完成'],
            fileName: 'sample.tar',
            error: null
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url === '/api/export/jobs/job-1/download?token=secret-token' && method === 'GET') {
        operations.push('download-job');
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: {
            'content-type': 'application/x-tar',
            'content-disposition': 'attachment; filename="sample.tar"',
            'content-length': '3'
          }
        });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('open', vi.fn());
    vi.stubGlobal('prompt', vi.fn(() => 'ignored.txt'));
    vi.stubGlobal('confirm', vi.fn(() => true));

    await import('../../src/webui/app.js');
    await flush();

    document.querySelector<HTMLElement>('.file-row')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    document.querySelector<HTMLButtonElement>('#exportArchiveButton')?.click();
    await flush();
    await flush();

    expect(operations).toEqual(['start-job', 'poll-job', 'download-job']);
    expect(document.querySelector<HTMLDivElement>('#exportProgressDialog')?.hidden).toBe(false);
    expect(document.querySelector<HTMLDivElement>('#exportProgressStage')?.textContent).toContain('已完成');
    expect(document.querySelector<HTMLDivElement>('#exportProgressCurrentMessage')?.textContent).toContain('已完成');
  });

  it('cancels an export job with token even when the user cancels before the job id arrives', async () => {
    const operations: string[] = [];
    let resolveStartJob: ((value: Response) => void) | null = null;

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url === '/api/workspaces') {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          data: {
            accessToken: 'secret-token',
            items: [{ id: 'workspace-root', name: '工作区 · demo', uri: 'file:///demo', source: 'workspace' }],
            connection: { kind: 'remote', label: '远程 · test', host: 'test', remoteName: 'ssh-remote', authority: 'ssh-remote+test' }
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }

      if (url.startsWith('/api/tree')) {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          data: {
            path: '',
            items: [{ name: 'sample.txt', path: 'sample.txt', type: 'file', size: 5, mtime: 1, mimeType: 'text/plain', isText: true, downloadable: true }]
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }

      if (url.startsWith('/api/file?')) {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          data: {
            file: {
              name: 'sample.txt',
              path: 'sample.txt',
              type: 'file',
              size: 5,
              mtime: 1,
              mimeType: 'text/plain',
              isText: true,
              downloadable: true
            },
            content: 'hello',
            editable: true
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }

      if (url === '/api/export/jobs' && method === 'POST') {
        operations.push('start-job');
        return new Promise<Response>((resolve) => {
          resolveStartJob = resolve;
        });
      }

      if (url === '/api/export/jobs/job-early/cancel?token=secret-token' && method === 'POST') {
        operations.push('cancel-job');
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: { cancelled: true } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }));
      }

      if (url === '/api/export/jobs/job-early' && method === 'GET') {
        operations.push('poll-job');
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: {
          jobId: 'job-early', status: 'running', format: 'archive', progress: 5, stage: 'preparing', currentMessage: 'running', messages: ['running'], fileName: null, error: null
        } }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('open', vi.fn());
    vi.stubGlobal('prompt', vi.fn(() => 'ignored.txt'));
    vi.stubGlobal('confirm', vi.fn(() => true));

    await import('../../src/webui/app.js');
    await flush();

    document.querySelector<HTMLElement>('.file-row')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('#exportArchiveButton')?.click();
    await flush();

    document.querySelector<HTMLButtonElement>('#exportProgressCancelButton')?.click();
    await flush();

    const startJobResolver: (value: Response) => void = resolveStartJob ?? (() => {
      throw new Error('export start resolver not captured');
    });

    startJobResolver(new Response(JSON.stringify({
      ok: true,
      data: {
        jobId: 'job-early',
        status: 'running',
        format: 'archive',
        progress: 5,
        stage: 'preparing',
        currentMessage: '正在准备导出',
        messages: ['正在准备导出'],
        fileName: null,
        error: null
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await flush();
    await flush();

    expect(operations).toContain('start-job');
    expect(operations).toContain('cancel-job');
    expect(operations).not.toContain('poll-job');
    expect(document.querySelector<HTMLDivElement>('#exportProgressDialog')?.hidden).toBe(true);
  });

  it('downloads multiple selected files as individual browser downloads', async () => {
    const openMock = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

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
        return new Response(JSON.stringify({
          ok: true,
          data: {
            path: '',
            items: [
              { name: 'a.txt', path: 'a.txt', type: 'file', size: 1, mtime: 1, mimeType: 'text/plain', isText: true, downloadable: true },
              { name: 'b.txt', path: 'b.txt', type: 'file', size: 1, mtime: 1, mimeType: 'text/plain', isText: true, downloadable: true }
            ]
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('open', openMock);
    vi.stubGlobal('prompt', vi.fn(() => 'ignored.txt'));
    vi.stubGlobal('confirm', vi.fn(() => true));

    await import('../../src/webui/app.js');
    await flush();

    const rows = Array.from(document.querySelectorAll<HTMLElement>('.file-row'));
    rows[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    rows[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));

    document.querySelector<HTMLButtonElement>('#downloadButton')?.click();

    expect(openMock).toHaveBeenNthCalledWith(
      1,
      '/api/download?workspace=workspace-root&path=a.txt&token=secret-token',
      '_blank',
      'noopener,noreferrer'
    );
    expect(openMock).toHaveBeenNthCalledWith(
      2,
      '/api/download?workspace=workspace-root&path=b.txt&token=secret-token',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('uses the access token when loading preview blobs for remote-friendly file previews', async () => {
    const operations: string[] = [];
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:preview'),
      configurable: true,
      writable: true
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === '/api/workspaces') {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            accessToken: 'secret-token',
            items: [{ id: 'workspace-root', name: '工作区 · demo', uri: 'file:///demo', source: 'workspace' }],
            connection: { kind: 'remote', label: '远程 · test', host: 'test', remoteName: 'ssh-remote', authority: 'ssh-remote+test' }
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url.startsWith('/api/tree')) {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            path: '',
            items: [
              { name: 'photo.png', path: 'photo.png', type: 'file', size: 4, mtime: 1, mimeType: 'image/png', isText: false, downloadable: true }
            ]
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url.startsWith('/api/file?')) {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            file: {
              name: 'photo.png',
              path: 'photo.png',
              type: 'file',
              size: 4,
              mtime: 1,
              mimeType: 'image/png',
              isText: false,
              downloadable: true
            },
            editable: false
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url === '/api/download?workspace=workspace-root&path=photo.png&token=secret-token') {
        operations.push('preview-download');
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'content-type': 'image/png' }
        });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('open', vi.fn());
    vi.stubGlobal('prompt', vi.fn(() => 'ignored.txt'));
    vi.stubGlobal('confirm', vi.fn(() => true));

    await import('../../src/webui/app.js');
    await flush();

    document.querySelector<HTMLElement>('.file-row')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await flush();

    expect(operations).toEqual(['preview-download']);
  });

  it('uses the access token when loading read-only text fallback content', async () => {
    const operations: string[] = [];
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:text-preview'),
      configurable: true,
      writable: true
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === '/api/workspaces') {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            accessToken: 'secret-token',
            items: [{ id: 'workspace-root', name: '工作区 · demo', uri: 'file:///demo', source: 'workspace' }],
            connection: { kind: 'remote', label: '远程 · test', host: 'test', remoteName: 'ssh-remote', authority: 'ssh-remote+test' }
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url.startsWith('/api/tree')) {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            path: '',
            items: [
              { name: 'readonly.log', path: 'readonly.log', type: 'file', size: 12, mtime: 1, mimeType: 'text/plain', isText: true, downloadable: true }
            ]
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url.startsWith('/api/file?')) {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            file: {
              name: 'readonly.log',
              path: 'readonly.log',
              type: 'file',
              size: 12,
              mtime: 1,
              mimeType: 'text/plain',
              isText: true,
              downloadable: true
            },
            editable: false
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url === '/api/download?workspace=workspace-root&path=readonly.log&token=secret-token') {
        operations.push('text-download');
        return new Response('readonly body', {
          status: 200,
          headers: { 'content-type': 'text/plain' }
        });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('open', vi.fn());
    vi.stubGlobal('prompt', vi.fn(() => 'ignored.txt'));
    vi.stubGlobal('confirm', vi.fn(() => true));

    await import('../../src/webui/app.js');
    await flush();

    document.querySelector<HTMLElement>('.file-row')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await flush();

    expect(operations).toEqual(['text-download', 'text-download']);
    expect(document.querySelector<HTMLTextAreaElement>('#viewerSurface textarea')?.value).toBe('readonly body');
  });

  it('does not expand local roots by default and allows toggling them open and closed', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === '/api/workspaces') {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            accessToken: 'secret-token',
            items: [
              { id: 'local-c', name: '本机根目录 (C:)', uri: 'file:///C:/', source: 'local' },
              { id: 'workspace-root', name: '工作区 · demo', uri: 'file:///demo', source: 'workspace' }
            ],
            connection: { kind: 'local', label: '本机 · test', host: 'test', remoteName: null, authority: null }
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url.startsWith('/api/tree?workspace=workspace-root')) {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            path: '',
            items: [{ name: 'src', path: 'src', type: 'directory', size: 0, mtime: 1, mimeType: 'inode/directory', isText: false, downloadable: false }]
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url.startsWith('/api/tree?workspace=local-c')) {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            path: '',
            items: [{ name: 'Users', path: 'Users', type: 'directory', size: 0, mtime: 1, mimeType: 'inode/directory', isText: false, downloadable: false }]
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('open', vi.fn());
    vi.stubGlobal('prompt', vi.fn(() => 'ignored.txt'));
    vi.stubGlobal('confirm', vi.fn(() => true));

    await import('../../src/webui/app.js');
    await flush();

    const toggles = Array.from(document.querySelectorAll<HTMLButtonElement>('.tree-toggle'));
    expect(toggles[0]?.dataset.state).toBe('visible');
    expect(document.querySelector('.tree-list .tree-list .tree-list')).toBeNull();

    toggles[0]?.click();
    await flush();
    expect(document.body.textContent).toContain('Users');

    const refreshedToggles = Array.from(document.querySelectorAll<HTMLButtonElement>('.tree-toggle'));
    refreshedToggles[0]?.click();
    await flush();
    expect(document.body.textContent).not.toContain('Users');
  });

  it('supports marquee selection across file rows', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

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
        return new Response(JSON.stringify({
          ok: true,
          data: {
            path: '',
            items: [
              { name: 'a.txt', path: 'a.txt', type: 'file', size: 1, mtime: 1, mimeType: 'text/plain', isText: true, downloadable: true },
              { name: 'b.txt', path: 'b.txt', type: 'file', size: 1, mtime: 1, mimeType: 'text/plain', isText: true, downloadable: true },
              { name: 'c.txt', path: 'c.txt', type: 'file', size: 1, mtime: 1, mimeType: 'text/plain', isText: true, downloadable: true }
            ]
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('open', vi.fn());
    vi.stubGlobal('prompt', vi.fn(() => 'ignored.txt'));
    vi.stubGlobal('confirm', vi.fn(() => true));

    await import('../../src/webui/app.js');
    await flush();

    const list = document.querySelector<HTMLDivElement>('#fileList');
    if (!list) {
      throw new Error('fileList not found');
    }
    Object.defineProperty(list, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 })
    });

    list.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
    await flush();
    Array.from(document.querySelectorAll<HTMLElement>('.file-row')).forEach((row, index) => {
      Object.defineProperty(row, 'getBoundingClientRect', {
        value: () => ({ left: 0, top: index * 40, right: 400, bottom: index * 40 + 36, width: 400, height: 36 })
      });
    });
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 78 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 200, clientY: 78 }));
    await flush();

    const rows = Array.from(document.querySelectorAll<HTMLElement>('.file-row'));
    expect(rows[0]?.classList.contains('is-selected')).toBe(true);
    expect(rows[1]?.classList.contains('is-selected')).toBe(true);
    expect(rows[2]?.classList.contains('is-selected')).toBe(false);
    expect(document.querySelector('#selectionSummary')?.textContent).toContain('2 项已选择');
  });

  it('selects all visible entries from the header checkbox', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

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
        return new Response(JSON.stringify({
          ok: true,
          data: {
            path: '',
            items: [
              { name: 'a.txt', path: 'a.txt', type: 'file', size: 1, mtime: 1, mimeType: 'text/plain', isText: true, downloadable: true },
              { name: 'b.txt', path: 'b.txt', type: 'file', size: 1, mtime: 1, mimeType: 'text/plain', isText: true, downloadable: true }
            ]
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('open', vi.fn());
    vi.stubGlobal('prompt', vi.fn(() => 'ignored.txt'));
    vi.stubGlobal('confirm', vi.fn(() => true));

    await import('../../src/webui/app.js');
    await flush();

    const selectAll = document.querySelector<HTMLInputElement>('#selectAllCheckbox');
    if (!selectAll) {
      throw new Error('selectAllCheckbox not found');
    }
    selectAll.checked = true;
    selectAll.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    const rows = Array.from(document.querySelectorAll<HTMLElement>('.file-row'));
    expect(rows.every((row) => row.classList.contains('is-selected'))).toBe(true);
    expect(document.querySelector('#selectionSummary')?.textContent).toContain('2 项已选择');
  });

  it('loads disguise image settings and saves the selected template', async () => {
    const operations: Array<{ method: string; url: string; body?: string }> = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

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

      if (url === '/api/settings/disguised-image' && method === 'GET') {
        operations.push({ method, url });
        return new Response(JSON.stringify({
          ok: true,
          data: {
            selectedSource: 'template',
            selectedTemplateId: 'template-sunset',
            customImageDataUrl: null,
            templates: [
              { id: 'template-sunset', label: '日落', dataUrl: 'data:image/png;base64,AAAA' },
              { id: 'template-ocean', label: '海面', dataUrl: 'data:image/png;base64,BBBB' }
            ]
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url === '/api/settings/disguised-image' && method === 'PUT') {
        operations.push({ method, url, body: String(init?.body ?? '') });
        return new Response(JSON.stringify({ ok: true, data: { saved: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('open', vi.fn());
    vi.stubGlobal('prompt', vi.fn(() => 'ignored.txt'));
    vi.stubGlobal('confirm', vi.fn(() => true));

    await import('../../src/webui/app.js');
    await flush();

    document.querySelector<HTMLButtonElement>('#settingsButton')?.click();
    await flush();

    document.querySelector<HTMLButtonElement>('#disguiseSettingsSaveButton')?.click();
    await flush();

    expect(operations).toContainEqual({ method: 'GET', url: '/api/settings/disguised-image' });
    expect(operations).toContainEqual({
      method: 'PUT',
      url: '/api/settings/disguised-image',
      body: JSON.stringify({
        selectedSource: 'template',
        selectedTemplateId: 'template-sunset',
        customImageDataUrl: null
      })
    });
  });

  it('converts a custom non-png image to png before saving disguise settings', async () => {
    const operations: Array<{ method: string; url: string; body?: string }> = [];

    class MockFileReader {
      result = '';
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;

      readAsDataURL() {
        this.result = 'data:image/jpeg;base64,BBBB';
        this.onload?.();
      }
    }

    class MockImage {
      width = 4;
      height = 3;
      naturalWidth = 4;
      naturalHeight = 3;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;

      set src(_value: string) {
        this.onload?.();
      }
    }

    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: vi.fn() }),
          toDataURL: () => 'data:image/png;base64,CCCC'
        } as unknown as HTMLCanvasElement;
      }

      return originalCreateElement(tagName);
    }) as typeof document.createElement);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

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

      if (url === '/api/settings/disguised-image' && method === 'GET') {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            selectedSource: 'template',
            selectedTemplateId: 'template-sunset',
            customImageDataUrl: null,
            templates: [
              { id: 'template-sunset', label: '日落', dataUrl: 'data:image/png;base64,AAAA' }
            ]
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url === '/api/settings/disguised-image' && method === 'PUT') {
        operations.push({ method, url, body: String(init?.body ?? '') });
        return new Response(JSON.stringify({ ok: true, data: { saved: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('open', vi.fn());
    vi.stubGlobal('prompt', vi.fn(() => 'ignored.txt'));
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('FileReader', MockFileReader as unknown as typeof FileReader);
    vi.stubGlobal('Image', MockImage as unknown as typeof Image);

    await import('../../src/webui/app.js');
    await flush();

    document.querySelector<HTMLButtonElement>('#settingsButton')?.click();
    await flush();

    const customInput = document.querySelector<HTMLInputElement>('#disguiseCustomInput');
    const file = new File(['jpeg body'], 'custom.jpg', { type: 'image/jpeg' });
    Object.defineProperty(customInput, 'files', { value: [file], configurable: true });
    customInput?.dispatchEvent(new Event('change'));
    await flush();

    document.querySelector<HTMLButtonElement>('#disguiseSettingsSaveButton')?.click();
    await flush();

    expect(document.querySelector<HTMLDivElement>('#disguiseSelectedFileName')?.textContent).toContain('custom.jpg');
    expect(document.querySelector<HTMLDivElement>('#disguiseSettingsDialog')?.hidden).toBe(true);
    expect(operations).toContainEqual({
      method: 'PUT',
      url: '/api/settings/disguised-image',
      body: JSON.stringify({
        selectedSource: 'custom',
        selectedTemplateId: 'template-sunset',
        customImageDataUrl: 'data:image/png;base64,CCCC'
      })
    });
  });

  it('opens settings only from the gear button and closes it explicitly', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

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

      if (url === '/api/settings/disguised-image' && method === 'GET') {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            selectedSource: 'template',
            selectedTemplateId: 'template-sunset',
            customImageDataUrl: null,
            templates: [{ id: 'template-sunset', label: '日落', dataUrl: 'data:image/png;base64,AAAA' }]
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('open', vi.fn());
    vi.stubGlobal('prompt', vi.fn(() => 'ignored.txt'));
    vi.stubGlobal('confirm', vi.fn(() => true));

    await import('../../src/webui/app.js');
    await flush();

    expect(document.querySelector<HTMLDivElement>('#disguiseSettingsDialog')?.hidden).toBe(true);

    document.querySelector<HTMLButtonElement>('#settingsButton')?.click();
    await flush();
    expect(document.querySelector<HTMLDivElement>('#disguiseSettingsDialog')?.hidden).toBe(false);

    document.querySelector<HTMLButtonElement>('#disguiseSettingsCloseButton')?.click();
    await flush();
    expect(document.querySelector<HTMLDivElement>('#disguiseSettingsDialog')?.hidden).toBe(true);
  });

  it('supports folder upload with progress dialog and real cancel', async () => {
    const operations: string[] = [];

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url === '/api/workspaces') {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          data: {
            accessToken: 'secret-token',
            items: [{ id: 'workspace-root', name: '工作区 · demo', uri: 'file:///demo', source: 'workspace' }],
            connection: { kind: 'local', label: '本机 · test', host: 'test', remoteName: null, authority: null }
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }

      if (url.startsWith('/api/tree')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: { path: '', items: [] } }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }

      if (url === '/api/mkdir' && method === 'POST') {
        operations.push('mkdir');
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: { created: true } }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }

      if (url === '/api/upload' && method === 'POST') {
        operations.push('upload-start');
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            operations.push('upload-abort');
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }

      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('open', vi.fn());
    vi.stubGlobal('prompt', vi.fn(() => 'ignored.txt'));
    vi.stubGlobal('confirm', vi.fn(() => true));

    await import('../../src/webui/app.js');
    await flush();

    document.querySelector<HTMLButtonElement>('#uploadTriggerButton')?.click();
    await flush();
    document.querySelector<HTMLButtonElement>('#uploadFolderChoiceButton')?.click();

    const folderInput = document.querySelector<HTMLInputElement>('#uploadFolderInput');
    const file = new File(['folder body'], 'nested.txt', { type: 'text/plain' });
    Object.defineProperty(file, 'webkitRelativePath', { value: 'my-folder/nested.txt' });
    Object.defineProperty(folderInput, 'files', { value: [file], configurable: true });
    folderInput?.dispatchEvent(new Event('change'));
    await flush();

    expect(document.querySelector<HTMLDivElement>('#exportProgressDialog')?.hidden).toBe(false);
    expect(operations).toContain('mkdir');
    expect(operations).toContain('upload-start');

    document.querySelector<HTMLButtonElement>('#exportProgressCancelButton')?.click();
    await flush();

    expect(operations).toContain('upload-abort');
    expect(document.querySelector<HTMLDivElement>('#exportProgressDialog')?.hidden).toBe(true);
  });

  it('uploads dropped files to the currently open directory from anywhere on the page', async () => {
    const operations: Array<{ kind: string; path?: string; workspace?: string; fileName?: string }> = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

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
        return new Response(JSON.stringify({ ok: true, data: { path: 'docs', items: [] } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url === '/api/upload' && method === 'POST') {
        const body = init?.body as FormData;
        operations.push({
          kind: 'upload',
          workspace: String(body.get('workspace')),
          path: String(body.get('path')),
          fileName: (body.get('file') as File)?.name
        });
        return new Response(JSON.stringify({ ok: true, data: { uploaded: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('open', vi.fn());
    vi.stubGlobal('prompt', vi.fn(() => 'ignored.txt'));
    vi.stubGlobal('confirm', vi.fn(() => true));

    await import('../../src/webui/app.js');
    await flush();

    const droppedFile = new File(['drop body'], 'dropped.txt', { type: 'text/plain' });
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: {
        files: [droppedFile],
        items: []
      },
      configurable: true
    });

    document.dispatchEvent(event);
    await flush();

    expect(operations).toContainEqual({
      kind: 'upload',
      workspace: 'workspace-root',
      path: 'docs',
      fileName: 'dropped.txt'
    });
  });

  it('asks for a destination path when files are dropped without an open directory', async () => {
    vi.doMock('../../src/webui/defaultRoot', () => ({
      pickInitialRootId: () => ''
    }));

    const operations: Array<{ kind: string; path?: string; workspace?: string; fileName?: string }> = [];
    const promptMock = vi.fn(() => 'incoming');

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

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

      if (url === '/api/mkdir' && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { workspace: string; path: string };
        operations.push({ kind: 'mkdir', workspace: body.workspace, path: body.path });
        return new Response(JSON.stringify({ ok: true, data: { created: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url === '/api/upload' && method === 'POST') {
        const body = init?.body as FormData;
        operations.push({
          kind: 'upload',
          workspace: String(body.get('workspace')),
          path: String(body.get('path')),
          fileName: (body.get('file') as File)?.name
        });
        return new Response(JSON.stringify({ ok: true, data: { uploaded: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('open', vi.fn());
    vi.stubGlobal('prompt', promptMock);
    vi.stubGlobal('confirm', vi.fn(() => true));

    await import('../../src/webui/app.js');
    await flush();

    const firstDroppedFile = new File(['first body'], 'nested.txt', { type: 'text/plain' });
    const secondDroppedFile = new File(['second body'], 'nested-2.txt', { type: 'text/plain' });

    const fileEntry = (name: string, file: File) => ({
      isFile: true,
      isDirectory: false,
      name,
      file(callback: (value: File) => void) {
        callback(file);
      }
    });

    const directoryEntry = {
      isFile: false,
      isDirectory: true,
      name: 'drag-folder',
      createReader() {
        let readCount = 0;
        return {
          readEntries(callback: (entries: Array<unknown>) => void) {
            readCount += 1;
            if (readCount === 1) {
              callback([fileEntry('nested.txt', firstDroppedFile)]);
              return;
            }
            if (readCount === 2) {
              callback([fileEntry('nested-2.txt', secondDroppedFile)]);
              return;
            }
            callback([]);
          }
        };
      }
    };

    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: {
        files: [],
        items: [{ kind: 'file', webkitGetAsEntry: () => directoryEntry }]
      },
      configurable: true
    });

    document.dispatchEvent(event);
    await flush();

    expect(promptMock).toHaveBeenCalled();
    expect(operations).toContainEqual({ kind: 'mkdir', workspace: 'workspace-root', path: 'incoming/drag-folder' });
    expect(operations).toContainEqual({ kind: 'upload', workspace: 'workspace-root', path: 'incoming/drag-folder', fileName: 'nested.txt' });
    expect(operations).toContainEqual({ kind: 'upload', workspace: 'workspace-root', path: 'incoming/drag-folder', fileName: 'nested-2.txt' });
  });
});

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
