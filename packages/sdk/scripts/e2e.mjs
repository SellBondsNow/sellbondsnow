// End-to-end validation of sellbonds against a live (anvil) deployment.
// Validates that the SDK's viem encoding matches the forked Wildcat contracts:
// register -> deployMarketAndHooks -> deposit -> borrow -> repay ->
// queueWithdrawal -> (time warp) -> executeWithdrawal, and a clean close.
//
// Env required: SBN_RPC_URL + SBN_ARCH_CONTROLLER / SBN_HOOKS_FACTORY /
// SBN_OPEN_TERM_TEMPLATE / SBN_FIXED_TERM_TEMPLATE / SBN_USDC, plus three anvil
// private keys: E2E_DEPLOYER_KEY (owner, unused here), E2E_ISSUER_KEY, E2E_LENDER_KEY.

import { privateKeyToAccount } from 'viem/accounts';
import {
  connect,
  registerSelf,
  deployMarket,
  deposit,
  borrow,
  repay,
  queueWithdrawal,
  executeWithdrawal,
  closeMarket,
  mintTestUsdc,
  marketStatus,
  usdcBalance,
} from '../dist/index.js';

const RPC = process.env.SBN_RPC_URL;
const issuerKey = process.env.E2E_ISSUER_KEY;
const lenderKey = process.env.E2E_LENDER_KEY;

const M = (n) => BigInt(Math.round(n)) * 10n ** 6n;
let step = 0;
const ok = (m) => console.log(`  ✓ ${++step}. ${m}`);
const fail = (m, e) => {
  console.error(`  ✗ ${m}: ${e?.message ?? e}`);
  process.exit(1);
};

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return (await res.json()).result;
}

async function main() {
  const issuer = connect(undefined, privateKeyToAccount(issuerKey));
  const lender = connect(undefined, privateKeyToAccount(lenderKey));
  console.log(`issuer ${issuer.account.address}  lender ${lender.account.address}`);

  // Everyone needs test USDC; anvil accounts already hold ETH for gas.
  await mintTestUsdc(issuer, M(1_000_000)).catch((e) => fail('mint issuer USDC', e));
  await mintTestUsdc(lender, M(1_000_000)).catch((e) => fail('mint lender USDC', e));
  ok('minted test USDC to issuer + lender');

  await registerSelf(issuer).catch((e) => fail('registerSelf', e));
  ok('issuer registered (registerSelf)');

  // ---- Flow 1: open-term market, withdraw + claim ----
  const a = await deployMarket(issuer, { type: 'open', capUsdc: 100_000, aprPct: 8, reservePct: 0, withdrawalBatch: '1d' }).catch((e) => fail('deployMarket open', e));
  ok(`deployed open-term market ${a.market} (${a.symbol})`);

  await deposit(lender, a.market, 50_000).catch((e) => fail('deposit', e));
  ok('lender deposited 50,000');

  await borrow(issuer, a.market, 10_000).catch((e) => fail('borrow', e));
  ok('issuer borrowed 10,000');

  await repay(issuer, a.market, 10_000).catch((e) => fail('repay', e));
  ok('issuer repaid 10,000');

  const w = await queueWithdrawal(lender, a.market, 10_000).catch((e) => fail('queueWithdrawal', e));
  ok(`lender queued withdrawal, expiry ${w.expiry}`);

  await rpc('evm_increaseTime', [90_000]);
  await rpc('evm_mine', []);
  ok('advanced chain time past batch expiry');

  const lenderUsdcBefore = await usdcBalance(lender);
  await executeWithdrawal(lender, a.market, lender.account.address, w.expiry).catch((e) => fail('executeWithdrawal', e));
  const lenderUsdcAfter = await usdcBalance(lender);
  if (lenderUsdcAfter <= lenderUsdcBefore) fail('executeWithdrawal', new Error('lender USDC did not increase'));
  ok(`lender claimed withdrawal (+${(lenderUsdcAfter - lenderUsdcBefore) / 10n ** 6n} USDC)`);

  // ---- Flow 2: clean close ----
  const b = await deployMarket(issuer, { type: 'open', capUsdc: 50_000, aprPct: 5, reservePct: 0 }).catch((e) => fail('deployMarket B', e));
  ok(`deployed second market ${b.market}`);
  await deposit(lender, b.market, 20_000).catch((e) => fail('deposit B', e));
  await borrow(issuer, b.market, 5_000).catch((e) => fail('borrow B', e));
  await repay(issuer, b.market, 6_000).catch((e) => fail('repay B (overpay to cover interest)', e));
  await closeMarket(issuer, b.market).catch((e) => fail('closeMarket', e));
  const st = await marketStatus(issuer, b.market);
  if (!st.isClosed) fail('closeMarket', new Error('market not closed'));
  ok('issuer closed market B (isClosed=true)');

  // ---- Flow 3: fixed-term deploy (encoding only) ----
  const c = await deployMarket(issuer, { type: 'fixed', capUsdc: 25_000, aprPct: 10, term: '1y', reservePct: 0 }).catch((e) => fail('deployMarket fixed', e));
  ok(`deployed fixed-term market ${c.market} (${c.symbol})`);

  console.log('\nALL E2E CHECKS PASSED ✅');
}

main().catch((e) => fail('e2e', e));
