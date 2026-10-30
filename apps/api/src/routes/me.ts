import type { FastifyPluginCallback } from 'fastify';
import type { EscrowClient } from '@stellar-postage/sdk';
import { generateLinkToken } from '@stellar-postage/bot';
import type { DataAccessLayer } from '../db/dal.js';
import { decryptMessage } from '../crypto/encryption.js';

export interface MeRoutesOptions {
  dal: DataAccessLayer;
  escrowClient: EscrowClient;
  encryptionKey: Buffer;
  sessionSecret?: string;
  botUsername?: string;
}

export const meRoutes: FastifyPluginCallback<MeRoutesOptions> = (fastify, options, done) => {
  const { dal, escrowClient, encryptionKey, sessionSecret, botUsername } = options;

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
        allowlist,
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
          `setPrice simulation skipped: ${err instanceof Error ? err.message : String(err)}`,
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
    },
  );

  // POST /me/channels/telegram/link
  fastify.post(
    '/me/channels/telegram/link',
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      const user = request.user!;
      const secret = sessionSecret || (fastify.config?.sessionSecret ?? 'default-secret');
      const token = generateLinkToken(user.id, secret);
      const username = botUsername || process.env['TELEGRAM_BOT_USERNAME'] || 'StellarPostageBot';

      return reply.code(200).send({
        link_token: token,
        url: `https://t.me/${username}?start=${token}`,
      });
    },
  );

  // POST /me/channels/email
  fastify.post(
    '/me/channels/email',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', minLength: 3 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { email } = request.body as { email: string };

      if (!email.includes('@')) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Invalid email address format',
        });
      }

      const channel = await dal.linkEmailChannel(user.id, email);
      return reply.code(200).send({
        channel: {
          id: channel.id,
          kind: channel.kind,
          external_id: channel.external_id,
          verified_at: channel.verified_at,
        },
        registered: true,
      });
    },
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
    },
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
    },
  );

  done();
};
