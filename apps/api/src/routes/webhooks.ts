import type { FastifyPluginCallback } from 'fastify';
import { TelegramWebhookHandler } from '@stellar-postage/bot';
import type { EmailWebhookHandler } from '@stellar-postage/mailer';

export interface WebhookRoutesOptions {
  webhookHandler: TelegramWebhookHandler;
  emailWebhookHandler?: EmailWebhookHandler;
}

export const webhookRoutes: FastifyPluginCallback<WebhookRoutesOptions> = (
  fastify,
  options,
  done,
) => {
  const { webhookHandler, emailWebhookHandler } = options;

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

  // POST /webhooks/inbound-email
  fastify.post('/webhooks/inbound-email', async (request, reply) => {
    if (!emailWebhookHandler) {
      return reply.code(503).send({
        error: 'Service Unavailable',
        message: 'Inbound email webhook handler not configured',
      });
    }

    const headers = request.headers as Record<string, string | string[] | undefined>;
    const body = request.body;

    const result = await emailWebhookHandler.handleWebhook({
      headers,
      body,
    });

    return reply.code(result.statusCode).send(result.body);
  });

  done();
};
