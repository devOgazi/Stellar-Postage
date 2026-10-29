/**
 * services/bot/src/index.ts
 */

export * from './types.js';
export * from './linking.js';
export * from './idempotency.js';
export * from './delivery.js';
export * from './bot.js';
export * from './webhook.js';
export { Telegraf } from 'telegraf';

import { createPostageBot } from './bot.js';
import { TelegramWebhookHandler } from './webhook.js';

// CLI entrypoint if executed directly
if (process.argv[1]?.endsWith('services/bot/src/index.ts')) {
  const token = process.env['TELEGRAM_BOT_TOKEN'];
  if (!token) {
    console.log('TELEGRAM_BOT_TOKEN not configured. Bot service idle.');
  } else {
    console.log('Starting Postage Telegram bot in polling/dev mode...');
    const bot = createPostageBot({
      botToken: token,
      linkSecret: process.env['SESSION_SECRET'] || 'dev-secret',
      dal: {
        async linkTelegramChannel() { return {} as any; },
        async findMessageById() { return null; },
        async findMessageByExternalRef() { return null; },
        async updateMessageExternalRef() { return {} as any; },
        async updateMessageStatus() { return {} as any; },
      },
    });
    bot.launch().then(() => console.log('Telegram bot active.'));
  }
}
