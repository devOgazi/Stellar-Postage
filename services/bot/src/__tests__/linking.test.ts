import { generateLinkToken, verifyLinkToken } from '../linking.js';

describe('Telegram Deep-link Token Verification', () => {
  const secret = 'super-secret-key-32-bytes-minimum-length';
  const userId = '11111111-2222-3333-4444-555555555555';

  it('generates and verifies a valid token', () => {
    const token = generateLinkToken(userId, secret);
    expect(typeof token).toBe('string');

    const verifiedUserId = verifyLinkToken(token, secret);
    expect(verifiedUserId).toBe(userId);
  });

  it('rejects tampered tokens', () => {
    const token = generateLinkToken(userId, secret);
    const tampered = token.slice(0, -4) + '0000';
    expect(verifyLinkToken(tampered, secret)).toBeNull();
  });

  it('rejects expired tokens', () => {
    const twoHoursAgo = Date.now() - 2 * 3600 * 1000;
    const token = generateLinkToken(userId, secret, twoHoursAgo);
    expect(verifyLinkToken(token, secret, 3600 * 1000)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifyLinkToken('', secret)).toBeNull();
    expect(verifyLinkToken('invalid-format', secret)).toBeNull();
    expect(verifyLinkToken('part1.part2', secret)).toBeNull();
  });
});
