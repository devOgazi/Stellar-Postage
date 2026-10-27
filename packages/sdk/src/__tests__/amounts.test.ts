import { fromBaseUnits, toBaseUnits, STROOPS_PER_USDC, USDC_DECIMALS } from '../amounts.js';

describe('USDC Amount Helpers', () => {
  it('defines 7 decimals and 10_000_000 stroops per USDC', () => {
    expect(USDC_DECIMALS).toBe(7);
    expect(STROOPS_PER_USDC).toBe(10_000_000n);
  });

  it('converts human numbers/strings to base units', () => {
    expect(toBaseUnits(5)).toBe(50_000_000n);
    expect(toBaseUnits('5')).toBe(50_000_000n);
    expect(toBaseUnits('0.1')).toBe(1_000_000n);
    expect(toBaseUnits('1.2345678')).toBe(12_345_678n); // truncated to 7 decimals
    expect(toBaseUnits('0.0000001')).toBe(1n);
    expect(toBaseUnits(100n)).toBe(100n);
  });

  it('converts base units to formatted decimal strings', () => {
    expect(fromBaseUnits(50_000_000n)).toBe('5.0000000');
    expect(fromBaseUnits(1_000_000n)).toBe('0.1000000');
    expect(fromBaseUnits(1n)).toBe('0.0000001');
    expect(fromBaseUnits('50000000')).toBe('5.0000000');
  });

  it('handles negative amounts correctly', () => {
    expect(toBaseUnits('-5')).toBe(-50_000_000n);
    expect(fromBaseUnits(-50_000_000n)).toBe('-5.0000000');
  });

  it('throws on invalid numeric input', () => {
    expect(() => toBaseUnits('invalid')).toThrow('Invalid USDC amount');
    expect(() => toBaseUnits('12.34.56')).toThrow('Invalid USDC amount');
  });
});
