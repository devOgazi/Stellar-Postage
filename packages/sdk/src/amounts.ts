/**
 * packages/sdk/src/amounts.ts
 * Amount helpers for USDC (7 decimals on Stellar).
 */

export const USDC_DECIMALS = 7;
export const STROOPS_PER_USDC = 10_000_000n;

/**
 * Convert human-readable USDC (e.g. 5, "5.5", 50n) to base units (stroops).
 */
export function toBaseUnits(amount: number | string | bigint): bigint {
  if (typeof amount === 'bigint') {
    return amount;
  }
  const str = (typeof amount === 'number' ? amount.toString() : amount).trim();
  if (!/^-?\d+(\.\d+)?$/.test(str)) {
    throw new Error(`Invalid USDC amount: ${amount}`);
  }
  const isNegative = str.startsWith('-');
  const raw = isNegative ? str.slice(1) : str;
  const [wholePart = '0', fracPart = ''] = raw.split('.');
  const paddedFrac = fracPart.padEnd(USDC_DECIMALS, '0').slice(0, USDC_DECIMALS);
  const baseUnits = BigInt(wholePart) * STROOPS_PER_USDC + BigInt(paddedFrac);
  return isNegative ? -baseUnits : baseUnits;
}

/**
 * Convert token base units (stroops) to human-readable decimal string.
 */
export function fromBaseUnits(baseUnits: bigint | number | string): string {
  const b = BigInt(baseUnits);
  const isNegative = b < 0n;
  const abs = isNegative ? -b : b;
  const whole = abs / STROOPS_PER_USDC;
  const frac = (abs % STROOPS_PER_USDC).toString().padStart(USDC_DECIMALS, '0');
  const formatted = `${whole}.${frac}`;
  return isNegative ? `-${formatted}` : formatted;
}
