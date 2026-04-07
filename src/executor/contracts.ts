import type { ExportProgressUpdate } from '../state/exportJobs';
import type {
  ConnectionInfoDto,
  ExportJobSnapshotDto,
  FileEntryDto,
  GetFileResponseDto,
  InitialLocationDto,
  WorkspaceItemDto
} from '../types/api';

export interface GatewayBinaryPayload {
  data: Uint8Array;
  mimeType: string;
  fileName: string;
}

export interface GatewayExportOptions {
  onProgress?: (update: ExportProgressUpdate) => void;
  signal?: AbortSignal;
}

export interface GatewayFileReadExecutor {
  listDirectory(directoryUri: string, directoryPath: string): Promise<FileEntryDto[]>;
  readTextFile(fileUri: string, relativePath: string): Promise<GetFileResponseDto>;
  readBinaryFile(fileUri: string, relativePath: string): Promise<GatewayBinaryPayload>;
}

export interface GatewayReadContextExecutor {
  getWorkspaces(): WorkspaceItemDto[];
  getInitialLocation(): InitialLocationDto | null;
  getConnectionInfo(): ConnectionInfoDto;
  getWorkspaceById(id: string): WorkspaceItemDto | undefined;
  resolveWorkspacePath(workspaceUri: string, relativePath: string): string;
}

export interface GatewayFileMutationExecutor {
  uploadFile(fileUri: string, content: Uint8Array): Promise<void>;
  createFile(fileUri: string): Promise<void>;
  writeFileBytes(fileUri: string, content: Uint8Array): Promise<void>;
  writeTextFile(fileUri: string, content: string): Promise<void>;
  deleteEntry(targetUri: string): Promise<void>;
  createDirectory(targetUri: string): Promise<void>;
  renameEntry(fromUri: string, toUri: string): Promise<void>;
  copyEntry(fromUri: string, toUri: string): Promise<void>;
  moveEntry(fromUri: string, toUri: string): Promise<void>;
}

export interface GatewayFileExportExecutor {
  exportArchive(
    entries: Array<{ uri: string; path: string }>,
    options?: GatewayExportOptions
  ): Promise<GatewayBinaryPayload>;
  exportDisguisedImage(
    entries: Array<{ uri: string; path: string }>,
    imageDataUrl: string,
    options?: GatewayExportOptions
  ): Promise<GatewayBinaryPayload>;
}

export interface GatewayFileExecutor extends GatewayFileReadExecutor, GatewayFileMutationExecutor, GatewayFileExportExecutor {}

export interface GatewayExportJobController {
  startJob(input: { workspaceUri: string; paths: string[]; format: 'archive' | 'disguised-image' }): ExportJobSnapshotDto;
  getJob(jobId: string): ExportJobSnapshotDto | null;
  getDownload(jobId: string): GatewayBinaryPayload | null;
  consumeDownload(jobId: string): GatewayBinaryPayload | null;
  cancelJob(jobId: string): boolean;
}

export interface GatewayExecutor {
  readonly reads: GatewayReadContextExecutor;
  readonly files: GatewayFileExecutor;
  readonly exports: GatewayExportJobController;
}
