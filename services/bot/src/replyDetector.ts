import crypto from 'node:crypto';
import {
  DEFAULT_MIN_REPLY_WORDS,
  DEFAULT_REPLY_VETO_WINDOW_SECS,
} from '@stellar-postage/shared';
import type { BotDataAccess } from './types.js';

export interface ReplyEvidenceRecord {
  id: string;
  message_id: string;
  kind: 'telegram';
  payload: Record<string, unknown>;
  hash: Buffer;
  oracle_tx?: string | null;
  created_at?: Date;
}

export type ReplyRejectionReason =
  | 'NOT_A_REPLY'
  | 'MESSAGE_NOT_FOUND'
  | 'NOT_PENDING'
  | 'REACTION_OR_EMPTY'
  | 'TOO_SHORT'
  | 'IS_BOT'
  | 'AUTO_REPLY'
  | 'WRONG_CHAT_OR_UNVERIFIED'
  | 'ALREADY_SUBMITTED';

export interface ProcessReplyResult {
  accepted: boolean;
  reason?: ReplyRejectionReason;
  evidence?: ReplyEvidenceRecord;
  vetoDeadline?: number;
}

export interface ReplyDetectorOptions {
  dal: BotDataAccess;
  minReplyWords?: number | undefined;
  vetoWindowSecs?: number | undefined;
  onForwardToOracle?: ((evidence: ReplyEvidenceRecord) => Promise<void>) | undefined;
  onRelayToSender?: ((messageId: string, replyText: string) => Promise<void>) | undefined;
}

export interface PendingVeto {
  evidence: ReplyEvidenceRecord;
  vetoDeadline: number;
  timer: NodeJS.Timeout | null;
  vetoed: boolean;
}

const AUTO_REPLY_REGEX =
  /\b(auto(?:matic)?[- ]reply|out of (?:the )?office|away from (?:my )?desk|vacation responder|currently out)\b/i;

export class ReplyDetector {
  private readonly dal: BotDataAccess;
  private readonly minReplyWords: number;
  private readonly vetoWindowSecs: number;
  private readonly onForwardToOracle?: ((evidence: ReplyEvidenceRecord) => Promise<void>) | undefined;
  private readonly onRelayToSender?: ((messageId: string, replyText: string) => Promise<void>) | undefined;

  // Pending veto tracker: evidenceId -> PendingVeto
  private readonly pendingVetos = new Map<string, PendingVeto>();
  // messageId -> evidenceId mapping for in-app /messages/:id/not-a-reply lookup
  private readonly messageVetoMap = new Map<string, string>();

  constructor(options: ReplyDetectorOptions) {
    this.dal = options.dal;
    this.minReplyWords = options.minReplyWords ?? DEFAULT_MIN_REPLY_WORDS;
    this.vetoWindowSecs = options.vetoWindowSecs ?? DEFAULT_REPLY_VETO_WINDOW_SECS;
    this.onForwardToOracle = options.onForwardToOracle;
    this.onRelayToSender = options.onRelayToSender;
  }

  /**
   * Evaluates an incoming Telegram update for valid reply evidence.
   */
  async processUpdate(update: any, now: number = Date.now()): Promise<ProcessReplyResult> {
    const msg = update?.message;
    if (!msg || !msg.reply_to_message || !msg.reply_to_message.message_id) {
      return { accepted: false, reason: 'NOT_A_REPLY' };
    }

    const replyToMessageId = msg.reply_to_message.message_id.toString();
    const deliveredMsg = await this.dal.findMessageByExternalRef(replyToMessageId);
    if (!deliveredMsg) {
      return { accepted: false, reason: 'MESSAGE_NOT_FOUND' };
    }

    // Only delivered or pending messages with pending stakes can be replied to
    if (deliveredMsg.status !== 'delivered' && deliveredMsg.status !== 'pending') {
      return { accepted: false, reason: 'NOT_PENDING' };
    }

    // 1. Minimum length (reject empty or reaction-only replies)
    const text = typeof msg.text === 'string' ? msg.text.trim() : '';
    if (!text) {
      return { accepted: false, reason: 'REACTION_OR_EMPTY' };
    }

    const words = text.split(/\s+/).filter(Boolean);
    if (words.length < this.minReplyWords) {
      return { accepted: false, reason: 'TOO_SHORT' };
    }

    // 2. Auto-reply and bot filter
    if (msg.from?.is_bot) {
      return { accepted: false, reason: 'IS_BOT' };
    }

    if (AUTO_REPLY_REGEX.test(text)) {
      return { accepted: false, reason: 'AUTO_REPLY' };
    }

    // 3. Sender-only replies (must come from verified recipient chat)
    const chatId = msg.chat?.id?.toString();
    if (this.dal.findChannelByKindAndExternalId) {
      const channel = await this.dal.findChannelByKindAndExternalId('telegram', chatId);
      if (
        !channel ||
        !channel.verified_at ||
        (deliveredMsg.recipient_id && channel.user_id !== deliveredMsg.recipient_id)
      ) {
        return { accepted: false, reason: 'WRONG_CHAT_OR_UNVERIFIED' };
      }
    }

    // 4. One refund per stake (replay prevention)
    if (this.dal.findReplyEvidenceByMessageId) {
      const existing = await this.dal.findReplyEvidenceByMessageId(deliveredMsg.id);
      if (existing && existing.length > 0) {
        return { accepted: false, reason: 'ALREADY_SUBMITTED' };
      }
    }

    // Compute evidence payload and hash
    const payload = {
      reply_message_id: msg.message_id,
      reply_to_message_id: msg.reply_to_message.message_id,
      chat_id: chatId,
      from_id: msg.from?.id,
      text,
      created_at: now,
    };

    const canonicalJson = JSON.stringify(payload, Object.keys(payload).sort());
    const hash = crypto.createHash('sha256').update(canonicalJson).digest();

    let createdEvidence: ReplyEvidenceRecord;
    if (this.dal.createReplyEvidence) {
      createdEvidence = await this.dal.createReplyEvidence({
        message_id: deliveredMsg.id,
        kind: 'telegram',
        payload,
        hash,
      });
    } else {
      createdEvidence = {
        id: crypto.randomUUID(),
        message_id: deliveredMsg.id,
        kind: 'telegram',
        payload,
        hash,
        created_at: new Date(now),
      };
    }

    // Relay the reply text to sender in-app
    if (this.onRelayToSender) {
      await this.onRelayToSender(deliveredMsg.id, text);
    }

    // Hold valid replies for REPLY_VETO_WINDOW_SECS
    const vetoDeadline = now + this.vetoWindowSecs * 1000;
    const remainingMs = Math.max(0, vetoDeadline - Date.now());

    const pending: PendingVeto = {
      evidence: createdEvidence,
      vetoDeadline,
      timer: null,
      vetoed: false,
    };

    if (this.onForwardToOracle && remainingMs > 0 && remainingMs <= 2_147_483_647) {
      pending.timer = setTimeout(async () => {
        if (!pending.vetoed && this.onForwardToOracle) {
          await this.onForwardToOracle(createdEvidence);
        }
      }, remainingMs);
      if (typeof pending.timer?.unref === 'function') {
        pending.timer.unref();
      }
    }

    this.pendingVetos.set(createdEvidence.id, pending);
    this.messageVetoMap.set(deliveredMsg.id, createdEvidence.id);

    return {
      accepted: true,
      evidence: createdEvidence,
      vetoDeadline,
    };
  }

  /**
   * Recipient vetoes a reply: "Not a real reply"
   * Returns { success: true } if vetoed within window, or { success: false, error } if expired or not found.
   */
  veto(evidenceOrMessageId: string, now: number = Date.now()): { success: boolean; error?: string } {
    let evidenceId = this.messageVetoMap.get(evidenceOrMessageId) || evidenceOrMessageId;
    const pending = this.pendingVetos.get(evidenceId);

    if (!pending) {
      return { success: false, error: 'Reply evidence not found' };
    }

    if (pending.vetoed) {
      return { success: true };
    }

    // Check veto window
    if (now > pending.vetoDeadline) {
      return { success: false, error: 'Veto window has expired' };
    }

    pending.vetoed = true;
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }

    return { success: true };
  }

  isVetoed(evidenceId: string): boolean {
    return this.pendingVetos.get(evidenceId)?.vetoed ?? false;
  }

  getPendingVeto(evidenceId: string): PendingVeto | undefined {
    return this.pendingVetos.get(evidenceId);
  }

  clear(): void {
    for (const p of this.pendingVetos.values()) {
      if (p.timer) clearTimeout(p.timer);
    }
    this.pendingVetos.clear();
    this.messageVetoMap.clear();
  }
}
