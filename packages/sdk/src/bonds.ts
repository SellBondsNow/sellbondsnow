import { randomBytes } from 'node:crypto';
import {
  type Abi,
  type Address,
  type Hex,
  encodeAbiParameters,
  getAddress,
  parseAbiParameters,
  zeroAddress,
} from 'viem';
import { archControllerAbi, bondNotesAbi, erc20Abi, hooksFactoryAbi, marketAbi } from './abis.js';
import { type Sbn } from './client.js';
import { addressUrl, assertDeployed, txUrl } from './config.js';
import { explainError } from './errors.js';
import { parseDuration, pctToBips, USDC_DECIMALS } from './format.js';
import { type MarketRecord, recordMarket } from './wallet.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Errors that mean a tx was rejected *before* entering the mempool (so it is
 *  safe to refetch the nonce and resend). Public testnet RPCs are load-balanced
 *  across replicas, so consecutive txs routinely hit a node with a stale nonce
 *  or a momentary rate limit. These never indicate a mined transaction. */
function isTransientSendError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('nonce') ||
    msg.includes('replacement transaction underpriced') ||
    msg.includes('already known') ||
    msg.includes('rate limit') ||
    msg.includes('429') ||
    msg.includes('fetch failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('connection') ||
    msg.includes('timeout')
  );
}

/** Simulate → write → wait. Returns the decoded result + receipt. Throws a
 *  friendly error if the simulation reverts (before any gas is spent).
 *
 *  The simulate+broadcast step is retried on transient infra errors (stale
 *  nonce, rate limit, dropped connection) — these happen before the tx is in
 *  the mempool, so resending after refetching the nonce is safe. Once we have a
 *  tx hash the wait is NOT retried, so a mined tx is never duplicated. */
async function send(
  sbn: Sbn,
  params: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint },
): Promise<{ hash: Hex; result: unknown }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    let hash: Hex;
    let result: unknown;
    try {
      const sim = await sbn.publicClient.simulateContract({
        account: sbn.account,
        address: params.address,
        abi: params.abi,
        functionName: params.functionName,
        args: (params.args ?? []) as any,
        value: params.value,
      } as any);
      result = sim.result;

      // Gas buffer. Wildcat markets use a reentrancy guard ("sentry") that
      // reverts with ReentrancySentryOOG if the call is given too little gas —
      // and a public node's eth_estimateGas routinely underestimates it. Estimate
      // explicitly and add 60% headroom so these calls don't OOG. Unused gas is
      // refunded, so over-provisioning is safe. Falls back to viem's auto-estimate
      // if the explicit estimate fails.
      let gas: bigint | undefined;
      try {
        const est = await sbn.publicClient.estimateContractGas({
          account: sbn.account,
          address: params.address,
          abi: params.abi,
          functionName: params.functionName,
          args: (params.args ?? []) as any,
          value: params.value,
        } as any);
        gas = (est * 160n) / 100n;
      } catch {
        gas = undefined;
      }
      hash = await sbn.walletClient.writeContract(
        (gas ? { ...(sim.request as any), gas } : sim.request) as any,
      );
    } catch (err) {
      lastErr = err;
      if (isTransientSendError(err) && attempt < 3) {
        await sleep(2000);
        continue;
      }
      throw new Error(explainError(err));
    }
    // Broadcast succeeded — wait for the receipt. Do not resend on wait errors;
    // that would risk duplicating a transaction that is already mined.
    const receipt = await sbn.publicClient.waitForTransactionReceipt({ hash });
    // A mined transaction can still have reverted (e.g. out-of-gas in the
    // reentrancy sentry, or a state change between simulation and execution).
    // Never report that as success.
    if (receipt.status !== 'success') {
      throw new Error(
        `Transaction reverted on-chain (${hash}). This can be an out-of-gas or a ` +
          `state change after simulation — re-read state with \`sbn status\` and retry.`,
      );
    }
    return { hash, result };
  }
  throw new Error(explainError(lastErr));
}

// --- Issuer onboarding -------------------------------------------------------

export async function isRegistered(sbn: Sbn, address?: Address): Promise<boolean> {
  assertDeployed(sbn.deployment);
  return sbn.publicClient.readContract({
    address: sbn.deployment.contracts.WildcatArchController,
    abi: archControllerAbi,
    functionName: 'isRegisteredBorrower',
    args: [address ?? sbn.account.address],
  });
}

export async function registerSelf(sbn: Sbn): Promise<{ already: boolean; hash?: Hex }> {
  assertDeployed(sbn.deployment);
  if (await isRegistered(sbn)) return { already: true };
  const { hash } = await send(sbn, {
    address: sbn.deployment.contracts.WildcatArchController,
    abi: archControllerAbi as unknown as Abi,
    functionName: 'registerSelf',
  });
  // Read-your-write guard. Public RPC endpoints are load-balanced across
  // replicas, so a registration whose tx receipt is already available is not
  // necessarily visible to the node that serves the *next* eth_call — i.e. the
  // market-deploy simulation. Without this wait, deploying immediately after
  // registering reverts with NotApprovedBorrower (an ArchController error the
  // HooksFactory ABI can't decode, surfacing as an opaque "revert"). Block
  // until the registration is observable before returning.
  await waitForRegistration(sbn);
  return { already: false, hash };
}

/** Poll until this wallet reads as a registered issuer, absorbing RPC replica
 *  lag right after registering. Resolves once visible; throws after `timeoutMs`. */
export async function waitForRegistration(sbn: Sbn, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  let delay = 1000;
  while (Date.now() - start < timeoutMs) {
    if (await isRegistered(sbn)) return;
    await sleep(delay);
    delay = Math.min(delay * 1.5, 5000);
  }
  if (await isRegistered(sbn)) return;
  throw new Error(
    'Registration did not become visible on the RPC in time. Your wallet is registered on-chain — wait a few seconds and retry the deploy.',
  );
}

// --- Balances & funding ------------------------------------------------------

export function ethBalance(sbn: Sbn, address?: Address): Promise<bigint> {
  return sbn.publicClient.getBalance({ address: address ?? sbn.account.address });
}

export function usdcBalance(sbn: Sbn, address?: Address): Promise<bigint> {
  return sbn.publicClient.readContract({
    address: sbn.deployment.contracts.TestUSDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address ?? sbn.account.address],
  });
}

/** Mint test USDC to the wallet (testnet asset only; permissionless mint). */
export async function mintTestUsdc(sbn: Sbn, amount: bigint): Promise<Hex> {
  assertDeployed(sbn.deployment);
  const { hash } = await send(sbn, {
    address: sbn.deployment.contracts.TestUSDC,
    abi: erc20Abi as unknown as Abi,
    functionName: 'mint',
    args: [sbn.account.address, amount],
  });
  return hash;
}

/** Poll until the wallet's ETH balance reaches `target`, or timeout. */
export async function waitForEth(sbn: Sbn, target: bigint, timeoutMs = 90_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await ethBalance(sbn)) >= target) return true;
    await sleep(3000);
  }
  return (await ethBalance(sbn)) >= target;
}

// --- Market deployment -------------------------------------------------------

export interface BondTermsInput {
  /** 'open' = perpetual revolving debt; 'fixed' = matures at a date. */
  type?: 'open' | 'fixed';
  /** Asset address. Defaults to the network's test USDC. */
  asset?: Address;
  /** Max capital the bond can raise, in USDC (human units, e.g. 10000). */
  capUsdc: string | number;
  /** Annual coupon paid to lenders, in percent (e.g. 8.5). Max 100. */
  aprPct?: number;
  /** Penalty APR if the issuer goes delinquent, in percent (uncapped). */
  penaltyAprPct?: number;
  /** Reserve ratio the issuer must keep liquid, in percent (0–100). */
  reservePct?: number;
  /** How long a withdrawal batch stays open before it can be claimed. */
  withdrawalBatch?: string | number;
  /** Grace period before delinquency penalties kick in. */
  gracePeriod?: string | number;
  /** Market token name prefix (combined with the asset name). */
  namePrefix?: string;
  /** Market token symbol prefix (combined with the asset symbol). */
  symbolPrefix?: string;
  /** Minimum single deposit, in USDC. Default 0 (no minimum). */
  minDepositUsdc?: string | number;
  /** Disable secondary transfers of the bond token. Default false. */
  transfersDisabled?: boolean;
  // Fixed-term only:
  /** Maturity for a fixed-term bond — duration from now (e.g. "1y") or unix ts. */
  term?: string | number;
  /** Allow the issuer to close before maturity. Default true. */
  allowClosureBeforeTerm?: boolean;
  /** Allow the issuer to shorten the term later. Default true. */
  allowTermReduction?: boolean;
}

export interface DeployedMarket {
  market: Address;
  hooksInstance: Address;
  hash: Hex;
  name: string;
  symbol: string;
  type: 'open' | 'fixed';
  explorerUrl: string;
  txUrl: string;
}

function usdcUnits(amount: string | number): bigint {
  const clean = String(amount).replace(/[_,\s]/g, '');
  // Positive decimal only — rejects negatives, scientific notation, multiple dots, NaN.
  if (!/^\d+(\.\d+)?$/.test(clean)) {
    throw new Error(`Invalid USDC amount "${amount}". Use a positive number like 10000 or 1.5.`);
  }
  const [whole, frac = ''] = clean.split('.');
  const fracPadded = (frac + '0'.repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  const value = BigInt(whole || '0') * 10n ** BigInt(USDC_DECIMALS) + BigInt(fracPadded || '0');
  if (value <= 0n) throw new Error(`USDC amount must be greater than zero (got "${amount}").`);
  return value;
}

/** 96-bit random nonce for CREATE2 salts — avoids collisions between deploys in
 *  the same millisecond (a wall-clock nonce would collide). */
function randomNonce(): bigint {
  return BigInt('0x' + randomBytes(12).toString('hex'));
}

/** Resolve a fixed-term input into a unix timestamp, with clear errors. Accepts
 *  a duration string ("1y", "90d") or a unix timestamp (number or numeric string
 *  >= 1e9). Rejects ambiguous/overflowing values. */
function resolveFixedTermEndTime(term: string | number): number {
  const now = Math.floor(Date.now() / 1000);
  let end: number;
  if (typeof term === 'number') {
    end = term >= 1_000_000_000 ? term : now + term;
  } else {
    const s = term.trim();
    if (/[smhdwy]$/i.test(s)) {
      end = now + parseDuration(s);
    } else if (/^\d+$/.test(s)) {
      const n = Number(s);
      end = n >= 1_000_000_000 ? n : now + n;
    } else {
      throw new Error(`Invalid term "${term}". Use a duration like "1y" / "90d", or a unix timestamp.`);
    }
  }
  if (end <= now) throw new Error(`Fixed term must end in the future (resolved to ${end}, now ${now}).`);
  if (end > 4_294_967_295) {
    throw new Error(`Fixed term end ${end} exceeds the uint32 limit (≈ year 2106). Choose a shorter term.`);
  }
  return end;
}

/** Build the CREATE2 salt: high 20 bytes = issuer address (required by the
 *  factory), low 12 bytes = a per-call nonce to avoid collisions. */
export function computeSalt(borrower: Address, nonce: bigint): Hex {
  const addr = BigInt(borrower);
  const salt = (addr << 96n) | (nonce & ((1n << 96n) - 1n));
  return `0x${salt.toString(16).padStart(64, '0')}` as Hex;
}

export async function deployMarket(sbn: Sbn, terms: BondTermsInput): Promise<DeployedMarket> {
  assertDeployed(sbn.deployment);
  const d = sbn.deployment;
  const type = terms.type ?? 'open';

  const finitePct = (v: number, name: string) => {
    if (!Number.isFinite(v) || v < 0) throw new Error(`${name} must be a non-negative number (got ${v}).`);
    return v;
  };
  const aprPct = finitePct(terms.aprPct ?? 8, 'aprPct');
  if (aprPct > 100) {
    throw new Error('aprPct must be ≤ 100. The protocol caps base APR at 100%; use penaltyAprPct for higher delinquency rates.');
  }
  const annualInterestBips = pctToBips(aprPct);
  const delinquencyFeeBips = pctToBips(finitePct(terms.penaltyAprPct ?? 20, 'penaltyAprPct'));
  if (delinquencyFeeBips > 65535) throw new Error('penaltyAprPct too high (max ~655%).');
  const reserveRatioBips = pctToBips(finitePct(terms.reservePct ?? 0, 'reservePct'));
  if (reserveRatioBips > 10000) throw new Error('reservePct must be ≤ 100.');
  const withdrawalBatchDuration = parseDuration(terms.withdrawalBatch ?? '1d');
  const delinquencyGracePeriod = parseDuration(terms.gracePeriod ?? '3d');

  const asset = terms.asset ?? d.contracts.TestUSDC;
  const maxTotalSupply = usdcUnits(terms.capUsdc);
  const minimumDeposit = terms.minDepositUsdc ? usdcUnits(terms.minDepositUsdc) : 0n;
  const transfersDisabled = terms.transfersDisabled ?? false;

  const namePrefix = terms.namePrefix ?? 'SBN ';
  const symbolPrefix = terms.symbolPrefix ?? 'sbn';

  let template: Address;
  let hooksData: Hex;
  if (type === 'fixed') {
    if (terms.term === undefined) throw new Error('Fixed-term bonds require `term` (e.g. "1y" or a unix timestamp).');
    const fixedTermEndTime = resolveFixedTermEndTime(terms.term);
    template = d.contracts.FixedTermHooksTemplate;
    hooksData = encodeAbiParameters(parseAbiParameters('uint32, uint128, bool, bool, bool'), [
      fixedTermEndTime,
      minimumDeposit,
      transfersDisabled,
      terms.allowClosureBeforeTerm ?? true,
      terms.allowTermReduction ?? true,
    ]);
  } else {
    template = d.contracts.OpenTermHooksTemplate;
    hooksData = encodeAbiParameters(parseAbiParameters('uint128, bool'), [minimumDeposit, transfersDisabled]);
  }

  const params = {
    asset,
    namePrefix,
    symbolPrefix,
    maxTotalSupply,
    annualInterestBips,
    delinquencyFeeBips,
    withdrawalBatchDuration,
    reserveRatioBips,
    delinquencyGracePeriod,
    hooks: 0n, // factory injects the hooks instance address; template sets flags
  } as const;

  const salt = computeSalt(sbn.account.address, randomNonce());
  const deployArgs = [template, '0x', params, hooksData, salt, zeroAddress, 0n] as const;

  // Deploy with a bounded retry that tolerates RPC replica lag. The only
  // expected transient failure here is a freshly-registered issuer still
  // looking unregistered to the simulating node (factory reverts
  // NotApprovedBorrower → opaque "revert"). If we ARE registered on-chain, wait
  // and retry; if we're genuinely not registered, fail fast with the real error.
  let sent: { hash: Hex; result: unknown } | undefined;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      sent = await send(sbn, {
        address: d.contracts.HooksFactory,
        abi: hooksFactoryAbi as unknown as Abi,
        functionName: 'deployMarketAndHooks',
        args: deployArgs,
      });
      break;
    } catch (err) {
      lastErr = err;
      if (!(await isRegistered(sbn))) throw err;
      await sleep(2500);
    }
  }
  if (!sent) throw new Error(explainError(lastErr));
  const { hash, result } = sent;

  const [market, hooksInstance] = result as [Address, Address];

  // Read back the real on-chain name/symbol. Public RPCs sometimes return empty
  // data on the first read after a deploy (a replica without the new state),
  // so retry briefly before giving up.
  const readWithRetry = async <T>(fn: 'name' | 'symbol'): Promise<T> => {
    let lastErr: unknown;
    for (let i = 0; i < 6; i++) {
      try {
        return (await sbn.publicClient.readContract({ address: market, abi: marketAbi, functionName: fn })) as T;
      } catch (err) {
        lastErr = err;
        await sleep(1500);
      }
    }
    throw lastErr;
  };
  const [name, symbol] = await Promise.all([readWithRetry<string>('name'), readWithRetry<string>('symbol')]);

  const record: MarketRecord = {
    market,
    hooksInstance,
    type,
    asset,
    name,
    symbol,
    network: d.chain,
    txHash: hash,
    createdAt: new Date().toISOString(),
  };
  recordMarket(record);

  return {
    market,
    hooksInstance,
    hash,
    name,
    symbol,
    type,
    explorerUrl: addressUrl(d, market),
    txUrl: txUrl(d, hash),
  };
}

// --- Lifecycle: deposit / borrow / repay / withdraw / close ------------------

async function approveIfNeeded(sbn: Sbn, token: Address, spender: Address, amount: bigint): Promise<void> {
  const readAllowance = (): Promise<bigint> =>
    sbn.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [sbn.account.address, spender],
    });

  if ((await readAllowance()) >= amount) return;
  await send(sbn, {
    address: token,
    abi: erc20Abi as unknown as Abi,
    functionName: 'approve',
    args: [spender, 2n ** 256n - 1n],
  });

  // Read-your-write guard. The approval tx is mined, but on a load-balanced
  // public RPC the dependent action (deposit/repay) may simulate against a
  // replica that hasn't seen it yet — reading allowance 0 and reverting on the
  // transferFrom. Wait until the new allowance is observable before returning.
  const start = Date.now();
  let delay = 1500;
  while (Date.now() - start < 30_000) {
    if ((await readAllowance()) >= amount) return;
    await sleep(delay);
    delay = Math.min(delay * 1.5, 5000);
  }
}

async function marketAsset(sbn: Sbn, market: Address): Promise<Address> {
  return sbn.publicClient.readContract({ address: market, abi: marketAbi, functionName: 'asset' });
}

/** Buy a bond: approve the asset, then deposit into the market (lender side). */
export async function deposit(sbn: Sbn, market: Address, amountUsdc: string | number): Promise<Hex> {
  const amount = usdcUnits(amountUsdc);
  const asset = await marketAsset(sbn, market);
  await approveIfNeeded(sbn, asset, market, amount);
  const { hash } = await send(sbn, { address: market, abi: marketAbi as unknown as Abi, functionName: 'deposit', args: [amount] });
  return hash;
}

/** Draw down raised capital (issuer side). */
export async function borrow(sbn: Sbn, market: Address, amountUsdc: string | number): Promise<Hex> {
  const { hash } = await send(sbn, { address: market, abi: marketAbi as unknown as Abi, functionName: 'borrow', args: [usdcUnits(amountUsdc)] });
  return hash;
}

/** Repay principal + interest (anyone can repay). */
export async function repay(sbn: Sbn, market: Address, amountUsdc: string | number): Promise<Hex> {
  const amount = usdcUnits(amountUsdc);
  const asset = await marketAsset(sbn, market);
  await approveIfNeeded(sbn, asset, market, amount);
  const { hash } = await send(sbn, { address: market, abi: marketAbi as unknown as Abi, functionName: 'repay', args: [amount] });
  return hash;
}

/** Queue a withdrawal (lender). Omit amount to queue the full balance. */
export async function queueWithdrawal(
  sbn: Sbn,
  market: Address,
  amountUsdc?: string | number,
): Promise<{ hash: Hex; expiry: number }> {
  if (amountUsdc === undefined) {
    const { hash, result } = await send(sbn, { address: market, abi: marketAbi as unknown as Abi, functionName: 'queueFullWithdrawal' });
    return { hash, expiry: Number(result) };
  }
  const { hash, result } = await send(sbn, {
    address: market,
    abi: marketAbi as unknown as Abi,
    functionName: 'queueWithdrawal',
    args: [usdcUnits(amountUsdc)],
  });
  return { hash, expiry: Number(result) };
}

/** Claim a matured/expired withdrawal batch (lender). */
export async function executeWithdrawal(sbn: Sbn, market: Address, account: Address, expiry: number): Promise<Hex> {
  const { hash } = await send(sbn, {
    address: market,
    abi: marketAbi as unknown as Abi,
    functionName: 'executeWithdrawal',
    args: [account, expiry],
  });
  return hash;
}

/** Close a market and settle (issuer or backup closer). */
export async function closeMarket(sbn: Sbn, market: Address): Promise<Hex> {
  const { hash } = await send(sbn, { address: market, abi: marketAbi as unknown as Abi, functionName: 'closeMarket' });
  return hash;
}

export async function setBackupCloser(sbn: Sbn, market: Address, backupCloser: Address): Promise<Hex> {
  const { hash } = await send(sbn, {
    address: market,
    abi: marketAbi as unknown as Abi,
    functionName: 'setBackupCloser',
    args: [backupCloser],
  });
  return hash;
}

export interface BondNote {
  name: string;
  description: string;
  author: Address;
  updatedAt: number;
}

/** Attach (or overwrite) an on-chain name + description for a bond market, via the
 *  BondNotes registry. Anyone can call it, but sellbonds.now only trusts a note
 *  whose author is the market's actual issuer — so describe a bond from its issuer
 *  wallet. Mainnet only (the registry isn't deployed on testnet yet). */
export async function describeBond(
  sbn: Sbn,
  market: Address,
  name: string,
  description: string,
): Promise<Hex> {
  const registry = sbn.deployment.contracts.BondNotes;
  if (!registry) {
    throw new Error(
      `Descriptions aren't available on ${sbn.deployment.label} yet (no BondNotes registry).`,
    );
  }
  const { hash } = await send(sbn, {
    address: registry,
    abi: bondNotesAbi as unknown as Abi,
    functionName: 'describe',
    args: [market, name ?? '', description ?? ''],
  });
  return hash;
}

/** Read a market's on-chain note (null if none or the registry isn't deployed). */
export async function readNote(sbn: Sbn, market: Address): Promise<BondNote | null> {
  const registry = sbn.deployment.contracts.BondNotes;
  if (!registry) return null;
  const [name, description, author, updatedAt] = (await sbn.publicClient.readContract({
    address: registry,
    abi: bondNotesAbi,
    functionName: 'notes',
    args: [market],
  })) as [string, string, Address, number];
  if (!name && !description) return null;
  return { name, description, author, updatedAt: Number(updatedAt) };
}

// --- Reads -------------------------------------------------------------------

export interface MarketStatus {
  market: Address;
  name: string;
  symbol: string;
  asset: Address;
  borrower: Address;
  isClosed: boolean;
  annualInterestBips: number;
  reserveRatioBips: number;
  maxTotalSupply: bigint;
  totalSupply: bigint;
  totalAssets: bigint;
  borrowableAssets: bigint;
  maximumDeposit: bigint;
  unpaidBatchExpiries: number[];
}

export async function marketStatus(sbn: Sbn, market: Address): Promise<MarketStatus> {
  const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    sbn.publicClient.readContract({ address: market, abi: marketAbi, functionName: functionName as any, args: args as any }) as Promise<T>;

  const [
    name,
    symbol,
    asset,
    borrower,
    isClosed,
    apr,
    reserve,
    totalSupply,
    totalAssets,
    borrowableAssets,
    maximumDeposit,
    expiries,
  ] = await Promise.all([
    read<string>('name'),
    read<string>('symbol'),
    read<Address>('asset'),
    read<Address>('borrower'),
    read<boolean>('isClosed'),
    read<bigint>('annualInterestBips'),
    read<bigint>('reserveRatioBips'),
    read<bigint>('totalSupply'),
    read<bigint>('totalAssets'),
    read<bigint>('borrowableAssets'),
    read<bigint>('maximumDeposit'),
    read<readonly number[]>('getUnpaidBatchExpiries'),
  ]);

  return {
    market,
    name,
    symbol,
    asset,
    borrower,
    isClosed,
    annualInterestBips: Number(apr),
    reserveRatioBips: Number(reserve),
    maxTotalSupply: totalSupply + maximumDeposit,
    totalSupply,
    totalAssets,
    borrowableAssets,
    maximumDeposit,
    unpaidBatchExpiries: (expiries as readonly number[]).map(Number),
  };
}

/* -------------------------------------------------------------------------- */
/*  Network-wide bond list                                                    */
/* -------------------------------------------------------------------------- */

export interface BondSummary {
  market: Address;
  issuer: Address;
  name: string;
  symbol: string;
  status: 'open' | 'closed';
  aprPct: number;
  capacityUsdc: number;
  raisedUsdc: number;
  borrowableUsdc: number;
  filledPct: number;
  /** Issuer-set short name — only present when verified (note author == issuer). */
  label?: string;
  /** Issuer-set description — only present when verified (note author == issuer). */
  description?: string;
  explorerUrl: string;
}

const LIST_READS = [
  'name',
  'symbol',
  'borrower',
  'isClosed',
  'annualInterestBips',
  'totalSupply',
  'maximumDeposit',
  'borrowableAssets',
] as const;

/**
 * Every bond on the network, read live from the on-chain registry
 * (ArchController.getRegisteredMarkets + one multicall) — no API server, works
 * on any network and even if sellbonds.now is down. Verified issuer notes
 * (label/description) are included where the BondNotes registry exists.
 * Works with a read-only client: pass `connectReadonly(network)`.
 */
export async function listAllBonds(
  sbn: Pick<Sbn, 'deployment' | 'publicClient'>,
): Promise<BondSummary[]> {
  const markets = (await sbn.publicClient.readContract({
    address: sbn.deployment.contracts.WildcatArchController,
    abi: archControllerAbi,
    functionName: 'getRegisteredMarkets',
  })) as Address[];
  if (markets.length === 0) return [];

  const notesRegistry = sbn.deployment.contracts.BondNotes;
  const contracts: any[] = markets.flatMap((address) =>
    LIST_READS.map((functionName) => ({ address, abi: marketAbi as unknown as Abi, functionName })),
  );
  if (notesRegistry) {
    contracts.push(
      ...markets.map((m) => ({
        address: notesRegistry,
        abi: bondNotesAbi as unknown as Abi,
        functionName: 'notes',
        args: [m],
      })),
    );
  }
  const res = await sbn.publicClient.multicall({ contracts, allowFailure: true });

  const usdc = (v: bigint) => Number(v) / 10 ** USDC_DECIMALS;
  return markets.map((address, i) => {
    const base = i * LIST_READS.length;
    const get = <T>(offset: number, fb: T): T =>
      res[base + offset]?.status === 'success' ? (res[base + offset]!.result as T) : fb;

    const issuer = getAddress(get<Address>(2, zeroAddress));
    const isClosed = get<boolean>(3, false);
    const raised = usdc(get<bigint>(5, 0n));
    const capacity = raised + usdc(get<bigint>(6, 0n));

    let label: string | undefined;
    let description: string | undefined;
    if (notesRegistry) {
      const n = res[markets.length * LIST_READS.length + i];
      if (n?.status === 'success' && Array.isArray(n.result)) {
        const [nm, desc, author] = n.result as [string, string, string, bigint];
        if (String(author).toLowerCase() === issuer.toLowerCase()) {
          label = nm || undefined;
          description = desc || undefined;
        }
      }
    }

    return {
      market: getAddress(address),
      issuer,
      name: get<string>(0, ''),
      symbol: get<string>(1, ''),
      status: isClosed ? ('closed' as const) : ('open' as const),
      aprPct: Number(get<bigint>(4, 0n)) / 100,
      capacityUsdc: capacity,
      raisedUsdc: raised,
      borrowableUsdc: usdc(get<bigint>(7, 0n)),
      filledPct: capacity > 0 ? Math.round((raised / capacity) * 100) : 0,
      label,
      description,
      explorerUrl: addressUrl(sbn.deployment, getAddress(address)),
    };
  });
}
