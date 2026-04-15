import type { ExportProgressUpdate } from '../state/exportJobs';
import type {
  ConnectionInfoDto,
  ExportJobSnapshotDto,
  FileEntryDto,
  GetFileResponseDto,
  InitialLocationDto,
  TerminalExecutionOutputDto,
  TerminalExecutionSnapshotDto,
  TerminalPoolSnapshotDto,
  TerminalTabContentDto,
  TerminalTabSnapshotDto,
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

export interface GatewayReadTextFileOptions {
  offset?: number;
  limit?: number;
  withLineNumbers?: boolean;
}

export interface GatewayFileReadExecutor {
  listDirectory(directoryUri: string, directoryPath: string): Promise<FileEntryDto[]>;
  readTextFile(fileUri: string, relativePath: string, options?: GatewayReadTextFileOptions): Promise<GetFileResponseDto>;
  readBinaryFile(fileUri: string, relativePath: string): Promise<GatewayBinaryPayload>;
}

export interface GatewayReadContextExecutor {
  getWorkspaces(): WorkspaceItemDto[];
  getInitialLocation(): InitialLocationDto | null;
  getConnectionInfo(): ConnectionInfoDto;
  getActiveEditor(): GatewayEditorSnapshot | null;
  listOpenDocuments(): { items: GatewayOpenDocumentItem[] };
  findFiles(input: { workspaceUri: string; includePattern: string; maxResults?: number }): Promise<Array<{ uri: string; path: string }>>;
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

export interface GatewayPositionInput {
  uri: string;
  line: number;
  character: number;
}

export interface GatewayLanguageRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface GatewayLanguageLocation {
  uri: string;
  path: string;
  range: GatewayLanguageRange;
}

export interface GatewayDiagnosticItem extends GatewayLanguageLocation {
  severity: 'error' | 'warning' | 'information' | 'hint';
  message: string;
  source: string | null;
  code: string | null;
}

export interface GatewayDocumentSymbolItem {
  name: string;
  kind: string;
  path: string;
  range: GatewayLanguageRange;
  selectionRange: GatewayLanguageRange;
  children?: GatewayDocumentSymbolItem[];
}

export interface GatewayWorkspaceSymbolItem {
  name: string;
  kind: string;
  path: string;
  containerName: string | null;
  range: GatewayLanguageRange;
}

export interface GatewayHoverItem {
  path: string;
  range: GatewayLanguageRange;
  contents: string;
}

export interface GatewayCodeActionItem {
  title: string;
  kind: string | null;
  disabledReason: string | null;
}

export interface GatewayRenamePreparation {
  range: GatewayLanguageRange;
  placeholder: string | null;
}

export interface GatewayRenameTextEdit {
  range: GatewayLanguageRange;
  newText: string;
}

export interface GatewayRenameChange {
  path: string;
  edits: GatewayRenameTextEdit[];
}

export interface GatewayLanguageExecutor {
  getDiagnostics(input: { uri?: string }): Promise<{ items: GatewayDiagnosticItem[] }>;
  getDefinition(input: GatewayPositionInput): Promise<{ items: GatewayLanguageLocation[] }>;
  findReferences(input: GatewayPositionInput): Promise<{ items: GatewayLanguageLocation[] }>;
  getDocumentSymbols(input: { uri: string }): Promise<{ items: GatewayDocumentSymbolItem[] }>;
  getWorkspaceSymbols(input: { query: string }): Promise<{ items: GatewayWorkspaceSymbolItem[] }>;
  getHover(input: GatewayPositionInput): Promise<{ items: GatewayHoverItem[] }>;
  getCodeActions(input: GatewayPositionInput): Promise<{ items: GatewayCodeActionItem[] }>;
  prepareRename(input: GatewayPositionInput): Promise<GatewayRenamePreparation | null>;
  getRenameEdits(input: GatewayPositionInput & { newName: string }): Promise<{ changes: GatewayRenameChange[] }>;
  getFormatEdits(input: { uri: string }): Promise<{ changes: GatewayRenameChange[] }>;
}

export interface GatewayEditorSnapshot {
  uri: string;
  path: string;
  languageId: string;
  version: number;
  isDirty: boolean;
  lineCount: number;
  selections: GatewayLanguageRange[];
}

export interface GatewayOpenDocumentItem {
  uri: string;
  path: string;
  languageId: string;
  version: number;
  isDirty: boolean;
  lineCount: number;
}

export interface GatewayTerminalExecutionResult {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  combinedOutput: string;
  exitCode: number | null;
  timedOut: boolean;
}

export interface GatewayTerminalExecutor {
  execute(input: {
    command: string;
    cwd: string;
    timeoutMs?: number;
    env?: Record<string, string>;
    signal?: AbortSignal;
  }): Promise<GatewayTerminalExecutionResult>;
}

export interface GatewayTerminalManager {
  listTabs(): TerminalPoolSnapshotDto;
  getTabContent(tabId: string): TerminalTabContentDto;
  newTab(input?: { title?: string; cwd?: string }): Promise<TerminalTabSnapshotDto>;
  closeTab(tabId: string, input: { initiatedBy: string }): Promise<TerminalPoolSnapshotDto>;
  execute(input: {
    command: string;
    cwd?: string;
    tabId?: string;
    timeoutMs?: number;
    env?: Record<string, string>;
    mode?: 'auto' | 'compatibility';
    shellIntegrationWaitMs?: number;
  }): Promise<GatewayTerminalExecutionResult & { tabId: string }>;
  startExecution(input: {
    command: string;
    cwd?: string;
    tabId?: string;
    timeoutMs?: number;
    env?: Record<string, string>;
    mode?: 'auto' | 'compatibility';
    shellIntegrationWaitMs?: number;
  }): Promise<TerminalExecutionSnapshotDto>;
  getExecution(executionId: string): TerminalExecutionSnapshotDto | null;
  getExecutionOutput(executionId: string): TerminalExecutionOutputDto | null;
  cancelExecution(executionId: string): boolean;
}

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
  readonly language: GatewayLanguageExecutor;
  readonly terminal: GatewayTerminalManager;
}
