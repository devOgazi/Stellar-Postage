/**
 * services/mailer/src/webhook.ts
 * Inbound email webhook handler for POST /v1/webhooks/inbound-email.
 */

import type { EmailProvider, EmailRejectionReason } from './types.js';
import type { EmailReplyDetector } from './replyDetector.js';

export interface EmailWebhookHandlerOptions {
  provider: EmailProvider;
  replyDetector: EmailReplyDetector;
  webhookSecret?: string | undefined;
  emailChannelEnabled?: boolean | undefined;
}

export interface InboundWebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface InboundWebhookResult {
  statusCode: number;
  body: {
    ok?: boolean | undefined;
    error?: string | undefined;
    message?: string | undefined;
    accepted?: boolean | undefined;
    reason?: EmailRejectionReason | undefined;
    evidence_id?: string | undefined;
    veto_deadline?: number | undefined;
  };
}

export class EmailWebhookHandler {
  private readonly provider: EmailProvider;
  private readonly replyDetector: EmailReplyDetector;
  private readonly webhookSecret?: string | undefined;
  private readonly emailChannelEnabled: boolean;

  constructor(options: EmailWebhookHandlerOptions) {
    this.provider = options.provider;
    this.replyDetector = options.replyDetector;
    this.webhookSecret = options.webhookSecret;
    this.emailChannelEnabled = options.emailChannelEnabled ?? true;
  }

  async handleWebhook(req: InboundWebhookRequest): Promise<InboundWebhookResult> {
    // 1. Channel enabled check
    if (!this.emailChannelEnabled) {
      return {
        statusCode: 503,
        body: {
          error: 'Service Unavailable',
          message: 'Email channel is disabled (EMAIL_CHANNEL_ENABLED is false)',
        },
      };
    }

    // 2. Secret verification
    if (this.webhookSecret) {
      const isValid = this.provider.verifyWebhookSecret(req.headers, this.webhookSecret);
      if (!isValid) {
        return {
          statusCode: 403,
          body: {
            error: 'Forbidden',
            message: 'Invalid or missing inbound email webhook secret',
          },
        };
      }
    }

    // 3. Body validation
    if (!req.body || typeof req.body !== 'object') {
      return {
        statusCode: 400,
        body: {
          error: 'Bad Request',
          message: 'Missing or invalid inbound webhook body',
        },
      };
    }

    // 4. Parse inbound payload via provider
    let parsedEmail;
    try {
      parsedEmail = this.provider.parseInboundWebhook(req.body, req.headers);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        statusCode: 400,
        body: {
          error: 'Bad Request',
          message: `Failed to parse inbound email payload: ${msg}`,
        },
      };
    }

    // 5. Process through reply detector
    const result = await this.replyDetector.processInboundEmail(parsedEmail);

    if (result.accepted) {
      return {
        statusCode: 200,
        body: {
          ok: true,
          accepted: true,
          evidence_id: result.evidence?.id,
          veto_deadline: result.vetoDeadline,
        },
      };
    }

    return {
      statusCode: 200,
      body: {
        ok: true,
        accepted: false,
        reason: result.reason,
      },
    };
  }
}
