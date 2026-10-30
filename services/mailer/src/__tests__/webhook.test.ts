import { EmailWebhookHandler } from '../webhook.js';
import { PostmarkProvider } from '../providers/postmark.js';
import { EmailReplyDetector } from '../replyDetector.js';
import {
  FIXTURE_ORIGINAL_MESSAGE_ID,
  FIXTURE_PROXY_ADDRESS,
  FIXTURE_RECIPIENT_EMAIL,
  spoofedFromEmailFixture,
  validReplyEmailFixture,
} from '../fixtures/emails.js';
import { mockFn } from './mock.js';

describe('EmailWebhookHandler (POST /v1/webhooks/inbound-email)', () => {
  const secret = 'test-inbound-secret-xyz';
  let mockDal: any;
  let provider: PostmarkProvider;
  let detector: EmailReplyDetector;

  beforeEach(() => {
    provider = new PostmarkProvider();
    mockDal = {
      findMessageByProxyAddr: mockFn((proxyAddr: string) => {
        if (proxyAddr.toLowerCase() === FIXTURE_PROXY_ADDRESS.toLowerCase()) {
          return Promise.resolve({
            id: 'msg-100',
            recipient_id: 'user-alice',
            sender_addr: 'GBOB',
            status: 'delivered',
            proxy_addr: FIXTURE_PROXY_ADDRESS,
            external_ref: FIXTURE_ORIGINAL_MESSAGE_ID,
          });
        }
        return Promise.resolve(null);
      }),
      findChannelByKindAndExternalId: mockFn((kind: string, extId: string) => {
        if (kind === 'email' && extId.toLowerCase() === FIXTURE_RECIPIENT_EMAIL.toLowerCase()) {
          return Promise.resolve({
            id: 'ch-1',
            user_id: 'user-alice',
            kind: 'email',
            external_id: FIXTURE_RECIPIENT_EMAIL,
            verified_at: new Date(),
          });
        }
        return Promise.resolve(null);
      }),
      findReplyEvidenceByMessageId: mockFn(() => Promise.resolve([])),
      createReplyEvidence: mockFn((params: any) =>
        Promise.resolve({
          id: 'evidence-1',
          ...params,
        }),
      ),
      findMessageById: mockFn(),
      updateMessageExternalRef: mockFn(),
      updateMessageStatus: mockFn(),
    };

    detector = new EmailReplyDetector({
      dal: mockDal,
      emailChannelEnabled: true,
    });
  });

  afterEach(() => {
    detector.clear();
  });

  it('accepts valid inbound webhook when secret matches', async () => {
    const handler = new EmailWebhookHandler({
      provider,
      replyDetector: detector,
      webhookSecret: secret,
      emailChannelEnabled: true,
    });

    const res = await handler.handleWebhook({
      headers: {
        'x-inbound-webhook-secret': secret,
      },
      body: validReplyEmailFixture,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.accepted).toBe(true);
    expect(res.body.evidence_id).toBeDefined();
  });

  it('rejects with 403 Forbidden when webhook secret does not match', async () => {
    const handler = new EmailWebhookHandler({
      provider,
      replyDetector: detector,
      webhookSecret: secret,
      emailChannelEnabled: true,
    });

    const res = await handler.handleWebhook({
      headers: {
        'x-inbound-webhook-secret': 'wrong-secret',
      },
      body: validReplyEmailFixture,
    });

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('returns 503 Service Unavailable when EMAIL_CHANNEL_ENABLED is false', async () => {
    const handler = new EmailWebhookHandler({
      provider,
      replyDetector: detector,
      webhookSecret: secret,
      emailChannelEnabled: false,
    });

    const res = await handler.handleWebhook({
      headers: {
        'x-inbound-webhook-secret': secret,
      },
      body: validReplyEmailFixture,
    });

    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe('Service Unavailable');
  });

  it('returns 200 with accepted: false and reason for invalid reply (e.g. spoofed From)', async () => {
    const handler = new EmailWebhookHandler({
      provider,
      replyDetector: detector,
      webhookSecret: secret,
      emailChannelEnabled: true,
    });

    const res = await handler.handleWebhook({
      headers: {
        'x-inbound-webhook-secret': secret,
      },
      body: spoofedFromEmailFixture,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.accepted).toBe(false);
    expect(res.body.reason).toBe('SPOOFED_FROM');
  });
});
