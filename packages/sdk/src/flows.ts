import { parseEther } from 'viem';
import { type Sbn } from './client.js';
import { assertDeployed } from './config.js';
import { ethBalance, mintTestUsdc, usdcBalance, waitForEth } from './bonds.js';
import { requestEthFromFaucet } from './faucet.js';

export type Logger = (msg: string) => void;
const noop: Logger = () => {};

export interface FundOptions {
  /** Minimum ETH (wei) the wallet should hold to transact. Default 0.001 ETH. */
  minEthWei?: bigint;
  /** Test USDC (base units) the wallet should hold. Default 1,000,000 USDC. */
  mintUsdc?: bigint;
  log?: Logger;
}

export interface FundResult {
  ethBefore: bigint;
  ethAfter: bigint;
  usdcAfter: bigint;
  faucetUsed: boolean;
  faucetMessage?: string;
}

const DEFAULT_MIN_ETH = parseEther('0.001');
const DEFAULT_MINT_USDC = 1_000_000n * 10n ** 6n;

/**
 * Make sure the wallet can transact: top up ETH via the sellbonds.now dispenser
 * if it's low, then mint test USDC if needed. Idempotent — safe to call before
 * every action.
 */
export async function ensureFunded(sbn: Sbn, opts: FundOptions = {}): Promise<FundResult> {
  assertDeployed(sbn.deployment);
  const log = opts.log ?? noop;
  const minEth = opts.minEthWei ?? DEFAULT_MIN_ETH;
  const mintTarget = opts.mintUsdc ?? DEFAULT_MINT_USDC;

  const ethBefore = await ethBalance(sbn);

  // Mainnet: there is no dispenser and USDC is real money. Never auto-fund or mint
  // on a value-bearing chain — the wallet must already hold gas (and, to lend or
  // self-deposit, real USDC). Just verify there's enough gas and report balances.
  if (!sbn.deployment.testnet) {
    if (ethBefore < minEth) {
      throw new Error(
        `Wallet ${sbn.account.address} has too little ETH for gas on ${sbn.deployment.label}. ` +
          `There is no dispenser on mainnet — send Base ETH to this address and retry. ` +
          `Issuing a bond needs only gas; lending also needs real USDC.`,
      );
    }
    return {
      ethBefore,
      ethAfter: ethBefore,
      usdcAfter: await usdcBalance(sbn),
      faucetUsed: false,
    };
  }

  let faucetUsed = false;
  let faucetMessage: string | undefined;

  if (ethBefore < minEth) {
    log(`Requesting gas from the sellbonds.now dispenser (${sbn.deployment.faucetUrl})…`);
    const res = await requestEthFromFaucet(sbn.deployment.faucetUrl, sbn.account.address);
    faucetUsed = true;
    faucetMessage = res.message;
    if (!res.ok) {
      throw new Error(
        `Dispenser could not fund ${sbn.account.address}: ${res.message ?? 'unknown error'}. ` +
          `Fund it manually with Base Sepolia ETH (https://portal.cdp.coinbase.com/products/faucet) and retry.`,
      );
    }
    log('Waiting for gas to arrive…');
    const arrived = await waitForEth(sbn, minEth);
    if (!arrived) {
      throw new Error(
        `Gas did not arrive in time. Check ${sbn.account.address} on the explorer and retry once it has ETH.`,
      );
    }
  }

  // Mint test USDC up to the target balance.
  const usdcNow = await usdcBalance(sbn);
  if (usdcNow < mintTarget) {
    log('Minting test USDC…');
    await mintTestUsdc(sbn, mintTarget - usdcNow);
  }

  return {
    ethBefore,
    ethAfter: await ethBalance(sbn),
    usdcAfter: await usdcBalance(sbn),
    faucetUsed,
    faucetMessage,
  };
}
