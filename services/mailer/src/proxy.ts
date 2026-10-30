/**
 * services/mailer/src/proxy.ts
 * Generates unique proxy addresses per stake for email reply tracking.
 * README: "generate a unique proxy address, e.g. s_8f3a9c@reply.example.com"
 */

import crypto from 'node:crypto';

export function generateProxyAddress(domain: string, token?: string): string {
  const cleanDomain = domain.toLowerCase().trim().replace(/^@/, '');
  const slug = token ?? crypto.randomBytes(4).toString('hex');
  return `s_${slug}@${cleanDomain}`;
}

export function parseProxyAddress(address: string): { slug: string; domain: string } | null {
  const clean = address.toLowerCase().trim();
  const match = clean.match(/^s_([a-z0-9_-]+)@([a-z0-9.-]+)$/);
  if (!match || !match[1] || !match[2]) return null;
  return {
    slug: match[1],
    domain: match[2],
  };
}
