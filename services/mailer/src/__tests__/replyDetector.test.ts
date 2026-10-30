import { EmailReplyDetector } from '../replyDetector.js';
import { PostmarkProvider } from '../providers/postmark.js';
import {
  FIXTURE_ORIGINAL_MESSAGE_ID,
  FIXTURE_PROXY_ADDRESS,
  FIXTURE_RECIPIENT_EMAIL,
  autoSubmittedEmailFixture,
  emptyReplyEmailFixture,
  failedAuthEmailFixture,
  outOfOfficeBodyEmailFixture,
  spoofedFromEmailFixture,
  threadingMismatchEmailFixture,
  validReplyEmailFixture,
  xAutoreplyEmailFixture,
} from '../fixtures/emails.js';
import { mockFn } from './mock.js';

describe('EmailReplyDetector (Email Flow & Validity Rules)', () => {
  const recipientId = 'recipient-user-uuid-1';
  const deliveredMessageId = 'message-uuid-100';

  let mockDal: any;
  let provider: PostmarkProvider;
  let forwardedEvidence: any[] = [];
  let relayedReplies: any[] = [];
  let activeDetectors: EmailReplyDetector[] = [];

  beforeEach(() => {
    forwardedEvidence = [];
    relayedReplies = [];
    provider = new PostmarkProvider();

    mockDal = {
      findMessageByProxyAddr: mockFn((proxyAddr: string) => {
        if (proxyAddr.toLowerCase() === FIXTURE_PROXY_ADDRESS.toLowerCase()) {
          return Promise.resolve({
            id: deliveredMessageId,
            recipient_id: recipientId,
            sender_addr: 'GBOB_SENDER_ADDR',
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
            id: 'channel-email-1',
            user_id: recipientId,
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
          id: 'evidence-email-uuid-1',
          ...params,
        }),
      ),
      findMessageById: mockFn(),
      updateMessageExternalRef: mockFn(),
      updateMessageStatus: mockFn(),
    };
  });

  const trackDetector = (d: EmailReplyDetector) => {
    activeDetectors.push(d);
    return d;
  };

  afterEach(() => {
    for (const d of activeDetectors) {
      d.clear();
    }
    activeDetectors = [];
  });

  it('valid email reply creates ReplyEvidence record (kind=email), payload and hash, and relays to sender', async () => {
    const detector = trackDetector(
      new EmailReplyDetector({
        dal: mockDal,
        minReplyWords: 1,
        vetoWindowSecs: 600,
        emailChannelEnabled: true,
        onForwardToOracle: (ev) => {
          forwardedEvidence.push(ev);
          return Promise.resolve();
        },
        onRelayToSender: (msgId, text) => {
          relayedReplies.push({ msgId, text });
          return Promise.resolve();
        },
      }),
    );

    const parsed = provider.parseInboundWebhook(validReplyEmailFixture);
    const result = await detector.processInboundEmail(parsed);

    expect(result.accepted).toBe(true);
    expect(result.evidence).toBeDefined();
    expect(result.evidence?.kind).toBe('email');
    expect(result.evidence?.hash).toBeInstanceOf(Buffer);
    expect(result.evidence?.payload).toMatchObject({
      channel: 'email',
      from: FIXTURE_RECIPIENT_EMAIL,
      to: FIXTURE_PROXY_ADDRESS,
      in_reply_to: FIXTURE_ORIGINAL_MESSAGE_ID,
      spf_status: 'pass',
      dkim_status: 'pass',
    });

    // Relayed to sender
    expect(relayedReplies.length).toBe(1);
    expect(relayedReplies[0].msgId).toBe(deliveredMessageId);
    expect(relayedReplies[0].text).toContain('Thanks for reaching out!');
  });

  it('rejects spoofed From address not matching registered recipient address', async () => {
    const detector = trackDetector(
      new EmailReplyDetector({
        dal: mockDal,
        emailChannelEnabled: true,
      }),
    );

    const parsed = provider.parseInboundWebhook(spoofedFromEmailFixture);
    const result = await detector.processInboundEmail(parsed);

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('SPOOFED_FROM');
  });

  it('rejects reply when SPF or DKIM fails', async () => {
    const detector = trackDetector(
      new EmailReplyDetector({
        dal: mockDal,
        emailChannelEnabled: true,
      }),
    );

    const parsed = provider.parseInboundWebhook(failedAuthEmailFixture);
    const result = await detector.processInboundEmail(parsed);

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('AUTH_RESULTS_FAILED');
  });

  it('rejects threading mismatch when In-Reply-To / References do not match original Message-ID', async () => {
    const detector = trackDetector(
      new EmailReplyDetector({
        dal: mockDal,
        emailChannelEnabled: true,
      }),
    );

    const parsed = provider.parseInboundWebhook(threadingMismatchEmailFixture);
    const result = await detector.processInboundEmail(parsed);

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('THREADING_MISMATCH');
  });

  it('rejects auto-replies via Auto-Submitted header', async () => {
    const detector = trackDetector(
      new EmailReplyDetector({
        dal: mockDal,
        emailChannelEnabled: true,
      }),
    );

    const parsed = provider.parseInboundWebhook(autoSubmittedEmailFixture);
    const result = await detector.processInboundEmail(parsed);

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('AUTO_REPLY');
  });

  it('rejects auto-replies via X-Autoreply header', async () => {
    const detector = trackDetector(
      new EmailReplyDetector({
        dal: mockDal,
        emailChannelEnabled: true,
      }),
    );

    const parsed = provider.parseInboundWebhook(xAutoreplyEmailFixture);
    const result = await detector.processInboundEmail(parsed);

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('AUTO_REPLY');
  });

  it('rejects auto-replies matching out-of-office heuristics in body / subject', async () => {
    const detector = trackDetector(
      new EmailReplyDetector({
        dal: mockDal,
        emailChannelEnabled: true,
      }),
    );

    const parsed = provider.parseInboundWebhook(outOfOfficeBodyEmailFixture);
    const result = await detector.processInboundEmail(parsed);

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('AUTO_REPLY');
  });

  it('rejects empty or reaction-only replies', async () => {
    const detector = trackDetector(
      new EmailReplyDetector({
        dal: mockDal,
        emailChannelEnabled: true,
      }),
    );

    const parsed = provider.parseInboundWebhook(emptyReplyEmailFixture);
    const result = await detector.processInboundEmail(parsed);

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('REACTION_OR_EMPTY');
  });

  it('rejects duplicate reply when evidence already exists (replay prevention)', async () => {
    mockDal.findReplyEvidenceByMessageId = mockFn(() =>
      Promise.resolve([{ id: 'already-existing-evidence' }]),
    );

    const detector = trackDetector(
      new EmailReplyDetector({
        dal: mockDal,
        emailChannelEnabled: true,
      }),
    );

    const parsed = provider.parseInboundWebhook(validReplyEmailFixture);
    const result = await detector.processInboundEmail(parsed);

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('ALREADY_SUBMITTED');
  });

  it('enforces recipient veto window: recipient can veto within window to prevent oracle submission', async () => {
    const detector = trackDetector(
      new EmailReplyDetector({
        dal: mockDal,
        vetoWindowSecs: 600,
        emailChannelEnabled: true,
        onForwardToOracle: (ev) => {
          forwardedEvidence.push(ev);
          return Promise.resolve();
        },
      }),
    );

    const parsed = provider.parseInboundWebhook(validReplyEmailFixture);
    const result = await detector.processInboundEmail(parsed);

    expect(result.accepted).toBe(true);
    expect(detector.isVetoed(result.evidence!.id)).toBe(false);

    // Recipient clicks "Not a real reply"
    const vetoRes = detector.veto(deliveredMessageId);
    expect(vetoRes.success).toBe(true);
    expect(detector.isVetoed(result.evidence!.id)).toBe(true);

    // Oracle should not be called
    expect(forwardedEvidence.length).toBe(0);
  });

  it('rejects when EMAIL_CHANNEL_ENABLED is false', async () => {
    const detector = trackDetector(
      new EmailReplyDetector({
        dal: mockDal,
        emailChannelEnabled: false,
      }),
    );

    const parsed = provider.parseInboundWebhook(validReplyEmailFixture);
    const result = await detector.processInboundEmail(parsed);

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('CHANNEL_DISABLED');
  });
});
