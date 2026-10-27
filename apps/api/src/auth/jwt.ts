import crypto from 'node:crypto';

export interface SessionTokenPayload {
  sub: string;
  stellar_address: string;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

export function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSecs = 86400 * 7
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSecs,
  };

  const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64Payload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${b64Header}.${b64Payload}`)
    .digest('base64url');

  return `${b64Header}.${b64Payload}.${signature}`;
}

export function verifyJwt<T = SessionTokenPayload>(token: string, secret: string): T {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [b64Header, b64Payload, signature] = parts;
  if (!b64Header || !b64Payload || !signature) {
    throw new Error('Malformed JWT components');
  }

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${b64Header}.${b64Payload}`)
    .digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSig);

  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('Invalid JWT signature');
  }

  const payloadStr = Buffer.from(b64Payload, 'base64url').toString('utf8');
  const payload = JSON.parse(payloadStr) as T & { exp?: number; nbf?: number };

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) {
    throw new Error('JWT has expired');
  }
  if (typeof payload.nbf === 'number' && payload.nbf > now) {
    throw new Error('JWT is not active yet');
  }

  return payload;
}
