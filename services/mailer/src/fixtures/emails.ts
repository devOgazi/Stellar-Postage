/**
 * services/mailer/src/fixtures/emails.ts
 * Email fixtures for testing inbound parse and reply detection.
 */

export const FIXTURE_ORIGINAL_MESSAGE_ID = '<orig-message-uuid-100@reply.example.com>';
export const FIXTURE_PROXY_ADDRESS = 's_8f3a9c@reply.example.com';
export const FIXTURE_RECIPIENT_EMAIL = 'alice@example.com';
export const FIXTURE_ATTACKER_EMAIL = 'eve@evil.com';

export function createPostmarkInboundFixture(
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    From: `"Alice Smith" <${FIXTURE_RECIPIENT_EMAIL}>`,
    FromName: 'Alice Smith',
    FromFull: {
      Email: FIXTURE_RECIPIENT_EMAIL,
      Name: 'Alice Smith',
    },
    To: `"Postage Reply" <${FIXTURE_PROXY_ADDRESS}>`,
    ToFull: [
      {
        Email: FIXTURE_PROXY_ADDRESS,
        Name: 'Postage Reply',
      },
    ],
    OriginalRecipient: FIXTURE_PROXY_ADDRESS,
    Subject: 'Re: Message from Bob (Staked 5 USDC)',
    MessageID: '<reply-uuid-200@postmarkapp.com>',
    Date: 'Fri, 30 Oct 2026 12:00:00 +0000',
    TextBody: 'Thanks for reaching out! Happy to chat tomorrow.',
    StrippedTextReply: 'Thanks for reaching out! Happy to chat tomorrow.',
    Headers: [
      {
        Name: 'In-Reply-To',
        Value: FIXTURE_ORIGINAL_MESSAGE_ID,
      },
      {
        Name: 'References',
        Value: FIXTURE_ORIGINAL_MESSAGE_ID,
      },
      {
        Name: 'Auto-Submitted',
        Value: 'no',
      },
      {
        Name: 'Authentication-Results',
        Value:
          'mx.postmarkapp.com; dkim=pass header.i=@example.com; spf=pass (sender IP is 1.2.3.4); dmarc=pass',
      },
    ],
    SPF: 'Pass',
    DKIMVerified: true,
    ...overrides,
  };
}

/** 1. Valid reply */
export const validReplyEmailFixture = createPostmarkInboundFixture();

/** 2. Spoofed From address */
export const spoofedFromEmailFixture = createPostmarkInboundFixture({
  From: `"Evil Eve" <${FIXTURE_ATTACKER_EMAIL}>`,
  FromFull: {
    Email: FIXTURE_ATTACKER_EMAIL,
    Name: 'Evil Eve',
  },
});

/** 3. Failed DKIM / SPF */
export const failedAuthEmailFixture = createPostmarkInboundFixture({
  SPF: 'Fail',
  DKIMVerified: false,
  Headers: [
    {
      Name: 'In-Reply-To',
      Value: FIXTURE_ORIGINAL_MESSAGE_ID,
    },
    {
      Name: 'References',
      Value: FIXTURE_ORIGINAL_MESSAGE_ID,
    },
    {
      Name: 'Authentication-Results',
      Value: 'mx.postmarkapp.com; dkim=fail; spf=fail (sender IP is 1.2.3.4); dmarc=fail',
    },
  ],
});

/** 4. Threading mismatch (In-Reply-To / References do not match original Message-ID) */
export const threadingMismatchEmailFixture = createPostmarkInboundFixture({
  Headers: [
    {
      Name: 'In-Reply-To',
      Value: '<completely-unrelated-msg-999@other.com>',
    },
    {
      Name: 'References',
      Value: '<completely-unrelated-msg-999@other.com>',
    },
    {
      Name: 'Authentication-Results',
      Value: 'mx.postmarkapp.com; dkim=pass; spf=pass; dmarc=pass',
    },
  ],
});

/** 5. Auto-reply via Auto-Submitted header */
export const autoSubmittedEmailFixture = createPostmarkInboundFixture({
  Headers: [
    {
      Name: 'In-Reply-To',
      Value: FIXTURE_ORIGINAL_MESSAGE_ID,
    },
    {
      Name: 'References',
      Value: FIXTURE_ORIGINAL_MESSAGE_ID,
    },
    {
      Name: 'Auto-Submitted',
      Value: 'auto-replied',
    },
    {
      Name: 'Authentication-Results',
      Value: 'mx.postmarkapp.com; dkim=pass; spf=pass; dmarc=pass',
    },
  ],
});

/** 6. Auto-reply via X-Autoreply header */
export const xAutoreplyEmailFixture = createPostmarkInboundFixture({
  Headers: [
    {
      Name: 'In-Reply-To',
      Value: FIXTURE_ORIGINAL_MESSAGE_ID,
    },
    {
      Name: 'References',
      Value: FIXTURE_ORIGINAL_MESSAGE_ID,
    },
    {
      Name: 'X-Autoreply',
      Value: 'yes',
    },
    {
      Name: 'Authentication-Results',
      Value: 'mx.postmarkapp.com; dkim=pass; spf=pass; dmarc=pass',
    },
  ],
});

/** 7. Out-of-office heuristics in body */
export const outOfOfficeBodyEmailFixture = createPostmarkInboundFixture({
  Subject: 'Automatic reply: Out of office',
  TextBody:
    'I am currently out of the office on annual leave. I will reply upon my return next Monday.',
  StrippedTextReply:
    'I am currently out of the office on annual leave. I will reply upon my return next Monday.',
});

/** 8. Empty or reaction-only reply */
export const emptyReplyEmailFixture = createPostmarkInboundFixture({
  TextBody: '',
  StrippedTextReply: '',
});
