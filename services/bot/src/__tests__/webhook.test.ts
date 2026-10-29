import { TelegramWebhookHandler } from '../webhook.js';
import { mockFn } from './mock.js';

describe('Telegram Webhook Handler', () => {
  const secret = 'telegram-webhook-secret-token-123';
  let mockBot: any;
  let handler: TelegramWebhookHandler;

  beforeEach(() => {
    mockBot = {
      handleUpdate: mockFn(async () => true),
    };

    handler = new TelegramWebhookHandler({
      bot: mockBot,
      webhookSecret: secret,
    });
  });

  it('accepts update with valid secret token', async () => {
    const res = await handler.handleWebhook({
      headers: {
        'x-telegram-bot-api-secret-token': secret,
      },
      body: {
        update_id: 100,
        message: { text: 'hello' },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockBot.handleUpdate.calls).toHaveLength(1);
  });

  it('rejects update with invalid secret token (403)', async () => {
    const res = await handler.handleWebhook({
      headers: {
        'x-telegram-bot-api-secret-token': 'wrong-secret',
      },
      body: {
        update_id: 101,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.body['error']).toBe('Forbidden');
    expect(mockBot.handleUpdate.calls).toHaveLength(0);
  });

  it('rejects update with missing secret token (403)', async () => {
    const res = await handler.handleWebhook({
      headers: {},
      body: {
        update_id: 102,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.body['error']).toBe('Forbidden');
  });

  it('is idempotent for duplicate updates', async () => {
    const update = {
      update_id: 200,
      message: { text: 'duplicate test' },
    };

    const first = await handler.handleWebhook({
      headers: { 'x-telegram-bot-api-secret-token': secret },
      body: update,
    });
    expect(first.statusCode).toBe(200);
    expect(mockBot.handleUpdate.calls).toHaveLength(1);

    // Same update_id again
    const second = await handler.handleWebhook({
      headers: { 'x-telegram-bot-api-secret-token': secret },
      body: update,
    });
    expect(second.statusCode).toBe(200);
    expect(second.body).toEqual({ ok: true, duplicate: true });
    // Bot should NOT be invoked a second time
    expect(mockBot.handleUpdate.calls).toHaveLength(1);
  });
});
