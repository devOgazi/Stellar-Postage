import { deliverEmailMessage } from '../delivery.js';
import { mockFn } from './mock.js';

describe('deliverEmailMessage', () => {
  const messageId = 'msg-uuid-1';
  const senderAddr = 'GBOB_SENDER_ADDR';
  const recipientEmail = 'alice@example.com';
  const inboundDomain = 'reply.example.com';

  let mockDal: any;
  let mockProvider: any;

  beforeEach(() => {
    mockDal = {
      updateMessageProxyAddr: mockFn(() => Promise.resolve({})),
      updateMessageExternalRef: mockFn(() => Promise.resolve({})),
      updateMessageStatus: mockFn(() => Promise.resolve({})),
    };

    mockProvider = {
      name: 'postmark',
      sendEmail: mockFn((_params: any) =>
        Promise.resolve({
          messageId: `<delivered-${messageId}@postmarkapp.com>`,
        }),
      ),
      parseInboundWebhook: mockFn(),
      verifyWebhookSecret: mockFn(),
    };
  });

  it('generates proxy address, sends email with sender in body and Reply-To, and persists refs', async () => {
    const result = await deliverEmailMessage({
      provider: mockProvider,
      dal: mockDal,
      emailChannelEnabled: true,
      params: {
        messageId,
        senderAddr,
        recipientEmail,
        amountUsdc: '5',
        body: 'Here is my pitch deck!',
        inboundDomain,
      },
    });

    expect(result.messageId).toBe(messageId);
    expect(result.proxyAddr).toMatch(/^s_[a-f0-9]+@reply\.example\.com$/);
    expect(result.externalRef).toBe(`<delivered-${messageId}@postmarkapp.com>`);

    // Verify provider was called with sender in body and Reply-To as proxy
    expect(mockProvider.sendEmail.calls.length).toBe(1);
    const sentParams = mockProvider.sendEmail.calls[0][0];
    expect(sentParams.to).toBe(recipientEmail);
    expect(sentParams.replyTo).toBe(result.proxyAddr);
    expect(sentParams.textBody).toContain(`Message from ${senderAddr}, staked 5 USDC`);
    expect(sentParams.textBody).toContain('Here is my pitch deck!');

    // Verify DAL updates
    expect(mockDal.updateMessageProxyAddr.calls.length).toBe(1);
    expect(mockDal.updateMessageProxyAddr.calls[0]).toEqual([messageId, result.proxyAddr]);
    expect(mockDal.updateMessageExternalRef.calls.length).toBe(1);
    expect(mockDal.updateMessageExternalRef.calls[0]).toEqual([messageId, result.externalRef]);
    expect(mockDal.updateMessageStatus.calls.length).toBe(1);
    expect(mockDal.updateMessageStatus.calls[0]).toEqual([messageId, 'delivered']);
  });

  it('throws error when EMAIL_CHANNEL_ENABLED is false', async () => {
    await expect(
      deliverEmailMessage({
        provider: mockProvider,
        dal: mockDal,
        emailChannelEnabled: false,
        params: {
          messageId,
          senderAddr,
          recipientEmail,
          amountUsdc: '5',
          body: 'Hello',
          inboundDomain,
        },
      }),
    ).rejects.toThrow('EMAIL_CHANNEL_DISABLED');
  });
});
