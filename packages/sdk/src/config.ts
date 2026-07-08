import { type Address, getAddress, isAddress } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import baseDeployment from './deployments/base.json' assert { type: 'json' };
import baseSepoliaDeployment from './deployments/base-sepolia.json' assert { type: 'json' };

const ZERO = '0x0000000000000000000000000000000000000000';

export interface DeploymentContracts {
  WildcatArchController: Address;
  WildcatSanctionsSentinel: Address;
  NullSanctionsOracle: Address;
  HooksFactory: Address;
  OpenTermHooksTemplate: Address;
  FixedTermHooksTemplate: Address;
  TestUSDC: Address;
  /** Registry of issuer-set name/description per bond. Mainnet only for now. */
  BondNotes?: Address;
}

export interface Deployment {
  chainId: number;
  chain: string;
  label: string;
  rpcUrl: string;
  explorer: string;
  faucetUrl: string;
  /** True for free test networks (gas dispenser + freely-mintable USDC). False on
   *  value-bearing mainnets, where the wallet must bring its own ETH and real USDC. */
  testnet: boolean;
  deployed: boolean;
  deployer: Address;
  contracts: DeploymentContracts;
}

const DEPLOYMENTS: Record<string, Deployment> = {
  base: baseDeployment as Deployment,
  'base-sepolia': baseSepoliaDeployment as Deployment,
};

export const DEFAULT_NETWORK = 'base';

/** Resolve which network to use (SBN_NETWORK env or the default). */
export function networkName(): string {
  return process.env.SBN_NETWORK?.trim() || DEFAULT_NETWORK;
}

/**
 * Load the deployment for a network, applying environment overrides. Env vars
 * let you point the SDK at a fresh/local deployment without rebuilding:
 *   SBN_RPC_URL, SBN_EXPLORER, SBN_FAUCET_URL,
 *   SBN_ARCH_CONTROLLER, SBN_HOOKS_FACTORY, SBN_OPEN_TERM_TEMPLATE,
 *   SBN_FIXED_TERM_TEMPLATE, SBN_USDC
 */
export function loadDeployment(network = networkName()): Deployment {
  const base = DEPLOYMENTS[network];
  if (!base) {
    throw new Error(
      `Unknown network "${network}". Known networks: ${Object.keys(DEPLOYMENTS).join(', ')}.`,
    );
  }
  // Deep clone so env overrides don't mutate the imported JSON.
  const d: Deployment = JSON.parse(JSON.stringify(base));

  const env = process.env;
  if (env.SBN_RPC_URL?.trim()) d.rpcUrl = env.SBN_RPC_URL.trim();
  if (env.SBN_EXPLORER?.trim()) d.explorer = env.SBN_EXPLORER.trim();
  if (env.SBN_FAUCET_URL?.trim()) d.faucetUrl = env.SBN_FAUCET_URL.trim();

  const overrideAddr = (envKey: string, target: keyof DeploymentContracts) => {
    const v = env[envKey]?.trim();
    if (v && isAddress(v)) d.contracts[target] = getAddress(v);
  };
  overrideAddr('SBN_ARCH_CONTROLLER', 'WildcatArchController');
  overrideAddr('SBN_HOOKS_FACTORY', 'HooksFactory');
  overrideAddr('SBN_OPEN_TERM_TEMPLATE', 'OpenTermHooksTemplate');
  overrideAddr('SBN_FIXED_TERM_TEMPLATE', 'FixedTermHooksTemplate');
  overrideAddr('SBN_USDC', 'TestUSDC');

  // A deployment is "live" once the core addresses are non-zero.
  d.deployed =
    d.contracts.WildcatArchController !== ZERO &&
    d.contracts.HooksFactory !== ZERO &&
    d.contracts.OpenTermHooksTemplate !== ZERO;

  return d;
}

export function assertDeployed(d: Deployment): void {
  if (!d.deployed) {
    throw new Error(
      `sellbonds.now is not deployed on ${d.label} yet. ` +
        `If you just deployed, set SBN_ARCH_CONTROLLER / SBN_HOOKS_FACTORY / ` +
        `SBN_OPEN_TERM_TEMPLATE / SBN_FIXED_TERM_TEMPLATE / SBN_USDC, ` +
        `or rebuild sellbonds with the populated deployments file.`,
    );
  }
}

export function viemChain(d: Deployment) {
  // Base mainnet is the launch network; Base Sepolia is the free testnet. Any
  // other chain falls back to a generic definition built from deployment metadata.
  if (d.chainId === base.id) return base;
  if (d.chainId === baseSepolia.id) return baseSepolia;
  return {
    id: d.chainId,
    name: d.label,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [d.rpcUrl] } },
    blockExplorers: { default: { name: 'Explorer', url: d.explorer } },
  } as const;
}

export function txUrl(d: Deployment, hash: string): string {
  return `${d.explorer}/tx/${hash}`;
}

export function addressUrl(d: Deployment, address: string): string {
  return `${d.explorer}/address/${address}`;
}
