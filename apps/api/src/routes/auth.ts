import type { FastifyPluginCallback } from 'fastify';
import type { AuthService } from '../auth/service.js';

export interface AuthRoutesOptions {
  authService: AuthService;
}

export const authRoutes: FastifyPluginCallback<AuthRoutesOptions> = (fastify, options, done) => {
  const { authService } = options;

  // POST /v1/auth/challenge
  fastify.post('/auth/challenge', async (request, reply) => {
    const body = (request.body as { address?: string; stellar_address?: string }) || {};
    const query = (request.query as { address?: string; stellar_address?: string }) || {};
    const address = body.address || body.stellar_address || query.address || query.stellar_address;

    if (!address) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Missing required stellar address (address or stellar_address)',
      });
    }

    try {
      const challenge = authService.generateChallenge(address);
      return reply.code(200).send(challenge);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({
        error: 'Bad Request',
        message: msg,
      });
    }
  });

  // POST /v1/auth/verify
  fastify.post('/auth/verify', async (request, reply) => {
    const body = (request.body as { challenge?: string; transaction?: string }) || {};
    const signedXdr = body.challenge || body.transaction;

    if (!signedXdr) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Missing challenge transaction XDR (challenge or transaction)',
      });
    }

    try {
      const session = await authService.verifyChallenge(signedXdr);
      return reply.code(200).send(session);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(401).send({
        error: 'Unauthorized',
        message: msg,
      });
    }
  });

  done();
};
