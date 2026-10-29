import { Telegram } from 'telegraf';
import { createPostageBot } from '../bot.js';
import { generateLinkToken } from '../linking.js';
import { mockFn } from './mock.js';

describe('Postage Telegram Bot Handler', () => {
  const secret = 'super-secret-key-32-bytes-minimum-length';
  let mockDal: any;
  let bot: any;
  let sentMessages: { chatId: any; text: string }[] = [];
  let answeredCb: { id: any; text?: string }[] = [];
  let originalCallApi: any;

  beforeEach(() => {
    sentMessages = [];
    answeredCb = [];
    originalCallApi = (Telegram.prototype as any).callApi;

    (Telegram.prototype as any).callApi = async function (method: string, data: any) {
      if (method === 'sendMessage') {
        sentMessages.push({ chatId: data.chat_id, text: data.text });
      } else if (method === 'answerCallbackQuery') {
        answeredCb.push({ id: data.callback_query_id, text: data.text });
      } else if (method === 'getMe') {
        return { id: 123456, is_bot: true, first_name: 'PostageBot', username: 'StellarPostageBot' };
      }
      return true;
    };

    mockDal = {
      linkTelegramChannel: mockFn(async () => ({ id: 'chan-1', kind: 'telegram', external_id: '999' })),
      updateMessageStatus: mockFn(async () => ({ id: 'msg-1', status: 'spam' })),
      updateMessageExternalRef: mockFn(),
      findMessageById: mockFn(),
      findMessageByExternalRef: mockFn(),
    };

    bot = createPostageBot({
      botToken: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
      linkSecret: secret,
      dal: mockDal,
    });
  });

  afterEach(() => {
    (Telegram.prototype as any).callApi = originalCallApi;
  });

  it('links chat to user on /start with valid link token', async () => {
    const userId = 'usr-12345';
    const token = generateLinkToken(userId, secret);

    const update = {
      update_id: 1,
      message: {
        message_id: 10,
        from: { id: 999, is_bot: false, first_name: 'Alice' },
        chat: { id: 999, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: `/start ${token}`,
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      },
    };

    await bot.handleUpdate(update);

    expect(mockDal.linkTelegramChannel.calls).toHaveLength(1);
    expect(mockDal.linkTelegramChannel.calls[0]).toEqual([userId, '999']);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.text).toContain('successfully linked');
  });

  it('rejects /start with invalid link token', async () => {
    const update = {
      update_id: 2,
      message: {
        message_id: 11,
        from: { id: 888, is_bot: false, first_name: 'Bob' },
        chat: { id: 888, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: `/start invalid-token`,
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      },
    };

    await bot.handleUpdate(update);

    expect(mockDal.linkTelegramChannel.calls).toHaveLength(0);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.text).toContain('Invalid or expired');
  });

  it('handles spam action button', async () => {
    const update = {
      update_id: 3,
      callback_query: {
        id: 'cb-1',
        from: { id: 999, is_bot: false, first_name: 'Alice' },
        message: { message_id: 100, chat: { id: 999, type: 'private' } },
        chat_instance: 'instance-1',
        data: 'spam:msg-123',
      },
    };

    await bot.handleUpdate(update);

    expect(mockDal.updateMessageStatus.calls).toHaveLength(1);
    expect(mockDal.updateMessageStatus.calls[0]).toEqual(['msg-123', 'spam']);
    expect(answeredCb).toHaveLength(1);
    expect(answeredCb[0]?.text).toContain('Flagged as spam');
  });

  it('handles reply and mute action buttons', async () => {
    // Reply button
    await bot.handleUpdate({
      update_id: 4,
      callback_query: {
        id: 'cb-2',
        from: { id: 999, is_bot: false },
        data: 'reply:msg-123',
      },
    });
    expect(answeredCb.some((a) => a.text?.includes('Telegram\'s Reply feature'))).toBe(true);

    // Mute button
    await bot.handleUpdate({
      update_id: 5,
      callback_query: {
        id: 'cb-3',
        from: { id: 999, is_bot: false },
        data: 'mute:G_SOME_SENDER',
      },
    });
    expect(answeredCb.some((a) => a.text?.includes('Sender G_SO...NDER muted'))).toBe(true);
  });
});
