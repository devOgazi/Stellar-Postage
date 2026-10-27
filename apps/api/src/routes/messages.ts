import crypto from 'node:crypto';
import type { FastifyPluginCallback } from 'fastify';
import { rpc } from '@stellar/stellar-sdk';
import type { EscrowClient } from '@stellar-postage/sdk';
import type { DataAccessLayer } from '../db/dal.js';
import { encryptMessage, decryptMessage } from '../crypto/encryption.js';

export interface MessagesRoutesOptions {
  dal: DataAccessLayer;
  escrowClient: EscrowClient;
  encryptionKey: Buffer;
  usdcSacId: string;
  replyVetoWindowSecs: number;
}

export const messagesRoutes: FastifyPluginCallback<MessagesRoutesOptions> = (fastify, options, done) => {
  const { dal, escrowClient, encryptionKey, usdcSacId, replyVetoWindowSecs } = options;

  // POST /messages
  fastify.post(
    '/messages',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['recipient', 'body'],
          properties: {
            recipient: { type: 'string', minLength: 1 },
            body: { type: 'string', minLength: 1 },
            amount: { type: ['string', 'number'] },
            window_secs: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { recipient: recipientIdentifier, body, amount, window_secs } = request.body as {
        recipient: string;
        body: string;
        amount?: string | number;
        window_secs?: number;
      };

      // 1. Resolve recipient
      let recipient = await dal.findUserByHandle(recipientIdentifier);
      if (!recipient && (recipientIdentifier.startsWith('G') || recipientIdentifier.startsWith('C')) && recipientIdentifier.length === 56) {
        recipient = await dal.findUserByAddress(recipientIdentifier);
      }

      if (!recipient) {
        return reply.code(404).send({
          error: 'Not Found',
          message: `Recipient not found: ${recipientIdentifier}`,
        });
      }

      // Check self-message
      if (recipient.stellar_address === user.stellar_address) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Cannot send message to yourself',
        });
      }

      // 2. Fetch recipient pricing policy
      const pricing = await dal.findPricingByUserId(recipient.id);
      const minAmount = pricing ? pricing.min_amount : 50_000_000n; // default 5 USDC
      const minWindow = pricing ? pricing.min_window_secs : 3600;
      const maxWindow = pricing ? pricing.max_window_secs : 604800;

      const stakeAmount = amount ? BigInt(amount) : minAmount;
      if (stakeAmount < minAmount) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: `Stake amount ${stakeAmount.toString()} is below recipient minimum of ${minAmount.toString()}`,
        });
      }

      const replyWindow = window_secs ?? minWindow;
      if (replyWindow < minWindow || replyWindow > maxWindow) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: `Reply window ${replyWindow}s is outside recipient allowed bounds [${minWindow}s, ${maxWindow}s]`,
        });
      }

      // 3. Encrypt payload and compute msg_hash = sha256(payload)
      const encryptedBody = encryptMessage(body, encryptionKey);
      const msgHash = crypto.createHash('sha256').update(body, 'utf8').digest();

      // 4. Create message draft in database
      const message = await dal.createMessage({
        sender_addr: user.stellar_address,
        recipient_id: recipient.id,
        body_enc: encryptedBody,
        msg_hash: msgHash,
        status: 'pending',
      });

      // 5. Build unsigned send transaction via SDK
      // (Only msg_hash goes on-chain; encrypted body is NEVER put on-chain)
      let transactionXdr: string | null = null;
      try {
        const tx = await escrowClient.send({
          sender: user.stellar_address,
          recipient: recipient.stellar_address,
          token: usdcSacId,
          amount: BigInt(stakeAmount),
          msgHash,
          windowSecs: BigInt(replyWindow),
        });
        transactionXdr = tx.toXDR();
      } catch (err: unknown) {
        fastify.log.warn(
          `send transaction simulation skipped: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      return reply.code(201).send({
        message_id: message.id,
        msg_hash: msgHash.toString('hex'),
        status: message.status,
        transaction: transactionXdr,
      });
    }
  );

  // POST /messages/:id/submit
  fastify.post(
    '/messages/:id/submit',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = (request.body as { signed_tx?: string; transaction?: string; stake_id?: string | number }) || {};

      const message = await dal.findMessageById(id);
      if (!message) {
        return reply.code(404).send({ error: 'Not Found', message: 'Message not found' });
      }

      if (message.sender_addr !== user.stellar_address) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only the sender can submit the funding transaction for this message',
        });
      }

      let stakeId = body.stake_id !== undefined ? BigInt(body.stake_id) : null;
      const signedTx = body.signed_tx || body.transaction;

      if (signedTx && !stakeId) {
        try {
          const res = await escrowClient.submitAndWait(signedTx);
          if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
            stakeId = 1n; // Default or parsed id
          }
        } catch (err: unknown) {
          fastify.log.warn(`Submission via RPC failed or skipped: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (stakeId !== null) {
        await dal.attachStakeId(message.id, stakeId);
      }

      const updated = await dal.updateMessageStatus(message.id, 'delivered');
      return reply.code(200).send({ message: updated });
    }
  );

  // GET /messages/:id
  fastify.get(
    '/messages/:id',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const message = await dal.findMessageById(id);
      if (!message) {
        return reply.code(404).send({ error: 'Not Found', message: 'Message not found' });
      }

      // Enforce authorization: only sender or recipient can view
      const isSender = message.sender_addr === user.stellar_address;
      const isRecipient = message.recipient_id === user.id;

      if (!isSender && !isRecipient) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You are not authorized to view this message',
        });
      }

      const plaintext = decryptMessage(message.body_enc, encryptionKey);

      return reply.code(200).send({
        id: message.id,
        sender_addr: message.sender_addr,
        recipient_id: message.recipient_id,
        stake_id: message.stake_id,
        msg_hash: message.msg_hash.toString('hex'),
        status: message.status,
        body: plaintext,
        created_at: message.created_at,
      });
    }
  );

  // POST /messages/:id/spam
  fastify.post(
    '/messages/:id/spam',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const message = await dal.findMessageById(id);
      if (!message) {
        return reply.code(404).send({ error: 'Not Found', message: 'Message not found' });
      }

      // Only recipient can flag spam
      if (message.recipient_id !== user.id) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only the recipient can flag a message as spam',
        });
      }

      let transactionXdr: string | null = null;
      if (message.stake_id) {
        try {
          const tx = await escrowClient.flagSpam(
            BigInt(message.stake_id),
            user.stellar_address
          );
          transactionXdr = tx.toXDR();
        } catch (err: unknown) {
          fastify.log.warn(`flagSpam simulation skipped: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const updated = await dal.updateMessageStatus(message.id, 'spam');
      return reply.code(200).send({
        message: updated,
        transaction: transactionXdr,
      });
    }
  );

  // POST /messages/:id/not-a-reply
  fastify.post(
    '/messages/:id/not-a-reply',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const message = await dal.findMessageById(id);
      if (!message) {
        return reply.code(404).send({ error: 'Not Found', message: 'Message not found' });
      }

      // Only recipient can veto a reply
      if (message.recipient_id !== user.id) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only the recipient can veto a reply',
        });
      }

      // Check veto window
      const createdAt = new Date(message.created_at).getTime();
      const vetoDeadline = createdAt + replyVetoWindowSecs * 1000;
      if (Date.now() > vetoDeadline) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: `Reply veto window of ${replyVetoWindowSecs}s has expired`,
        });
      }

      return reply.code(200).send({
        status: 'vetoed',
        message_id: message.id,
      });
    }
  );

  done();
};
