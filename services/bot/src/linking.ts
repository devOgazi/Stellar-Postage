import crypto from 'node:crypto';

const DEFAULT_LINK_TOKEN_TTL_MS = 3600 * 1000; // 1 hour

/**
 * Generates a signed, tamper-proof link token for Telegram deep linking.
 */
export function generateLinkToken(
  userId: string,
  secret: string,
  timestamp: number = Date.now()
): string {
  const data = `${userId}.${timestamp}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('hex');
  return `${userId}.${timestamp}.${sig}`;
}

/**
 * Verifies a link token and returns the userId, or null if invalid or expired.
 */
export function verifyLinkToken(
  token: string,
  secret: string,
  maxAgeMs: number = DEFAULT_LINK_TOKEN_TTL_MS,
  now: number = Date.now()
): string | null {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [userId, tsStr, sig] = parts;
  if (!userId || !tsStr || !sig) return null;

  const ts = parseInt(tsStr, 10);
  if (Number.isNaN(ts)) return null;

  // Check expiration
  if (now - ts > maxAgeMs || ts > now + 60_000) {
    return null; // Expired or future timestamp
  }

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${userId}.${tsStr}`)
    .digest('hex');

  // Constant-time comparison
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expectedSig, 'hex');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  return userId;
}
