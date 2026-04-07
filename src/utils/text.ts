const textDecoder = new TextDecoder('utf-8');
const textEncoder = new TextEncoder();

export function decodeUtf8(content: Uint8Array): string {
  return textDecoder.decode(content);
}

export function encodeUtf8(content: string): Uint8Array {
  return textEncoder.encode(content);
}

export function isProbablyText(content: Uint8Array, mimeType: string): boolean {
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
