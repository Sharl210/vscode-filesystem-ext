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

function createExportRouterForTest() {
  const auth = createAuthState('secret-token');
  const calls: string[] = [];
  let disguiseSettings: DisguiseImageSettingsDto = {
    selectedSource: 'template' as const,
    selectedTemplateId: 'template-sunset',
    customImageDataUrl: null,
    templates: [
      { id: 'template-sunset', label: '日落', dataUrl: 'data:image/png;base64,AAAA' },
      { id: 'template-ocean', label: '海面', dataUrl: 'data:image/png;base64,BBBB' }
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
      return {
        jobId: 'job-1',
        status: 'completed' as const,
        format: 'archive' as const,
        progress: 100,
        stage: 'completed' as const,
        currentMessage: '导出完成',
        messages: ['正在准备导出', '导出完成'],
        fileName: 'bundle.tar',
        error: null
      };
    },
    getDownload() {
      return {
        data: new TextEncoder().encode('job-download'),
        mimeType: 'application/x-tar',
        fileName: 'bundle.tar'
      };
    },
    cancelJob() {
      return true;
    }
  };

  const fileService = {
    async listDirectory() {
      return [];
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
    async readBinaryFile() {
      return {
        data: new TextEncoder().encode('raw bytes'),
        mimeType: 'text/plain',
        fileName: 'hello.ts'
      };
    },
    async writeFileBytes() {},
    async writeTextFile() {},
    async deleteEntry() {},
    async createDirectory() {},
    async renameEntry() {},
    async copyEntry() {},
    async exportArchive(entries: Array<{ uri: string; path: string }>) {
      calls.push(`archive:${entries.map((entry) => entry.path).join('|')}`);
      return {
        data: new TextEncoder().encode('tar-bytes'),
        mimeType: 'application/x-tar',
        fileName: 'bundle.tar'
      };
    },
    async exportDisguisedImage(entries: Array<{ uri: string; path: string }>, _imageDataUrl: string) {
      calls.push(`image:${entries.map((entry) => entry.path).join('|')}`);
      return {
        data: new TextEncoder().encode('png-bytes'),
        mimeType: 'image/png',
        fileName: 'bundle.png'
      };
    }
  };

  const router = createRouter({
    auth,
    getWorkspaces() {
      return [workspace];
    },
    getConnectionInfo() {
      return {
        kind: 'local' as const,
        label: '本机 · test',
        host: 'test',
        remoteName: null,
        authority: null
      };
    },
    getWorkspaceById(id) {
      return id === workspace.id ? workspace : undefined;
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

describe('export router', () => {
  it('returns disguise image settings with built-in templates', async () => {
    const { router } = createExportRouterForTest();

    const response = await router.handle({
      method: 'GET',
      url: '/api/settings/disguised-image',
      headers: { authorization: 'Bearer secret-token' },
      body: new Uint8Array()
    });

    expect(response.status).toBe(200);
    expect(response.jsonBody).toMatchObject({
      ok: true,
      data: {
        templates: expect.any(Array),
        selectedSource: 'template',
        selectedTemplateId: expect.any(String),
        customImageDataUrl: null
      }
    });
  });

  it('saves disguise image settings', async () => {
    const { router } = createExportRouterForTest();

    const response = await router.handle({
      method: 'PUT',
      url: '/api/settings/disguised-image',
      headers: {
        authorization: 'Bearer secret-token',
        'content-type': 'application/json'
      },
      body: new TextEncoder().encode(JSON.stringify({
        selectedSource: 'custom',
        selectedTemplateId: 'template-sunset',
        customImageDataUrl: 'data:image/png;base64,AAAA'
      }))
    });

    expect(response.status).toBe(200);
    expect(response.jsonBody).toMatchObject({
      ok: true,
      data: {
        saved: true
      }
    });
  });

  it('exports selected entries as a tar archive', async () => {
    const { router, calls } = createExportRouterForTest();

    const response = await router.handle({
      method: 'GET',
      url: '/api/export/archive?workspace=ws_demo&path=src/hello.ts&path=src/assets/logo.png',
      headers: { authorization: 'Bearer secret-token' },
      body: new Uint8Array()
    });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/x-tar');
    expect(response.headers['content-disposition']).toContain('bundle.tar');
    expect(calls).toEqual(['archive:src/hello.ts|src/assets/logo.png']);
  });

  it('creates an export job and returns the initial progress snapshot', async () => {
    const { router } = createExportRouterForTest();

    const response = await router.handle({
      method: 'POST',
      url: '/api/export/jobs',
      headers: {
        authorization: 'Bearer secret-token',
        'content-type': 'application/json'
      },
      body: new TextEncoder().encode(JSON.stringify({
        workspace: 'ws_demo',
        format: 'archive',
        paths: ['src/hello.ts']
      }))
    });

    expect(response.status).toBe(200);
    expect(response.jsonBody).toMatchObject({
      ok: true,
      data: {
        jobId: 'job-1',
        status: 'running',
        currentMessage: '正在准备导出'
      }
    });
  });

  it('returns export job status snapshots', async () => {
    const { router } = createExportRouterForTest();

    const response = await router.handle({
      method: 'GET',
      url: '/api/export/jobs/job-1',
      headers: { authorization: 'Bearer secret-token' },
      body: new Uint8Array()
    });

    expect(response.status).toBe(200);
    expect(response.jsonBody).toMatchObject({
      ok: true,
      data: {
        jobId: 'job-1',
        status: 'completed',
        progress: 100,
        fileName: 'bundle.tar'
      }
    });
  });

  it('downloads completed export job artifacts', async () => {
    const { router } = createExportRouterForTest();

    const response = await router.handle({
      method: 'GET',
      url: '/api/export/jobs/job-1/download',
      headers: { authorization: 'Bearer secret-token' },
      body: new Uint8Array()
    });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/x-tar');
    expect(response.headers['content-disposition']).toContain('bundle.tar');
    expect(new TextDecoder().decode(response.body)).toBe('job-download');
  });

  it('cancels export jobs through the cancel endpoint', async () => {
    const { router } = createExportRouterForTest();

    const response = await router.handle({
      method: 'POST',
      url: '/api/export/jobs/job-1/cancel',
      headers: { authorization: 'Bearer secret-token' },
      body: new Uint8Array()
    });

    expect(response.status).toBe(200);
    expect(response.jsonBody).toEqual({
      ok: true,
      data: {
        cancelled: true
      }
    });
  });

  it('exports selected entries as a disguised image', async () => {
    const { router, calls } = createExportRouterForTest();

    const response = await router.handle({
      method: 'GET',
      url: '/api/export/disguised-image?workspace=ws_demo&path=src/hello.ts',
      headers: { authorization: 'Bearer secret-token' },
      body: new Uint8Array()
    });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['content-disposition']).toContain('bundle.png');
    expect(calls).toEqual(['image:src/hello.ts']);
  });

  it('rejects any export entry that escapes the workspace boundary', async () => {
    const { router } = createExportRouterForTest();

    const response = await router.handle({
      method: 'GET',
      url: '/api/export/archive?workspace=ws_demo&path=src/hello.ts&path=../outside',
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
});
