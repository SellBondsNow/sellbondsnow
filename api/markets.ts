// sellbonds.now — issued-bonds index.
//
// GET /api/markets            → JSON: every bond ever issued + aggregates
// GET /api/markets?format=jsonl → one bond per line (streaming-friendly for agents)
//
// Reads the on-chain registry (WildcatArchController.getRegisteredMarkets) and
// each market's live state via multicall — no database, no indexer. Results are
// cached in-memory per warm instance for ~60s so we don't hammer the RPC.
//
// This is read-only public data. To invest in a bond, an agent runs
// `sbn deposit <market> <usdc>` (see https://sellbonds.now/llms.txt).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createPublicClient, http, getAddress, type Address } from 'viem';
import { base, baseSepolia } from 'viem/chains';

// Default to Base mainnet; set SBN_NETWORK=base-sepolia to serve the testnet index.
const NETWORK = process.env.SBN_NETWORK?.trim() || 'base';
const IS_TESTNET = NETWORK === 'base-sepolia';

const CHAIN = IS_TESTNET ? baseSepolia : base;
const RPC_URL =
  (IS_TESTNET ? process.env.RPC_URL_BASE_SEPOLIA?.trim() : process.env.RPC_URL_BASE?.trim()) ||
  (IS_TESTNET ? 'https://sepolia.base.org' : 'https://mainnet.base.org');
const EXPLORER = IS_TESTNET ? 'https://sepolia.basescan.org' : 'https://basescan.org';

// Arch controller (the on-chain registry of every market) per network. Override
// with SBN_ARCH_CONTROLLER. The base (mainnet) address is filled in after deploy.
const ARCH_CONTROLLER_BY_NETWORK: Record<string, Address> = {
  base: '0x0dbb4426844266add3ab840935cd1a3a67dd4ef6', // Base mainnet ArchController
  'base-sepolia': '0x0dbb4426844266add3ab840935cd1a3a67dd4ef6',
};
const ARCH_CONTROLLER = (process.env.SBN_ARCH_CONTROLLER?.trim() ||
  ARCH_CONTROLLER_BY_NETWORK[NETWORK] ||
  ARCH_CONTROLLER_BY_NETWORK.base) as Address;

// HooksFactory emits MarketDeployed(market) — we read its logs to get each bond's
// issuance date. Address is deploy-deterministic (same on both chains).
const HOOKS_FACTORY = (process.env.SBN_HOOKS_FACTORY?.trim() ||
  '0x6fe029dfc85924c83a2f7159292f53b3a9a3806f') as Address;
// Block the stack was deployed at — the floor for the MarketDeployed log scan.
// A dedicated RPC is recommended so this range stays cheap as history grows.
const FROM_BLOCK_BY_NETWORK: Record<string, bigint> = {
  base: 46984789n,
  'base-sepolia': 0n,
};
const FROM_BLOCK = FROM_BLOCK_BY_NETWORK[NETWORK] ?? 0n;

// BondNotes registry — issuer-set name + description per market. Mainnet only for now.
const BONDNOTES_BY_NETWORK: Record<string, Address | undefined> = {
  base: '0xbe5369cfcbe284d42306bc462be796a7c764dbe9',
  'base-sepolia': undefined,
};
const BONDNOTES =
  (process.env.SBN_BONDNOTES?.trim() as Address | undefined) || BONDNOTES_BY_NETWORK[NETWORK];

const USDC_DECIMALS = 6;

const archAbi = [
  {
    type: 'function',
    name: 'getRegisteredMarkets',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
] as const;

// MarketDeployed(address indexed hooksTemplate, address indexed market, ...) — the
// full signature is required so viem computes the right topic0; `market` is indexed.
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

const bondNotesAbi = [
  {
    type: 'function',
    name: 'notes',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [
      { type: 'string' }, // name
      { type: 'string' }, // description
      { type: 'address' }, // author
      { type: 'uint40' }, // updatedAt
    ],
  },
] as const;

const marketAbi = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'asset', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'borrower', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'isClosed', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'annualInterestBips', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'reserveRatioBips', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalAssets', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'borrowableAssets', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'maximumDeposit', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

const READS = [
  'name', 'symbol', 'asset', 'borrower', 'isClosed', 'annualInterestBips',
  'reserveRatioBips', 'totalSupply', 'totalAssets', 'borrowableAssets', 'maximumDeposit',
] as const;

interface Bond {
  address: string;
  issuer: string;
  name: string;
  symbol: string;
  asset: string;
  status: 'open' | 'closed';
  aprPct: number;
  reservePct: number;
  capacityUsdc: number;
  raisedUsdc: number;
  inMarketUsdc: number;
  drawnDownUsdc: number;
  borrowableUsdc: number;
  filledPct: number;
  explorerUrl: string;
  issuedAt?: number; // unix seconds of the bond's deploy block
  label?: string; // issuer-set short name (only when the note's author is the issuer)
  description?: string; // issuer-set "what it's for" (verified author == issuer)
}

const fmt = (v: bigint) => Number(v) / 10 ** USDC_DECIMALS;

let cache: { at: number; payload: any } | null = null;
const CACHE_MS = 60_000;

// Shared accessor so other functions (e.g. the bond sitemap) reuse the same
// index logic. Note each Vercel function bundles its own copy of this module,
// so the in-memory cache is per-function per-instance.
export async function getIndex() {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    cache = { at: Date.now(), payload: await buildIndex() };
  }
  return cache.payload;
}

// Issuance timestamps are immutable, so cache them permanently per market and only
// scan logs for markets we haven't dated yet.
const issuedAtCache = new Map<string, number>();

async function loadIssuedAt(client: any, markets: Address[]): Promise<void> {
  const missing = new Set(
    markets.filter((m) => !issuedAtCache.has(m.toLowerCase())).map((m) => m.toLowerCase()),
  );
  if (missing.size === 0) return;
  try {
    const latest: bigint = await client.getBlockNumber();
    // Scan backward in windows and early-exit once every market is dated. With a
    // dedicated RPC (Alchemy PAYG) this is a single call; the loop is the fallback
    // for RPCs that cap getLogs ranges.
    const WINDOW = 500_000n;
    const MAX_WINDOWS = 80;
    const marketBlock = new Map<string, bigint>();
    let to = latest;
    for (let i = 0; i < MAX_WINDOWS && missing.size > 0 && to >= FROM_BLOCK; i++) {
      const from = to - WINDOW + 1n > FROM_BLOCK ? to - WINDOW + 1n : FROM_BLOCK;
      let logs: any[] = [];
      try {
        logs = await client.getLogs({
          address: HOOKS_FACTORY,
          event: marketDeployedEvent,
          fromBlock: from,
          toBlock: to,
        });
      } catch {
        logs = [];
      }
      for (const log of logs) {
        const m = (log.args?.market as string | undefined)?.toLowerCase();
        if (m && missing.has(m) && log.blockNumber != null) {
          marketBlock.set(m, log.blockNumber as bigint);
          missing.delete(m);
        }
      }
      if (from === FROM_BLOCK) break;
      to = from - 1n;
    }
    const uniqueBlocks = [...new Set([...marketBlock.values()].map((b) => b.toString()))];
    const blockTs = new Map<string, number>();
    await Promise.all(
      uniqueBlocks.map(async (bn) => {
        const blk = await client.getBlock({ blockNumber: BigInt(bn) });
        blockTs.set(bn, Number(blk.timestamp));
      }),
    );
    for (const [m, bn] of marketBlock) {
      const ts = blockTs.get(bn.toString());
      if (ts) issuedAtCache.set(m, ts);
    }
  } catch (err) {
    // Non-fatal: dates just won't show. Most likely an RPC getLogs range limit —
    // a dedicated RPC fixes it.
    console.error('issuedAt log scan failed:', err);
  }
}

async function buildIndex() {
  const client = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });

  const addresses = (await client.readContract({
    address: ARCH_CONTROLLER,
    abi: archAbi,
    functionName: 'getRegisteredMarkets',
  })) as Address[];

  // One multicall for every read across every market.
  const contracts = addresses.flatMap((address) =>
    READS.map((functionName) => ({ address, abi: marketAbi as any, functionName })),
  );
  const noteCalls = BONDNOTES
    ? addresses.map((address) => ({
        address: BONDNOTES,
        abi: bondNotesAbi as any,
        functionName: 'notes',
        args: [address],
      }))
    : [];
  const [results, noteResults] = await Promise.all([
    client.multicall({ contracts, allowFailure: true }),
    noteCalls.length
      ? client.multicall({ contracts: noteCalls, allowFailure: true })
      : Promise.resolve([] as any[]),
    loadIssuedAt(client, addresses),
  ]);

  // market(lower) -> note. Only trusted later when the note's author equals the
  // market's actual issuer (borrower) — a forged note from anyone else is ignored.
  const noteByMarket = new Map<string, { name: string; description: string; author: string }>();
  addresses.forEach((address, i) => {
    const r = (noteResults as any[])[i];
    if (r?.status === 'success' && Array.isArray(r.result)) {
      const [name, description, author] = r.result as [string, string, string, bigint];
      if ((name && name.length) || (description && description.length)) {
        noteByMarket.set(address.toLowerCase(), {
          name: name || '',
          description: description || '',
          author: String(author || '').toLowerCase(),
        });
      }
    }
  });

  const bonds: Bond[] = addresses.map((address, i) => {
    const base = i * READS.length;
    const val = (offset: number) => results[base + offset];
    const get = <T>(offset: number, fallback: T): T =>
      val(offset)?.status === 'success' ? (val(offset)!.result as T) : fallback;

    const isClosed = get<boolean>(4, false);
    const annualInterestBips = get<bigint>(5, 0n);
    const reserveRatioBips = get<bigint>(6, 0n);
    const totalSupply = get<bigint>(7, 0n);
    const totalAssets = get<bigint>(8, 0n);
    const borrowable = get<bigint>(9, 0n);
    const maximumDeposit = get<bigint>(10, 0n);

    const raised = fmt(totalSupply);
    const inMarket = fmt(totalAssets);
    const capacity = raised + fmt(maximumDeposit);
    const drawn = Math.max(0, raised - inMarket);

    const issuer = getAddress(get<Address>(3, '0x0000000000000000000000000000000000000000'));
    const note = noteByMarket.get(address.toLowerCase());
    const noteOk = !!note && !!note.author && note.author === issuer.toLowerCase();

    return {
      address: getAddress(address),
      issuer,
      name: get<string>(0, ''),
      symbol: get<string>(1, ''),
      asset: getAddress(get<Address>(2, '0x0000000000000000000000000000000000000000')),
      status: isClosed ? 'closed' : 'open',
      aprPct: Number(annualInterestBips) / 100,
      reservePct: Number(reserveRatioBips) / 100,
      capacityUsdc: capacity,
      raisedUsdc: raised,
      inMarketUsdc: inMarket,
      drawnDownUsdc: drawn,
      borrowableUsdc: fmt(borrowable),
      filledPct: capacity > 0 ? Math.round((raised / capacity) * 100) : 0,
      explorerUrl: `${EXPLORER}/address/${getAddress(address)}`,
      issuedAt: issuedAtCache.get(address.toLowerCase()),
      label: noteOk && note!.name ? note!.name : undefined,
      description: noteOk && note!.description ? note!.description : undefined,
    };
  });

  // Aggregate issuers from the same on-chain data (no separate source).
  const issuerMap = new Map<string, any>();
  for (const b of bonds) {
    const cur =
      issuerMap.get(b.issuer) ??
      { issuer: b.issuer, bonds: 0, totalRaisedUsdc: 0, totalDrawnUsdc: 0, explorerUrl: `${EXPLORER}/address/${b.issuer}` };
    cur.bonds += 1;
    cur.totalRaisedUsdc = round2(cur.totalRaisedUsdc + b.raisedUsdc);
    cur.totalDrawnUsdc = round2(cur.totalDrawnUsdc + b.drawnDownUsdc);
    issuerMap.set(b.issuer, cur);
  }
  const issuers = [...issuerMap.values()].sort((a, b) => b.totalRaisedUsdc - a.totalRaisedUsdc);

  const aggregates = {
    totalBonds: bonds.length,
    activeBonds: bonds.filter((b) => b.status === 'open').length,
    totalIssuers: issuers.length,
    totalRaisedUsdc: round2(bonds.reduce((s, b) => s + b.raisedUsdc, 0)),
    totalDrawnUsdc: round2(bonds.reduce((s, b) => s + b.drawnDownUsdc, 0)),
    totalCapacityUsdc: round2(bonds.reduce((s, b) => s + b.capacityUsdc, 0)),
  };

  return {
    network: NETWORK,
    chainId: CHAIN.id,
    explorer: EXPLORER,
    archController: ARCH_CONTROLLER,
    asset: 'USDC',
    invest: {
      howto: 'List bonds here, then run: sbn deposit <market> <usdc>. Install: npm i -g sellbonds.',
      docs: 'https://sellbonds.now/llms.txt',
    },
    aggregates,
    bonds,
    issuers,
    updatedAt: nowIso(),
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function nowIso() {
  // Date is allowed here (Node runtime), unlike workflow scripts.
  return new Date().toISOString();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'GET only' });

  try {
    const payload = await getIndex();
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=120');

    const format = (Array.isArray(req.query.format) ? req.query.format[0] : req.query.format) || 'json';
    if (format === 'jsonl') {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      return res.status(200).send(payload.bonds.map((b: Bond) => JSON.stringify(b)).join('\n') + '\n');
    }
    if (format === 'issuers-jsonl') {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      return res.status(200).send(payload.issuers.map((i: any) => JSON.stringify(i)).join('\n') + '\n');
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json(payload);
  } catch (err) {
    console.error('markets index error:', err);
    return res.status(502).json({ ok: false, error: 'failed to read on-chain market registry' });
  }
}
