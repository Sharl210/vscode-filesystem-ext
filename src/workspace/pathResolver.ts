import path from 'node:path';

export class PathForbiddenError extends Error {
  constructor(message = 'Path escapes workspace root.') {
    super(message);
    this.name = 'PathForbiddenError';
  }
}

export function resolveWorkspacePath(workspaceUri: string, relativePath: string): string {
  const parsed = new URL(workspaceUri);
  const rootPath = decodeURIComponent(parsed.pathname);
  const normalizedPath = relativePath.replace(/\\/g, '/');

  if (normalizedPath === '') {
    return parsed.toString();
  }

  if (
    normalizedPath.startsWith('/') ||
    normalizedPath.startsWith('\\') ||
    path.posix.isAbsolute(normalizedPath) ||
    path.win32.isAbsolute(normalizedPath)
  ) {
    throw new PathForbiddenError('Absolute paths are not allowed.');
  }

  const targetPath = path.posix.normalize(path.posix.join(rootPath, normalizedPath));
  const relative = path.posix.relative(rootPath, targetPath);

  if (relative === '..' || relative.startsWith('../')) {
    throw new PathForbiddenError();
  }

  parsed.pathname = targetPath;
  return parsed.toString();
}
