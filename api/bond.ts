// sellbonds.now — single-bond detail: full state + on-chain event history.
//
// GET /api/bond?market=0x...  → JSON for one bond (state, terms, issuer, and its
// investments / draws / repayments read straight from chain). Powers /bond.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createPublicClient, http, getAddress, isAddress, type Address } from 'viem';
import { base, baseSepolia } from 'viem/chains';

const NETWORK = process.env.SBN_NETWORK?.trim() || 'base';
const IS_TESTNET = NETWORK === 'base-sepolia';
const CHAIN = IS_TESTNET ? baseSepolia : base;
const RPC_URL =
  (IS_TESTNET ? process.env.RPC_URL_BASE_SEPOLIA?.trim() : process.env.RPC_URL_BASE?.trim()) ||
  (IS_TESTNET ? 'https://sepolia.base.org' : 'https://mainnet.base.org');
const EXPLORER = IS_TESTNET ? 'https://sepolia.basescan.org' : 'https://basescan.org';
const HOOKS_FACTORY = (process.env.SBN_HOOKS_FACTORY?.trim() ||
  '0x6fe029dfc85924c83a2f7159292f53b3a9a3806f') as Address;
const BONDNOTES_BY_NETWORK: Record<string, Address | undefined> = {
  base: '0xbe5369cfcbe284d42306bc462be796a7c764dbe9',
  'base-sepolia': undefined,
};
const BONDNOTES =
  (process.env.SBN_BONDNOTES?.trim() as Address | undefined) || BONDNOTES_BY_NETWORK[NETWORK];
const FROM_BLOCK_BY_NETWORK: Record<string, bigint> = { base: 46984789n, 'base-sepolia': 0n };
const FROM_BLOCK = FROM_BLOCK_BY_NETWORK[NETWORK] ?? 0n;
const ZERO = '0x0000000000000000000000000000000000000000';
const USDC_DECIMALS = 6;
const fmt = (v: bigint) => Number(v) / 10 ** USDC_DECIMALS;

const marketAbi = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'asset', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'borrower', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'isClosed', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'annualInterestBips', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'reserveRatioBips', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'delinquencyFeeBips', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalAssets', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'borrowableAssets', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'maximumDeposit', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;
const READS = [
  'name', 'symbol', 'asset', 'borrower', 'isClosed', 'annualInterestBips',
  'reserveRatioBips', 'delinquencyFeeBips', 'totalSupply', 'totalAssets', 'borrowableAssets', 'maximumDeposit',
] as const;

const bondNotesAbi = [
  {
    type: 'function',
    name: 'notes',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'string' }, { type: 'string' }, { type: 'address' }, { type: 'uint40' }],
  },
] as const;

const marketDeployedEvent = {
  type: 'event',
  name: 'MarketDeployed',
  inputs: [
    { name: 'hooksTemplate', type: 'address', indexed: true },
    { name: 'market', type: 'address', indexed: true },
    { name: 'name', type: 'string', indexed: false },
    { name: 'symbol', type: 'string', indexed: false },
    { name: 'asset', type: 'address', indexed: false },
    { name: 'maxTotalSupply', type: 'uint256', indexed: false },
    { name: 'annualInterestBips', type: 'uint256', indexed: false },
    { name: 'delinquencyFeeBips', type: 'uint256', indexed: false },
    { name: 'withdrawalBatchDuration', type: 'uint256', indexed: false },
    { name: 'reserveRatioBips', type: 'uint256', indexed: false },
    { name: 'delinquencyGracePeriod', type: 'uint256', indexed: false },
    { name: 'hooks', type: 'uint256', indexed: false },
  ],
} as const;
const MARKET_EVENTS = [
  { type: 'event', name: 'Deposit', inputs: [{ name: 'account', type: 'address', indexed: true }, { name: 'assetAmount', type: 'uint256' }, { name: 'scaledAmount', type: 'uint256' }] },
  { type: 'event', name: 'Borrow', inputs: [{ name: 'assetAmount', type: 'uint256' }] },
  { type: 'event', name: 'DebtRepaid', inputs: [{ name: 'from', type: 'address', indexed: true }, { name: 'assetAmount', type: 'uint256' }] },
] as const;

interface Event {
  type: 'issued' | 'invested' | 'drawn' | 'repaid';
  actor?: string;
  amountUsdc?: number;
  at: number;
  txHash: string;
  explorerUrl: string;
}

const cache = new Map<string, { at: number; payload: any }>();
const CACHE_MS = 30_000;

// Shared accessor so bond-page.ts (the server-rendered /bond/<address> page) reuses
// this logic. Each Vercel function bundles its own copy, so caches are per-function.
export async function getBond(market: Address) {
  const key = `${NETWORK}:${market.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at <= CACHE_MS) return hit.payload;
  const payload = await buildBond(market);
  if (payload) cache.set(key, { at: Date.now(), payload });
  return payload;
}

// Scan backward in windows (Alchemy serves the whole range in one; the loop is a fallback).
async function scanLogs(client: any, params: any): Promise<any[]> {
  const latest: bigint = await client.getBlockNumber();
  const out: any[] = [];
  // Dedicated RPCs (Alchemy) serve the whole range in one call; public RPCs cap
  // getLogs (~10k blocks), so shrink the window and retry if a request is rejected.
  let window = 500_000n;
  let to = latest;
  let calls = 0;
  while (to >= FROM_BLOCK && calls < 200) {
    const from = to - window + 1n > FROM_BLOCK ? to - window + 1n : FROM_BLOCK;
    try {
      out.push(...(await client.getLogs({ ...params, fromBlock: from, toBlock: to })));
      calls++;
      if (from === FROM_BLOCK) break;
      to = from - 1n;
    } catch {
      if (window > 9000n) {
        window = 9000n;
        continue; // retry the same `to` with a smaller window
      }
      calls++;
      if (from === FROM_BLOCK) break;
      to = from - 1n;
    }
  }
  return out;
}

// Fast path: one multicall, no log scans. Everything needed for meta tags, OG
// cards, and the stats summary — used by bond-page.ts and og-bond.ts, where link
// unfurlers impose tight timeouts. Events come from the full buildBond only.
async function readCore(market: Address): Promise<{ client: any; core: any } | null> {
  const client: any = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });

  const calls: any[] = READS.map((functionName) => ({ address: market, abi: marketAbi, functionName }));
  if (BONDNOTES) calls.push({ address: BONDNOTES, abi: bondNotesAbi, functionName: 'notes', args: [market] });
  const res = await client.multicall({ contracts: calls, allowFailure: true });
  const get = <T>(i: number, fb: T): T => (res[i]?.status === 'success' ? (res[i].result as T) : fb);

  const borrower = get<Address>(3, ZERO as Address);
  // No borrower / no code → not a real sellbonds market.
  if (!borrower || borrower.toLowerCase() === ZERO) return null;

  const isClosed = get<boolean>(4, false);
  const annualInterestBips = get<bigint>(5, 0n);
  const reserveRatioBips = get<bigint>(6, 0n);
  const delinquencyFeeBips = get<bigint>(7, 0n);
  const totalSupply = get<bigint>(8, 0n);
  const totalAssets = get<bigint>(9, 0n);
  const borrowable = get<bigint>(10, 0n);
  const maximumDeposit = get<bigint>(11, 0n);

  const raised = fmt(totalSupply);
  const inMarket = fmt(totalAssets);
  const capacity = raised + fmt(maximumDeposit);
  const drawn = Math.max(0, raised - inMarket);

  // Verified issuer note (only trusted when the note's author is the bond's issuer).
  let label = '';
  let description = '';
  if (BONDNOTES) {
    const n = res[READS.length];
    if (n?.status === 'success' && Array.isArray(n.result)) {
      const [nm, desc, author] = n.result as [string, string, string, bigint];
      if (String(author).toLowerCase() === borrower.toLowerCase()) {
        label = nm || '';
        description = desc || '';
      }
    }
  }

  const core = {
    network: NETWORK,
    chainId: CHAIN.id,
    explorer: EXPLORER,
    market: getAddress(market),
    name: get<string>(0, ''),
    symbol: get<string>(1, ''),
    label: label || undefined,
    description: description || undefined,
    issuer: getAddress(borrower),
    asset: getAddress(get<Address>(2, ZERO as Address)),
    status: isClosed ? ('closed' as const) : ('open' as const),
    aprPct: Number(annualInterestBips) / 100,
    penaltyAprPct: Number(delinquencyFeeBips) / 100,
    reservePct: Number(reserveRatioBips) / 100,
    capacityUsdc: capacity,
    raisedUsdc: raised,
    inMarketUsdc: inMarket,
    drawnDownUsdc: drawn,
    borrowableUsdc: fmt(borrowable),
    filledPct: capacity > 0 ? Math.round((raised / capacity) * 100) : 0,
    explorerUrl: `${EXPLORER}/address/${getAddress(market)}`,
    issuerExplorerUrl: `${EXPLORER}/address/${getAddress(borrower)}`,
  };
  return { client, core };
}

const liteCache = new Map<string, { at: number; payload: any }>();

/** Market state without event history — one multicall, fast enough for unfurlers. */
export async function getBondLite(market: Address) {
  const key = `${NETWORK}:${market.toLowerCase()}`;
  const hit = liteCache.get(key);
  if (hit && Date.now() - hit.at <= CACHE_MS) return hit.payload;
  const r = await readCore(market);
  if (!r) return null;
  liteCache.set(key, { at: Date.now(), payload: r.core });
  return r.core;
}

async function buildBond(market: Address) {
  const r = await readCore(market);
  if (!r) return null;
  const { client, core } = r;

  // Event history for this market + its issuance, both filtered server-side.
  const [marketLogs, issueLogs] = await Promise.all([
    scanLogs(client, { address: market, events: MARKET_EVENTS }),
    scanLogs(client, { address: HOOKS_FACTORY, event: marketDeployedEvent, args: { market } }),
  ]);
  const logs = [...marketLogs, ...issueLogs];

  const blocks = [...new Set(logs.map((l) => (l.blockNumber as bigint).toString()))];
  const blockTs = new Map<string, number>();
  await Promise.all(
    blocks.map(async (bn) => {
      try {
        const blk = await client.getBlock({ blockNumber: BigInt(bn) });
        blockTs.set(bn, Number(blk.timestamp));
      } catch {
        /* leave undated */
      }
    }),
  );

  const events: Event[] = logs
    .map((l): Event | null => {
      const at = blockTs.get((l.blockNumber as bigint).toString());
      if (!at) return null;
      const txHash = l.transactionHash as string;
      const baseE = { at, txHash, explorerUrl: `${EXPLORER}/tx/${txHash}` };
      if (l.eventName === 'MarketDeployed') return { type: 'issued', ...baseE };
      if (l.eventName === 'Deposit') return { type: 'invested', actor: getAddress(l.args.account as string), amountUsdc: fmt(l.args.assetAmount as bigint), ...baseE };
      if (l.eventName === 'Borrow') return { type: 'drawn', amountUsdc: fmt(l.args.assetAmount as bigint), ...baseE };
      if (l.eventName === 'DebtRepaid') return { type: 'repaid', actor: getAddress(l.args.from as string), amountUsdc: fmt(l.args.assetAmount as bigint), ...baseE };
      return null;
    })
    .filter((e): e is Event => e !== null)
    .sort((a, b) => b.at - a.at);

  const issuedAt = events.find((e) => e.type === 'issued')?.at;

  return {
    ...core,
    issuedAt,
    events,
    updatedAt: new Date().toISOString(),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'GET only' });

  const raw = Array.isArray(req.query.market) ? req.query.market[0] : req.query.market;
  if (!raw || !isAddress(raw)) return res.status(400).json({ ok: false, error: 'invalid or missing "market" address' });
  const market = getAddress(raw);

  try {
    const payload = await getBond(market);
    if (!payload) return res.status(404).json({ ok: false, error: 'no sellbonds bond at that address' });
    res.setHeader('Cache-Control', 'public, max-age=20, s-maxage=30, stale-while-revalidate=120');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json(payload);
  } catch (err) {
    console.error('bond detail error:', err);
    return res.status(502).json({ ok: false, error: 'failed to read the bond from chain' });
  }
}
