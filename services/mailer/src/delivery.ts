/**
 * services/mailer/src/delivery.ts
 * Outbound email delivery for staked messages.
 * README: "Deliver the message to the recipient's real inbox with Reply-To set to the proxy address.
 * The sender's identity is shown in the body."
 */

import { generateProxyAddress } from './proxy.js';
import type { DeliverEmailParams, EmailProvider, MailerDataAccess } from './types.js';

export interface DeliverEmailOptions {
  provider: EmailProvider;
  dal: MailerDataAccess;
  params: DeliverEmailParams;
  emailChannelEnabled?: boolean | undefined;
}

export async function deliverEmailMessage(
  options: DeliverEmailOptions,
): Promise<{ messageId: string; externalRef: string; proxyAddr: string }> {
  const { provider, dal, params, emailChannelEnabled = true } = options;

  if (!emailChannelEnabled) {
    throw new Error('EMAIL_CHANNEL_DISABLED: Email channel is disabled');
  }

  // 1. Generate unique proxy address per stake
  const proxyAddr = generateProxyAddress(params.inboundDomain);

  // 2. Format email with sender identity shown in the body
  const fromEmail = params.fromEmail ?? `notifications@${params.inboundDomain}`;
  const subject = `Message from ${params.senderAddr} (Staked ${params.amountUsdc} USDC)`;
  const header = `Message from ${params.senderAddr}, staked ${params.amountUsdc} USDC`;
  const textBody = `${header}\n\n${params.body}\n\n---\nReply directly to this email to respond.\nIf you reply, the sender's stake will be refunded. If ignored or marked spam, you keep the stake.`;

  // 3. Send outbound email with Reply-To set to the unique proxy address
  const sendResult = await provider.sendEmail({
    from: fromEmail,
    to: params.recipientEmail,
    replyTo: proxyAddr,
    subject,
    textBody,
  });

  const externalRef = sendResult.messageId;

  // 4. Record proxy_addr and external_ref (Message-ID) in database
  if (dal.updateMessageProxyAddr) {
    await dal.updateMessageProxyAddr(params.messageId, proxyAddr);
  }
  await dal.updateMessageExternalRef(params.messageId, externalRef);
  await dal.updateMessageStatus(params.messageId, 'delivered');

  return {
    messageId: params.messageId,
    externalRef,
    proxyAddr,
  };
}
