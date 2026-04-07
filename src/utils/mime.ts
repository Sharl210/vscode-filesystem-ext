const MIME_BY_EXTENSION = new Map<string, string>([
  ['.css', 'text/css'],
  ['.html', 'text/html'],
  ['.js', 'text/javascript'],
  ['.json', 'application/json'],
  ['.md', 'text/markdown'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ts', 'text/typescript'],
  ['.tsx', 'text/tsx'],
  ['.txt', 'text/plain']
]);

export function detectMimeType(fileName: string): string {
  const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';

  return MIME_BY_EXTENSION.get(extension.toLowerCase()) ?? 'application/octet-stream';
}
