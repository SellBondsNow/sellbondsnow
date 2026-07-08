import { formatUnits, parseUnits } from 'viem';

export const USDC_DECIMALS = 6;

/** Parse a human USDC amount ("10000", "10_000", "1.5") into base units (6dp). */
export function parseUsdc(amount: string | number): bigint {
  const clean = String(amount).replace(/[_,\s]/g, '');
  return parseUnits(clean, USDC_DECIMALS);
}

export function formatUsdc(amount: bigint): string {
  return formatUnits(amount, USDC_DECIMALS);
}

export function formatEth(wei: bigint): string {
  return formatUnits(wei, 18);
}

/** bips -> percent string, e.g. 850 -> "8.5%". */
export function bipsToPct(bips: number | bigint): string {
  const n = Number(bips);
  return `${n / 100}%`;
}

/** percent -> bips, e.g. 8.5 -> 850. */
export function pctToBips(pct: number): number {
  return Math.round(pct * 100);
}

/**
 * Parse a duration string into seconds. Accepts a bare number (seconds) or a
 * suffixed value: s, m, h, d, w, y. e.g. "90d", "1y", "12h".
 */
export function parseDuration(input: string | number): number {
  if (typeof input === 'number') return input;
  const m = input.trim().match(/^(\d+(?:\.\d+)?)\s*([smhdwy]?)$/i);
  if (!m) throw new Error(`Invalid duration "${input}". Use e.g. 90d, 1y, 12h, or seconds.`);
  const value = parseFloat(m[1]!);
  const unit = (m[2] || 's').toLowerCase();
  const mult: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
    w: 604800,
    y: 31536000,
  };
  return Math.round(value * mult[unit]!);
}

export function formatDuration(seconds: number): string {
  if (seconds % 31536000 === 0) return `${seconds / 31536000}y`;
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}
