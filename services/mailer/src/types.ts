/**
 * services/mailer/src/types.ts
 * Type definitions for the Stellar Postage email channel.
 */

export interface StoredMessage {
  id: string;
  recipient_id?: string | null | undefined;
  sender_addr?: string | undefined;
  status: string;
  proxy_addr?: string | null | undefined;
  external_ref?: string | null | undefined;
}

export interface StoredChannel {
  id: string;
  user_id?: string | null | undefined;
  kind: string;
  external_id: string;
  verified_at?: Date | null | undefined;
}

export interface ReplyEvidenceRecord {
  id: string;
  message_id: string | null;
  kind: string;
  payload: unknown;
  hash: Buffer;
  oracle_tx?: string | null | undefined;
  created_at?: Date | undefined;
}

export interface MailerDataAccess {
  findMessageById(id: string): Promise<StoredMessage | null>;
  findMessageByProxyAddr(proxyAddr: string): Promise<StoredMessage | null>;
  findMessageByExternalRef?(externalRef: string): Promise<StoredMessage | null>;
  findChannelByKindAndExternalId(
    kind: 'telegram' | 'email',
    externalId: string,
  ): Promise<StoredChannel | null>;
  findReplyEvidenceByMessageId(messageId: string): Promise<ReplyEvidenceRecord[]>;
  createReplyEvidence(params: {
    message_id: string;
    kind: string;
    payload: unknown;
    hash: Buffer;
  }): Promise<ReplyEvidenceRecord>;
  updateMessageExternalRef(id: string, externalRef: string): Promise<StoredMessage>;
  updateMessageProxyAddr?(id: string, proxyAddr: string): Promise<StoredMessage>;
  updateMessageStatus(id: string, status: string): Promise<StoredMessage>;
  linkEmailChannel?(userId: string, externalId: string): Promise<StoredChannel>;
}

export interface SendEmailParams {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  textBody: string;
  htmlBody?: string | undefined;
  headers?: Record<string, string> | undefined;
  messageId?: string | undefined;
}

export interface SendEmailResult {
  messageId: string;
}

export interface ParsedInboundEmail {
  from: string;
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string | undefined;
  messageId: string;
  inReplyTo?: string | undefined;
  references?: string[] | undefined;
  spfStatus?: string | undefined;
  dkimStatus?: string | undefined;
  dmarcStatus?: string | undefined;
  autoSubmitted?: string | undefined;
  xAutoreply?: string | undefined;
  headers: Record<string, string | string[]>;
  rawPayload: unknown;
}

export interface EmailProvider {
  name: string;
  sendEmail(params: SendEmailParams): Promise<SendEmailResult>;
  parseInboundWebhook(
    payload: unknown,
    headers?: Record<string, string | string[] | undefined> | undefined,
  ): ParsedInboundEmail;
  verifyWebhookSecret(
    headers: Record<string, string | string[] | undefined>,
    secret: string,
  ): boolean;
}

export interface DeliverEmailParams {
  messageId: string;
  senderAddr: string;
  recipientEmail: string;
  amountUsdc: string | number;
  body: string;
  inboundDomain: string;
  fromEmail?: string | undefined;
}

export type EmailRejectionReason =
  | 'CHANNEL_DISABLED'
  | 'INVALID_PAYLOAD'
  | 'PROXY_NOT_FOUND'
  | 'MESSAGE_NOT_FOUND'
  | 'NOT_PENDING'
  | 'SPOOFED_FROM'
  | 'AUTH_RESULTS_FAILED'
  | 'THREADING_MISMATCH'
  | 'AUTO_REPLY'
  | 'REACTION_OR_EMPTY'
  | 'TOO_SHORT'
  | 'ALREADY_SUBMITTED';

export interface ProcessInboundResult {
  accepted: boolean;
  reason?: EmailRejectionReason | undefined;
  evidence?: ReplyEvidenceRecord | undefined;
  vetoDeadline?: number | undefined;
}
