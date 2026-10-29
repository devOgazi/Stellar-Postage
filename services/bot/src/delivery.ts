import { Markup, type Telegraf } from 'telegraf';
import type { BotDataAccess, DeliverStakedMessageParams } from './types.js';

/**
 * Delivers a staked message to a recipient on Telegram with action buttons,
 * and saves the Telegram message_id to messages.external_ref.
 */
export async function deliverStakedMessage(
  bot: Telegraf,
  dal: BotDataAccess,
  params: DeliverStakedMessageParams
): Promise<{ messageId: string; externalRef: string }> {
  const header = `Message from ${params.senderAddr}, staked ${params.amountUsdc} USDC`;
  const text = `${header}\n\n${params.body}`;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('💬 Reply', `reply:${params.messageId}`),
      Markup.button.callback('🚨 Spam', `spam:${params.messageId}`),
      Markup.button.callback('🔕 Mute sender', `mute:${params.senderAddr}`),
    ],
  ]);

  const sent = await bot.telegram.sendMessage(params.chatId, text, {
    reply_markup: keyboard.reply_markup,
  });

  const externalRef = sent.message_id.toString();

  // Persist the Telegram message_id in messages.external_ref
  await dal.updateMessageExternalRef(params.messageId, externalRef);

  return {
    messageId: params.messageId,
    externalRef,
  };
}
