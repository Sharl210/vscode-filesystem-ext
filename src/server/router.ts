import type {
  CreateExportJobRequestDto,
  ConnectionInfoDto,
  DisguiseImageSettingsDto,
  ExportJobSnapshotDto,
  FileEntryDto,
  GetFileResponseDto,
  WorkspaceItemDto
} from '../types/api';
import { normalizeEntryName } from '../utils/nameValidation';
import type { AuthState } from './auth';
import {
  sendBinaryDownload,
  sendHtml,
  sendJsonError,
  sendJsonSuccess,
  sendNotFound,
  sendRedirect,
  type RouterResponse
} from './response';

interface RouterFileService {
  listDirectory(directoryUri: string, directoryPath: string): Promise<FileEntryDto[]>;
  readTextFile(fileUri: string, relativePath: string): Promise<GetFileResponseDto>;
  readBinaryFile(fileUri: string, relativePath: string): Promise<{ data: Uint8Array; mimeType: string; fileName: string }>;
  exportArchive(entries: Array<{ uri: string; path: string }>): Promise<{ data: Uint8Array; mimeType: string; fileName: string }>;
  exportDisguisedImage(entries: Array<{ uri: string; path: string }>, imageDataUrl: string): Promise<{ data: Uint8Array; mimeType: string; fileName: string }>;
  writeFileBytes(fileUri: string, content: Uint8Array): Promise<void>;
  writeTextFile(fileUri: string, content: string): Promise<void>;
  deleteEntry(targetUri: string): Promise<void>;
  createDirectory(targetUri: string): Promise<void>;
  renameEntry(fromUri: string, toUri: string): Promise<void>;
  copyEntry(fromUri: string, toUri: string): Promise<void>;
}

interface RouterExportJobs {
  startJob(input: { workspaceUri: string; paths: string[]; format: 'archive' | 'disguised-image' }): ExportJobSnapshotDto;
  getJob(jobId: string): ExportJobSnapshotDto | null;
  getDownload(jobId: string): { data: Uint8Array; mimeType: string; fileName: string } | null;
  cancelJob(jobId: string): boolean;
}

export interface RouterRequest {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body: Uint8Array;
}

interface RouterDependencies {
  auth: AuthState;
  getWorkspaces(): WorkspaceItemDto[];
  getConnectionInfo(): ConnectionInfoDto;
  getWorkspaceById(id: string): WorkspaceItemDto | undefined;
  getDisguiseImageSettings(): Promise<DisguiseImageSettingsDto>;
  saveDisguiseImageSettings(settings: {
    selectedSource: 'template' | 'custom';
    selectedTemplateId: string;
    customImageDataUrl: string | null;
  }): Promise<void>;
  exportJobs: RouterExportJobs;
  resolveWorkspacePath(workspaceUri: string, relativePath: string): string;
  fileService: RouterFileService;
  getIndexHtml(): string;
  getStaticAsset(pathname: string): { body: Uint8Array; contentType: string } | undefined;
}

export function createRouter(dependencies: RouterDependencies) {
  return {
    async handle(request: RouterRequest): Promise<RouterResponse> {
      const url = new URL(request.url, 'http://127.0.0.1');

      if (url.pathname === '/') {
        if (dependencies.auth.validateUiToken(url)) {
          return sendRedirect('/', {
            'set-cookie': `workspace-web-gateway-token=${dependencies.auth.token}; HttpOnly; SameSite=Strict; Path=/`
          });
        }

        if (!dependencies.auth.validateRequest(request.headers)) {
          return sendRedirect(`/?token=${dependencies.auth.token}`);
        }

        return sendHtml(dependencies.getIndexHtml());
      }

      const staticAsset = dependencies.getStaticAsset(url.pathname);
      if (staticAsset) {
        return {
          status: 200,
          headers: { 'content-type': staticAsset.contentType },
          body: staticAsset.body
        };
      }

      if (!url.pathname.startsWith('/api/')) {
        return sendNotFound();
      }

      if (!dependencies.auth.validateRequest(request.headers, url)) {
        return sendJsonError('UNAUTHORIZED', '缺少有效的访问凭据');
      }

      if (url.pathname === '/api/workspaces' && request.method === 'GET') {
        return sendJsonSuccess({
          accessToken: dependencies.auth.token,
          items: dependencies.getWorkspaces(),
          connection: dependencies.getConnectionInfo()
        });
      }

      if (url.pathname === '/api/upload' && request.method === 'POST') {
        const multipart = parseMultipart(request.body, request.headers['content-type'] ?? '');
        const uploadWorkspaceId = multipart.fields.workspace ?? '';
        const uploadWorkspace = dependencies.getWorkspaceById(uploadWorkspaceId);

        if (!uploadWorkspace) {
          return sendJsonError('WORKSPACE_NOT_FOUND', '指定的 workspace 不存在或已失效');
        }

        const targetDirectory = dependencies.resolveWorkspacePath(uploadWorkspace.uri, multipart.fields.path ?? '');

        let normalizedName: string;
        try {
          normalizedName = normalizeEntryName(multipart.file.name);
        } catch {
          return sendJsonError('INVALID_REQUEST', '上传文件名无效');
        }

        const targetUri = appendChildPath(targetDirectory, normalizedName);

        await dependencies.fileService.writeFileBytes(targetUri, multipart.file.content);
        return sendJsonSuccess({ uploaded: true, fileName: normalizedName });
      }

      if (url.pathname === '/api/settings/disguised-image' && request.method === 'GET') {
        return sendJsonSuccess(await dependencies.getDisguiseImageSettings());
      }

      const exportJobMatch = url.pathname.match(/^\/api\/export\/jobs\/([^/]+)(\/download|\/cancel)?$/);
      if (exportJobMatch && request.method === 'GET' && !exportJobMatch[2]) {
        const job = dependencies.exportJobs.getJob(decodeURIComponent(exportJobMatch[1] ?? ''));
        if (!job) {
          return sendJsonError('ENTRY_NOT_FOUND', '导出任务不存在或已被清理');
        }
        return sendJsonSuccess(job);
      }

      if (exportJobMatch && request.method === 'GET' && exportJobMatch[2] === '/download') {
        const download = dependencies.exportJobs.getDownload(decodeURIComponent(exportJobMatch[1] ?? ''));
        if (!download) {
          return sendJsonError('ENTRY_NOT_FOUND', '导出结果不存在或尚未完成');
        }
        return sendBinaryDownload(download.data, download.mimeType, download.fileName);
      }

      if (exportJobMatch && request.method === 'POST' && exportJobMatch[2] === '/cancel') {
        const cancelled = dependencies.exportJobs.cancelJob(decodeURIComponent(exportJobMatch[1] ?? ''));
        if (!cancelled) {
          return sendJsonError('ENTRY_NOT_FOUND', '导出任务不存在或已被清理');
        }
        return sendJsonSuccess({ cancelled: true });
      }

      if (url.pathname === '/api/export/jobs' && request.method === 'POST') {
        const payloadResult = parseJson<CreateExportJobRequestDto>(request.body);
        if (!payloadResult.ok) {
          return sendJsonError('INVALID_REQUEST', '请求体不是合法的 JSON');
        }

        const payload = payloadResult.data;
        const exportWorkspace = dependencies.getWorkspaceById(payload.workspace ?? '');
        if (!exportWorkspace) {
          return sendJsonError('WORKSPACE_NOT_FOUND', '指定的 workspace 不存在或已失效');
        }
        if (payload.format !== 'archive' && payload.format !== 'disguised-image') {
          return sendJsonError('INVALID_REQUEST', '导出格式无效');
        }
        if (!Array.isArray(payload.paths) || payload.paths.length === 0 || !payload.paths.every((path) => typeof path === 'string' && path !== '')) {
          return sendJsonError('INVALID_REQUEST', '至少选择一个要导出的项目');
        }

        let exportPaths: string[];
        try {
          exportPaths = collectExportPathsFromPayload(payload.paths);
          resolveExportEntries(dependencies.resolveWorkspacePath, exportWorkspace.uri, exportPaths);
        } catch (error) {
          if (error instanceof Error && error.message === 'PATH_FORBIDDEN') {
            return sendJsonError('PATH_FORBIDDEN', '请求的路径超出了 workspace 范围');
          }

          return sendJsonError('PATH_FORBIDDEN', '请求的路径超出了 workspace 范围');
        }

        return sendJsonSuccess(dependencies.exportJobs.startJob({
          workspaceUri: exportWorkspace.uri,
          paths: exportPaths,
          format: payload.format
        }));
      }

      const jsonResult = request.headers['content-type']?.includes('application/json')
        ? parseJson<Record<string, string>>(request.body)
        : { ok: true as const, data: {} as Record<string, string> };

      if (!jsonResult.ok) {
        return sendJsonError('INVALID_REQUEST', '请求体不是合法的 JSON');
      }

      const jsonPayload: Record<string, string> = jsonResult.data;

      if (url.pathname === '/api/settings/disguised-image' && request.method === 'PUT') {
        if (jsonPayload.selectedSource !== 'template' && jsonPayload.selectedSource !== 'custom') {
          return sendJsonError('INVALID_REQUEST', '伪装图片来源无效');
        }

        if (typeof jsonPayload.selectedTemplateId !== 'string') {
          return sendJsonError('INVALID_REQUEST', '伪装图片模板无效');
        }

        const customImageDataUrl = typeof jsonPayload.customImageDataUrl === 'string' && jsonPayload.customImageDataUrl.length > 0
          ? jsonPayload.customImageDataUrl
          : null;
        await dependencies.saveDisguiseImageSettings({
          selectedSource: jsonPayload.selectedSource,
          selectedTemplateId: jsonPayload.selectedTemplateId,
          customImageDataUrl
        });
        return sendJsonSuccess({ saved: true });
      }

      if (url.pathname === '/api/new-file' && request.method === 'POST') {
        const targetWorkspace = dependencies.getWorkspaceById(jsonPayload.workspace ?? '');

        if (!targetWorkspace) {
          return sendJsonError('WORKSPACE_NOT_FOUND', '指定的 workspace 不存在或已失效');
        }

        const targetUri = dependencies.resolveWorkspacePath(targetWorkspace.uri, jsonPayload.path ?? '');
        await dependencies.fileService.writeFileBytes(targetUri, new Uint8Array());
        return sendJsonSuccess({ created: true });
      }

      if (url.pathname === '/api/copy' && request.method === 'POST' && jsonPayload.fromWorkspace && jsonPayload.toWorkspace) {
        const sourceWorkspace = dependencies.getWorkspaceById(jsonPayload.fromWorkspace);
        const targetWorkspace = dependencies.getWorkspaceById(jsonPayload.toWorkspace);

        if (!sourceWorkspace || !targetWorkspace) {
          return sendJsonError('WORKSPACE_NOT_FOUND', '指定的 workspace 不存在或已失效');
        }

        const fromUri = dependencies.resolveWorkspacePath(sourceWorkspace.uri, jsonPayload.fromPath ?? '');
        const toUri = dependencies.resolveWorkspacePath(targetWorkspace.uri, jsonPayload.toPath ?? '');
        await dependencies.fileService.copyEntry(fromUri, toUri);
        return sendJsonSuccess({ copied: true });
      }

      if (url.pathname === '/api/move' && request.method === 'POST') {
        const sourceWorkspace = dependencies.getWorkspaceById(jsonPayload.fromWorkspace ?? '');
        const targetWorkspace = dependencies.getWorkspaceById(jsonPayload.toWorkspace ?? '');

        if (!sourceWorkspace || !targetWorkspace) {
          return sendJsonError('WORKSPACE_NOT_FOUND', '指定的 workspace 不存在或已失效');
        }

        const fromUri = dependencies.resolveWorkspacePath(sourceWorkspace.uri, jsonPayload.fromPath ?? '');
        const toUri = dependencies.resolveWorkspacePath(targetWorkspace.uri, jsonPayload.toPath ?? '');

        if (sourceWorkspace.id === targetWorkspace.id) {
          await dependencies.fileService.renameEntry(fromUri, toUri);
        } else {
          await dependencies.fileService.copyEntry(fromUri, toUri);
          await dependencies.fileService.deleteEntry(fromUri);
        }

        return sendJsonSuccess({ moved: true });
      }

      const workspaceId = url.searchParams.get('workspace') ?? jsonPayload.workspace ?? '';
      const relativePath = url.searchParams.get('path') ?? jsonPayload.path ?? '';
      const workspace = dependencies.getWorkspaceById(workspaceId);

      if (!workspace) {
        return sendJsonError('WORKSPACE_NOT_FOUND', '指定的 workspace 不存在或已失效');
      }

      let resolvedPath: string;
      try {
        resolvedPath = dependencies.resolveWorkspacePath(workspace.uri, relativePath);
      } catch (error) {
        if (error instanceof Error && error.message === 'PATH_FORBIDDEN') {
          return sendJsonError('PATH_FORBIDDEN', '请求的路径超出了 workspace 范围');
        }

        return sendJsonError('PATH_FORBIDDEN', '请求的路径超出了 workspace 范围');
      }

      if (url.pathname === '/api/export/archive' && request.method === 'GET') {
        const exportPaths = collectExportPaths(url);

        if (exportPaths.length === 0) {
          return sendJsonError('INVALID_REQUEST', '至少选择一个要导出的项目');
        }

        let exportEntries: Array<{ uri: string; path: string }>;
        try {
          exportEntries = resolveExportEntries(dependencies.resolveWorkspacePath, workspace.uri, exportPaths);
        } catch (error) {
          if (error instanceof Error && error.message === 'PATH_FORBIDDEN') {
            return sendJsonError('PATH_FORBIDDEN', '请求的路径超出了 workspace 范围');
          }

          return sendJsonError('PATH_FORBIDDEN', '请求的路径超出了 workspace 范围');
        }

        const archive = await dependencies.fileService.exportArchive(exportEntries);
        return sendBinaryDownload(archive.data, archive.mimeType, archive.fileName);
      }

      if (url.pathname === '/api/export/disguised-image' && request.method === 'GET') {
        const exportPaths = collectExportPaths(url);

        if (exportPaths.length === 0) {
          return sendJsonError('INVALID_REQUEST', '至少选择一个要导出的项目');
        }

        const settings = await dependencies.getDisguiseImageSettings();
        const activeImage = settings.selectedSource === 'custom'
          ? settings.customImageDataUrl
          : settings.templates.find((template) => template.id === settings.selectedTemplateId)?.dataUrl
          ?? settings.templates[0]?.dataUrl;

        if (!activeImage) {
          return sendJsonError('INVALID_REQUEST', '缺少可用的伪装图片模板');
        }

        let exportEntries: Array<{ uri: string; path: string }>;
        try {
          exportEntries = resolveExportEntries(dependencies.resolveWorkspacePath, workspace.uri, exportPaths);
        } catch (error) {
          if (error instanceof Error && error.message === 'PATH_FORBIDDEN') {
            return sendJsonError('PATH_FORBIDDEN', '请求的路径超出了 workspace 范围');
          }

          return sendJsonError('PATH_FORBIDDEN', '请求的路径超出了 workspace 范围');
        }

        const archive = await dependencies.fileService.exportDisguisedImage(exportEntries, activeImage);
        return sendBinaryDownload(archive.data, archive.mimeType, archive.fileName);
      }

      if (url.pathname === '/api/tree' && request.method === 'GET') {
        const items = await dependencies.fileService.listDirectory(resolvedPath, relativePath);

        return sendJsonSuccess({
          workspace: workspace.id,
          path: relativePath,
          items
        });
      }

      if (url.pathname === '/api/file' && request.method === 'GET') {
        const file = await dependencies.fileService.readTextFile(resolvedPath, relativePath);
        return sendJsonSuccess(file);
      }

      if (url.pathname === '/api/file' && request.method === 'PUT') {
        const payloadResult = parseJson<{ content?: string }>(request.body);

        if (!payloadResult.ok) {
          return sendJsonError('INVALID_REQUEST', '请求体不是合法的 JSON');
        }

        const payload = payloadResult.data;

        if (typeof payload.content !== 'string') {
          return sendJsonError('INVALID_REQUEST', '写入内容格式无效');
        }

        await dependencies.fileService.writeTextFile(resolvedPath, payload.content);
        return sendJsonSuccess({ saved: true });
      }

      if (url.pathname === '/api/file' && request.method === 'DELETE') {
        await dependencies.fileService.deleteEntry(resolvedPath);
        return sendJsonSuccess({ deleted: true });
      }

      if (url.pathname === '/api/mkdir' && request.method === 'POST') {
        await dependencies.fileService.createDirectory(resolvedPath);
        return sendJsonSuccess({ created: true });
      }

      if (url.pathname === '/api/rename' && request.method === 'POST') {
        const fromPath = jsonPayload.fromPath ?? '';
        const toPath = jsonPayload.toPath ?? '';

        const fromUri = dependencies.resolveWorkspacePath(workspace.uri, fromPath);
        const toUri = dependencies.resolveWorkspacePath(workspace.uri, toPath);

        await dependencies.fileService.renameEntry(fromUri, toUri);
        return sendJsonSuccess({ renamed: true });
      }

      if (url.pathname === '/api/copy' && request.method === 'POST') {
        const fromPath = jsonPayload.fromPath ?? '';
        const toPath = jsonPayload.toPath ?? '';

        const fromUri = dependencies.resolveWorkspacePath(workspace.uri, fromPath);
        const toUri = dependencies.resolveWorkspacePath(workspace.uri, toPath);

        await dependencies.fileService.copyEntry(fromUri, toUri);
        return sendJsonSuccess({ copied: true });
      }

      if (url.pathname === '/api/download' && request.method === 'GET') {
        const download = await dependencies.fileService.readBinaryFile(resolvedPath, relativePath);
        return sendBinaryDownload(download.data, download.mimeType, download.fileName);
      }

      return sendNotFound();
    }
  };
}

function parseJson<T>(body: Uint8Array): { ok: true; data: T } | { ok: false } {
  if (body.byteLength === 0) {
    return {
      ok: true,
      data: {} as T
    };
  }

  try {
    return {
      ok: true,
      data: JSON.parse(new TextDecoder().decode(body)) as T
    };
  } catch {
    return { ok: false };
  }
}

function parseMultipart(body: Uint8Array, contentType: string): {
  fields: Record<string, string>;
  file: {
    name: string;
    content: Uint8Array;
  };
} {
  const boundaryMatch = contentType.match(/boundary=(.+)$/);

  if (!boundaryMatch) {
    return {
      fields: {},
      file: {
        name: 'upload.bin',
        content: body
      }
    };
  }

  const boundary = `--${boundaryMatch[1]}`;
  const text = new TextDecoder('latin1').decode(body);
  const parts = text.split(boundary).filter((part) => part.includes('Content-Disposition'));
  const fields: Record<string, string> = {};
  let fileName = 'upload.bin';
  let fileContent = new Uint8Array();

  for (const part of parts) {
    const [rawHeaders, rawBody = ''] = part.split('\r\n\r\n');
    const nameMatch = rawHeaders.match(/name="([^"]+)"/);

    if (!nameMatch) {
      continue;
    }

    const fieldName = nameMatch[1];
    const cleanedBody = rawBody.replace(/\r\n--$/, '').replace(/\r\n$/, '');
    const fileNameMatch = rawHeaders.match(/filename="([^"]+)"/);

    if (fileNameMatch) {
      fileName = fileNameMatch[1];
      fileContent = new Uint8Array(Buffer.from(cleanedBody, 'latin1'));
      continue;
    }

    fields[fieldName] = cleanedBody;
  }

  return {
    fields,
    file: {
      name: fileName,
      content: fileContent
    }
  };
}

function appendChildPath(parentUri: string, fileName: string): string {
  return parentUri.endsWith('/') ? `${parentUri}${fileName}` : `${parentUri}/${fileName}`;
}

function collectExportPaths(url: URL) {
  return url.searchParams.getAll('path').filter((value, index, values) => value !== '' && values.indexOf(value) === index);
}

function collectExportPathsFromPayload(paths: string[]) {
  return paths.filter((value, index, values) => value !== '' && values.indexOf(value) === index);
}

function resolveExportEntries(
  resolveWorkspacePath: (workspaceUri: string, relativePath: string) => string,
  workspaceUri: string,
  exportPaths: string[]
) {
  return exportPaths.map((path) => ({
    uri: resolveWorkspacePath(workspaceUri, path),
    path
  }));
}
