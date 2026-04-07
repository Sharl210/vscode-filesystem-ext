import { randomUUID } from 'node:crypto';
import type {
  DisguiseImageSettingsDto,
  ExportJobFormatDto,
  ExportJobSnapshotDto,
  ExportJobStageDto
} from '../types/api';

export interface ExportProgressUpdate {
  progress: number;
  message: string;
  stage: ExportJobStageDto;
}

interface ExportJobResult {
  data: Uint8Array;
  mimeType: string;
  fileName: string;
}

interface ExportJobFileService {
  exportArchive(
    entries: Array<{ uri: string; path: string }>,
    options?: { onProgress?: (update: ExportProgressUpdate) => void; signal?: AbortSignal }
  ): Promise<ExportJobResult>;
  exportDisguisedImage(
    entries: Array<{ uri: string; path: string }>,
    imageDataUrl: string,
    options?: { onProgress?: (update: ExportProgressUpdate) => void; signal?: AbortSignal }
  ): Promise<ExportJobResult>;
}

interface ExportJobsManagerDependencies {
  fileService: ExportJobFileService;
  getDisguiseImageSettings(): Promise<DisguiseImageSettingsDto>;
  resolveWorkspacePath(workspaceUri: string, relativePath: string): string;
}

export interface ExportJobsManager {
  startJob(input: { workspaceUri: string; paths: string[]; format: ExportJobFormatDto }): ExportJobSnapshotDto;
  getJob(jobId: string): ExportJobSnapshotDto | null;
  getDownload(jobId: string): ExportJobResult | null;
  cancelJob(jobId: string): boolean;
}

export function createExportJobsManager(dependencies: ExportJobsManagerDependencies): ExportJobsManager {
  const jobs = new Map<string, ExportJobSnapshotDto>();
  const controllers = new Map<string, AbortController>();
  const downloads = new Map<string, ExportJobResult>();

  return {
    startJob(input) {
      const jobId = randomUUID();
      const snapshot: ExportJobSnapshotDto = {
        jobId,
        status: 'queued',
        format: input.format,
        progress: 0,
        stage: 'preparing',
        currentMessage: '已创建导出任务',
        messages: ['已创建导出任务'],
        fileName: null,
        error: null
      };

      jobs.set(jobId, snapshot);
      queueMicrotask(() => {
        void runJob(jobId, input);
      });
      return cloneSnapshot(snapshot);
    },
    getJob(jobId) {
      const snapshot = jobs.get(jobId);
      return snapshot ? cloneSnapshot(snapshot) : null;
    },
    getDownload(jobId) {
      const download = downloads.get(jobId) ?? null;
      if (download) {
        downloads.delete(jobId);
        jobs.delete(jobId);
      }
      return download;
    },
    cancelJob(jobId) {
      const controller = controllers.get(jobId);
      const existed = controller !== undefined || jobs.has(jobId) || downloads.has(jobId);
      controller?.abort();
      controllers.delete(jobId);
      jobs.delete(jobId);
      downloads.delete(jobId);
      return existed;
    }
  };

  async function runJob(jobId: string, input: { workspaceUri: string; paths: string[]; format: ExportJobFormatDto }) {
    const controller = new AbortController();
    controllers.set(jobId, controller);

    try {
      update(jobId, {
        status: 'running',
        progress: 5,
        stage: 'preparing',
        message: '正在校验导出路径'
      });

      const exportEntries = input.paths.map((path) => ({
        uri: dependencies.resolveWorkspacePath(input.workspaceUri, path),
        path
      }));

      if (controller.signal.aborted || !jobs.has(jobId)) {
        return;
      }

      let result: ExportJobResult;
      if (input.format === 'archive') {
        result = await dependencies.fileService.exportArchive(exportEntries, {
          signal: controller.signal,
          onProgress(updateValue) {
            update(jobId, { status: 'running', ...updateValue });
          }
        });
      } else {
        update(jobId, {
          status: 'running',
          progress: 10,
          stage: 'preparing',
          message: '正在载入伪装图片模板'
        });
        const settings = await dependencies.getDisguiseImageSettings();
        const activeImage = pickActiveImage(settings);
        result = await dependencies.fileService.exportDisguisedImage(exportEntries, activeImage, {
          signal: controller.signal,
          onProgress(updateValue) {
            update(jobId, { status: 'running', ...updateValue });
          }
        });
      }

      if (controller.signal.aborted || !jobs.has(jobId)) {
        return;
      }

      downloads.set(jobId, result);
      update(jobId, {
        status: 'completed',
        progress: 100,
        stage: 'completed',
        message: '导出完成，正在等待下载',
        fileName: result.fileName
      });
    } catch (error) {
      if (!jobs.has(jobId)) {
        return;
      }

      update(jobId, {
        status: 'failed',
        progress: 100,
        stage: 'failed',
        message: error instanceof Error && error.message === 'EXPORT_ABORTED' ? '导出已取消' : (error instanceof Error ? error.message : '导出失败'),
        error: error instanceof Error && error.message === 'EXPORT_ABORTED' ? '导出已取消' : (error instanceof Error ? error.message : '导出失败')
      });
    } finally {
      controllers.delete(jobId);
    }
  }

  function update(
    jobId: string,
    patch: { status: ExportJobSnapshotDto['status']; progress: number; stage: ExportJobStageDto; message: string; error?: string | null; fileName?: string | null }
  ) {
    const current = jobs.get(jobId);
    if (!current) {
      return;
    }

    jobs.set(jobId, {
      ...current,
      status: patch.status,
      progress: clampProgress(patch.progress),
      stage: patch.stage,
      currentMessage: patch.message,
      messages: appendMessage(current.messages, patch.message),
      error: patch.error ?? current.error,
      fileName: patch.fileName ?? current.fileName
    });
  }
}

function pickActiveImage(settings: DisguiseImageSettingsDto) {
  if (settings.selectedSource === 'custom' && settings.customImageDataUrl) {
    return settings.customImageDataUrl;
  }

  return settings.templates.find((template) => template.id === settings.selectedTemplateId)?.dataUrl
    ?? settings.templates[0]?.dataUrl
    ?? '';
}

function appendMessage(messages: string[], next: string) {
  if (messages[messages.length - 1] === next) {
    return messages;
  }

  return [...messages, next].slice(-12);
}

function clampProgress(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function cloneSnapshot(snapshot: ExportJobSnapshotDto): ExportJobSnapshotDto {
  return {
    ...snapshot,
    messages: [...snapshot.messages]
  };
}
