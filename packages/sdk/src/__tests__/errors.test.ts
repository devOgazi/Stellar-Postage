import {
  CONTRACT_ERRORS,
  EscrowContractError,
  parseContractError,
} from '../errors.js';

describe('Contract Error Mapping', () => {
  it('maps all 11 error codes to exact README error names', () => {
    expect(CONTRACT_ERRORS[1]).toBe('NotInitialized');
    expect(CONTRACT_ERRORS[2]).toBe('AlreadyInitialized');
    expect(CONTRACT_ERRORS[3]).toBe('Paused');
    expect(CONTRACT_ERRORS[4]).toBe('BelowMinimum');
    expect(CONTRACT_ERRORS[5]).toBe('WindowOutOfRange');
    expect(CONTRACT_ERRORS[6]).toBe('StakeNotFound');
    expect(CONTRACT_ERRORS[7]).toBe('NotPending');
    expect(CONTRACT_ERRORS[8]).toBe('DeadlineNotReached');
    expect(CONTRACT_ERRORS[9]).toBe('TooLate');
    expect(CONTRACT_ERRORS[10]).toBe('InvalidAmount');
    expect(CONTRACT_ERRORS[11]).toBe('FeeTooHigh');
  });

  it('parses error codes from simulation strings', () => {
    const err = parseContractError('Host error: Error(Contract, #4)');
    expect(err).toBeInstanceOf(EscrowContractError);
    expect(err?.code).toBe(4);
    expect(err?.errorName).toBe('BelowMinimum');
  });

  it('parses error codes from Error(Contract, 7)', () => {
    const err = parseContractError('Transaction failed: Error(Contract, 7)');
    expect(err?.code).toBe(7);
    expect(err?.errorName).toBe('NotPending');
  });

  it('parses error codes from object with code property', () => {
    const err = parseContractError({ code: 8 });
    expect(err?.code).toBe(8);
    expect(err?.errorName).toBe('DeadlineNotReached');
  });

  it('returns null for unknown errors', () => {
    expect(parseContractError('Network connection reset')).toBeNull();
    expect(parseContractError(null)).toBeNull();
  });
});
