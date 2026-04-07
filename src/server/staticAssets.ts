import { readFileSync } from 'node:fs';
import path from 'node:path';

const STATIC_CONTENT_TYPE = new Map<string, string>([
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8']
]);

export function createStaticAssets(extensionPath: string) {
  const webRoot = path.join(extensionPath, 'dist', 'webui');

  return {
    getIndexHtml() {
      return readFileSync(path.join(webRoot, 'index.html'), 'utf8');
    },
    getStaticAsset(pathname: string) {
      const relativePath = pathname.replace(/^\//, '');
      const fullPath = path.join(webRoot, relativePath);

      try {
        return {
          body: new Uint8Array(readFileSync(fullPath)),
          contentType: STATIC_CONTENT_TYPE.get(path.extname(fullPath)) ?? 'application/octet-stream'
        };
      } catch {
        return undefined;
      }
    }
  };
}
