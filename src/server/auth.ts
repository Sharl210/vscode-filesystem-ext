import crypto from 'node:crypto';

export interface AuthState {
  token: string;
  validateRequest(headers: Record<string, string | undefined>, url?: URL): boolean;
  validateUiToken(url: URL): boolean;
}

export function createAuthState(token: string = crypto.randomUUID()): AuthState {
  return {
    token,
    validateRequest(headers, url) {
      const authorization = headers.authorization ?? headers.Authorization;

      if (authorization === `Bearer ${token}`) {
        return true;
      }

      if (url?.searchParams.get('token') === token) {
        return true;
      }

      const cookie = headers.cookie ?? headers.Cookie;

      return cookie?.includes(`workspace-web-gateway-token=${token}`) ?? false;
    },
    validateUiToken(url) {
      return url.searchParams.get('token') === token;
    }
  };
}
