import {
  type Account,
  type PublicClient,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  fallback,
  http,
} from 'viem';
import { type Deployment, loadDeployment, viemChain } from './config.js';
import { account as defaultAccount } from './wallet.js';

export interface Sbn {
  deployment: Deployment;
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Account;
}

/**
 * Transport that tries the configured RPC first, then transparently falls over to
 * the sellbonds.now hosted RPC and a public endpoint — so a rate-limit or outage on
 * one provider auto-recovers on the next, with no config from the agent. Set
 * SBN_RPC_URL to put your own RPC first. The hosted proxy is Base-mainnet only.
 */
function rpcTransport(d: Deployment) {
  const candidates = [
    d.rpcUrl,
    d.testnet ? undefined : 'https://sellbonds.now/rpc',
    d.testnet ? 'https://sepolia.base.org' : 'https://mainnet.base.org',
  ].filter((u): u is string => !!u);
  const seen = new Set<string>();
  const urls = candidates.filter((u) => {
    const k = u.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Low per-transport retry so a rate-limited endpoint fails over quickly.
  return fallback(urls.map((u) => http(u, { retryCount: 1 })));
}

/**
 * Build the public + wallet clients for a network. The wallet client signs with
 * the local keystore (or SBN_PRIVATE_KEY) — sellbonds.now never sees the key.
 */
export function connect(network?: string, acct: Account = defaultAccount()): Sbn {
  const deployment = loadDeployment(network);
  const chain = viemChain(deployment);
  const transport = rpcTransport(deployment);

  const publicClient = createPublicClient({ chain, transport }) as PublicClient;
  const walletClient = createWalletClient({ account: acct, chain, transport });

  return { deployment, publicClient, walletClient, account: acct };
}

/** Build a read-only client (no key required) for status/list queries. */
export function connectReadonly(network?: string): {
  deployment: Deployment;
  publicClient: PublicClient;
} {
  const deployment = loadDeployment(network);
  const chain = viemChain(deployment);
  const publicClient = createPublicClient({ chain, transport: rpcTransport(deployment) }) as PublicClient;
  return { deployment, publicClient };
}
