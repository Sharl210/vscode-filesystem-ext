import { describe, expect, it } from 'vitest';
import { createExportJobsManager } from '../../src/state/exportJobs';

describe('export jobs manager', () => {
  it('tracks archive export progress and exposes the completed download', async () => {
    const manager = createExportJobsManager({
      getDisguiseImageSettings: async () => ({
        selectedSource: 'template',
        selectedTemplateId: 'template-sunset',
        customImageDataUrl: null,
        templates: [{ id: 'template-sunset', label: '日落', dataUrl: 'data:image/png;base64,AAAA' }]
      }),
      resolveWorkspacePath(workspaceUri, relativePath) {
        return `${workspaceUri}/${relativePath}`;
      },
      fileService: {
        async exportArchive(_entries, options) {
          options?.onProgress?.({ progress: 25, message: '正在收集文件', stage: 'collecting' });
          options?.onProgress?.({ progress: 80, message: '正在生成压缩包', stage: 'packaging' });
          return {
            data: new TextEncoder().encode('archive-data'),
            mimeType: 'application/x-tar',
            fileName: 'sample.tar'
          };
        },
        async exportDisguisedImage() {
          throw new Error('not used');
        }
      }
    });

    const started = manager.startJob({
      workspaceUri: 'file:///demo',
      paths: ['sample.txt'],
      format: 'archive'
    });

    expect(started.status === 'queued' || started.status === 'running').toBe(true);

    await waitFor(async () => manager.getJob(started.jobId)?.status === 'completed');

    const completed = manager.getJob(started.jobId);
    expect(completed).toMatchObject({
      status: 'completed',
      progress: 100,
      stage: 'completed'
    });
    expect(completed?.messages).toContain('正在收集文件');
    expect(completed?.messages).toContain('正在生成压缩包');

    const download = manager.getDownload(started.jobId);
    expect(download?.fileName).toBe('sample.tar');
  });
});

async function waitFor(check: () => boolean | Promise<boolean>, attempts = 20) {
  for (let index = 0; index < attempts; index += 1) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error('Timed out waiting for export job completion');
}
