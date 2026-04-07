import type { ApiErrorCode } from '../types/api';

export interface RouterResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  jsonBody?: unknown;
}

export function sendJsonSuccess<T>(data: T, status = 200): RouterResponse {
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8'
    },
    body: encodeJson({ ok: true, data }),
    jsonBody: { ok: true, data }
  };
}

export function sendJsonError(code: ApiErrorCode, message: string): RouterResponse {
  const status = statusForErrorCode(code);
  const jsonBody = {
    ok: false,
    error: {
      code,
      message
    }
  };

  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8'
    },
    body: encodeJson(jsonBody),
    jsonBody
  };
}

export function sendBinaryDownload(data: Uint8Array, mimeType: string, fileName: string): RouterResponse {
  return {
    status: 200,
    headers: {
      'content-length': String(data.byteLength),
      'content-type': mimeType,
      'content-disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    },
    body: data
  };
}

export function sendHtml(html: string, headers: Record<string, string> = {}): RouterResponse {
  return {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      ...headers
    },
    body: new TextEncoder().encode(html)
  };
}

export function sendRedirect(location: string, headers: Record<string, string> = {}): RouterResponse {
  return {
    status: 302,
    headers: {
      location,
      ...headers
    },
    body: new Uint8Array()
  };
}

export function sendNotFound(): RouterResponse {
  return {
    status: 404,
    headers: {
      'content-type': 'text/plain; charset=utf-8'
    },
    body: new TextEncoder().encode('Not Found')
  };
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function statusForErrorCode(code: ApiErrorCode): number {
  switch (code) {
    case 'UNAUTHORIZED':
      return 401;
    case 'WORKSPACE_NOT_FOUND':
    case 'ENTRY_NOT_FOUND':
      return 404;
    case 'PATH_FORBIDDEN':
      return 403;
    case 'INVALID_REQUEST':
      return 400;
    case 'READ_ONLY_FILESYSTEM':
    case 'WORKSPACE_STALE':
      return 409;
    case 'FILE_TOO_LARGE':
      return 413;
    case 'INTERNAL_ERROR':
      return 500;
  }
}
