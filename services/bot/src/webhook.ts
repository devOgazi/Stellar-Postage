import type { Telegraf } from 'telegraf';
import type { Update } from 'telegraf/types';
import { IdempotencyTracker } from './idempotency.js';

export interface WebhookHandlerOptions {
  bot: Telegraf;
  webhookSecret?: string | undefined;
  idempotencyTracker?: IdempotencyTracker | undefined;
}

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface WebhookResult {
  statusCode: number;
  body: Record<string, unknown>;
}

export class TelegramWebhookHandler {
  private readonly bot: Telegraf;
  private readonly webhookSecret?: string | undefined;
  private readonly idempotency: IdempotencyTracker;

  constructor(options: WebhookHandlerOptions) {
    this.bot = options.bot;
    this.webhookSecret = options.webhookSecret;
    this.idempotency = options.idempotencyTracker || new IdempotencyTracker();
  }

  /**
   * Processes an incoming Telegram webhook update.
   */
  async handleWebhook(req: WebhookRequest): Promise<WebhookResult> {
    // 1. Secret verification
    if (this.webhookSecret) {
      const headerSecret =
        req.headers['x-telegram-bot-api-secret-token'] ||
        req.headers['X-Telegram-Bot-Api-Secret-Token'];
      const secretVal = Array.isArray(headerSecret) ? headerSecret[0] : headerSecret;

      if (!secretVal || secretVal !== this.webhookSecret) {
        return {
          statusCode: 403,
          body: {
            error: 'Forbidden',
            message: 'Invalid or missing Telegram webhook secret token',
          },
        };
      }
    }

    const update = req.body as Update;
    if (!update || typeof update !== 'object') {
      return {
        statusCode: 400,
        body: { error: 'Bad Request', message: 'Missing update body' },
      };
    }

    // 2. Idempotency check via update_id
    if (typeof update.update_id === 'number') {
      const isDuplicate = this.idempotency.hasOrSet(update.update_id);
      if (isDuplicate) {
        return {
          statusCode: 200,
          body: { ok: true, duplicate: true },
        };
      }
    }

    // 3. Dispatch to Telegraf bot
    try {
      await this.bot.handleUpdate(update);
      return {
        statusCode: 200,
        body: { ok: true },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        statusCode: 500,
        body: { error: 'Internal Server Error', message: msg },
      };
    }
  }
}
