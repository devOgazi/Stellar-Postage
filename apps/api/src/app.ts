import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { EscrowClient } from '@stellar-postage/sdk';
import { createPostageBot, TelegramWebhookHandler, type Telegraf } from '@stellar-postage/bot';
import { type AppConfig, loadConfig } from './config.js';
import { DataAccessLayer } from './db/dal.js';
import { getPool } from './db/pool.js';
import { NonceStore } from './auth/nonce.js';
import { AuthService } from './auth/service.js';
import { verifyJwt, type SessionTokenPayload } from './auth/jwt.js';
import { authRoutes } from './routes/auth.js';
import { recipientRoutes } from './routes/recipients.js';
import { meRoutes } from './routes/me.js';
import { messagesRoutes } from './routes/messages.js';
import { webhookRoutes } from './routes/webhooks.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      stellar_address: string;
    };
  }

  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    config: AppConfig;
    dal: DataAccessLayer;
    authService: AuthService;
    nonceStore: NonceStore;
    escrowClient: EscrowClient;
    bot?: Telegraf;
    webhookHandler?: TelegramWebhookHandler;
  }
}

export interface AppOptions {
  config?: AppConfig;
  dal?: DataAccessLayer;
  nonceStore?: NonceStore;
  authService?: AuthService;
  escrowClient?: EscrowClient;
  bot?: Telegraf;
  webhookHandler?: TelegramWebhookHandler;
}

export function createApp(options?: AppOptions): FastifyInstance {
  const config = options?.config || loadConfig();
  const dal = options?.dal || new DataAccessLayer(getPool());
  const nonceStore = options?.nonceStore || new NonceStore();
  const authService =
    options?.authService ||
    new AuthService(
      config.sponsorKeypair,
      config.networkPassphrase,
      config.domain,
      config.authExpirySecs,
      config.sessionSecret,
      nonceStore,
      dal
    );
  const escrowClient =
    options?.escrowClient ||
    new EscrowClient({
      contractId: config.escrowContractId,
      rpcUrl: config.sorobanRpcUrl,
      networkPassphrase: config.networkPassphrase,
    });

  const bot =
    options?.bot ||
    createPostageBot({
      botToken: config.telegramBotToken || 'mock:token',
      linkSecret: config.sessionSecret,
      dal,
    });
  const webhookHandler =
    options?.webhookHandler ||
    new TelegramWebhookHandler({
      bot,
      webhookSecret: config.telegramWebhookSecret,
    });

  const app = Fastify({
    logger: false,
    ajv: {
      customOptions: {
        allowUnionTypes: true,
      },
    },
  });

  app.decorate('config', config);
  app.decorate('dal', dal);
  app.decorate('nonceStore', nonceStore);
  app.decorate('authService', authService);
  app.decorate('escrowClient', escrowClient);
  app.decorate('bot', bot);
  app.decorate('webhookHandler', webhookHandler);

  // Authentication preHandler hook
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header: Bearer token required',
      });
    }

    const token = authHeader.slice(7).trim();
    try {
      const payload = verifyJwt<SessionTokenPayload>(token, config.sessionSecret);
      request.user = {
        id: payload.sub,
        stellar_address: payload.stellar_address,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(401).send({
        error: 'Unauthorized',
        message: `Invalid session token: ${msg}`,
      });
    }
  });

  // Health check endpoint
  app.get('/health', () => ({ status: 'ok' }));

  // Register API v1 routes
  void app.register(
    async (v1) => {
      await v1.register(authRoutes, { authService });
      await v1.register(recipientRoutes, { dal });
      await v1.register(meRoutes, {
        dal,
        escrowClient,
        encryptionKey: config.messageEncryptionKey,
        sessionSecret: config.sessionSecret,
      });
      await v1.register(messagesRoutes, {
        dal,
        escrowClient,
        encryptionKey: config.messageEncryptionKey,
        usdcSacId: config.usdcSacId,
        replyVetoWindowSecs: config.replyVetoWindowSecs,
      });
      await v1.register(webhookRoutes, { webhookHandler });
    },
    { prefix: '/v1' }
  );

  return app;
}
