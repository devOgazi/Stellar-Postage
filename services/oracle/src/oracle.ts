import crypto from 'node:crypto';
import type { EscrowClient } from '@stellar-postage/sdk';
import type { Signer } from './signer.js';
import type { ChannelAccountPool } from './channelPool.js';
import { TransactionSubmitter } from './submitter.js';

export interface ReplyEvidenceInput {
  id: string;
  message_id: string;
  kind: string;
  payload: Record<string, unknown>;
  hash: Buffer | string;
  oracle_tx?: string | null | undefined;
  stake_id?: bigint | number | string | undefined;
}

export interface OracleConfig {
  graceSecs?: number | undefined;
  maxRetries?: number | undefined;
  initialBackoffMs?: number | undefined;
}

export interface ReplyEvidenceRecord {
  id: string;
  oracle_tx?: string | null;
}

export interface MessageRecord {
  id: string;
  stake_id?: string | null;
}

export interface OracleDataAccess {
  findReplyEvidenceById?(id: string): Promise<ReplyEvidenceRecord | null>;
  updateReplyEvidenceOracleTx(id: string, oracleTx: string): Promise<unknown>;
  findMessageById?(id: string): Promise<MessageRecord | null>;
}

export interface AttestationResult {
  success: boolean;
  stakeId: bigint;
  evidenceHash: string;
  txHash: string;
  ledger?: number | undefined;
}

export class OracleService {
  private readonly escrowClient: EscrowClient;
  private readonly submitter: TransactionSubmitter;
  private readonly dal?: OracleDataAccess | undefined;
  private readonly graceSecs: number;

  constructor(
    escrowClient: EscrowClient,
    signer: Signer,
    channelPool: ChannelAccountPool,
    dal?: OracleDataAccess | undefined,
    config?: OracleConfig | undefined
  ) {
    this.escrowClient = escrowClient;
    this.dal = dal;
    this.graceSecs = config?.graceSecs ?? 3600;
    this.submitter = new TransactionSubmitter(escrowClient, signer, channelPool, {
      maxRetries: config?.maxRetries,
      initialBackoffMs: config?.initialBackoffMs,
    });
  }

  /**
   * Accepts and re-verifies ReplyEvidence, then submits confirm_reply(stake_id).
   *
   * The oracle exposes NO capability other than confirm_reply for this contract.
   *
   * Re-verification checks:
   * 1. Evidence hash matches canonical payload
   * 2. Evidence not already submitted
   * 3. On-chain stake is Pending
   * 4. Current time is within deadline + grace
   */
  async confirmReply(
    evidence: ReplyEvidenceInput,
    options?: { now?: number | undefined; retryDelayFn?: ((ms: number) => Promise<void>) | undefined }
  ): Promise<AttestationResult> {
    const nowSecs = options?.now !== undefined ? Math.floor(options.now / 1000) : Math.floor(Date.now() / 1000);

    // 1. Evidence hash integrity verification
    const canonicalJson = JSON.stringify(evidence.payload, Object.keys(evidence.payload).sort());
    const computedHashBuf = crypto.createHash('sha256').update(canonicalJson).digest();
    const computedHashHex = computedHashBuf.toString('hex');

    const expectedHashHex =
      Buffer.isBuffer(evidence.hash)
        ? evidence.hash.toString('hex')
        : typeof evidence.hash === 'string'
          ? evidence.hash.replace(/^0x/, '')
          : '';

    if (computedHashHex !== expectedHashHex) {
      throw new Error(`TAMPERED_EVIDENCE: Evidence hash does not match payload`);
    }

    // 2. Check if already submitted
    if (evidence.oracle_tx) {
      throw new Error(`DUPLICATE_EVIDENCE: Evidence was already submitted with tx ${evidence.oracle_tx}`);
    }

    if (this.dal?.findReplyEvidenceById) {
      const existing = await this.dal.findReplyEvidenceById(evidence.id);
      if (existing?.oracle_tx) {
        throw new Error(`DUPLICATE_EVIDENCE: Evidence was already submitted with tx ${existing.oracle_tx}`);
      }
    }

    // Resolve stake_id from evidence or message
    let stakeIdVal: bigint | number | undefined = evidence.stake_id !== undefined ? BigInt(evidence.stake_id) : undefined;
    if (stakeIdVal === undefined && this.dal?.findMessageById) {
      const msg = await this.dal.findMessageById(evidence.message_id);
      if (msg?.stake_id) {
        stakeIdVal = BigInt(msg.stake_id);
      }
    }

    if (stakeIdVal === undefined) {
      throw new Error(`MISSING_STAKE_ID: Could not resolve stake_id for message ${evidence.message_id}`);
    }

    const stakeId = BigInt(stakeIdVal);

    // 3. Re-verify on-chain state via fetchStake
    const onChainStake = await this.escrowClient.fetchStake(stakeId);
    if (onChainStake.status !== 'Pending') {
      throw new Error(`NOT_PENDING: On-chain stake status is ${onChainStake.status}, expected Pending`);
    }

    // 4. Re-verify within deadline + grace
    const expiry = Number(onChainStake.deadline) + this.graceSecs;
    if (nowSecs > expiry) {
      throw new Error(`EXPIRED_STAKE: Current time ${nowSecs} exceeds deadline + grace ${expiry}`);
    }

    // 5. Submit confirm_reply(stake_id) via channel account pool with retries
    const submission = await this.submitter.submitConfirmReply(stakeId, options?.retryDelayFn);

    // 6. Log attestation with evidence hash and tx hash into reply_evidence.oracle_tx
    if (this.dal) {
      await this.dal.updateReplyEvidenceOracleTx(evidence.id, submission.txHash);
    }

    return {
      success: true,
      stakeId,
      evidenceHash: computedHashHex,
      txHash: submission.txHash,
      ledger: submission.ledger,
    };
  }
}
