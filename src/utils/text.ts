const textDecoder = new TextDecoder('utf-8');
const utf8StrictDecoder = new TextDecoder('utf-8', { fatal: true });
const utf16leDecoder = new TextDecoder('utf-16le');
const utf16beDecoder = new TextDecoder('utf-16be');
const latin1Decoder = new TextDecoder('latin1');
const textEncoder = new TextEncoder();

const SOURCE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.go', '.h', '.hpp', '.html', '.ini', '.java', '.js', '.json', '.jsx',
  '.lua', '.m', '.md', '.php', '.pl', '.py', '.rb', '.rs', '.scss', '.sh', '.sql', '.swift', '.toml', '.ts',
  '.tsx', '.txt', '.vue', '.xml', '.yaml', '.yml'
]);

export interface DecodedTextContent {
  content: string;
  encoding: string;
  isText: boolean;
}

export function decodeUtf8(content: Uint8Array): string {
  return textDecoder.decode(content);
}

export function encodeUtf8(content: string): Uint8Array {
  return textEncoder.encode(content);
}

export function decodeTextContent(content: Uint8Array, mimeType: string, fileName: string): DecodedTextContent {
  if (content.byteLength === 0) {
    return {
      content: '',
      encoding: 'utf-8',
      isText: true
    };
  }

  if (hasUtf8Bom(content)) {
    return {
      content: decodeUtf8(content.subarray(3)),
      encoding: 'utf-8-bom',
      isText: true
    };
  }

  if (hasUtf16LeBom(content)) {
    return {
      content: utf16leDecoder.decode(content.subarray(2)),
      encoding: 'utf-16le',
      isText: true
    };
  }

  if (hasUtf16BeBom(content)) {
    return {
      content: utf16beDecoder.decode(content.subarray(2)),
      encoding: 'utf-16be',
      isText: true
    };
  }

  try {
    return {
      content: utf8StrictDecoder.decode(content),
      encoding: 'utf-8',
      isText: true
    };
  } catch {
    if (looksLikeUtf16Le(content)) {
      return {
        content: utf16leDecoder.decode(content),
        encoding: 'utf-16le',
        isText: true
      };
    }

    if (looksLikeUtf16Be(content)) {
      return {
        content: utf16beDecoder.decode(content),
        encoding: 'utf-16be',
        isText: true
      };
    }

    return {
      content: latin1Decoder.decode(content),
      encoding: 'latin1',
      isText: isProbablyText(content, mimeType, fileName)
    };
  }
}

export function isProbablyText(content: Uint8Array, mimeType: string, fileName = ''): boolean {
  if (mimeType.startsWith('text/')) {
    return true;
  }

  if (
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'image/svg+xml'
  ) {
    return true;
  }

  const lowerFileName = fileName.toLowerCase();
  for (const extension of SOURCE_EXTENSIONS) {
    if (lowerFileName.endsWith(extension)) {
      return true;
    }
  }

  const sample = content.slice(0, 512);

  for (const value of sample) {
    if (value === 0) {
      return false;
    }
  }

  let printable = 0;

  for (const value of sample) {
    if ((value >= 32 && value <= 126) || value === 9 || value === 10 || value === 13) {
      printable += 1;
    }
  }

  return sample.length === 0 ? true : printable / sample.length >= 0.85;
}

function hasUtf8Bom(content: Uint8Array): boolean {
  return content.length >= 3 && content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf;
}

function hasUtf16LeBom(content: Uint8Array): boolean {
  return content.length >= 2 && content[0] === 0xff && content[1] === 0xfe;
}

function hasUtf16BeBom(content: Uint8Array): boolean {
  return content.length >= 2 && content[0] === 0xfe && content[1] === 0xff;
}

function looksLikeUtf16Le(content: Uint8Array): boolean {
  return countZeroBytes(content, 1) >= 8 && countZeroBytes(content, 0) <= 2;
}

function looksLikeUtf16Be(content: Uint8Array): boolean {
  return countZeroBytes(content, 0) >= 8 && countZeroBytes(content, 1) <= 2;
}

function countZeroBytes(content: Uint8Array, parity: 0 | 1): number {
  let zeroCount = 0;
  const sample = content.slice(0, 128);
  for (let index = parity; index < sample.length; index += 2) {
    if (sample[index] === 0) {
      zeroCount += 1;
    }
  }

  return zeroCount;
}
