import type { FastifyPluginCallback } from 'fastify';
import type { DataAccessLayer } from '../db/dal.js';

export interface RecipientRoutesOptions {
  dal: DataAccessLayer;
}

export const recipientRoutes: FastifyPluginCallback<RecipientRoutesOptions> = (fastify, options, done) => {
  const { dal } = options;

  fastify.get(
    '/recipients/:handle',
    {
      schema: {
        params: {
          type: 'object',
          required: ['handle'],
          properties: {
            handle: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { handle } = request.params as { handle: string };
      if (!handle) {
        return reply.code(400).send({ error: 'Bad Request', message: 'Handle is required' });
      }

      // Try finding by handle first, then by address
      let user = await dal.findUserByHandle(handle);
      if (!user && (handle.startsWith('G') || handle.startsWith('C')) && handle.length === 56) {
        user = await dal.findUserByAddress(handle);
      }

      if (!user) {
        return reply.code(404).send({ error: 'Not Found', message: `Recipient not found: ${handle}` });
      }

      // Load pricing or use default
      const pricing = await dal.findPricingByUserId(user.id);
      const channels = await dal.findChannelsByUserId(user.id);

      return reply.code(200).send({
        recipient: {
          id: user.id,
          stellar_address: user.stellar_address,
          handle: user.handle,
        },
        pricing: {
          min_amount: pricing ? pricing.min_amount.toString() : '50000000', // 5 USDC
          min_window_secs: pricing ? pricing.min_window_secs : 3600,
          max_window_secs: pricing ? pricing.max_window_secs : 604800,
          allowlist: pricing ? pricing.allowlist : [],
        },
        channels: channels
          .filter((c) => c.verified_at !== null)
          .map((c) => ({
            kind: c.kind,
            verified: true,
          })),
      });
    }
  );

  done();
};
