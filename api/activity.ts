// sellbonds.now — live activity feed.
//
// GET /api/activity            → JSON: recent on-chain events across all bonds
// GET /api/activity?format=jsonl → one event per line
//
// Reads issuances (HooksFactory MarketDeployed) and per-bond Deposit / Borrow /
// DebtRepaid events directly from chain — no database. Public RPCs cap getLogs
// ranges, so we scan backward in windows and stop once we have enough recent
// events; a dedicated RPC makes this fast and complete. Cached per warm instance.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createPublicClient, http, getAddress, type Address } from 'viem';
import { base, baseSepolia } from 'viem/chains';

const NETWORK = process.env.SBN_NETWORK?.trim() || 'base';
const IS_TESTNET = NETWORK === 'base-sepolia';
const CHAIN = IS_TESTNET ? baseSepolia : base;
const RPC_URL =
  (IS_TESTNET ? process.env.RPC_URL_BASE_SEPOLIA?.trim() : process.env.RPC_URL_BASE?.trim()) ||
  (IS_TESTNET ? 'https://sepolia.base.org' : 'https://mainnet.base.org');
const EXPLORER = IS_TESTNET ? 'https://sepolia.basescan.org' : 'https://basescan.org';

const ARCH_CONTROLLER = (process.env.SBN_ARCH_CONTROLLER?.trim() ||
  '0x0dbb4426844266add3ab840935cd1a3a67dd4ef6') as Address;
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

const USDC_DECIMALS = 6;
const fmtUsdc = (v: bigint) => Number(v) / 10 ** USDC_DECIMALS;

// Events we surface. Full signatures so viem computes the right topics.
const EVENTS = [
  {
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
  },
  {
    type: 'event',
    name: 'Deposit',
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'assetAmount', type: 'uint256', indexed: false },
      { name: 'scaledAmount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Borrow',
    inputs: [{ name: 'assetAmount', type: 'uint256', indexed: false }],
  },
  {
    type: 'event',
    name: 'DebtRepaid',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'assetAmount', type: 'uint256', indexed: false },
    ],
  },
] as const;

const archAbi = [
  {
    type: 'function',
    name: 'getRegisteredMarkets',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
] as const;
const labelAbi = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'borrower', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
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

interface Activity {
  type: 'issued' | 'funded' | 'drawn' | 'repaid';
  market: string;
  label: string;
  actor?: string;
  amountUsdc?: number;
  at: number; // unix seconds
  txHash: string;
  explorerUrl: string;
}

const VERB: Record<Activity['type'], string> = {
  issued: 'issued',
  funded: 'funded',
  drawn: 'drew from',
  repaid: 'repaid',
};

let cache: { at: number; payload: any } | null = null;
const CACHE_MS = 30_000;
const TARGET = 40; // stop scanning once we have at least this many recent events
const shortAddr = (a: string) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

async function buildActivity() {
  const client: any = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });

  const markets = (await client.readContract({
    address: ARCH_CONTROLLER,
    abi: archAbi,
    functionName: 'getRegisteredMarkets',
  })) as Address[];

  if (markets.length === 0) {
    return { network: NETWORK, chainId: CHAIN.id, explorer: EXPLORER, events: [], updatedAt: new Date().toISOString() };
  }

  const addrs = [...markets, HOOKS_FACTORY];
  const latest: bigint = await client.getBlockNumber();
  const WINDOW = 500_000n; // one call on a dedicated RPC; loop is the fallback
  const MAX_WINDOWS = 80;
  const raw: any[] = [];
  let to = latest;
  for (let i = 0; i < MAX_WINDOWS && to >= FROM_BLOCK; i++) {
    const from = to - WINDOW + 1n > FROM_BLOCK ? to - WINDOW + 1n : FROM_BLOCK;
    try {
      const logs = await client.getLogs({ address: addrs, events: EVENTS as any, fromBlock: from, toBlock: to });
      raw.push(...logs);
    } catch {
      /* range/RPC hiccup — skip this window */
    }
    if (raw.length >= TARGET || from === FROM_BLOCK) break;
    to = from - 1n;
  }

  // Block timestamps for every block we touched.
  const blocks = [...new Set(raw.map((l) => (l.blockNumber as bigint).toString()))];
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

  // Labels for the markets that show up in the feed: issuer-set name (verified) or symbol.
  const seen = [...new Set(raw.map((l) => (l.eventName === 'MarketDeployed' ? (l.args.market as string) : (l.address as string)).toLowerCase()))];
  const labelCalls = seen.flatMap((m) => [
    { address: getAddress(m), abi: labelAbi as any, functionName: 'name' },
    { address: getAddress(m), abi: labelAbi as any, functionName: 'symbol' },
    { address: getAddress(m), abi: labelAbi as any, functionName: 'borrower' },
    ...(BONDNOTES ? [{ address: BONDNOTES, abi: bondNotesAbi as any, functionName: 'notes', args: [getAddress(m)] }] : []),
  ]);
  const labelRes = labelCalls.length ? await client.multicall({ contracts: labelCalls, allowFailure: true }) : [];
  const stride = BONDNOTES ? 4 : 3;
  const labelByMarket = new Map<string, string>();
  seen.forEach((m, i) => {
    const base = i * stride;
    const ok = (k: number) => labelRes[base + k]?.status === 'success';
    const tokenName = ok(0) ? (labelRes[base].result as string) : '';
    const symbol = ok(1) ? (labelRes[base + 1].result as string) : '';
    const borrower = ok(2) ? String(labelRes[base + 2].result).toLowerCase() : '';
    // Match the bonds table's fallback: issuer-set BondNotes name (verified) > on-chain
    // token name > symbol. (Previously this only fell back to symbol, so a bond named via
    // --name showed as "sbnUSDC" in the feed.)
    let label = tokenName || symbol || shortAddr(getAddress(m));
    if (BONDNOTES) {
      const note = labelRes[base + 3];
      if (note?.status === 'success' && Array.isArray(note.result)) {
        const [noteName, , author] = note.result as [string, string, string, bigint];
        if (noteName && String(author).toLowerCase() === borrower) label = noteName;
      }
    }
    labelByMarket.set(m, label);
  });

  const events: Activity[] = raw
    .map((l): Activity | null => {
      const at = blockTs.get((l.blockNumber as bigint).toString());
      if (!at) return null;
      const txHash = l.transactionHash as string;
      const base = { at, txHash, explorerUrl: `${EXPLORER}/tx/${txHash}` };
      if (l.eventName === 'MarketDeployed') {
        const market = (l.args.market as string).toLowerCase();
        return { type: 'issued', market: getAddress(market), label: labelByMarket.get(market) || '', ...base };
      }
      const market = (l.address as string).toLowerCase();
      const label = labelByMarket.get(market) || '';
      if (l.eventName === 'Deposit')
        return { type: 'funded', market: getAddress(market), label, actor: getAddress(l.args.account as string), amountUsdc: fmtUsdc(l.args.assetAmount as bigint), ...base };
      if (l.eventName === 'Borrow')
        return { type: 'drawn', market: getAddress(market), label, amountUsdc: fmtUsdc(l.args.assetAmount as bigint), ...base };
      if (l.eventName === 'DebtRepaid')
        return { type: 'repaid', market: getAddress(market), label, actor: getAddress(l.args.from as string), amountUsdc: fmtUsdc(l.args.assetAmount as bigint), ...base };
      return null;
    })
    .filter((e): e is Activity => e !== null)
    .sort((a, b) => b.at - a.at)
    .slice(0, TARGET)
    .map((e) => ({ ...e, verb: VERB[e.type], actorShort: e.actor ? shortAddr(e.actor) : undefined } as any));

  return { network: NETWORK, chainId: CHAIN.id, explorer: EXPLORER, events, updatedAt: new Date().toISOString() };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'GET only' });

  try {
    if (!cache || Date.now() - cache.at > CACHE_MS) {
      cache = { at: Date.now(), payload: await buildActivity() };
    }
    const payload = cache.payload;
    res.setHeader('Cache-Control', 'public, max-age=15, s-maxage=30, stale-while-revalidate=60');
    const format = (Array.isArray(req.query.format) ? req.query.format[0] : req.query.format) || 'json';
    if (format === 'jsonl') {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      return res.status(200).send(payload.events.map((e: any) => JSON.stringify(e)).join('\n') + '\n');
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json(payload);
  } catch (err) {
    console.error('activity feed error:', err);
    return res.status(502).json({ ok: false, error: 'failed to read on-chain activity' });
  }
}
