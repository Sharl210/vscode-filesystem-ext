import { describe, expect, it } from 'vitest';
import { createAuthState } from '../../src/server/auth';
import { createRouter } from '../../src/server/router';
import type { DisguiseImageSettingsDto, WorkspaceItemDto } from '../../src/types/api';

const workspace: WorkspaceItemDto = {
  id: 'ws_demo',
  name: 'demo',
  uri: 'file:///workspace/demo',
  source: 'workspace'
};

const localRoot: WorkspaceItemDto = {
  id: 'ws_local',
  name: '本机根目录',
  uri: 'file:///',
  source: 'local'
};

function createRouterForTest() {
  const auth = createAuthState('secret-token');
  const calls: string[] = [];
  let disguiseSettings: DisguiseImageSettingsDto = {
    selectedSource: 'template' as const,
    selectedTemplateId: 'template-sunset',
    customImageDataUrl: null,
    templates: [
      { id: 'template-sunset', label: '日落', dataUrl: 'data:image/png;base64,AAAA' }
    ]
  };
  const exportJobs = {
    startJob() {
      return {
        jobId: 'job-1',
        status: 'running' as const,
        format: 'archive' as const,
        progress: 10,
        stage: 'preparing' as const,
        currentMessage: '正在准备导出',
        messages: ['正在准备导出'],
        fileName: null,
        error: null
      };
    },
    getJob() {
      return null;
    },
    getDownload() {
      return null;
    },
    cancelJob() {
      return true;
    }
  };

  const fileService = {
    async listDirectory(_uri: string, relativePath: string) {
      return [
        {
          name: 'hello.ts',
          path: relativePath === '' ? 'hello.ts' : `${relativePath}/hello.ts`,
          type: 'file' as const,
          size: 10,
          mtime: 1,
          mimeType: 'text/typescript',
          isText: true,
          downloadable: true
        }
      ];
    },
    async readTextFile() {
      return {
        file: {
          name: 'hello.ts',
          path: 'src/hello.ts',
          type: 'file' as const,
          size: 10,
          mtime: 1,
          mimeType: 'text/typescript',
          isText: true,
          downloadable: true
        },
        content: 'export const hello = true;',
        encoding: 'utf-8' as const,
        editable: true
      };
    },
    async writeTextFile() {},
    async deleteEntry(targetUri: string) {
      calls.push(`delete:${targetUri}`);
    },
    async createDirectory(targetUri: string) {
      calls.push(`mkdir:${targetUri}`);
    },
    async renameEntry(fromUri: string, toUri: string) {
      calls.push(`rename:${fromUri}->${toUri}`);
    },
    async copyEntry(fromUri: string, toUri: string) {
      calls.push(`copy:${fromUri}->${toUri}`);
    },
    async readBinaryFile() {
      return {
        data: new TextEncoder().encode('raw bytes'),
        mimeType: 'text/plain',
        fileName: 'hello.ts'
      };
    },
    async exportArchive() {
      return {
        data: new TextEncoder().encode('tar bytes'),
        mimeType: 'application/x-tar',
        fileName: 'hello.tar'
      };
    },
    async exportDisguisedImage() {
      return {
        data: new TextEncoder().encode('png bytes'),
        mimeType: 'image/png',
        fileName: 'hello.png'
      };
    },
    async writeFileBytes(targetUri: string, content: Uint8Array) {
      calls.push(`upload:${targetUri}:${content.byteLength}`);
    }
  };

  const router = createRouter({
    auth,
    getWorkspaces() {
      return [workspace, localRoot];
    },
    getInitialLocation() {
      return {
        rootId: workspace.id,
        path: 'src/components',
        activeFilePath: 'src/components/App.tsx',
        expandedPaths: ['', 'src', 'src/components']
      };
    },
    getConnectionInfo() {
      return {
        kind: 'remote' as const,
        label: '远程 · ssh-remote · prod-server',
        host: 'ubuntu-devbox',
        remoteName: 'ssh-remote',
        authority: 'ssh-remote+prod-server'
      };
    },
    getWorkspaceById(id) {
      if (id === workspace.id) {
        return workspace;
      }

      if (id === localRoot.id) {
        return localRoot;
      }

      return undefined;
    },
    async getDisguiseImageSettings() {
      return disguiseSettings;
    },
    async saveDisguiseImageSettings(settings) {
      disguiseSettings = {
        ...disguiseSettings,
        ...settings
      };
    },
    exportJobs,
    resolveWorkspacePath(workspaceUri, relativePath) {
      if (relativePath === '../outside') {
        throw new Error('PATH_FORBIDDEN');
      }

      return `${workspaceUri}/${relativePath}`.replace(/\/$/, '');
    },
    fileService,
    getIndexHtml() {
      return '<!doctype html><html><body>ok</body></html>';
    },
    getStaticAsset() {
      return undefined;
    }
  });

  return { router, calls };
}

describe('router', () => {
  it('returns 401 for api requests without auth', async () => {
    const { router } = createRouterForTest();

    const response = await router.handle({
      method: 'GET',
      url: '/api/workspaces',
      headers: {},
      body: new Uint8Array()
    });

    expect(response.status).toBe(401);
  });

  it('accepts api requests with token in query string', async () => {
    const { router } = createRouterForTest();

    const response = await router.handle({
      method: 'GET',
      url: '/api/workspaces?token=secret-token',
      headers: {},
      body: new Uint8Array()
    });

    expect(response.status).toBe(200);
    expect(response.jsonBody).toMatchObject({ ok: true });
  });

  it('redirects root token requests and sets auth cookie', async () => {
    const { router } = createRouterForTest();

    const response = await router.handle({
      method: 'GET',
      url: '/?token=secret-token',
      headers: {},
      body: new Uint8Array()
    });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
    expect(response.headers['set-cookie']).toContain('workspace-web-gateway-token=secret-token');
  });

  it('redirects bare root requests to a tokenized url when no cookie exists', async () => {
    const { router } = createRouterForTest();

    const response = await router.handle({
      method: 'GET',
      url: '/',
      headers: {},
      body: new Uint8Array()
    });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/?token=secret-token');
  });

  it('returns workspaces for an authenticated request', async () => {
    const { router } = createRouterForTest();

    const response = await router.handle({
      method: 'GET',
      url: '/api/workspaces',
      headers: { authorization: 'Bearer secret-token' },
      body: new Uint8Array()
    });

    expect(response.status).toBe(200);
    expect(response.jsonBody).toEqual({
      ok: true,
      data: {
        accessToken: 'secret-token',
        initialLocation: {
          rootId: 'ws_demo',
          path: 'src/components',
          activeFilePath: 'src/components/App.tsx',
          expandedPaths: ['', 'src', 'src/components']
        },
        items: [workspace, localRoot],
        connection: {
          kind: 'remote',
          label: '远程 · ssh-remote · prod-server',
          host: 'ubuntu-devbox',
          remoteName: 'ssh-remote',
          authority: 'ssh-remote+prod-server'
        }
      }
    });
  });

  it('returns 404 when the workspace id does not exist', async () => {
    const { router } = createRouterForTest();

    const response = await router.handle({
      method: 'GET',
      url: '/api/tree?workspace=missing&path=',
      headers: { authorization: 'Bearer secret-token' },
      body: new Uint8Array()
    });

    expect(response.status).toBe(404);
    expect(response.jsonBody).toEqual({
      ok: false,
      error: {
        code: 'WORKSPACE_NOT_FOUND',
        message: '指定的 workspace 不存在或已失效'
      }
    });
  });

  it('returns 403 when path resolution escapes the workspace', async () => {
    const { router } = createRouterForTest();

    const response = await router.handle({
      method: 'GET',
      url: '/api/tree?workspace=ws_demo&path=../outside',
      headers: { authorization: 'Bearer secret-token' },
      body: new Uint8Array()
    });

    expect(response.status).toBe(403);
    expect(response.jsonBody).toEqual({
      ok: false,
      error: {
        code: 'PATH_FORBIDDEN',
        message: '请求的路径超出了 workspace 范围'
      }
    });
  });

  it('returns JSON file content for GET /api/file', async () => {
    const { router } = createRouterForTest();

    const response = await router.handle({
      method: 'GET',
      url: '/api/file?workspace=ws_demo&path=src/hello.ts',
      headers: { authorization: 'Bearer secret-token' },
      body: new Uint8Array()
    });

    expect(response.status).toBe(200);
    expect(response.jsonBody).toMatchObject({
      ok: true,
      data: {
        content: 'export const hello = true;'
      }
    });
  });

  it('returns raw bytes and content headers for GET /api/download', async () => {
    const { router } = createRouterForTest();

    const response = await router.handle({
      method: 'GET',
      url: '/api/download?workspace=ws_demo&path=src/hello.ts',
      headers: { authorization: 'Bearer secret-token' },
      body: new Uint8Array()
    });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/plain');
    expect(response.headers['content-disposition']).toContain('hello.ts');
    expect(new TextDecoder().decode(response.body)).toBe('raw bytes');
  });

  it('creates directories from POST /api/mkdir', async () => {
    const { router, calls } = createRouterForTest();

    const response = await router.handle({
      method: 'POST',
      url: '/api/mkdir',
      headers: {
        authorization: 'Bearer secret-token',
        'content-type': 'application/json'
      },
      body: new TextEncoder().encode(JSON.stringify({ workspace: 'ws_demo', path: 'src/new-folder' }))
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual(['mkdir:file:///workspace/demo/src/new-folder']);
  });

  it('renames entries from POST /api/rename', async () => {
    const { router, calls } = createRouterForTest();

    const response = await router.handle({
      method: 'POST',
      url: '/api/rename',
      headers: {
        authorization: 'Bearer secret-token',
        'content-type': 'application/json'
      },
      body: new TextEncoder().encode(
        JSON.stringify({ workspace: 'ws_demo', fromPath: 'src/old.ts', toPath: 'src/new.ts' })
      )
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual(['rename:file:///workspace/demo/src/old.ts->file:///workspace/demo/src/new.ts']);
  });

  it('accepts multipart upload requests', async () => {
    const { router, calls } = createRouterForTest();
    const boundary = '----workspace-gateway';
    const multipartBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="workspace"',
      '',
      'ws_demo',
      `--${boundary}`,
      'Content-Disposition: form-data; name="path"',
      '',
      'src',
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="upload.txt"',
      'Content-Type: text/plain',
      '',
      'hello upload',
      `--${boundary}--`,
      ''
    ].join('\r\n');

    const response = await router.handle({
      method: 'POST',
      url: '/api/upload',
      headers: {
        authorization: 'Bearer secret-token',
        'content-type': `multipart/form-data; boundary=${boundary}`
      },
      body: new TextEncoder().encode(multipartBody)
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual(['upload:file:///workspace/demo/src/upload.txt:12']);
  });

  it('rejects upload filenames that contain path traversal', async () => {
    const { router } = createRouterForTest();
    const boundary = '----workspace-gateway';
    const multipartBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="workspace"',
      '',
      'ws_demo',
      `--${boundary}`,
      'Content-Disposition: form-data; name="path"',
      '',
      'src',
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="../escape.txt"',
      'Content-Type: text/plain',
      '',
      'evil',
      `--${boundary}--`,
      ''
    ].join('\r\n');

    const response = await router.handle({
      method: 'POST',
      url: '/api/upload',
      headers: {
        authorization: 'Bearer secret-token',
        'content-type': `multipart/form-data; boundary=${boundary}`
      },
      body: new TextEncoder().encode(multipartBody)
    });

    expect(response.status).toBe(400);
    expect(response.jsonBody).toEqual({
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: '上传文件名无效'
      }
    });
  });

  it('returns 400 for invalid json payloads', async () => {
    const { router } = createRouterForTest();

    const response = await router.handle({
      method: 'POST',
      url: '/api/mkdir',
      headers: {
        authorization: 'Bearer secret-token',
        'content-type': 'application/json'
      },
      body: new TextEncoder().encode('{invalid')
    });

    expect(response.status).toBe(400);
    expect(response.jsonBody).toEqual({
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: '请求体不是合法的 JSON'
      }
    });
  });

  it('creates a new empty file from POST /api/new-file', async () => {
    const { router, calls } = createRouterForTest();

    const response = await router.handle({
      method: 'POST',
      url: '/api/new-file',
      headers: {
        authorization: 'Bearer secret-token',
        'content-type': 'application/json'
      },
      body: new TextEncoder().encode(JSON.stringify({ workspace: 'ws_demo', path: 'src/new-file.txt' }))
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual(['upload:file:///workspace/demo/src/new-file.txt:0']);
  });

  it('copies entries across roots', async () => {
    const { router, calls } = createRouterForTest();

    const response = await router.handle({
      method: 'POST',
      url: '/api/copy',
      headers: {
        authorization: 'Bearer secret-token',
        'content-type': 'application/json'
      },
      body: new TextEncoder().encode(
        JSON.stringify({
          fromWorkspace: 'ws_local',
          fromPath: 'tmp/source.txt',
          toWorkspace: 'ws_demo',
          toPath: 'src/copied.txt'
        })
      )
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual(['copy:file:////tmp/source.txt->file:///workspace/demo/src/copied.txt']);
  });

  it('moves entries across roots by copy then delete', async () => {
    const { router, calls } = createRouterForTest();

    const response = await router.handle({
      method: 'POST',
      url: '/api/move',
      headers: {
        authorization: 'Bearer secret-token',
        'content-type': 'application/json'
      },
      body: new TextEncoder().encode(
        JSON.stringify({
          fromWorkspace: 'ws_local',
          fromPath: 'tmp/source.txt',
          toWorkspace: 'ws_demo',
          toPath: 'src/moved.txt'
        })
      )
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      'copy:file:////tmp/source.txt->file:///workspace/demo/src/moved.txt',
      'delete:file:////tmp/source.txt'
    ]);
  });
});
