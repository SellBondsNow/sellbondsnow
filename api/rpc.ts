// sellbonds.now — hosted Base mainnet RPC proxy.
//
// POST any JSON-RPC request (single or batch) and it is forwarded to the project's
// Base mainnet RPC server-side, so agents that get rate-limited on public endpoints
// have a reliable option without needing their own key.
//
// This is an OPTIONAL convenience. It only relays JSON-RPC — signing always happens
// locally in the agent's wallet, and agents can point at any Base RPC (or their own)
// instead via SBN_RPC_URL. Use it as a Base mainnet RPC URL:
//   SBN_RPC_URL=https://sellbonds.now/rpc
//
// Guardrails (protecting the upstream paid RPC, not the caller):
//   - method allowlist: standard reads + eth_sendRawTransaction only
//   - batch size + body size caps
//   - best-effort per-IP throttle (per warm instance — see faucet.ts caveat)
// Required env: RPC_URL_BASE (the upstream Base RPC).

import type { VercelRequest, VercelResponse } from '@vercel/node';

const RPC_URL = process.env.RPC_URL_BASE?.trim() || 'https://mainnet.base.org';

// Everything the SDK/viem needs for the full bond lifecycle: reads, fee estimation,
// nonce/receipt tracking, log queries, and broadcasting locally-signed transactions.
// Deliberately excludes debug_/trace_/admin_ and filter/subscription methods.
const ALLOWED_METHODS = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_call',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'eth_getBalance',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_getTransactionCount',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getBlockReceipts',
  'eth_getLogs',
  'eth_sendRawTransaction',
  'net_version',
  'web3_clientVersion',
  'eth_syncing',
]);

const MAX_BATCH = 50;
const MAX_BODY_BYTES = 512 * 1024;

// Best-effort per-IP sliding-window throttle (per warm instance only — bounds abuse,
// not a real limiter; see faucet.ts). Generous enough for a full bond flow.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_CALLS = 300; // JSON-RPC calls (batch items count individually)
const callLog = new Map<string, { windowStart: number; count: number }>();

function clientIp(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  return (raw?.split(',')[0] || req.socket?.remoteAddress || 'unknown').trim();
}

function takeCalls(ip: string, n: number): boolean {
  const now = Date.now();
  let entry = callLog.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    callLog.set(ip, entry);
  }
  if (entry.count + n > RATE_MAX_CALLS) return false;
  entry.count += n;
  if (callLog.size > 5_000) {
    const cutoff = now - RATE_WINDOW_MS;
    for (const [k, v] of callLog) if (v.windowStart < cutoff) callLog.delete(k);
  }
  return true;
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res
      .status(405)
      .json({ error: 'POST JSON-RPC only. Use this URL as a Base mainnet RPC endpoint.' });
  }

  // Body may arrive parsed (object/array) or as a raw string depending on headers.
  let body: any = req.body;
  if (typeof body === 'string') {
    if (body.length > MAX_BODY_BYTES) {
      return res.status(413).json(rpcError(null, -32600, 'request too large'));
    }
    try {
      body = JSON.parse(body);
    } catch {
      body = undefined;
    }
  }
  if (body === undefined || body === null) {
    return res.status(400).json(rpcError(null, -32600, 'Invalid JSON-RPC request'));
  }

  const calls: any[] = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > MAX_BATCH) {
    return res.status(400).json(rpcError(null, -32600, `batch size must be 1-${MAX_BATCH}`));
  }
  for (const call of calls) {
    const method = call?.method;
    if (typeof method !== 'string' || !ALLOWED_METHODS.has(method)) {
      return res
        .status(400)
        .json(rpcError(call?.id, -32601, `method not allowed on this proxy: ${String(method)}`));
    }
  }

  const ip = clientIp(req);
  if (!takeCalls(ip, calls.length)) {
    res.setHeader('Retry-After', '60');
    return res
      .status(429)
      .json(rpcError(calls[0]?.id, -32005, 'rate limited — bring your own RPC via SBN_RPC_URL for heavy use'));
  }

  try {
    const upstream = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(upstream.status).send(text);
  } catch (err) {
    console.error('rpc proxy error:', err);
    return res.status(502).json(rpcError(null, -32603, 'RPC proxy error'));
  }
}
