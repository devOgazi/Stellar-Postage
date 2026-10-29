import type { FastifyPluginCallback } from 'fastify';
import { TelegramWebhookHandler, type WebhookHandlerOptions } from '@stellar-postage/bot';

export interface WebhookRoutesOptions {
  webhookHandler: TelegramWebhookHandler;
}

export const webhookRoutes: FastifyPluginCallback<WebhookRoutesOptions> = (
  fastify,
  options,
  done
) => {
  const { webhookHandler } = options;

  // POST /webhooks/telegram
  fastify.post('/webhooks/telegram', async (request, reply) => {
    const headers = request.headers as Record<string, string | string[] | undefined>;
    const body = request.body;

    const result = await webhookHandler.handleWebhook({
      headers,
      body,
    });

    return reply.code(result.statusCode).send(result.body);
  });

  done();
};
