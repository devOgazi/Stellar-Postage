/**
 * services/mailer/src/replyDetector.ts
 * Inbound email reply detection, verification, and veto lifecycle.
 */

import crypto from 'node:crypto';
import { DEFAULT_MIN_REPLY_WORDS, DEFAULT_REPLY_VETO_WINDOW_SECS } from '@stellar-postage/shared';
import type {
  MailerDataAccess,
  ParsedInboundEmail,
  ProcessInboundResult,
  ReplyEvidenceRecord,
} from './types.js';

export interface PendingEmailVeto {
  evidence: ReplyEvidenceRecord;
  vetoDeadline: number;
  timer: NodeJS.Timeout | null;
  vetoed: boolean;
}

export interface EmailReplyDetectorOptions {
  dal: MailerDataAccess;
  minReplyWords?: number | undefined;
  vetoWindowSecs?: number | undefined;
  emailChannelEnabled?: boolean | undefined;
  onForwardToOracle?: ((evidence: ReplyEvidenceRecord) => Promise<void>) | undefined;
  onRelayToSender?: ((messageId: string, replyText: string) => Promise<void>) | undefined;
}

const AUTO_REPLY_REGEX =
  /\b(auto(?:matic)?[- ]reply|out of (?:the )?office|away from (?:my )?desk|vacation responder|currently out)\b/i;

export class EmailReplyDetector {
  private readonly dal: MailerDataAccess;
  private readonly minReplyWords: number;
  private readonly vetoWindowSecs: number;
  private readonly emailChannelEnabled: boolean;
  private readonly onForwardToOracle?:
    | ((evidence: ReplyEvidenceRecord) => Promise<void>)
    | undefined;
  private readonly onRelayToSender?:
    | ((messageId: string, replyText: string) => Promise<void>)
    | undefined;

  // Pending veto tracker: evidenceId -> PendingEmailVeto
  private readonly pendingVetos = new Map<string, PendingEmailVeto>();
  // messageId -> evidenceId
  private readonly messageVetoMap = new Map<string, string>();

  constructor(options: EmailReplyDetectorOptions) {
    this.dal = options.dal;
    this.minReplyWords = options.minReplyWords ?? DEFAULT_MIN_REPLY_WORDS;
    this.vetoWindowSecs = options.vetoWindowSecs ?? DEFAULT_REPLY_VETO_WINDOW_SECS;
    this.emailChannelEnabled = options.emailChannelEnabled ?? true;
    this.onForwardToOracle = options.onForwardToOracle;
    this.onRelayToSender = options.onRelayToSender;
  }

  /**
   * Processes a parsed inbound email and verifies validity rules.
   */
  async processInboundEmail(
    inbound: ParsedInboundEmail,
    now: number = Date.now(),
  ): Promise<ProcessInboundResult> {
    // 0. Channel enabled check
    if (!this.emailChannelEnabled) {
      return { accepted: false, reason: 'CHANNEL_DISABLED' };
    }

    // 1. Locate message by proxy address
    if (!inbound.to) {
      return { accepted: false, reason: 'INVALID_PAYLOAD' };
    }

    const message = await this.dal.findMessageByProxyAddr(inbound.to);
    if (!message) {
      return { accepted: false, reason: 'PROXY_NOT_FOUND' };
    }

    // Only delivered or pending messages can be replied to
    if (message.status !== 'delivered' && message.status !== 'pending') {
      return { accepted: false, reason: 'NOT_PENDING' };
    }

    // 2. From matches the registered recipient address (anti-spoofing)
    const channel = await this.dal.findChannelByKindAndExternalId(
      'email',
      inbound.from.toLowerCase(),
    );
    if (
      !channel ||
      !channel.verified_at ||
      (message.recipient_id && channel.user_id !== message.recipient_id)
    ) {
      return { accepted: false, reason: 'SPOOFED_FROM' };
    }

    // 3. DKIM / SPF / DMARC verification
    const spfPass = inbound.spfStatus?.toLowerCase() === 'pass';
    const dkimPass = inbound.dkimStatus?.toLowerCase() === 'pass';
    const dmarcPass =
      inbound.dmarcStatus === undefined || inbound.dmarcStatus?.toLowerCase() === 'pass';

    if (!spfPass || !dkimPass || !dmarcPass) {
      return { accepted: false, reason: 'AUTH_RESULTS_FAILED' };
    }

    // 4. Threading check: In-Reply-To / References match the original Message-ID
    if (!message.external_ref) {
      return { accepted: false, reason: 'THREADING_MISMATCH' };
    }

    const cleanExpectedRef = message.external_ref.replace(/^<|>$/g, '').trim().toLowerCase();
    const cleanInReplyTo = inbound.inReplyTo
      ? inbound.inReplyTo.replace(/^<|>$/g, '').trim().toLowerCase()
      : '';
    const cleanReferences = (inbound.references ?? []).map((r) =>
      r.replace(/^<|>$/g, '').trim().toLowerCase(),
    );

    const matchesThread =
      cleanInReplyTo === cleanExpectedRef || cleanReferences.includes(cleanExpectedRef);

    if (!matchesThread) {
      return { accepted: false, reason: 'THREADING_MISMATCH' };
    }

    // 5. Auto-reply detection
    if (inbound.autoSubmitted && inbound.autoSubmitted !== 'no') {
      return { accepted: false, reason: 'AUTO_REPLY' };
    }

    if (inbound.xAutoreply && inbound.xAutoreply !== 'no') {
      return { accepted: false, reason: 'AUTO_REPLY' };
    }

    if (AUTO_REPLY_REGEX.test(inbound.subject) || AUTO_REPLY_REGEX.test(inbound.textBody)) {
      return { accepted: false, reason: 'AUTO_REPLY' };
    }

    // 6. Minimum reply length (same validity rules as Telegram)
    const text = inbound.textBody.trim();
    if (!text) {
      return { accepted: false, reason: 'REACTION_OR_EMPTY' };
    }

    const words = text.split(/\s+/).filter(Boolean);
    if (words.length < this.minReplyWords) {
      return { accepted: false, reason: 'TOO_SHORT' };
    }

    // 7. One refund per stake (replay prevention)
    const existingEvidence = await this.dal.findReplyEvidenceByMessageId(message.id);
    if (existingEvidence && existingEvidence.length > 0) {
      return { accepted: false, reason: 'ALREADY_SUBMITTED' };
    }

    // 8. Create ReplyEvidence record (kind='email')
    const payload: Record<string, unknown> = {
      channel: 'email',
      created_at: now,
      dkim_status: inbound.dkimStatus,
      email_message_id: inbound.messageId,
      from: inbound.from,
      in_reply_to: inbound.inReplyTo,
      proxy_addr: inbound.to,
      spf_status: inbound.spfStatus,
      text,
      to: inbound.to,
    };

    const canonicalJson = JSON.stringify(payload, Object.keys(payload).sort());
    const hash = crypto.createHash('sha256').update(canonicalJson).digest();

    const createdEvidence = await this.dal.createReplyEvidence({
      message_id: message.id,
      kind: 'email',
      payload,
      hash,
    });

    // 9. Relay / forward reply to the sender
    if (this.onRelayToSender) {
      await this.onRelayToSender(message.id, text);
    }

    // 10. Recipient veto window (default 10 minutes)
    const vetoDeadline = now + this.vetoWindowSecs * 1000;
    const remainingMs = Math.max(0, vetoDeadline - Date.now());

    const pending: PendingEmailVeto = {
      evidence: createdEvidence,
      vetoDeadline,
      timer: null,
      vetoed: false,
    };

    if (this.onForwardToOracle && remainingMs > 0 && remainingMs <= 2_147_483_647) {
      pending.timer = setTimeout(() => {
        if (!pending.vetoed && this.onForwardToOracle) {
          void this.onForwardToOracle(createdEvidence);
        }
      }, remainingMs);
      if (typeof pending.timer.unref === 'function') {
        pending.timer.unref();
      }
    }

    this.pendingVetos.set(createdEvidence.id, pending);
    this.messageVetoMap.set(message.id, createdEvidence.id);

    return {
      accepted: true,
      evidence: createdEvidence,
      vetoDeadline,
    };
  }

  /**
   * Recipient vetoes a reply: "Not a real reply"
   */
  veto(
    evidenceOrMessageId: string,
    now: number = Date.now(),
  ): { success: boolean; error?: string | undefined } {
    const evidenceId = this.messageVetoMap.get(evidenceOrMessageId) ?? evidenceOrMessageId;
    const pending = this.pendingVetos.get(evidenceId);

    if (!pending) {
      return { success: false, error: 'Reply evidence not found' };
    }

    if (pending.vetoed) {
      return { success: true };
    }

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

  getPendingVeto(evidenceId: string): PendingEmailVeto | undefined {
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
