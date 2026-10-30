import { PostmarkProvider } from '../providers/postmark.js';
import { validReplyEmailFixture } from '../fixtures/emails.js';

describe('PostmarkProvider', () => {
  it('instantiates with default options and name postmark', () => {
    const provider = new PostmarkProvider();
    expect(provider.name).toBe('postmark');
  });

  it('sendEmail returns a valid Message-ID in mock mode', async () => {
    const provider = new PostmarkProvider();
    const result = await provider.sendEmail({
      from: 'postage@reply.example.com',
      to: 'alice@example.com',
      replyTo: 's_8f3a9c@reply.example.com',
      subject: 'Message from Bob',
      textBody: 'Hello Alice, pitch attached.',
    });

    expect(result.messageId).toBeDefined();
    expect(result.messageId).toMatch(/^<.+@postmarkapp\.com>$/);
  });

  it('parseInboundWebhook correctly parses inbound email fields and authentication results', () => {
    const provider = new PostmarkProvider();
    const parsed = provider.parseInboundWebhook(validReplyEmailFixture);

    expect(parsed.from).toBe('alice@example.com');
    expect(parsed.to).toBe('s_8f3a9c@reply.example.com');
    expect(parsed.subject).toContain('Re: Message from Bob');
    expect(parsed.textBody).toContain('Thanks for reaching out!');
    expect(parsed.spfStatus).toBe('pass');
    expect(parsed.dkimStatus).toBe('pass');
    expect(parsed.dmarcStatus).toBe('pass');
    expect(parsed.inReplyTo).toBe('<orig-message-uuid-100@reply.example.com>');
    expect(parsed.references).toContain('<orig-message-uuid-100@reply.example.com>');
  });

  it('verifyWebhookSecret checks x-inbound-webhook-secret and bearer headers', () => {
    const provider = new PostmarkProvider();
    const secret = 'super-secret-token-123';

    expect(provider.verifyWebhookSecret({ 'x-inbound-webhook-secret': secret }, secret)).toBe(true);

    expect(provider.verifyWebhookSecret({ 'x-postmark-secret': secret }, secret)).toBe(true);

    expect(provider.verifyWebhookSecret({ authorization: `Bearer ${secret}` }, secret)).toBe(true);

    expect(
      provider.verifyWebhookSecret({ 'x-inbound-webhook-secret': 'wrong-secret' }, secret),
    ).toBe(false);

    expect(provider.verifyWebhookSecret({}, secret)).toBe(false);
  });
});
