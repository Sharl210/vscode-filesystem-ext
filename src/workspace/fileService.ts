import type { GatewayReadTextFileOptions } from '../executor/contracts';
import type { ExportProgressUpdate } from '../state/exportJobs';
import type { FileEntryDto, GetFileResponseDto, ReadTextFileSliceDto } from '../types/api';
import { type ArchiveEntry, createDisguisedImagePayload, createTarArchive, createZipArchive, decodeDataUrlBytes } from '../utils/archive';
import { detectMimeType } from '../utils/mime';
import { decodeTextContent, encodeUtf8 } from '../utils/text';

export type FileTypeValue = number;

interface FileStat {
  type: FileTypeValue;
  size: number;
  mtime: number;
}

export interface FileSystemAdapter {
  readDirectory(uri: string): Promise<Array<[string, FileTypeValue]>>;
  readFile(uri: string): Promise<Uint8Array>;
  writeFile(uri: string, content: Uint8Array): Promise<void>;
  stat(uri: string): Promise<FileStat>;
  delete(uri: string): Promise<void>;
  createDirectory(uri: string): Promise<void>;
  rename(fromUri: string, toUri: string): Promise<void>;
  copy(fromUri: string, toUri: string): Promise<void>;
}

interface FileService {
  listDirectory(directoryUri: string, directoryPath: string): Promise<FileEntryDto[]>;
  readTextFile(fileUri: string, relativePath: string, options?: GatewayReadTextFileOptions): Promise<GetFileResponseDto>;
  readBinaryFile(fileUri: string, relativePath: string): Promise<{ data: Uint8Array; mimeType: string; fileName: string }>;
  exportArchive(
    entries: Array<{ uri: string; path: string }>,
    options?: { onProgress?: (update: ExportProgressUpdate) => void; signal?: AbortSignal }
  ): Promise<{ data: Uint8Array; mimeType: string; fileName: string }>;
  exportDisguisedImage(
    entries: Array<{ uri: string; path: string }>,
    imageDataUrl: string,
    options?: { onProgress?: (update: ExportProgressUpdate) => void; signal?: AbortSignal }
  ): Promise<{ data: Uint8Array; mimeType: string; fileName: string }>;
  writeFileBytes(fileUri: string, content: Uint8Array): Promise<void>;
  writeTextFile(fileUri: string, content: string): Promise<void>;
  deleteEntry(targetUri: string): Promise<void>;
  createDirectory(targetUri: string): Promise<void>;
  renameEntry(fromUri: string, toUri: string): Promise<void>;
  copyEntry(fromUri: string, toUri: string): Promise<void>;
}

const MAX_INLINE_EDIT_BYTES = 2 * 1024 * 1024;

export function createFileService(adapter: FileSystemAdapter): FileService {
  return {
    async listDirectory(directoryUri, directoryPath) {
      const entries = await adapter.readDirectory(directoryUri);

      const items = await Promise.all(
        entries.map(async ([name, type]) => {
          const uri = joinFileUri(directoryUri, name);
          try {
            const stat = await adapter.stat(uri);
            const mimeType = type === 2 ? 'inode/directory' : detectMimeType(name);
            const isText = type === 2 ? false : isLikelyTextFromMetadata(mimeType, name);

            return createFileEntry(name, joinRelativePath(directoryPath, name), type, stat, mimeType, isText);
          } catch {
            return null;
          }
        })
      );

      return items
        .filter((item): item is FileEntryDto => item !== null)
        .sort((left, right) => left.name.localeCompare(right.name));
    },
    async readTextFile(fileUri, relativePath, options) {
      const stat = await adapter.stat(fileUri);
      const content = await adapter.readFile(fileUri);
      const name = getBaseName(relativePath);
      const mimeType = detectMimeType(name);
      const decoded = decodeTextContent(content, mimeType, name);
      const isText = decoded.isText;
      const file = createFileEntry(name, relativePath, 1, stat, mimeType, isText);
      const sliced = sliceTextContent(decoded.content, options);

      return {
        file,
        content: sliced.content,
        encoding: decoded.encoding,
        editable: isText && stat.size <= MAX_INLINE_EDIT_BYTES,
        slice: sliced.slice
      };
    },
    async readBinaryFile(fileUri, relativePath) {
      const name = getBaseName(relativePath);

      return {
        data: await adapter.readFile(fileUri),
        mimeType: detectMimeType(name),
        fileName: name
      };
    },
    async exportArchive(entries, options) {
      options?.onProgress?.({ progress: 10, message: '正在收集文件', stage: 'collecting' });
      const archiveEntries = await collectArchiveEntries(adapter, entries, options);
      const archiveName = `${deriveArchiveBaseName(entries)}.tar`;
      throwIfAborted(options?.signal);
      options?.onProgress?.({ progress: 76, message: '正在准备打包归档', stage: 'packaging' });

      return {
        data: createTarArchive(archiveEntries, {
          onEntry(update) {
            options?.onProgress?.({
              progress: calculateStageProgress(76, 94, update.processedBytes, update.totalBytes),
              message: `正在打包 ${update.path.replace(/\/$/, '') || '/'}`,
              stage: 'packaging'
            });
          }
        }),
        mimeType: 'application/x-tar',
        fileName: archiveName
      };
    },
    async exportDisguisedImage(entries, imageDataUrl, options) {
      options?.onProgress?.({ progress: 10, message: '正在收集文件', stage: 'collecting' });
      const archiveEntries = await collectArchiveEntries(adapter, entries, options);
      const archiveBaseName = deriveArchiveBaseName(entries);
      throwIfAborted(options?.signal);
      options?.onProgress?.({ progress: 72, message: '正在准备打包归档', stage: 'packaging' });
      const archiveData = createZipArchive(archiveEntries, {
        onEntry(update) {
          options?.onProgress?.({
            progress: calculateStageProgress(72, 90, update.processedBytes, update.totalBytes),
            message: `正在打包 ${update.path.replace(/\/$/, '') || '/'}`,
            stage: 'packaging'
          });
        }
      });
      throwIfAborted(options?.signal);
      options?.onProgress?.({ progress: 94, message: '正在写入伪装图片封面', stage: 'disguising' });
      const disguisedImage = createDisguisedImagePayload(archiveData, decodeDataUrlBytes(imageDataUrl));
      options?.onProgress?.({ progress: 98, message: '正在拼接归档内容到图片尾部', stage: 'disguising' });

      return {
        data: disguisedImage,
        mimeType: 'image/png',
        fileName: `${archiveBaseName}.png`
      };
    },
    async writeTextFile(fileUri, content) {
      await adapter.writeFile(fileUri, encodeUtf8(content));
    },
    async writeFileBytes(fileUri, content) {
      await adapter.writeFile(fileUri, content);
    },
    async deleteEntry(targetUri) {
      await adapter.delete(targetUri);
    },
    async createDirectory(targetUri) {
      await adapter.createDirectory(targetUri);
    },
    async renameEntry(fromUri, toUri) {
      await adapter.rename(fromUri, toUri);
    },
    async copyEntry(fromUri, toUri) {
      await adapter.copy(fromUri, toUri);
    }
  };
}

const DIRECTORY = 2;

async function collectArchiveEntries(
  adapter: FileSystemAdapter,
  entries: Array<{ uri: string; path: string }>,
  options?: { onProgress?: (update: ExportProgressUpdate) => void; signal?: AbortSignal }
) {
  const archiveEntries: ArchiveEntry[] = [];
  let visitedCount = 0;

  for (const entry of entries) {
    throwIfAborted(options?.signal);
    const stat = await adapter.stat(entry.uri);
    await collectArchiveEntry(
      adapter,
      entry.uri,
      entry.path,
      stat.type === DIRECTORY ? 'directory' : 'file',
      archiveEntries,
      {
        signal: options?.signal,
        onVisit(message) {
          visitedCount += 1;
          options?.onProgress?.({
            progress: Math.min(72, 12 + visitedCount * 8),
            message,
            stage: 'collecting'
          });
        }
      }
    );
  }

  return archiveEntries;
}

async function collectArchiveEntry(
  adapter: FileSystemAdapter,
  uri: string,
  relativePath: string,
  type: 'file' | 'directory',
  archiveEntries: ArchiveEntry[],
  options: { signal?: AbortSignal; onVisit(message: string): void }
) {
  throwIfAborted(options.signal);
  const stat = await adapter.stat(uri);
  options.onVisit(`正在处理 ${relativePath || '/'}`);

  if (type === 'directory') {
    archiveEntries.push({
      path: relativePath,
      type: 'directory',
      mtime: stat.mtime
    });

    const children = await adapter.readDirectory(uri);
    for (const [name] of children.sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))) {
      throwIfAborted(options.signal);
      const childUri = joinFileUri(uri, name);
      const childPath = joinRelativePath(relativePath, name);
      const childStat = await adapter.stat(childUri);
      await collectArchiveEntry(
        adapter,
        childUri,
        childPath,
        childStat.type === DIRECTORY ? 'directory' : 'file',
        archiveEntries,
        options
      );
    }
    return;
  }

  archiveEntries.push({
    path: relativePath,
    type: 'file',
    data: await adapter.readFile(uri),
    mtime: stat.mtime
  });
}

function deriveArchiveBaseName(entries: Array<{ path: string }>) {
  if (entries.length !== 1) {
    return 'selected-items';
  }

  const name = getBaseName(entries[0]?.path ?? 'selected-items');
  const extension = getExtension(name);
  return extension ? name.slice(0, -(extension.length + 1)) : name;
}

function createFileEntry(
  name: string,
  relativePath: string,
  type: FileTypeValue,
  stat: FileStat,
  mimeType: string,
  isText: boolean
): FileEntryDto {
  return {
    name,
    path: relativePath,
    type: type === 2 ? 'directory' : 'file',
    size: stat.size,
    mtime: stat.mtime,
    mimeType,
    isText,
    downloadable: true
  };
}

function joinFileUri(parentUri: string, name: string): string {
  return parentUri.endsWith('/') ? `${parentUri}${name}` : `${parentUri}/${name}`;
}

function joinRelativePath(parentPath: string, name: string): string {
  return parentPath === '' ? name : `${parentPath}/${name}`;
}

function getBaseName(relativePath: string): string {
  const parts = relativePath.split('/');
  return parts[parts.length - 1] ?? relativePath;
}

function getExtension(name: string) {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1) : '';
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error('EXPORT_ABORTED');
  }
}

function calculateStageProgress(stageStart: number, stageEnd: number, processedBytes: number, totalBytes: number) {
  const safeTotal = Math.max(totalBytes, 1);
  const ratio = Math.max(0, Math.min(1, processedBytes / safeTotal));
  return stageStart + (stageEnd - stageStart) * ratio;
}

function sliceTextContent(content: string, options?: GatewayReadTextFileOptions): { content: string; slice?: ReadTextFileSliceDto } {
  const offset = normalizePositiveInteger(options?.offset);
  const limit = normalizePositiveInteger(options?.limit);
  const withLineNumbers = options?.withLineNumbers === true;

  if (!offset && !limit && !withLineNumbers) {
    return { content };
  }

  const lines = splitTextLines(content);
  const totalLines = lines.length;
  const startLine = Math.max(1, offset ?? 1);
  const requestedLimit = Math.max(1, limit ?? Math.max(totalLines - startLine + 1, 1));
  const startIndex = Math.min(startLine - 1, totalLines);
  const selectedLines = lines.slice(startIndex, startIndex + requestedLimit);
  const returnedLineStart = selectedLines.length > 0 ? startLine : null;
  const returnedLineEnd = selectedLines.length > 0 ? startLine + selectedLines.length - 1 : null;
  const renderedLines = withLineNumbers
    ? selectedLines.map((line, index) => `${startLine + index}: ${line}`)
    : selectedLines;

  return {
    content: renderedLines.join('\n'),
    slice: {
      offset: startLine,
      limit: requestedLimit,
      totalLines,
      returnedLineStart,
      returnedLineEnd,
      truncated: startLine > 1 || (returnedLineEnd ?? 0) < totalLines,
      withLineNumbers,
      nextOffset: returnedLineEnd !== null && returnedLineEnd < totalLines ? returnedLineEnd + 1 : null
    }
  };
}

function normalizePositiveInteger(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : undefined;
}

function splitTextLines(content: string) {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines;
}

function isLikelyTextFromMetadata(mimeType: string, fileName: string) {
  if (mimeType.startsWith('text/')) {
    return true;
  }

  if (mimeType === 'application/json' || mimeType === 'application/xml' || mimeType === 'image/svg+xml') {
    return true;
  }

  const lowerFileName = fileName.toLowerCase();
  return ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.css', '.html', '.xml', '.yaml', '.yml', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.sh'].some((extension) => lowerFileName.endsWith(extension));
}
