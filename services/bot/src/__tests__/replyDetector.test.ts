import { ReplyDetector } from '../replyDetector.js';
import { mockFn } from './mock.js';

describe('Reply Detection and Reply Validity Rules', () => {
  const recipientId = 'recipient-user-uuid-1';
  const deliveredMessageId = 'message-uuid-1';
  const externalRef = '100';
  const recipientChatId = '123456789';

  let mockDal: any;
  let forwardedEvidence: any[] = [];
  let relayedReplies: any[] = [];

  beforeEach(() => {
    forwardedEvidence = [];
    relayedReplies = [];

    mockDal = {
      findMessageByExternalRef: mockFn(async (ref: string) => {
        if (ref === externalRef) {
          return {
            id: deliveredMessageId,
            recipient_id: recipientId,
            sender_addr: 'GBOB_SENDER_ADDR',
            status: 'delivered',
            external_ref: externalRef,
          };
        }
        return null;
      }),
      findChannelByKindAndExternalId: mockFn(async (kind: string, extId: string) => {
        if (kind === 'telegram' && extId === recipientChatId) {
          return {
            id: 'channel-1',
            user_id: recipientId,
            kind: 'telegram',
            external_id: recipientChatId,
            verified_at: new Date(),
          };
        }
        return null;
      }),
      findReplyEvidenceByMessageId: mockFn(async () => []),
      createReplyEvidence: mockFn(async (params: any) => ({
        id: 'evidence-uuid-1',
        ...params,
      })),
      linkTelegramChannel: mockFn(),
      findMessageById: mockFn(),
      updateMessageExternalRef: mockFn(),
      updateMessageStatus: mockFn(),
    };
  });

  let activeDetectors: ReplyDetector[] = [];
  const trackDetector = (d: ReplyDetector) => {
    activeDetectors.push(d);
    return d;
  };

  afterEach(() => {
    for (const d of activeDetectors) {
      d.clear();
    }
    activeDetectors = [];
  });

  const makeUpdate = (overrides?: any) => ({
    update_id: 1001,
    message: {
      message_id: 200,
      reply_to_message: {
        message_id: 100, // matches externalRef 'telegram-msg-100' or 100
      },
      chat: { id: 123456789 },
      from: { id: 123456789, is_bot: false },
      text: 'Thanks for reaching out! Let us schedule a call.',
      ...overrides,
    },
  });

  it('valid reply creates ReplyEvidence record with kind=telegram, payload, and hash', async () => {
    const detector = trackDetector(new ReplyDetector({
      dal: mockDal,
      minReplyWords: 1,
      vetoWindowSecs: 600,
      onForwardToOracle: async (ev) => { forwardedEvidence.push(ev); },
      onRelayToSender: async (msgId, text) => { relayedReplies.push({ msgId, text }); },
    }));

    const update = makeUpdate();
    const result = await detector.processUpdate(update);

    expect(result.accepted).toBe(true);
    expect(result.evidence).toBeDefined();
    expect(result.evidence?.kind).toBe('telegram');
    expect(result.evidence?.hash).toBeInstanceOf(Buffer);
    expect(result.evidence?.payload).toMatchObject({
      reply_message_id: 200,
      reply_to_message_id: 100,
      text: 'Thanks for reaching out! Let us schedule a call.',
    });

    // Dal called to persist reply evidence
    expect(mockDal.createReplyEvidence.calls).toHaveLength(1);
    // Relayed reply text to sender in-app
    expect(relayedReplies).toHaveLength(1);
    expect(relayedReplies[0].text).toContain('Thanks for reaching out');
  });

  it('Rule 1: rejects reaction-only or empty reply', async () => {
    const detector = trackDetector(new ReplyDetector({ dal: mockDal }));

    // Empty text / reaction-only
    const emptyUpdate = makeUpdate({ text: '' });
    const res1 = await detector.processUpdate(emptyUpdate);
    expect(res1.accepted).toBe(false);
    expect(res1.reason).toBe('REACTION_OR_EMPTY');

    // Whitespace only
    const wsUpdate = makeUpdate({ text: '   ' });
    const res2 = await detector.processUpdate(wsUpdate);
    expect(res2.accepted).toBe(false);
    expect(res2.reason).toBe('REACTION_OR_EMPTY');
  });

  it('Rule 1: rejects reply below MIN_REPLY_WORDS', async () => {
    const detector = new ReplyDetector({ dal: mockDal, minReplyWords: 3 });

    const shortUpdate = makeUpdate({ text: 'Two words' });
    const res = await detector.processUpdate(shortUpdate);
    expect(res.accepted).toBe(false);
    expect(res.reason).toBe('TOO_SHORT');
  });

  it('Rule 2: rejects bot replies', async () => {
    const detector = trackDetector(new ReplyDetector({ dal: mockDal }));

    const botUpdate = makeUpdate({
      from: { id: 99999, is_bot: true },
      text: 'Automated greeting message.',
    });
    const res = await detector.processUpdate(botUpdate);
    expect(res.accepted).toBe(false);
    expect(res.reason).toBe('IS_BOT');
  });

  it('Rule 2: rejects auto-reply and out of office responses', async () => {
    const detector = trackDetector(new ReplyDetector({ dal: mockDal }));

    const autoReplies = [
      'This is an automatic reply: I am currently out of office until Monday.',
      'Auto-reply: away from my desk.',
      'Vacation responder: I will check emails when I return.',
    ];

    for (const text of autoReplies) {
      const update = makeUpdate({ text });
      const res = await detector.processUpdate(update);
      expect(res.accepted).toBe(false);
      expect(res.reason).toBe('AUTO_REPLY');
    }
  });

  it('Rule 3: rejects reply from wrong or unverified chat', async () => {
    const detector = trackDetector(new ReplyDetector({ dal: mockDal }));

    // Reply from random third-party chat
    const wrongChatUpdate = makeUpdate({
      chat: { id: 999999999 },
    });
    const res = await detector.processUpdate(wrongChatUpdate);
    expect(res.accepted).toBe(false);
    expect(res.reason).toBe('WRONG_CHAT_OR_UNVERIFIED');
  });

  it('Rule 4: enforces one refund per stake (rejects duplicate replies)', async () => {
    // Mock that reply evidence already exists for this message
    mockDal.findReplyEvidenceByMessageId = mockFn(async () => [
      { id: 'existing-evidence', message_id: deliveredMessageId },
    ]);

    const detector = trackDetector(new ReplyDetector({ dal: mockDal }));
    const res = await detector.processUpdate(makeUpdate());
    expect(res.accepted).toBe(false);
    expect(res.reason).toBe('ALREADY_SUBMITTED');
  });

  it('Rule 5: veto inside the window cancels forwarding to oracle', async () => {
    let forwarded = false;
    const detector = trackDetector(new ReplyDetector({
      dal: mockDal,
      vetoWindowSecs: 10, // 10 seconds window
      onForwardToOracle: async () => { forwarded = true; },
    }));

    const now = 1_000_000;
    const result = await detector.processUpdate(makeUpdate(), now);
    expect(result.accepted).toBe(true);
    const evidenceId = result.evidence!.id;

    // Recipient presses "Not a real reply" 5 seconds later (inside 10s window)
    const vetoRes = detector.veto(evidenceId, now + 5_000);
    expect(vetoRes.success).toBe(true);
    expect(detector.isVetoed(evidenceId)).toBe(true);

    // Forwarding to oracle must never occur
    expect(forwarded).toBe(false);
  });

  it('Rule 5: veto after the window has expired is rejected', async () => {
    const detector = trackDetector(new ReplyDetector({
      dal: mockDal,
      vetoWindowSecs: 10, // 10 seconds window
    }));

    const now = 1_000_000;
    const result = await detector.processUpdate(makeUpdate(), now);
    expect(result.accepted).toBe(true);
    const evidenceId = result.evidence!.id;

    // Recipient attempts to veto 15 seconds later (after 10s window)
    const vetoRes = detector.veto(evidenceId, now + 15_000);
    expect(vetoRes.success).toBe(false);
    expect(vetoRes.error).toContain('expired');
  });
});
