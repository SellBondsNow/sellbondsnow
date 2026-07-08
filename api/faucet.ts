// sellbonds.now testnet dispenser.
//
// POST /api/faucet { "address": "0x..." }
// Sends a small amount of Base Sepolia ETH (gas bootstrap) to a new agent wallet
// from a funded relayer hot wallet. Test USDC is minted by the wallet itself via
// the permissionless MockUSDC.mint, so this only needs to dispense gas.
//
// This is the ONLY hosted piece of sellbonds.now in the agent flow, and it only
// moves valueless testnet gas. It never touches an agent's key. On mainnet there
// is no dispenser — agents bring their own funds.
//
// Vercel Function (Node runtime). Required env:
//   FAUCET_RELAYER_PRIVATE_KEY  — funded Base Sepolia hot wallet (gitignored .env)
//   RPC_URL_BASE_SEPOLIA        — optional, defaults to https://sepolia.base.org

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  parseEther,
  getAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

// Amount dripped per request, and the balance above which we refuse (so a funded
// wallet can't drain the relayer with repeat calls). Base Sepolia gas is ~free,
// so a small drip covers hundreds of transactions.
const DRIP = parseEther('0.003');
const ALREADY_FUNDED_AT = parseEther('0.0015');

// Best-effort rate limits. These are per warm serverless instance only (not
// shared across instances) — they raise the bar against trivial drain loops but are
// NOT a substitute for a real store. Harden with Vercel KV / Upstash before scale.
// The primary drain bound is operational: keep the relayer balance small (~0.08 ETH).
const RATE_WINDOW_MS = 60_000; // per IP
const ADDRESS_WINDOW_MS = 60 * 60_000; // per recipient address
const lastSeen = new Map<string, number>();
const lastFunded = new Map<string, number>();

// Per-instance dispense budget: bounds the drain rate even from many IPs/addresses.
const BUDGET_WINDOW_MS = 60 * 60_000;
const BUDGET_MAX_DRIPS = 40; // per warm instance per hour
let budgetWindowStart = 0;
let budgetUsed = 0;

function hasBudget(): boolean {
  const now = Date.now();
  if (now - budgetWindowStart > BUDGET_WINDOW_MS) {
    budgetWindowStart = now;
    budgetUsed = 0;
  }
  return budgetUsed < BUDGET_MAX_DRIPS;
}

// Keep the throttle maps from growing unbounded on a long-lived instance.
function pruneMap(map: Map<string, number>, windowMs: number) {
  if (map.size < 5_000) return;
  const cutoff = Date.now() - windowMs;
  for (const [k, t] of map) if (t < cutoff) map.delete(k);
}

function clientIp(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  return (raw?.split(',')[0] || req.socket?.remoteAddress || 'unknown').trim();
}

function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  const rawKey = process.env.FAUCET_RELAYER_PRIVATE_KEY?.trim();
  const rpcUrl = process.env.RPC_URL_BASE_SEPOLIA?.trim() || 'https://sepolia.base.org';
  if (!rawKey) return res.status(503).json({ ok: false, error: 'dispenser not configured' });

  // Body may arrive parsed or as a string depending on content-type.
  let body: any = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  const addressInput = body?.address;
  if (typeof addressInput !== 'string' || !isAddress(addressInput)) {
    return res.status(400).json({ ok: false, error: 'invalid or missing "address"' });
  }
  const address = getAddress(addressInput);

  // Best-effort per-IP + per-address throttles.
  const ip = clientIp(req);
  const now = Date.now();
  const prev = lastSeen.get(ip);
  if (prev && now - prev < RATE_WINDOW_MS) {
    res.setHeader('Retry-After', String(Math.ceil((RATE_WINDOW_MS - (now - prev)) / 1000)));
    return res.status(429).json({ ok: false, error: 'rate limited — wait a minute between requests' });
  }
  const prevFunded = lastFunded.get(address.toLowerCase());
  if (prevFunded && now - prevFunded < ADDRESS_WINDOW_MS) {
    res.setHeader('Retry-After', String(Math.ceil((ADDRESS_WINDOW_MS - (now - prevFunded)) / 1000)));
    return res.status(429).json({ ok: false, error: 'this address was funded recently — wait an hour between requests' });
  }
  if (!hasBudget()) {
    res.setHeader('Retry-After', '3600');
    return res.status(429).json({ ok: false, error: 'dispenser is at capacity — try again later or use a public Base Sepolia faucet' });
  }
  pruneMap(lastSeen, RATE_WINDOW_MS);
  pruneMap(lastFunded, ADDRESS_WINDOW_MS);

  try {
    const account = privateKeyToAccount(rawKey as `0x${string}`);
    const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
    const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl) });

    // Safety: this dispenser only ever moves valueless testnet gas. If the RPC is
    // ever misconfigured to a non-Base-Sepolia chain, refuse rather than risk
    // sending real ETH from the relayer hot wallet.
    const liveChainId = await publicClient.getChainId();
    if (liveChainId !== baseSepolia.id) {
      return res.status(503).json({ ok: false, error: 'dispenser is testnet-only (Base Sepolia)' });
    }

    const balance = await publicClient.getBalance({ address });
    if (balance >= ALREADY_FUNDED_AT) {
      return res.status(200).json({
        ok: true,
        skipped: true,
        message: 'wallet already has enough gas',
        balance: balance.toString(),
      });
    }

    const relayerBalance = await publicClient.getBalance({ address: account.address });
    if (relayerBalance < DRIP) {
      return res.status(503).json({ ok: false, error: 'dispenser is out of funds — try a public Base Sepolia faucet' });
    }

    // Consume budget only when actually dispensing (skipped/already-funded requests
    // above don't count against it).
    budgetUsed += 1;
    const txHash = await walletClient.sendTransaction({ to: address, value: DRIP });
    lastSeen.set(ip, now);
    lastFunded.set(address.toLowerCase(), now);
    return res.status(200).json({ ok: true, txHash, amount: DRIP.toString(), message: 'gas dispensed' });
  } catch (err) {
    // Log full detail server-side; return a generic message so we don't leak RPC
    // endpoints, key state, or internal errors to callers.
    console.error('faucet error:', err);
    return res.status(502).json({ ok: false, error: 'dispenser error — try again shortly or use a public Base Sepolia faucet' });
  }
}
