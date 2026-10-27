import type { FastifyPluginCallback } from 'fastify';
import type { EscrowClient } from '@stellar-postage/sdk';
import type { DataAccessLayer } from '../db/dal.js';
import { decryptMessage } from '../crypto/encryption.js';

export interface MeRoutesOptions {
  dal: DataAccessLayer;
  escrowClient: EscrowClient;
  encryptionKey: Buffer;
}

export const meRoutes: FastifyPluginCallback<MeRoutesOptions> = (fastify, options, done) => {
  const { dal, escrowClient, encryptionKey } = options;

  // PUT /me/pricing
  fastify.put(
    '/me/pricing',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['min_amount', 'min_window_secs', 'max_window_secs'],
          properties: {
            min_amount: { type: ['string', 'number'] },
            min_window_secs: { type: 'integer', minimum: 0 },
            max_window_secs: { type: 'integer', minimum: 0 },
            allowlist: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const body = request.body as {
        min_amount: string | number;
        min_window_secs: number;
        max_window_secs: number;
        allowlist?: string[];
      };

      const minAmount = BigInt(body.min_amount);
      if (minAmount < 0n) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'min_amount cannot be negative',
        });
      }

      if (body.min_window_secs > body.max_window_secs) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'min_window_secs cannot exceed max_window_secs',
        });
      }

      const allowlist = body.allowlist ?? [];
      const updated = await dal.upsertPricing(
        user.id,
        minAmount,
        body.min_window_secs,
        body.max_window_secs,
        allowlist
      );

      // Build the on-chain set_price transaction via SDK
      let transactionXdr: string | null = null;
      try {
        const tx = await escrowClient.setPrice({
          recipient: user.stellar_address,
          minAmount,
          minWindow: BigInt(body.min_window_secs),
          maxWindow: BigInt(body.max_window_secs),
        });
        transactionXdr = tx.toXDR();
      } catch (err: unknown) {
        // If simulation is not available in mock/offline mode, transactionXdr remains null
        fastify.log.warn(
          `setPrice simulation skipped: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      return reply.code(200).send({
        pricing: {
          min_amount: updated.min_amount.toString(),
          min_window_secs: updated.min_window_secs,
          max_window_secs: updated.max_window_secs,
          allowlist: updated.allowlist,
        },
        transaction: transactionXdr,
      });
    }
  );

  // GET /me/inbox
  fastify.get(
    '/me/inbox',
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      const user = request.user!;
      const messages = await dal.findInbox(user.id);

      const items = messages.map((m) => ({
        id: m.id,
        sender_addr: m.sender_addr,
        recipient_id: m.recipient_id,
        stake_id: m.stake_id,
        status: m.status,
        body: decryptMessage(m.body_enc, encryptionKey),
        created_at: m.created_at,
      }));

      return reply.code(200).send(items);
    }
  );

  // GET /me/sent
  fastify.get(
    '/me/sent',
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      const user = request.user!;
      const messages = await dal.findSent(user.stellar_address);

      const items = messages.map((m) => ({
        id: m.id,
        sender_addr: m.sender_addr,
        recipient_id: m.recipient_id,
        stake_id: m.stake_id,
        status: m.status,
        body: decryptMessage(m.body_enc, encryptionKey),
        created_at: m.created_at,
      }));

      return reply.code(200).send(items);
    }
  );

  done();
};
