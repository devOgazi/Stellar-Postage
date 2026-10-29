/**
 * services/bot/src/types.ts
 */

export interface PostageBotConfig {
  botToken: string;
  webhookSecret?: string;
  botUsername?: string;
}

export interface BotDataAccess {
  linkTelegramChannel(userId: string, externalId: string): Promise<any>;
  findChannelByKindAndExternalId?(kind: string, externalId: string): Promise<any>;
  findMessageById(id: string): Promise<any>;
  findMessageByExternalRef(externalRef: string): Promise<any>;
  updateMessageExternalRef(id: string, externalRef: string): Promise<any>;
  updateMessageStatus(id: string, status: string): Promise<any>;
  findReplyEvidenceByMessageId?(messageId: string): Promise<any[]>;
  createReplyEvidence?(params: {
    message_id: string;
    kind: string;
    payload: unknown;
    hash: Buffer;
    oracle_tx?: string | null;
  }): Promise<any>;
  findReplyEvidenceById?(id: string): Promise<any>;
  updateReplyEvidenceOracleTx?(id: string, oracleTx: string): Promise<any>;
}

export interface DeliverStakedMessageParams {
  chatId: string | number;
  messageId: string;
  senderAddr: string;
  amountUsdc: string | number;
  body: string;
  stakeId?: string | bigint | number;
}
