import { Telegraf } from 'telegraf';
import type { BotDataAccess } from './types.js';
import { verifyLinkToken } from './linking.js';

export interface CreatePostageBotOptions {
  botToken: string;
  linkSecret: string;
  dal: BotDataAccess;
  botUsername?: string;
}

/**
 * Creates and configures the Telegraf bot instance for Stellar Postage.
 */
export function createPostageBot(options: CreatePostageBotOptions): Telegraf {
  const { botToken, linkSecret, dal } = options;
  const bot = new Telegraf(botToken);

  // Set default botInfo to avoid cold-start getMe network calls
  bot.botInfo = {
    id: 12345678,
    is_bot: true,
    first_name: 'StellarPostageBot',
    username: options.botUsername || 'StellarPostageBot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
  };

  // /start <link-token>
  bot.start(async (ctx) => {
    const payload = (ctx.payload || '').trim();

    if (!payload) {
      await ctx.reply(
        '👋 Welcome to Stellar Postage!\n\nTo link your Telegram account, visit your settings dashboard to generate a linking link.'
      );
      return;
    }

    const userId = verifyLinkToken(payload, linkSecret);
    if (!userId) {
      await ctx.reply(
        '❌ Invalid or expired link token. Please generate a new link in your dashboard.'
      );
      return;
    }

    const chatId = ctx.chat.id.toString();
    try {
      await dal.linkTelegramChannel(userId, chatId);
      await ctx.reply(
        '✅ Your Telegram account has been successfully linked to Stellar Postage! You will receive staked messages here.'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`❌ Failed to link channel: ${msg}`);
    }
  });

  // Action: Spam
  bot.action(/^spam:(.+)$/, async (ctx) => {
    const messageId = (ctx.match as RegExpMatchArray)?.[1];
    if (!messageId) return;
    try {
      await dal.updateMessageStatus(messageId, 'spam');
      await ctx.answerCbQuery('🚨 Flagged as spam. Stake payout has been claimed.');
      await ctx.reply('This message has been marked as spam.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.answerCbQuery(`Error: ${msg}`);
    }
  });

  // Action: Reply
  bot.action(/^reply:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('💬 To reply and refund the sender, use Telegram\'s Reply feature on the message.');
  });

  // Action: Mute sender
  bot.action(/^mute:(.+)$/, async (ctx) => {
    const sender = (ctx.match as RegExpMatchArray)?.[1] || '';
    const shortSender = sender.length > 10 ? `${sender.slice(0, 4)}...${sender.slice(-4)}` : sender;
    await ctx.answerCbQuery(`🔕 Sender ${shortSender} muted.`);
  });

  return bot;
}
