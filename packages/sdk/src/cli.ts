import { parseArgs } from 'node:util';
import { type Address, type Hex } from 'viem';
import { connect, connectReadonly, type Sbn } from './client.js';
import { addressUrl, loadDeployment, txUrl } from './config.js';
import { archControllerAbi } from './abis.js';
import {
  borrow,
  closeMarket,
  deposit,
  deployMarket,
  describeBond,
  executeWithdrawal,
  ethBalance,
  isRegistered,
  listAllBonds,
  marketStatus,
  queueWithdrawal,
  registerSelf,
  repay,
  setBackupCloser,
  usdcBalance,
  type BondTermsInput,
} from './bonds.js';
import { ensureFunded } from './flows.js';
import { bipsToPct, formatEth, formatUsdc } from './format.js';
import {
  createWallet,
  importWallet,
  listMarkets,
  loadOrCreateWallet,
  loadWallet,
  saveMarkets,
  WALLET_PATH,
  walletExists,
} from './wallet.js';

/** Read the global on-chain registry of markets (lowercased addresses). Returns
 *  null if the read fails, so callers can fall back gracefully. */
async function registeredMarketSet(network?: string): Promise<Set<string> | null> {
  try {
    const { deployment, publicClient } = connectReadonly(network);
    const markets = (await publicClient.readContract({
      address: deployment.contracts.WildcatArchController,
      abi: archControllerAbi,
      functionName: 'getRegisteredMarkets',
    })) as Address[];
    return new Set(markets.map((a) => a.toLowerCase()));
  } catch {
    return null;
  }
}

const err = (m: string) => process.stderr.write(m + '\n');
const out = (m: string) => process.stdout.write(m + '\n');

const HELP = `sbn — issue and manage uncollateralized on-chain bonds from your agent.
Direct-to-chain, non-custodial. sellbonds.now never holds your keys or funds.

USAGE
  sbn <command> [args] [flags]

CORE
  raise <capUSDC>        One shot: make+fund a wallet, register, deploy a bond.
  deploy                 Deploy a bond market with explicit --flags.
  status <market>        Show a market's live state.
  list                   List every bond on the network (fund one: sbn deposit <market> <usdc>).
  list --mine [--all]    Only markets this wallet issued (verified on-chain; --all shows dead too).
  prune                  Remove local records for markets that no longer exist on-chain.

WALLET
  wallet                 Show your wallet address + balances.
  wallet new [--force]   Create a fresh local wallet (~/.sellbondsnow/wallet.json).
  wallet import <pk>     Import an existing private key.
  fund                   Top up gas + USDC (testnet dispenser; mainnet = bring your own).
  register               Register this wallet as a bond issuer (one time).

ISSUER LIFECYCLE
  borrow <market> <usdc> Draw down raised capital.
  repay  <market> <usdc> Repay principal + interest.
  close  <market>        Settle and close a market.
  describe <market> <text>        Set an on-chain name/description (strongly recommended).
  backup-closer <market> <addr>   Set an emergency closer (e.g. a multisig).

LENDER LIFECYCLE
  deposit  <market> <usdc>         Buy a bond (lend into the market).
  withdraw <market> [usdc]         Queue a withdrawal (full if amount omitted).
  claim    <market> <expiry>       Claim an expired withdrawal batch.

FLAGS (deploy / raise)
  --type open|fixed   Bond type (default open).
  --apr <pct>         Coupon paid to lenders, e.g. 8.5 (default 8, max 100).
  --penalty <pct>     Delinquency penalty APR (default 20, uncapped).
  --reserve <pct>     Reserve the issuer keeps liquid (default 0).
  --term <dur>        Maturity for fixed bonds, e.g. 1y, 90d (fixed only).
  --batch <dur>       Withdrawal batch duration (default 1d).
  --grace <dur>       Delinquency grace period (default 3d).
  --min-deposit <usdc>  Minimum single deposit (default 0).
  --no-transfers      Make the bond token non-transferable.
  --name <prefix>     Bond token name prefix (default "SBN ").
  --description <text>  What the bond funds — shown on sellbonds.now. Set it by default;
                      if the user didn't give one, write it from their goal (keep it honest).
  --symbol <prefix>   Bond token symbol prefix (default "sbn").

GLOBAL
  --network <name>    Network (default base; use base-sepolia for the free testnet).
  --json              Machine-readable JSON output.
  -h, --help          Show this help.

DOCS  https://sellbonds.now/skill.md   ·   https://sellbonds.now/llms.txt`;

const options = {
  network: { type: 'string' },
  json: { type: 'boolean' },
  type: { type: 'string' },
  apr: { type: 'string' },
  penalty: { type: 'string' },
  reserve: { type: 'string' },
  cap: { type: 'string' },
  term: { type: 'string' },
  batch: { type: 'string' },
  grace: { type: 'string' },
  name: { type: 'string' },
  symbol: { type: 'string' },
  description: { type: 'string' },
  'min-deposit': { type: 'string' },
  'no-transfers': { type: 'boolean' },
  account: { type: 'string' },
  force: { type: 'boolean' },
  full: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

async function main() {
  const { values: f, positionals } = parseArgs({
    args: process.argv.slice(2),
    options,
    allowPositionals: true,
    strict: false,
  });
  const cmd = positionals[0];
  const json = !!f.json;
  const network = f.network as string | undefined;

  if (!cmd || f.help) {
    out(HELP);
    return;
  }

  const emit = (human: () => void, data: Record<string, unknown>) => {
    if (json) out(JSON.stringify({ ok: true, ...data }, jsonReplacer, 2));
    else human();
  };

  switch (cmd) {
    // ---- wallet -----------------------------------------------------------
    case 'wallet':
    case 'whoami': {
      const sub = positionals[1];
      if (sub === 'new') {
        if (walletExists() && !f.force) throw new Error(`A wallet already exists at ${WALLET_PATH}. Use --force to overwrite (this DESTROYS the old key).`);
        const w = createWallet();
        emit(() => {
          err('Created a new agent wallet.');
          out(w.address);
          err(`Key stored at ${WALLET_PATH} (mode 0600). Fund it: sbn fund`);
        }, { address: w.address, keystore: WALLET_PATH });
        return;
      }
      if (sub === 'import') {
        const pk = positionals[2];
        if (!pk) throw new Error('Usage: sbn wallet import <0x-private-key>');
        const w = importWallet(pk as Hex);
        emit(() => { err('Imported wallet.'); out(w.address); }, { address: w.address, keystore: WALLET_PATH });
        return;
      }
      // show
      if (!walletExists() && !process.env.SBN_PRIVATE_KEY) {
        emit(() => err('No wallet yet. Create one: sbn wallet new  (or just run: sbn raise <amount>)'), { exists: false });
        return;
      }
      const sbn = connect(network);
      const [eth, usdc] = await Promise.all([ethBalance(sbn), sbn.deployment.deployed ? usdcBalance(sbn) : Promise.resolve(0n)]);
      const reg = sbn.deployment.deployed ? await isRegistered(sbn) : false;
      emit(() => {
        out(sbn.account.address);
        err(`  network:    ${sbn.deployment.label}`);
        err(`  ETH:        ${formatEth(eth)}`);
        err(`  USDC:       ${formatUsdc(usdc)}`);
        err(`  registered: ${reg ? 'yes' : 'no'}`);
        err(`  explorer:   ${addressUrl(sbn.deployment, sbn.account.address)}`);
      }, {
        address: sbn.account.address,
        network: sbn.deployment.chain,
        eth: formatEth(eth),
        usdc: formatUsdc(usdc),
        registered: reg,
      });
      return;
    }

    // ---- fund -------------------------------------------------------------
    case 'fund': {
      const { wallet, created } = loadOrCreateWallet();
      if (created) err(`Created wallet ${wallet.address}`);
      const sbn = connect(network);
      const res = await ensureFunded(sbn, { log: err });
      emit(() => {
        err('Wallet funded.');
        out(sbn.account.address);
        err(`  ETH:       ${formatEth(res.ethAfter)}`);
        err(`  USDC:      ${formatUsdc(res.usdcAfter)}`);
      }, { address: sbn.account.address, eth: formatEth(res.ethAfter), usdc: formatUsdc(res.usdcAfter), faucetUsed: res.faucetUsed });
      return;
    }

    // ---- register ---------------------------------------------------------
    case 'register': {
      const sbn = connect(network);
      const r = await registerSelf(sbn);
      emit(() => {
        if (r.already) err('Already registered as an issuer.');
        else { err('Registered as an issuer.'); err(txUrl(sbn.deployment, r.hash!)); }
        out(sbn.account.address);
      }, { address: sbn.account.address, already: r.already, txHash: r.hash, txUrl: r.hash ? txUrl(sbn.deployment, r.hash) : undefined });
      return;
    }

    // ---- raise (one-shot) -------------------------------------------------
    case 'raise': {
      const cap = (positionals[1] as string) ?? (f.cap as string);
      if (!cap) throw new Error('Usage: sbn raise <capUSDC> [flags].  e.g. sbn raise 10000 --apr 8.5');
      const { wallet, created } = loadOrCreateWallet();
      if (created) err(`Created a new agent wallet: ${wallet.address}\n  Key at ${WALLET_PATH} (mode 0600).`);
      const sbn = connect(network);

      err('1/3  Funding wallet…');
      await ensureFunded(sbn, { log: err });
      err('2/3  Registering as issuer…');
      const reg = await registerSelf(sbn);
      if (reg.already) err('     (already registered)');
      err('3/3  Deploying bond market…');
      const market = await deployMarket(sbn, termsFromFlags(f, cap));

      const description = f.description as string | undefined;
      if (description) {
        err('     Adding on-chain description…');
        try {
          await describeBond(sbn, market.market as Address, (f.name as string) ?? '', description);
        } catch (e) {
          err('     (description failed: ' + (e instanceof Error ? e.message : String(e)) + ')');
        }
      } else {
        err('     Tip: next time pass --name + --description (write them from the user\'s goal if needed) — unnamed bonds show as a generic "SBN USD Coin" and lenders skip them.');
      }

      emit(() => {
        err('');
        err('🎉  Bond is live.');
        out(market.market);
        err(`  ${market.name} (${market.symbol})`);
        err(`  type:     ${market.type}-term`);
        err(`  explorer: ${market.explorerUrl}`);
        err(`  deploy tx:${market.txUrl}`);
        err('');
        err('  Lenders buy in:   sbn deposit ' + market.market + ' <usdc>');
        err('  You draw capital: sbn borrow ' + market.market + ' <usdc>');
        err('  You repay:        sbn repay ' + market.market + ' <usdc>');
      }, {
        market: market.market,
        hooksInstance: market.hooksInstance,
        name: market.name,
        symbol: market.symbol,
        type: market.type,
        issuer: sbn.account.address,
        explorerUrl: market.explorerUrl,
        txUrl: market.txUrl,
      });
      return;
    }

    // ---- deploy (explicit) ------------------------------------------------
    case 'deploy': {
      const cap = (f.cap as string) ?? (positionals[1] as string);
      if (!cap) throw new Error('deploy needs a cap: --cap <usdc> (or positional). e.g. sbn deploy --cap 10000 --type fixed --term 1y');
      const sbn = connect(network);
      if (!(await isRegistered(sbn))) {
        err('Not registered yet — registering first…');
        await registerSelf(sbn);
      }
      const market = await deployMarket(sbn, termsFromFlags(f, cap));
      emit(() => {
        err('Bond deployed.');
        out(market.market);
        err(`  ${market.name} (${market.symbol}) · ${market.type}-term`);
        err(`  ${market.explorerUrl}`);
      }, { market: market.market, hooksInstance: market.hooksInstance, name: market.name, symbol: market.symbol, type: market.type, explorerUrl: market.explorerUrl, txUrl: market.txUrl });
      return;
    }

    // ---- lifecycle --------------------------------------------------------
    case 'deposit': {
      const [market, amount] = requireArgs(positionals, 2, 'deposit <market> <usdc>');
      const sbn = connect(network);
      const hash = await deposit(sbn, market as Address, amount!);
      emitTx(json, sbn, hash, `Deposited ${amount} USDC into ${market}.`);
      return;
    }
    case 'borrow': {
      const [market, amount] = requireArgs(positionals, 2, 'borrow <market> <usdc>');
      const sbn = connect(network);
      const hash = await borrow(sbn, market as Address, amount!);
      emitTx(json, sbn, hash, `Borrowed ${amount} USDC from ${market}.`);
      return;
    }
    case 'repay': {
      const [market, amount] = requireArgs(positionals, 2, 'repay <market> <usdc>');
      const sbn = connect(network);
      const hash = await repay(sbn, market as Address, amount!);
      emitTx(json, sbn, hash, `Repaid ${amount} USDC to ${market}.`);
      return;
    }
    case 'withdraw': {
      const market = positionals[1];
      if (!market) throw new Error('Usage: sbn withdraw <market> [usdc]');
      const sbn = connect(network);
      const { hash, expiry } = await queueWithdrawal(sbn, market as Address, positionals[2]);
      emit(() => {
        err(`Queued withdrawal. Claimable after the batch expires.`);
        err(`  expiry (unix): ${expiry}  (${new Date(expiry * 1000).toISOString()})`);
        err(`  claim with:    sbn claim ${market} ${expiry}`);
        out(txUrl(sbn.deployment, hash));
      }, { market, expiry, txHash: hash, txUrl: txUrl(sbn.deployment, hash) });
      return;
    }
    case 'claim': {
      const [market, expiry] = requireArgs(positionals, 2, 'claim <market> <expiry>');
      const sbn = connect(network);
      const acct = (f.account as Address) ?? sbn.account.address;
      const hash = await executeWithdrawal(sbn, market as Address, acct, Number(expiry));
      emitTx(json, sbn, hash, `Claimed withdrawal for ${acct} from ${market}.`);
      return;
    }
    case 'close': {
      const market = positionals[1];
      if (!market) throw new Error('Usage: sbn close <market>');
      const sbn = connect(network);
      const hash = await closeMarket(sbn, market as Address);
      emitTx(json, sbn, hash, `Closed market ${market}.`);
      return;
    }
    case 'backup-closer': {
      const [market, addr] = requireArgs(positionals, 2, 'backup-closer <market> <address>');
      const sbn = connect(network);
      const hash = await setBackupCloser(sbn, market as Address, addr as Address);
      emitTx(json, sbn, hash, `Set backup closer ${addr} on ${market}.`);
      return;
    }
    case 'describe': {
      const market = positionals[1];
      const description = (positionals[2] as string) ?? (f.description as string);
      if (!market || !description) {
        throw new Error('Usage: sbn describe <market> "<description>" [--name "<short name>"]');
      }
      const sbn = connect(network);
      const hash = await describeBond(sbn, market as Address, (f.name as string) ?? '', description);
      emitTx(json, sbn, hash, `Described ${market}.`);
      return;
    }

    // ---- reads ------------------------------------------------------------
    case 'status': {
      const market = positionals[1];
      if (!market) throw new Error('Usage: sbn status <market>');
      const { deployment, publicClient } = connectReadonly(network);
      // Friendly guard: a dead/old/wrong address has no contract code, which
      // otherwise surfaces as a confusing low-level "returned no data" error.
      const code = await publicClient.getCode({ address: market as Address });
      if (!code || code === '0x') {
        throw new Error(
          `No bond contract at ${market} on ${deployment.label}. ` +
            `It may never have deployed, be on another network, or be from an old deployment.`,
        );
      }
      const s = await marketStatus({ deployment, publicClient } as Sbn, market as Address);
      emit(() => {
        out(`${s.name} (${s.symbol})`);
        err(`  market:      ${s.market}`);
        err(`  issuer:      ${s.borrower}`);
        err(`  status:      ${s.isClosed ? 'CLOSED' : 'open'}`);
        err(`  coupon APR:  ${bipsToPct(s.annualInterestBips)}`);
        err(`  reserve:     ${bipsToPct(s.reserveRatioBips)}`);
        err(`  raised:      ${formatUsdc(s.totalSupply)} / cap ${formatUsdc(s.maxTotalSupply)} USDC`);
        err(`  in market:   ${formatUsdc(s.totalAssets)} USDC`);
        err(`  borrowable:  ${formatUsdc(s.borrowableAssets)} USDC`);
        err(`  unpaid batches: ${s.unpaidBatchExpiries.length}`);
        err(`  explorer:    ${addressUrl(deployment, s.market)}`);
      }, {
        ...s,
        maxTotalSupply: formatUsdc(s.maxTotalSupply),
        totalSupply: formatUsdc(s.totalSupply),
        totalAssets: formatUsdc(s.totalAssets),
        borrowableAssets: formatUsdc(s.borrowableAssets),
        maximumDeposit: formatUsdc(s.maximumDeposit),
        couponApr: bipsToPct(s.annualInterestBips),
      });
      return;
    }
    case 'list':
    case 'markets': {
      const d = loadDeployment(network);

      // Default: every bond on the network, read live from the on-chain registry.
      // (--mine restores the old behavior: only markets issued from this machine.)
      if (!f.mine) {
        const ro = connectReadonly(network);
        const bonds = await listAllBonds(ro);
        const mine = new Set(
          walletExists() ? listMarkets().map((r) => r.market.toLowerCase()) : [],
        );
        const myAddress = walletExists() ? loadWallet().address.toLowerCase() : undefined;
        emit(() => {
          if (bonds.length === 0) {
            err(`No bonds on ${d.label} yet. Issue the first one: sbn raise <amount>`);
            return;
          }
          err(`${bonds.length} bond${bonds.length === 1 ? '' : 's'} on ${d.label} (newest last). Fund one: sbn deposit <market> <usdc>`);
          for (const b of bonds) {
            const yours = mine.has(b.market.toLowerCase()) || b.issuer.toLowerCase() === myAddress ? '  [yours]' : '';
            const title = b.label || b.name || b.symbol || 'Untitled';
            const money = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
            out(
              `${b.market}  ${title}  ${b.aprPct}% APR  ${money(b.raisedUsdc)} / ${money(b.capacityUsdc)} cap  ${b.status}${yours}`,
            );
          }
        }, {
          ok: true,
          network: d.chain,
          count: bonds.length,
          bonds: bonds.map((b) => ({
            ...b,
            yours: mine.has(b.market.toLowerCase()) || b.issuer.toLowerCase() === myAddress || undefined,
          })),
          invest: 'sbn deposit <market> <usdc> — see https://sellbonds.now/llms.txt',
        });
        return;
      }

      const records = listMarkets().filter((r) => r.network === d.chain);
      // Verify against the on-chain registry. Local records can point to markets
      // that never deployed (a deploy that reverted) or that belong to an older
      // deployment — both show up here as "dead". If the registry can't be read,
      // fall back to showing everything rather than hiding real markets.
      const registered = await registeredMarketSet(network);
      const isLive = (r: { market: string }) =>
        registered ? registered.has(r.market.toLowerCase()) : true;
      const live = records.filter(isLive);
      const dead = records.filter((r) => !isLive(r));
      const showAll = Boolean(f.all);
      emit(() => {
        if (records.length === 0) {
          err('No markets issued from this machine yet. Create one: sbn raise <amount>');
          err('(Looking for bonds to invest in? `sbn list` without --mine shows every bond on the network.)');
          return;
        }
        const rows = showAll ? records : live;
        for (const r of rows) {
          const tag = registered && !registered.has(r.market.toLowerCase()) ? '   [dead — not on-chain]' : '';
          out(`${r.market}  ${r.name} (${r.symbol})  ${r.type}-term  ${r.createdAt}${tag}`);
        }
        if (!showAll && dead.length) {
          err(
            `\n${dead.length} local record${dead.length === 1 ? '' : 's'} point to markets that aren't on-chain ` +
              `(a reverted deploy, or an older deployment) and ${dead.length === 1 ? 'was' : 'were'} hidden.\n` +
              `  See them:  sbn list --mine --all\n  Remove them:  sbn prune`,
          );
        }
      }, { live, dead, markets: showAll ? records : live });
      return;
    }

    case 'prune': {
      const d = loadDeployment(network);
      const all = listMarkets();
      const registered = await registeredMarketSet(network);
      if (!registered) throw new Error('Could not read the on-chain registry to verify markets — try again.');
      // Keep records on other networks untouched; on this network, keep only
      // markets that are actually registered on-chain.
      const kept = all.filter((r) => r.network !== d.chain || registered.has(r.market.toLowerCase()));
      const removed = all.length - kept.length;
      saveMarkets(kept);
      emit(() => {
        err(removed === 0
          ? 'Nothing to prune — every local record is live on-chain.'
          : `Pruned ${removed} dead market record${removed === 1 ? '' : 's'}. ${kept.length} live record${kept.length === 1 ? '' : 's'} kept.`);
      }, { removed, kept: kept.length });
      return;
    }

    case 'version':
    case '--version': {
      out('sellbonds 0.3.1');
      return;
    }

    default:
      err(`Unknown command: ${cmd}\n`);
      out(HELP);
      process.exitCode = 1;
  }
}

function termsFromFlags(f: Record<string, unknown>, cap: string): BondTermsInput {
  return {
    type: (f.type as 'open' | 'fixed') ?? 'open',
    capUsdc: cap,
    aprPct: f.apr !== undefined ? Number(f.apr) : undefined,
    penaltyAprPct: f.penalty !== undefined ? Number(f.penalty) : undefined,
    reservePct: f.reserve !== undefined ? Number(f.reserve) : undefined,
    withdrawalBatch: f.batch as string | undefined,
    gracePeriod: f.grace as string | undefined,
    namePrefix: f.name as string | undefined,
    symbolPrefix: f.symbol as string | undefined,
    minDepositUsdc: f['min-deposit'] as string | undefined,
    transfersDisabled: !!f['no-transfers'],
    term: f.term as string | undefined,
  };
}

function requireArgs(positionals: string[], n: number, usage: string): string[] {
  const args = positionals.slice(1, 1 + n);
  if (args.length < n || args.some((a) => a === undefined)) {
    throw new Error(`Usage: sbn ${usage}`);
  }
  return args;
}

function emitTx(json: boolean, sbn: Sbn, hash: Hex, human: string) {
  if (json) out(JSON.stringify({ ok: true, txHash: hash, txUrl: txUrl(sbn.deployment, hash) }, null, 2));
  else {
    err(human);
    out(txUrl(sbn.deployment, hash));
  }
}

function jsonReplacer(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value;
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  if (process.argv.includes('--json')) out(JSON.stringify({ ok: false, error: msg }));
  else process.stderr.write(`error: ${msg}\n`);
  process.exitCode = 1;
});
