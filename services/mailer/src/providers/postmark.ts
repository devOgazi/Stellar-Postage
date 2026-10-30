/**
 * services/mailer/src/providers/postmark.ts
 * Postmark email provider adapter implementation.
 */

import crypto from 'node:crypto';
import type {
  EmailProvider,
  ParsedInboundEmail,
  SendEmailParams,
  SendEmailResult,
} from '../types.js';

export interface PostmarkProviderOptions {
  serverToken?: string | undefined;
  apiUrl?: string | undefined;
}

export class PostmarkProvider implements EmailProvider {
  public readonly name = 'postmark';
  private readonly serverToken?: string | undefined;
  private readonly apiUrl: string;

  constructor(options?: PostmarkProviderOptions) {
    this.serverToken = options?.serverToken;
    this.apiUrl = options?.apiUrl ?? 'https://api.postmarkapp.com';
  }

  /**
   * Delivers an outbound email via Postmark.
   */
  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    const customHeaders = Object.entries(params.headers ?? {}).map(([Name, Value]) => ({
      Name,
      Value,
    }));

    const postmarkPayload: Record<string, unknown> = {
      From: params.from,
      To: params.to,
      ReplyTo: params.replyTo,
      Subject: params.subject,
      TextBody: params.textBody,
      Headers: customHeaders,
    };
    if (params.htmlBody !== undefined) {
      postmarkPayload['HtmlBody'] = params.htmlBody;
    }

    if (this.serverToken && this.serverToken !== 'mock:token') {
      const res = await fetch(`${this.apiUrl}/email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Postmark-Server-Token': this.serverToken,
        },
        body: JSON.stringify(postmarkPayload),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Postmark send failed (${res.status}): ${errText}`);
      }

      const data = (await res.json()) as Record<string, unknown>;
      const rawId = (data['MessageID'] ?? data['MessageId']) as string | undefined;
      const messageId = rawId
        ? `<${rawId.replace(/^<|>$/g, '')}>`
        : `<${crypto.randomUUID()}@postmarkapp.com>`;
      return { messageId };
    }

    // Mock / Offline delivery for unit tests and local development
    const mockId = params.messageId ?? `<postmark-${crypto.randomUUID()}@postmarkapp.com>`;
    return { messageId: mockId };
  }

  /**
   * Parses an inbound email webhook from Postmark.
   */
  parseInboundWebhook(
    payload: unknown,
    _headers?: Record<string, string | string[] | undefined> | undefined,
  ): ParsedInboundEmail {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid Postmark webhook payload: object expected');
    }

    const data = payload as Record<string, unknown>;

    // 1. Resolve From address
    let fromEmail = '';
    const fromFull = data['FromFull'] as Record<string, unknown> | undefined;
    const fromField = data['From'];
    if (fromFull && typeof fromFull['Email'] === 'string') {
      fromEmail = fromFull['Email'];
    } else if (typeof fromField === 'string') {
      const match = fromField.match(/<([^>]+)>/);
      fromEmail = match && match[1] ? match[1] : fromField;
    }
    fromEmail = fromEmail.trim().toLowerCase();

    // 2. Resolve To / OriginalRecipient address (the proxy address)
    let toEmail = '';
    const origRecipient = data['OriginalRecipient'];
    const toFull = data['ToFull'] as Array<Record<string, unknown>> | undefined;
    const toField = data['To'];
    if (typeof origRecipient === 'string' && origRecipient) {
      toEmail = origRecipient;
    } else if (Array.isArray(toFull) && toFull[0] && typeof toFull[0]['Email'] === 'string') {
      toEmail = toFull[0]['Email'];
    } else if (typeof toField === 'string') {
      const match = toField.match(/<([^>]+)>/);
      toEmail = match && match[1] ? match[1] : toField;
    }
    toEmail = toEmail.trim().toLowerCase();

    // 3. Extract Headers map
    const headersMap: Record<string, string | string[]> = {};
    const rawHeaders = data['Headers'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(rawHeaders)) {
      for (const h of rawHeaders) {
        if (h && typeof h['Name'] === 'string') {
          const key = h['Name'].toLowerCase();
          const val = typeof h['Value'] === 'string' ? h['Value'] : String(h['Value'] ?? '');
          const existing = headersMap[key];
          if (existing !== undefined) {
            if (Array.isArray(existing)) {
              existing.push(val);
            } else {
              headersMap[key] = [existing, val];
            }
          } else {
            headersMap[key] = val;
          }
        }
      }
    }

    // 4. Extract In-Reply-To and References
    const inReplyToHeader = (headersMap['in-reply-to'] ?? data['In-Reply-To'] ?? '') as string;
    const inReplyTo = inReplyToHeader ? inReplyToHeader.trim() : undefined;

    const referencesHeader = (headersMap['references'] ?? data['References'] ?? '') as string;
    let references: string[] | undefined;
    if (referencesHeader) {
      references = referencesHeader
        .split(/\s+/)
        .map((r) => r.trim())
        .filter(Boolean);
    }

    // 5. Extract SPF / DKIM / DMARC
    const authResultsHeader = (headersMap['authentication-results'] ?? '') as string;

    // SPF check
    const spfVal = data['SPF'];
    let spfStatus = typeof spfVal === 'string' ? spfVal.toLowerCase() : undefined;
    if (!spfStatus && authResultsHeader) {
      const spfMatch = authResultsHeader.match(/\bspf=([a-z]+)/i);
      if (spfMatch && spfMatch[1]) {
        spfStatus = spfMatch[1].toLowerCase();
      }
    }

    // DKIM check
    let dkimStatus: string | undefined;
    if (data['DKIMVerified'] === true) {
      dkimStatus = 'pass';
    } else if (authResultsHeader) {
      const dkimMatch = authResultsHeader.match(/\bdkim=([a-z]+)/i);
      if (dkimMatch && dkimMatch[1]) {
        dkimStatus = dkimMatch[1].toLowerCase();
      }
    }

    // DMARC check
    let dmarcStatus: string | undefined;
    if (authResultsHeader) {
      const dmarcMatch = authResultsHeader.match(/\bdmarc=([a-z]+)/i);
      if (dmarcMatch && dmarcMatch[1]) {
        dmarcStatus = dmarcMatch[1].toLowerCase();
      }
    }

    // 6. Extract Auto-Submitted and X-Autoreply
    const autoSubmitted = (headersMap['auto-submitted'] ?? '') as string;
    const xAutoreply = (headersMap['x-autoreply'] ?? '') as string;

    // 7. Text body
    const strippedReply = data['StrippedTextReply'];
    const textBodyVal = data['TextBody'];
    const textBody =
      typeof strippedReply === 'string' && strippedReply
        ? strippedReply.trim()
        : typeof textBodyVal === 'string'
          ? textBodyVal.trim()
          : '';

    const subjectVal = data['Subject'];
    const htmlBodyVal = data['HtmlBody'];
    const messageIdVal = data['MessageID'];

    return {
      from: fromEmail,
      to: toEmail,
      subject: typeof subjectVal === 'string' ? subjectVal : '',
      textBody,
      htmlBody: typeof htmlBodyVal === 'string' ? htmlBodyVal : undefined,
      messageId: typeof messageIdVal === 'string' ? messageIdVal : crypto.randomUUID(),
      inReplyTo,
      references,
      spfStatus,
      dkimStatus,
      dmarcStatus,
      autoSubmitted: autoSubmitted ? autoSubmitted.toLowerCase().trim() : undefined,
      xAutoreply: xAutoreply ? xAutoreply.toLowerCase().trim() : undefined,
      headers: headersMap,
      rawPayload: payload,
    };
  }

  /**
   * Verifies the inbound webhook secret against request headers.
   */
  verifyWebhookSecret(
    headers: Record<string, string | string[] | undefined>,
    secret: string,
  ): boolean {
    if (!secret) return true;

    const findHeader = (name: string): string | undefined => {
      const val = headers[name] ?? headers[name.toLowerCase()];
      return Array.isArray(val) ? val[0] : val;
    };

    const directSecret =
      findHeader('inbound-webhook-secret') ||
      findHeader('x-inbound-webhook-secret') ||
      findHeader('x-postmark-secret') ||
      findHeader('x-webhook-secret');

    if (directSecret && directSecret === secret) {
      return true;
    }

    const authHeader = findHeader('authorization');
    if (authHeader) {
      if (authHeader === `Bearer ${secret}`) return true;
      if (authHeader.startsWith('Basic ')) {
        const base64Part = authHeader.slice(6).trim();
        try {
          const decoded = Buffer.from(base64Part, 'base64').toString('utf8');
          // Support ":secret", "secret:", or "secret:secret"
          const [u, p] = decoded.split(':');
          if (u === secret || p === secret) return true;
        } catch {
          // ignore parse error
        }
      }
    }

    return false;
  }
}
