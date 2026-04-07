import { crc32 } from './crc32';
import { deflateSync } from 'node:zlib';

export interface ArchiveEntry {
  path: string;
  type: 'file' | 'directory';
  data?: Uint8Array;
  mtime: number;
}

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const DEFAULT_PNG_IMAGE = createSolidPngBytes(32, 120, 220);

export function createTarArchive(
  entries: ArchiveEntry[],
  options?: { onEntry?: (update: { path: string; processedBytes: number; totalBytes: number }) => void }
): Uint8Array {
  const chunks: Uint8Array[] = [];
  const totalBytes = entries.reduce((sum, entry) => {
    const normalizedPath = normalizeArchivePath(entry.path, entry.type);
    const size = entry.type === 'file' ? (entry.data?.byteLength ?? 0) : 0;
    return sum + 512 + size + padToBlockSize(size) + (normalizedPath.endsWith('/') ? 0 : 0);
  }, 1024);
  let processedBytes = 0;

  for (const entry of entries) {
    const normalizedPath = normalizeArchivePath(entry.path, entry.type);
    const data = entry.type === 'file' ? entry.data ?? new Uint8Array() : new Uint8Array();
    const size = entry.type === 'file' ? data.byteLength : 0;
    const padding = padToBlockSize(size);

    chunks.push(createTarHeader(normalizedPath, entry.type, size, entry.mtime));
    processedBytes += 512;

    if (entry.type === 'file') {
      chunks.push(data);
      processedBytes += data.byteLength;
      if (padding > 0) {
        chunks.push(new Uint8Array(padding));
        processedBytes += padding;
      }
    }

    options?.onEntry?.({
      path: normalizedPath,
      processedBytes,
      totalBytes
    });
  }

  chunks.push(new Uint8Array(1024));
  return concatBytes(chunks);
}

export function createZipArchive(
  entries: ArchiveEntry[],
  options?: { onEntry?: (update: { path: string; processedBytes: number; totalBytes: number }) => void }
): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const totalBytes = entries.reduce((sum, entry) => {
    const normalizedPath = normalizeArchivePath(entry.path, entry.type);
    const fileNameBytes = encodeUtf8(normalizedPath);
    const size = entry.type === 'file' ? (entry.data?.byteLength ?? 0) : 0;
    return sum + 30 + fileNameBytes.byteLength + size + 46 + fileNameBytes.byteLength;
  }, 22);
  let localOffset = 0;
  let processedBytes = 0;

  for (const entry of entries) {
    const normalizedPath = normalizeArchivePath(entry.path, entry.type);
    const fileNameBytes = encodeUtf8(normalizedPath);
    const data = entry.type === 'file' ? entry.data ?? new Uint8Array() : new Uint8Array();
    const checksum = crc32(data);
    const localHeader = new Uint8Array(30 + fileNameBytes.byteLength);
    const centralDirectory = new Uint8Array(46 + fileNameBytes.byteLength);

    writeUint32Le(localHeader, 0, 0x04034b50);
    writeUint16Le(localHeader, 4, 20);
    writeUint16Le(localHeader, 6, 0);
    writeUint16Le(localHeader, 8, 0);
    writeUint16Le(localHeader, 10, 0);
    writeUint16Le(localHeader, 12, 0);
    writeUint32Le(localHeader, 14, checksum);
    writeUint32Le(localHeader, 18, data.byteLength);
    writeUint32Le(localHeader, 22, data.byteLength);
    writeUint16Le(localHeader, 26, fileNameBytes.byteLength);
    writeUint16Le(localHeader, 28, 0);
    localHeader.set(fileNameBytes, 30);

    writeUint32Le(centralDirectory, 0, 0x02014b50);
    writeUint16Le(centralDirectory, 4, 20);
    writeUint16Le(centralDirectory, 6, 20);
    writeUint16Le(centralDirectory, 8, 0);
    writeUint16Le(centralDirectory, 10, 0);
    writeUint16Le(centralDirectory, 12, 0);
    writeUint16Le(centralDirectory, 14, 0);
    writeUint32Le(centralDirectory, 16, checksum);
    writeUint32Le(centralDirectory, 20, data.byteLength);
    writeUint32Le(centralDirectory, 24, data.byteLength);
    writeUint16Le(centralDirectory, 28, fileNameBytes.byteLength);
    writeUint16Le(centralDirectory, 30, 0);
    writeUint16Le(centralDirectory, 32, 0);
    writeUint16Le(centralDirectory, 34, 0);
    writeUint16Le(centralDirectory, 36, 0);
    writeUint32Le(centralDirectory, 38, entry.type === 'directory' ? 0x10 : 0);
    writeUint32Le(centralDirectory, 42, localOffset);
    centralDirectory.set(fileNameBytes, 46);

    localParts.push(localHeader, data);
    centralParts.push(centralDirectory);

    localOffset += localHeader.byteLength + data.byteLength;
    processedBytes += localHeader.byteLength + data.byteLength + centralDirectory.byteLength;
    options?.onEntry?.({
      path: normalizedPath,
      processedBytes,
      totalBytes
    });
  }

  const centralDirectoryBytes = concatBytes(centralParts);
  const endOfCentralDirectory = new Uint8Array(22);
  writeUint32Le(endOfCentralDirectory, 0, 0x06054b50);
  writeUint16Le(endOfCentralDirectory, 4, 0);
  writeUint16Le(endOfCentralDirectory, 6, 0);
  writeUint16Le(endOfCentralDirectory, 8, entries.length);
  writeUint16Le(endOfCentralDirectory, 10, entries.length);
  writeUint32Le(endOfCentralDirectory, 12, centralDirectoryBytes.byteLength);
  writeUint32Le(endOfCentralDirectory, 16, localOffset);
  writeUint16Le(endOfCentralDirectory, 20, 0);

  return concatBytes([...localParts, centralDirectoryBytes, endOfCentralDirectory]);
}

export function createDisguisedImagePayload(
  archiveData: Uint8Array,
  imageBytes: Uint8Array = DEFAULT_PNG_IMAGE
): Uint8Array {
  ensurePngImage(imageBytes);
  return concatBytes([imageBytes, archiveData]);
}

export function decodeDataUrlBytes(dataUrl: string): Uint8Array {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);

  if (!match) {
    throw new Error('INVALID_IMAGE_DATA');
  }

  return new Uint8Array(Buffer.from(match[2], 'base64'));
}

function ensurePngImage(imageBytes: Uint8Array) {
  if (imageBytes.byteLength < PNG_SIGNATURE.length) {
    throw new Error('INVALID_IMAGE_DATA');
  }

  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (imageBytes[index] !== PNG_SIGNATURE[index]) {
      throw new Error('INVALID_IMAGE_DATA');
    }
  }
}

function createTarHeader(path: string, type: 'file' | 'directory', size: number, mtime: number) {
  const header = new Uint8Array(512);
  const nameBytes = encodeUtf8(path);
  header.set(nameBytes.slice(0, 100), 0);

  writeOctal(header, 100, 8, type === 'directory' ? 0o755 : 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, Math.floor(mtime / 1000));
  header.fill(32, 148, 156);
  header[156] = type === 'directory' ? '5'.charCodeAt(0) : '0'.charCodeAt(0);
  header.set(encodeAscii('ustar\0'), 257);
  header.set(encodeAscii('00'), 263);

  const checksum = header.reduce((sum, value) => sum + value, 0);
  writeChecksum(header, checksum);
  return header;
}

function writeChecksum(target: Uint8Array, value: number) {
  const text = value.toString(8).padStart(6, '0');
  target.set(encodeAscii(text), 148);
  target[154] = 0;
  target[155] = 32;
}

function writeOctal(target: Uint8Array, offset: number, width: number, value: number) {
  const text = value.toString(8).padStart(width - 1, '0');
  target.set(encodeAscii(text), offset);
  target[offset + width - 1] = 0;
}

function createSolidPngBytes(red: number, green: number, blue: number) {
  return createGradientPngBytes(480, 270, [red, green, blue], [255, 255, 255]);
}

function createGradientPngBytes(width: number, height: number, startColor: [number, number, number], endColor: [number, number, number]) {
  const header = createPngChunk('IHDR', Uint8Array.from([
    (width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff,
    (height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff,
    8,
    6,
    0,
    0,
    0
  ]));
  const pixels = new Uint8Array(height * (1 + width * 4));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    pixels[offset] = 0;
    offset += 1;
    const verticalRatio = height <= 1 ? 0 : y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const horizontalRatio = width <= 1 ? 0 : x / (width - 1);
      const mixRatio = (verticalRatio * 0.7) + (horizontalRatio * 0.3);
      const noise = ((x * 17 + y * 29) % 23) - 11;
      pixels[offset] = clampColor(startColor[0] * (1 - mixRatio) + endColor[0] * mixRatio + noise);
      pixels[offset + 1] = clampColor(startColor[1] * (1 - mixRatio) + endColor[1] * mixRatio + noise);
      pixels[offset + 2] = clampColor(startColor[2] * (1 - mixRatio) + endColor[2] * mixRatio + noise);
      pixels[offset + 3] = 255;
      offset += 4;
    }
  }
  const imageData = deflateSync(pixels);
  const idat = createPngChunk('IDAT', imageData);
  const end = createPngChunk('IEND', new Uint8Array());
  return concatBytes([PNG_SIGNATURE, header, idat, end]);
}

function createPngChunk(type: string, data: Uint8Array) {
  const chunk = new Uint8Array(12 + data.byteLength);
  writeUint32Be(chunk, 0, data.byteLength);
  chunk.set(encodeUtf8(type), 4);
  chunk.set(data, 8);
  writeUint32Be(chunk, chunk.byteLength - 4, crc32(chunk.slice(4, chunk.byteLength - 4)));
  return chunk;
}

function writeUint16Le(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32Le(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function writeUint32Be(target: Uint8Array, offset: number, value: number) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function normalizeArchivePath(path: string, type: 'file' | 'directory') {
  const normalized = path.replace(/^\/+/, '').replace(/\\/g, '/');
  return type === 'directory' && !normalized.endsWith('/') ? `${normalized}/` : normalized;
}

function padToBlockSize(size: number) {
  const remainder = size % 512;
  return remainder === 0 ? 0 : 512 - remainder;
}

function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return merged;
}

function encodeAscii(value: string) {
  return new Uint8Array(Buffer.from(value, 'ascii'));
}

function encodeUtf8(value: string) {
  return new TextEncoder().encode(value);
}

function clampColor(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
