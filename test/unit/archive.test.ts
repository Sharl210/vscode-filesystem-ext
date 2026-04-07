import { describe, expect, it } from 'vitest';
import { createDisguisedImagePayload, createTarArchive } from '../../src/utils/archive';

describe('archive utilities', () => {
  it('creates an uncompressed tar archive for selected files', () => {
    const tar = createTarArchive([
      {
        path: 'docs/readme.txt',
        type: 'file',
        data: new TextEncoder().encode('hello tar'),
        mtime: 1710000000
      }
    ]);

    const text = new TextDecoder('latin1').decode(tar);

    expect(text).toContain('docs/readme.txt');
    expect(text).toContain('hello tar');
    expect(tar.byteLength % 512).toBe(0);
  });

  it('wraps a zip payload into a png polyglot that still exposes a direct archive payload', () => {
    const zip = new Uint8Array(Buffer.from('PK\x03\x04demo-zip', 'latin1'));

    const payload = createDisguisedImagePayload(zip);
    const text = new TextDecoder('latin1').decode(payload);

    expect(Array.from(payload.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(text).not.toContain('.tar');
    expect(text).toContain('PK');
  });

  it('keeps unicode file names intact inside the tar header', () => {
    const tar = createTarArchive([
      {
        path: '中文.txt',
        type: 'file',
        data: new TextEncoder().encode('hello'),
        mtime: 1710000000
      }
    ]);

    const entryName = new TextDecoder().decode(tar.slice(0, 100)).replace(/\0+$/, '');

    expect(entryName).toBe('中文.txt');
  });
});
