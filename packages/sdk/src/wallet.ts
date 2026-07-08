import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { type Address, type Hex, type PrivateKeyAccount } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

export interface WalletFile {
  address: Address;
  privateKey: Hex;
  createdAt: string;
  note: string;
}

export const SBN_HOME = process.env.SBN_HOME?.trim() || join(homedir(), '.sellbondsnow');
export const WALLET_PATH = join(SBN_HOME, 'wallet.json');
export const MARKETS_PATH = join(SBN_HOME, 'markets.json');

const KEYSTORE_NOTE =
  'sellbonds.now agent wallet. PLAINTEXT testnet key, mode 0600. ' +
  'Do not reuse this key on mainnet with real funds. Back it up if you care about the markets it controls.';

function ensureHome(): void {
  if (!existsSync(SBN_HOME)) mkdirSync(SBN_HOME, { recursive: true, mode: 0o700 });
}

export function walletExists(): boolean {
  return existsSync(WALLET_PATH);
}

/** Create a brand-new local wallet and persist it at mode 0600. */
export function createWallet(): WalletFile {
  ensureHome();
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const wallet: WalletFile = {
    address: account.address,
    privateKey,
    createdAt: new Date().toISOString(),
    note: KEYSTORE_NOTE,
  };
  writeWallet(wallet);
  return wallet;
}

/** Import an existing private key, persisting it at mode 0600. */
export function importWallet(privateKey: Hex): WalletFile {
  ensureHome();
  const account = privateKeyToAccount(privateKey);
  const wallet: WalletFile = {
    address: account.address,
    privateKey,
    createdAt: new Date().toISOString(),
    note: KEYSTORE_NOTE,
  };
  writeWallet(wallet);
  return wallet;
}

function writeWallet(wallet: WalletFile): void {
  ensureHome();
  writeFileSync(WALLET_PATH, JSON.stringify(wallet, null, 2), { mode: 0o600 });
  chmodSync(WALLET_PATH, 0o600);
}

export function loadWallet(): WalletFile {
  if (!walletExists()) {
    throw new Error(
      `No wallet found at ${WALLET_PATH}. Create one with \`sbn wallet new\` ` +
        `(or it will be created automatically by \`sbn raise\`).`,
    );
  }
  return JSON.parse(readFileSync(WALLET_PATH, 'utf8')) as WalletFile;
}

/** Load the local wallet, or create one if none exists. */
export function loadOrCreateWallet(): { wallet: WalletFile; created: boolean } {
  if (walletExists()) return { wallet: loadWallet(), created: false };
  return { wallet: createWallet(), created: true };
}

export function account(): PrivateKeyAccount {
  // Allow an env-supplied key to take precedence (useful for CI / ephemeral runs).
  // Normalize the 0x prefix so a raw 64-hex key (a common copy-paste) also works.
  const envKey = process.env.SBN_PRIVATE_KEY?.trim();
  if (envKey) {
    const hex = (envKey.startsWith('0x') ? envKey : `0x${envKey}`) as Hex;
    return privateKeyToAccount(hex);
  }
  return privateKeyToAccount(loadWallet().privateKey);
}

// --- Local registry of markets this agent has deployed -----------------------

export interface MarketRecord {
  market: Address;
  hooksInstance: Address;
  type: 'open' | 'fixed';
  asset: Address;
  name: string;
  symbol: string;
  network: string;
  txHash: Hex;
  createdAt: string;
}

export function recordMarket(record: MarketRecord): void {
  ensureHome();
  const existing = listMarkets();
  existing.push(record);
  writeFileSync(MARKETS_PATH, JSON.stringify(existing, null, 2), { mode: 0o600 });
}

export function listMarkets(): MarketRecord[] {
  if (!existsSync(MARKETS_PATH)) return [];
  try {
    return JSON.parse(readFileSync(MARKETS_PATH, 'utf8')) as MarketRecord[];
  } catch {
    return [];
  }
}

/** Overwrite the local market record (used by `sbn prune`). */
export function saveMarkets(records: MarketRecord[]): void {
  ensureHome();
  writeFileSync(MARKETS_PATH, JSON.stringify(records, null, 2), { mode: 0o600 });
}

export { dirname };
