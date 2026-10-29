import { deliverStakedMessage } from '../delivery.js';
import { mockFn } from './mock.js';

describe('Staked Message Delivery', () => {
  it('sends message with correct header, inline buttons, and persists external_ref', async () => {
    let sentToChat: any = null;
    let sentText: string = '';
    let sentOptions: any = null;

    const mockBot = {
      telegram: {
        sendMessage: mockFn(async (chatId: any, text: any, options: any) => {
          sentToChat = chatId;
          sentText = text;
          sentOptions = options;
          return { message_id: 98765 };
        }),
      },
    } as any;

    let updatedExternalRef: { id: string; ref: string } | null = null;
    const mockDal = {
      updateMessageExternalRef: mockFn(async (id: string, ref: string) => {
        updatedExternalRef = { id, ref };
        return { id, external_ref: ref };
      }),
    } as any;

    const res = await deliverStakedMessage(mockBot, mockDal, {
      chatId: '123456789',
      messageId: 'msg-uuid-1',
      senderAddr: 'GBOB_STELLAR_ADDRESS',
      amountUsdc: '5',
      body: 'Hi Alice, let us connect!',
      stakeId: 42n,
    });

    expect(res.messageId).toBe('msg-uuid-1');
    expect(res.externalRef).toBe('98765');
    expect(sentToChat).toBe('123456789');

    // Header check
    expect(sentText).toContain('Message from GBOB_STELLAR_ADDRESS, staked 5 USDC');
    expect(sentText).toContain('Hi Alice, let us connect!');

    // Inline buttons check: Reply, Spam, Mute sender
    expect(sentOptions.reply_markup).toBeDefined();
    const buttons = sentOptions.reply_markup.inline_keyboard[0];
    expect(buttons).toHaveLength(3);
    expect(buttons[0].text).toContain('Reply');
    expect(buttons[0].callback_data).toBe('reply:msg-uuid-1');
    expect(buttons[1].text).toContain('Spam');
    expect(buttons[1].callback_data).toBe('spam:msg-uuid-1');
    expect(buttons[2].text).toContain('Mute sender');
    expect(buttons[2].callback_data).toBe('mute:GBOB_STELLAR_ADDRESS');

    // Check external_ref saved to db
    expect(updatedExternalRef).toEqual({
      id: 'msg-uuid-1',
      ref: '98765',
    });
  });
});
