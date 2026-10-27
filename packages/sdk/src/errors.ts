/**
 * packages/sdk/src/errors.ts
 * Exact error names and codes mapped from README "Smart Contract Specification → Errors".
 */

export const CONTRACT_ERRORS = {
  1: 'NotInitialized',
  2: 'AlreadyInitialized',
  3: 'Paused',
  4: 'BelowMinimum',
  5: 'WindowOutOfRange',
  6: 'StakeNotFound',
  7: 'NotPending',
  8: 'DeadlineNotReached',
  9: 'TooLate',
  10: 'InvalidAmount',
  11: 'FeeTooHigh',
} as const;

export type ContractErrorCode = keyof typeof CONTRACT_ERRORS;
export type ContractErrorName = (typeof CONTRACT_ERRORS)[ContractErrorCode];

export class EscrowContractError extends Error {
  readonly code: number;
  readonly errorName: ContractErrorName;

  constructor(code: number, errorName: ContractErrorName, message?: string) {
    super(message ?? `Contract error ${code}: ${errorName}`);
    this.name = 'EscrowContractError';
    this.code = code;
    this.errorName = errorName;
  }
}

/**
 * Extract known contract error from simulation, transaction response, or error string.
 */
export function parseContractError(err: unknown): EscrowContractError | null {
  if (!err) return null;

  if (err instanceof EscrowContractError) {
    return err;
  }

  // Check if error object has direct code property
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = Number((err as { code: unknown }).code);
    if (code in CONTRACT_ERRORS) {
      const errorName = CONTRACT_ERRORS[code as ContractErrorCode];
      return new EscrowContractError(code, errorName);
    }
  }

  // Check error message string or serialized error
  const message = typeof err === 'string' ? err : (err as Error)?.message ?? JSON.stringify(err);

  // Match Error(Contract, #1) or Error(Contract, 1) or Error(Contract(1))
  const match = message.match(/Error\(Contract,?\s*#?(\d+)\)/) ||
                message.match(/ContractError\((\d+)\)/) ||
                message.match(/contract error:?\s*#?(\d+)/i) ||
                message.match(/code:\s*(\d+)/i);

  if (match?.[1]) {
    const code = parseInt(match[1], 10);
    if (code in CONTRACT_ERRORS) {
      const errorName = CONTRACT_ERRORS[code as ContractErrorCode];
      return new EscrowContractError(code, errorName, message);
    }
  }

  return null;
}
