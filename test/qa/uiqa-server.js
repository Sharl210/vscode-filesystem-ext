const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const dist = path.join(process.cwd(), 'dist', 'webui');
const roots = [
  { id: 'workspace-root', name: '工作区 · workspace-smoke', uri: 'file:///fixture/workspace-smoke', source: 'workspace' },
  { id: 'local-root', name: '本机根目录', uri: 'file:///', source: 'local' }
];

const directories = new Map();
const files = new Map();

directories.set('workspace-root:', [
  {
    name: 'sample.txt',
    path: 'sample.txt',
    type: 'file',
    size: 18,
    mtime: Date.now(),
    mimeType: 'text/plain',
    isText: true,
    downloadable: true
  }
]);

files.set('workspace-root:sample.txt', {
  content: 'hello from fixture',
  mime: 'text/plain',
  editable: true
});

function list(rootId, relativePath) {
  return directories.get(`${rootId}:${relativePath}`) ?? [];
}

function putList(rootId, relativePath, entries) {
  directories.set(`${rootId}:${relativePath}`, entries);
}

function ensureDirectory(rootId, relativePath) {
  if (!directories.has(`${rootId}:${relativePath}`)) {
    directories.set(`${rootId}:${relativePath}`, []);
  }
}

function getBaseName(value) {
  return value.split('/').filter(Boolean).pop() ?? value;
}

function getParent(value) {
  const segments = value.split('/').filter(Boolean);
  segments.pop();
  return segments.join('/');
}

function upsertEntry(rootId, relativePath, type, mimeType = 'text/plain', content = '') {
  const parent = getParent(relativePath);
  ensureDirectory(rootId, parent);
  const current = list(rootId, parent).filter((entry) => entry.name !== getBaseName(relativePath));
  const entry = {
    name: getBaseName(relativePath),
    path: relativePath,
    type,
    size: type === 'file' ? content.length : 0,
    mtime: Date.now(),
    mimeType: type === 'directory' ? 'inode/directory' : mimeType,
    isText: type === 'file' && mimeType.startsWith('text/'),
    downloadable: true
  };

  current.push(entry);
  current.sort((left, right) => left.name.localeCompare(right.name));
  putList(rootId, parent, current);

  if (type === 'directory') {
    ensureDirectory(rootId, relativePath);
    return;
  }

  files.set(`${rootId}:${relativePath}`, {
    content,
    mime: mimeType,
    editable: mimeType.startsWith('text/')
  });
}

function removeEntry(rootId, relativePath) {
  const parent = getParent(relativePath);
  putList(
    rootId,
    parent,
    list(rootId, parent).filter((entry) => entry.path !== relativePath)
  );
  directories.delete(`${rootId}:${relativePath}`);
  files.delete(`${rootId}:${relativePath}`);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:19197');

  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(fs.readFileSync(path.join(dist, 'index.html')));
    return;
  }

  if (url.pathname === '/app.css') {
    response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
    response.end(fs.readFileSync(path.join(dist, 'app.css')));
    return;
  }

  if (url.pathname === '/app.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    response.end(fs.readFileSync(path.join(dist, 'app.js')));
    return;
  }

  if (url.pathname === '/api/workspaces') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      ok: true,
      data: {
        items: roots,
        connection: {
          kind: 'local',
          label: '本机 · qa-mock',
          host: 'qa-mock',
          remoteName: null,
          authority: null
        }
      }
    }));
    return;
  }

  if (url.pathname === '/api/tree') {
    const rootId = url.searchParams.get('workspace') ?? '';
    const relativePath = url.searchParams.get('path') ?? '';
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: true, data: { path: relativePath, items: list(rootId, relativePath) } }));
    return;
  }

  if (url.pathname === '/api/file' && request.method === 'GET') {
    const rootId = url.searchParams.get('workspace') ?? '';
    const relativePath = url.searchParams.get('path') ?? '';
    const file = files.get(`${rootId}:${relativePath}`);
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      ok: true,
      data: {
        file: {
          name: getBaseName(relativePath),
          path: relativePath,
          type: 'file',
          size: (file?.content ?? '').length,
          mtime: Date.now(),
          mimeType: file?.mime ?? 'text/plain',
          isText: true,
          downloadable: true
        },
        content: file?.content ?? '',
        editable: file?.editable ?? true
      }
    }));
    return;
  }

  if (url.pathname === '/api/file' && request.method === 'PUT') {
    const body = JSON.parse((await readBody(request)).toString('utf8') || '{}');
    const rootId = url.searchParams.get('workspace') ?? '';
    const relativePath = url.searchParams.get('path') ?? '';
    upsertEntry(rootId, relativePath, 'file', 'text/plain', body.content ?? '');
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: true, data: { saved: true } }));
    return;
  }

  if (url.pathname === '/api/file' && request.method === 'DELETE') {
    const rootId = url.searchParams.get('workspace') ?? '';
    const relativePath = url.searchParams.get('path') ?? '';
    removeEntry(rootId, relativePath);
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: true, data: { deleted: true } }));
    return;
  }

  if (url.pathname === '/api/new-file') {
    const payload = JSON.parse((await readBody(request)).toString('utf8') || '{}');
    upsertEntry(payload.workspace, payload.path, 'file', 'text/plain', '');
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: true, data: { created: true } }));
    return;
  }

  if (url.pathname === '/api/mkdir') {
    const payload = JSON.parse((await readBody(request)).toString('utf8') || '{}');
    upsertEntry(payload.workspace, payload.path, 'directory');
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: true, data: { created: true } }));
    return;
  }

  if (url.pathname === '/api/rename') {
    const payload = JSON.parse((await readBody(request)).toString('utf8') || '{}');
    const file = files.get(`${payload.workspace}:${payload.fromPath}`);
    removeEntry(payload.workspace, payload.fromPath);
    upsertEntry(payload.workspace, payload.toPath, file ? 'file' : 'directory', file?.mime ?? 'inode/directory', file?.content ?? '');
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: true, data: { renamed: true } }));
    return;
  }

  if (url.pathname === '/api/upload') {
    const body = await readBody(request);
    const text = body.toString('latin1');
    const boundary = request.headers['content-type'].match(/boundary=(.+)$/)[1];
    const parts = text.split(`--${boundary}`);
    let workspace = 'workspace-root';
    let relativePath = '';
    let fileName = 'upload.txt';
    let content = '';
    for (const part of parts) {
      if (part.includes('name="workspace"')) {
        workspace = part.split('\r\n\r\n')[1]?.replace(/\r\n--?$/, '').trim() || workspace;
      }
      if (part.includes('name="path"')) {
        relativePath = part.split('\r\n\r\n')[1]?.replace(/\r\n--?$/, '').trim() || relativePath;
      }
      if (part.includes('filename="')) {
        fileName = part.match(/filename="([^"]+)"/)?.[1] || fileName;
        content = part.split('\r\n\r\n')[1]?.replace(/\r\n--?$/, '') || '';
      }
    }
    const targetPath = relativePath ? `${relativePath}/${fileName}` : fileName;
    upsertEntry(workspace, targetPath, 'file', 'text/plain', content);
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: true, data: { uploaded: true, fileName } }));
    return;
  }

  if (url.pathname === '/api/copy') {
    const payload = JSON.parse((await readBody(request)).toString('utf8') || '{}');
    const file = files.get(`${payload.fromWorkspace}:${payload.fromPath}`);
    upsertEntry(payload.toWorkspace, payload.toPath, 'file', file?.mime ?? 'text/plain', file?.content ?? '');
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: true, data: { copied: true } }));
    return;
  }

  if (url.pathname === '/api/move') {
    const payload = JSON.parse((await readBody(request)).toString('utf8') || '{}');
    const file = files.get(`${payload.fromWorkspace}:${payload.fromPath}`);
    upsertEntry(payload.toWorkspace, payload.toPath, 'file', file?.mime ?? 'text/plain', file?.content ?? '');
    removeEntry(payload.fromWorkspace, payload.fromPath);
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: true, data: { moved: true } }));
    return;
  }

  if (url.pathname === '/api/download') {
    const rootId = url.searchParams.get('workspace') ?? '';
    const relativePath = url.searchParams.get('path') ?? '';
    const file = files.get(`${rootId}:${relativePath}`);
    response.writeHead(200, { 'content-type': file?.mime ?? 'text/plain' });
    response.end(file?.content ?? '');
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'not found' } }));
});

server.listen(19197, '127.0.0.1', () => {
  console.log('qa mutable server on 19197');
});

setInterval(() => {}, 1000);
