const MIME_BY_EXTENSION = new Map<string, string>([
  ['.c', 'text/x-c'],
  ['.cc', 'text/x-c++'],
  ['.css', 'text/css'],
  ['.cpp', 'text/x-c++'],
  ['.go', 'text/x-go'],
  ['.h', 'text/x-c'],
  ['.hpp', 'text/x-c++'],
  ['.html', 'text/html'],
  ['.ini', 'text/plain'],
  ['.java', 'text/x-java-source'],
  ['.js', 'text/javascript'],
  ['.json', 'application/json'],
  ['.mdx', 'text/markdown'],
  ['.md', 'text/markdown'],
  ['.php', 'text/x-php'],
  ['.py', 'text/x-python'],
  ['.rb', 'text/x-ruby'],
  ['.rs', 'text/x-rust'],
  ['.sh', 'text/x-shellscript'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.sql', 'text/x-sql'],
  ['.ts', 'text/typescript'],
  ['.tsx', 'text/tsx'],
  ['.toml', 'application/toml'],
  ['.txt', 'text/plain'],
  ['.xml', 'application/xml'],
  ['.yaml', 'application/yaml'],
  ['.yml', 'application/yaml']
]);

export function detectMimeType(fileName: string): string {
  const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';

  return MIME_BY_EXTENSION.get(extension.toLowerCase()) ?? 'application/octet-stream';
}
