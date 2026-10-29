export interface IndexerConfig {
  contractId: string;
  rpcUrl?: string;
  startLedger?: number;
  pollIntervalMs?: number;
  healthPort?: number;
  retentionWindowLedgers?: number;
}

export interface IndexerHealth {
  status: 'ok' | 'degraded';
  currentLedger: number;
  latestLedger: number;
  lag: number;
}

export interface IndexerDataAccess {
  insertChainEvent(params: {
    ledger: bigint | number | string;
    tx_hash: string;
    event_idx: number;
    topic: string;
    stake_id?: bigint | number | string | null;
    payload?: unknown;
  }): Promise<void>;
  updateMessageStatus?(id: string, status: string): Promise<any>;
  findMessageByStakeId?(stakeId: bigint | number | string): Promise<any>;
  attachStakeId?(id: string, stakeId: bigint | number | string): Promise<any>;
  getCursor?(id?: string): Promise<number | null>;
  setCursor?(ledger: number, id?: string): Promise<void>;
}
