import { describe, expect, it } from 'vitest';
import { createFileService, type FileSystemAdapter, type FileTypeValue } from '../../src/workspace/fileService';

const DIRECTORY: FileTypeValue = 2;
const FILE: FileTypeValue = 1;

function createAdapter(): FileSystemAdapter {
  const entries = new Map<string, { type: FileTypeValue; data?: Uint8Array; mtime: number }>([
    ['file:///workspace/demo/src', { type: DIRECTORY, mtime: 10 }],
    [
      'file:///workspace/demo/src/hello.ts',
      {
        type: FILE,
        data: new TextEncoder().encode('export const hello = true;'),
        mtime: 11
      }
    ],
    [
      'file:///workspace/demo/src/logo.png',
      {
        type: FILE,
        data: Uint8Array.from([137, 80, 78, 71, 0, 1, 2, 3]),
        mtime: 12
      }
    ],
    [
      'file:///workspace/demo/src/huge.txt',
      {
        type: FILE,
        data: new Uint8Array(2 * 1024 * 1024 + 1).fill(97),
        mtime: 13
      }
    ]
  ]);

  return {
    async readDirectory(uri) {
      if (uri !== 'file:///workspace/demo/src') {
        return [];
      }

      return [
        ['hello.ts', FILE],
        ['logo.png', FILE],
        ['huge.txt', FILE]
      ];
    },
    async readFile(uri) {
      const entry = entries.get(uri);

      if (!entry?.data) {
        throw new Error(`Missing file ${uri}`);
      }

      return entry.data;
    },
    async writeFile(uri, content) {
      entries.set(uri, { type: FILE, data: content, mtime: 20 });
    },
    async stat(uri) {
      const entry = entries.get(uri);

      if (!entry) {
        throw new Error(`Missing entry ${uri}`);
      }

      return {
        type: entry.type,
        size: entry.data?.byteLength ?? 0,
        mtime: entry.mtime
      };
    },
    async delete() {},
    async createDirectory() {},
    async rename() {},
    async copy() {}
  };
}

describe('file service', () => {
  it('lists directory entries as normalized DTOs', async () => {
    const service = createFileService(createAdapter());

    const items = await service.listDirectory('file:///workspace/demo/src', 'src');

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      name: 'hello.ts',
      path: 'src/hello.ts',
      type: 'file',
      mimeType: 'text/typescript',
      isText: true
    });
  });

  it('reads a text file as editable utf-8 content', async () => {
    const service = createFileService(createAdapter());

    const result = await service.readTextFile('file:///workspace/demo/src/hello.ts', 'src/hello.ts');

    expect(result.content).toBe('export const hello = true;');
    expect(result.editable).toBe(true);
    expect(result.encoding).toBe('utf-8');
  });

  it('returns metadata only for binary files', async () => {
    const service = createFileService(createAdapter());

    const result = await service.readTextFile('file:///workspace/demo/src/logo.png', 'src/logo.png');

    expect(result.content).toBeUndefined();
    expect(result.editable).toBe(false);
    expect(result.file.isText).toBe(false);
  });

  it('returns metadata only for oversized files', async () => {
    const service = createFileService(createAdapter());

    const result = await service.readTextFile('file:///workspace/demo/src/huge.txt', 'src/huge.txt');

    expect(result.content).toBeUndefined();
    expect(result.editable).toBe(false);
    expect(result.file.size).toBeGreaterThan(2 * 1024 * 1024);
  });

  it('writes utf-8 content through the adapter', async () => {
    const adapter = createAdapter();
    const service = createFileService(adapter);

    await service.writeTextFile('file:///workspace/demo/src/new.txt', 'hello world');

    const result = await adapter.readFile('file:///workspace/demo/src/new.txt');

    expect(new TextDecoder().decode(result)).toBe('hello world');
  });

  it('exports selected entries as an uncompressed tar archive', async () => {
    const service = createFileService(createAdapter());

    const result = await service.exportArchive([{ uri: 'file:///workspace/demo/src/hello.ts', path: 'src/hello.ts' }]);
    const content = new TextDecoder('latin1').decode(result.data);

    expect(result.fileName).toBe('hello.tar');
    expect(result.mimeType).toBe('application/x-tar');
    expect(content).toContain('src/hello.ts');
    expect(content).toContain('export const hello = true;');
  });

  it('reports granular export progress for each archived file', async () => {
    const service = createFileService(createAdapter());
    const updates: Array<{ progress: number; message: string; stage: string }> = [];

    await service.exportArchive(
      [
        { uri: 'file:///workspace/demo/src/hello.ts', path: 'src/hello.ts' },
        { uri: 'file:///workspace/demo/src/logo.png', path: 'src/logo.png' }
      ],
      {
        onProgress(update) {
          updates.push(update);
        }
      }
    );

    expect(updates.some((update) => update.message.includes('src/hello.ts'))).toBe(true);
    expect(updates.some((update) => update.message.includes('src/logo.png'))).toBe(true);
    expect(updates.some((update) => update.message.includes('正在打包'))).toBe(true);
    expect(updates[0]?.progress).toBeLessThanOrEqual(updates[updates.length - 1]?.progress ?? 0);
  });

  it('exports selected entries as a disguised png file', async () => {
    const service = createFileService(createAdapter());

    const result = await service.exportDisguisedImage(
      [{ uri: 'file:///workspace/demo/src/hello.ts', path: 'src/hello.ts' }],
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8W0AAAAASUVORK5CYII='
    );
    const content = new TextDecoder('latin1').decode(result.data);

    expect(result.fileName).toBe('hello.png');
    expect(result.mimeType).toBe('image/png');
    expect(Array.from(result.data.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(content).not.toContain('hello.tar');
    expect(content).toContain('src/hello.ts');
  });

  it('exports selected entries as a disguised png file with direct zip payload when zip mode is selected', async () => {
    const service = createFileService(createAdapter());

    const result = await service.exportDisguisedImage(
      [{ uri: 'file:///workspace/demo/src/hello.ts', path: 'src/hello.ts' }],
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8W0AAAAASUVORK5CYII='
    );
    const content = new TextDecoder('latin1').decode(result.data);

    expect(content).toContain('PK');
    expect(content).toContain('src/hello.ts');
  });

  it('skips unreadable entries instead of failing the whole directory listing', async () => {
    const adapter = createAdapter();
    const originalStat = adapter.stat;

    adapter.readDirectory = async () => [
      ['hello.ts', FILE],
      ['secret.bin', FILE]
    ];
    adapter.stat = async (uri) => {
      if (uri.endsWith('secret.bin')) {
        throw new Error('EACCES');
      }

      return originalStat(uri);
    };

    const service = createFileService(adapter);
    const items = await service.listDirectory('file:///workspace/demo/src', 'src');

    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe('hello.ts');
  });
});
