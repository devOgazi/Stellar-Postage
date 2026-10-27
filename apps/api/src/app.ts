import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { type AppConfig, loadConfig } from './config.js';
import { DataAccessLayer } from './db/dal.js';
import { getPool } from './db/pool.js';
import { NonceStore } from './auth/nonce.js';
import { AuthService } from './auth/service.js';
import { verifyJwt, type SessionTokenPayload } from './auth/jwt.js';
import { authRoutes } from './routes/auth.js';

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
  }
}

export interface AppOptions {
  config?: AppConfig;
  dal?: DataAccessLayer;
  nonceStore?: NonceStore;
  authService?: AuthService;
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

  const app = Fastify({
    logger: false,
  });

  app.decorate('config', config);
  app.decorate('dal', dal);
  app.decorate('nonceStore', nonceStore);
  app.decorate('authService', authService);

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
    },
    { prefix: '/v1' }
  );

  return app;
}
