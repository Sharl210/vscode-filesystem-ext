export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'WORKSPACE_NOT_FOUND'
  | 'PATH_FORBIDDEN'
  | 'ENTRY_NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'READ_ONLY_FILESYSTEM'
  | 'FILE_TOO_LARGE'
  | 'WORKSPACE_STALE'
  | 'INTERNAL_ERROR';

export interface ApiErrorResponse {
  ok: false;
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

export interface WorkspaceItemDto {
  id: string;
  name: string;
  uri: string;
  source: 'local' | 'workspace' | 'remote';
}

export interface ConnectionInfoDto {
  kind: 'local' | 'remote';
  label: string;
  host: string;
  remoteName: string | null;
  authority: string | null;
}

export interface InitialLocationDto {
  rootId: string;
  path: string;
  activeFilePath: string | null;
  expandedPaths: string[];
}

export interface WorkspacesResponseDto {
  accessToken: string;
  initialLocation: InitialLocationDto | null;
  items: WorkspaceItemDto[];
  connection: ConnectionInfoDto;
}

export interface FileEntryDto {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  mtime: number;
  mimeType: string;
  isText: boolean;
  downloadable: boolean;
}

export interface GetFileResponseDto {
  file: FileEntryDto;
  content?: string;
  encoding?: string;
  editable: boolean;
}

export type TerminalTabStatusDto = 'idle' | 'running';

export interface TerminalTabSnapshotDto {
  tabId: string;
  title: string;
  cwd: string;
  status: TerminalTabStatusDto;
  isDefault: boolean;
  lastActiveAt: string;
  recentCommands: string[];
}

export interface TerminalPoolSnapshotDto {
  tabs: TerminalTabSnapshotDto[];
  defaultTabId: string | null;
}

export interface TerminalTabContentDto {
  tabId: string;
  title: string;
  status: TerminalTabStatusDto;
  content: string;
  recentCommands: string[];
  historyVersion: number;
}

export type TerminalExecutionStatusDto = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TerminalExecutionSnapshotDto {
  executionId: string;
  tabId: string;
  command: string;
  cwd: string;
  status: TerminalExecutionStatusDto;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  timedOut: boolean;
  error: string | null;
}

export interface TerminalExecutionOutputDto {
  executionId: string;
  tabId: string;
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  combinedOutput: string;
  exitCode: number | null;
  timedOut: boolean;
  finishedAt: string | null;
}

export interface CreateDirectoryRequestDto {
  workspace: string;
  path: string;
}

export interface RenameEntryRequestDto {
  workspace: string;
  fromPath: string;
  toPath: string;
}

export interface CopyEntryRequestDto {
  workspace: string;
  fromPath: string;
  toPath: string;
}

export interface NewFileRequestDto {
  workspace: string;
  path: string;
}

export interface CrossRootCopyRequestDto {
  fromWorkspace: string;
  fromPath: string;
  toWorkspace: string;
  toPath: string;
}

export interface MoveEntryRequestDto {
  fromWorkspace: string;
  fromPath: string;
  toWorkspace: string;
  toPath: string;
}

export interface DisguiseImageTemplateDto {
  id: string;
  label: string;
  dataUrl: string;
}

export interface DisguiseImageSettingsDto {
  templates: DisguiseImageTemplateDto[];
  selectedSource: 'template' | 'custom';
  selectedTemplateId: string;
  customImageDataUrl: string | null;
}

export type ExportJobFormatDto = 'archive' | 'disguised-image';

export type ExportJobStatusDto = 'queued' | 'running' | 'completed' | 'failed';

export type ExportJobStageDto = 'preparing' | 'collecting' | 'packaging' | 'disguising' | 'downloading' | 'completed' | 'failed';

export interface ExportJobSnapshotDto {
  jobId: string;
  status: ExportJobStatusDto;
  format: ExportJobFormatDto;
  progress: number;
  stage: ExportJobStageDto;
  currentMessage: string;
  messages: string[];
  fileName: string | null;
  error: string | null;
}

export interface CreateExportJobRequestDto {
  workspace: string;
  format: ExportJobFormatDto;
  paths: string[];
}
