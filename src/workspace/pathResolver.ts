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

export function resolveTerminalCwdPath(workspaceUri: string, cwdPath: string): string {
  const rootPath = normalizeWorkspaceRootPath(workspaceUri);
  const normalizedInput = cwdPath.replace(/\\/g, '/');

  if (normalizedInput === '') {
    return rootPath;
  }

  const targetPath = isAbsoluteTerminalPath(normalizedInput)
    ? normalizeTerminalPath(normalizedInput)
    : normalizeTerminalPath(joinForWorkspace(rootPath, normalizedInput));

  if (!isInsideWorkspaceRoot(rootPath, targetPath)) {
    throw new PathForbiddenError();
  }

  return targetPath;
}

function normalizeWorkspaceRootPath(workspaceUri: string): string {
  const parsed = new URL(workspaceUri);
  return normalizeTerminalPath(decodeURIComponent(parsed.pathname));
}

function normalizeTerminalPath(value: string): string {
  const normalizedSlashes = value.replace(/\\/g, '/');
  if (/^\/[a-zA-Z]:\//.test(normalizedSlashes)) {
    return path.win32.normalize(normalizedSlashes.slice(1)).replace(/\\/g, '/');
  }

  if (/^[a-zA-Z]:\//.test(normalizedSlashes)) {
    return path.win32.normalize(normalizedSlashes).replace(/\\/g, '/');
  }

  return path.posix.normalize(normalizedSlashes);
}

function isAbsoluteTerminalPath(value: string): boolean {
  return value.startsWith('/') || path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

function joinForWorkspace(rootPath: string, relativePath: string): string {
  if (/^[a-zA-Z]:\//.test(rootPath)) {
    return path.win32.join(rootPath, relativePath).replace(/\\/g, '/');
  }

  return path.posix.join(rootPath, relativePath);
}

function isInsideWorkspaceRoot(rootPath: string, targetPath: string): boolean {
  const windowsLike = /^[a-zA-Z]:\//.test(rootPath) || /^[a-zA-Z]:\//.test(targetPath);
  if (windowsLike) {
    const normalizedRoot = rootPath.toLowerCase();
    const normalizedTarget = targetPath.toLowerCase();
    return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
  }

  return targetPath === rootPath || targetPath.startsWith(`${rootPath}/`);
}
