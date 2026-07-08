// sellbonds-mcp — MCP server for sellbonds.now.
//
// Exposes the sellbonds SDK as MCP tools so any MCP client (Claude Code, Claude
// Desktop, Cursor, custom agents) can issue, fund, and manage uncollateralized
// on-chain bonds in USDC on Base. Signing is local (same keystore as the sbn CLI,
// ~/.sellbondsnow/wallet.json); sellbonds.now never sees keys or funds.
//
// Safety model: read tools are unrestricted. Tools that create NEW financial
// commitments (issue_bond, deposit) on a value-bearing network require
// acknowledge_risks=true, which the calling agent should only set after its
// human has confirmed the risks (see https://sellbonds.now/risk.md).
//
// Env (all optional, shared with the CLI): SBN_NETWORK (base | base-sepolia),
// SBN_RPC_URL, SBN_HOME, SBN_PRIVATE_KEY.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { Address } from 'viem';
import {
  connect,
  connectReadonly,
  networkName,
  loadOrCreateWallet,
  walletExists,
  loadWallet,
  listMarkets,
  ensureFunded,
  isRegistered,
  registerSelf,
  deployMarket,
  describeBond,
  deposit,
  borrow,
  repay,
  queueWithdrawal,
  executeWithdrawal,
  closeMarket,
  marketStatus,
  ethBalance,
  usdcBalance,
  txUrl,
  addressUrl,
} from 'sellbonds';

const SITE = 'https://sellbonds.now';

const server = new McpServer({ name: 'sellbonds', version: '0.1.2' });

// ---------- helpers ----------

const toJson = (v: unknown) =>
  JSON.stringify(v, (_k, val) => (typeof val === 'bigint' ? val.toString() : val), 2);

const ok = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : toJson(v) }] });
const fail = (msg: string) => ({ isError: true, content: [{ type: 'text' as const, text: msg }] });

const wrap =
  <A>(fn: (args: A) => Promise<unknown>) =>
  async (args: A) => {
    try {
      return ok(await fn(args));
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  };

const networkParam = z
  .enum(['base', 'base-sepolia'])
  .optional()
  .describe('Network. Defaults to SBN_NETWORK or base (mainnet, real USDC). base-sepolia is the free testnet.');

const marketParam = z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe('Bond market contract address (0x…)');

function isMainnet(network?: string): boolean {
  return (network ?? networkName()) !== 'base-sepolia';
}

const RISK_GATE = `This would create a new financial commitment with real USDC on Base mainnet. Before retrying with acknowledge_risks=true, confirm with your human that they understand and accept: (1) bonds are uncollateralized — a lender can lose 100%; (2) the contracts are an unaudited fork of Wildcat V2; (3) transactions are irreversible; (4) there is no KYC/sanctions layer — legal/tax/regulatory compliance is their responsibility. Full text: ${SITE}/risk.md`;

// ---------- read tools ----------

server.registerTool(
  'list_bonds',
  {
    title: 'List all bonds',
    description:
      'Every bond issued on sellbonds.now (Base mainnet), read live from the on-chain registry: terms, APR, raised/cap, status, issuer, plus network aggregates.',
    inputSchema: {},
  },
  wrap(async () => {
    const res = await fetch(`${SITE}/api/markets`);
    if (!res.ok) throw new Error(`markets API ${res.status}`);
    return res.json();
  }),
);

server.registerTool(
  'get_bond',
  {
    title: 'Get one bond',
    description:
      'Full detail for one bond on Base mainnet: live state, terms, issuer, and its on-chain event history (investments, draws, repayments).',
    inputSchema: { market: marketParam },
  },
  wrap(async ({ market }: { market: string }) => {
    const res = await fetch(`${SITE}/api/bond?market=${market}`);
    if (res.status === 404) throw new Error('No sellbonds bond at that address.');
    if (!res.ok) throw new Error(`bond API ${res.status}`);
    return res.json();
  }),
);

server.registerTool(
  'bond_status',
  {
    title: 'Read bond state from chain',
    description:
      'Read a bond market directly from the chain via RPC (works on testnet too, unlike get_bond). Returns raw contract state.',
    inputSchema: { market: marketParam, network: networkParam },
  },
  wrap(async ({ market, network }: { market: string; network?: string }) => {
    const sbn = connectReadonly(network);
    const status = await marketStatus(sbn as never, market as Address);
    return { network: network ?? networkName(), ...status, explorerUrl: addressUrl(sbn.deployment, market) };
  }),
);

server.registerTool(
  'wallet_status',
  {
    title: 'Wallet status',
    description:
      "The local sellbonds wallet (shared with the sbn CLI at ~/.sellbondsnow/wallet.json): address, balances, issuer registration. Set create=true to create one if it doesn't exist.",
    inputSchema: {
      network: networkParam,
      create: z.boolean().optional().describe('Create the wallet if none exists (default false)'),
    },
  },
  wrap(async ({ network, create }: { network?: string; create?: boolean }) => {
    if (!walletExists() && !create) {
      return { exists: false, hint: 'No wallet yet. Call wallet_status with create=true to create one (key stays local).' };
    }
    const { wallet, created } = create ? loadOrCreateWallet() : { wallet: loadWallet(), created: false };
    const sbn = connect(network);
    const [eth, usdc, registered] = await Promise.all([
      ethBalance(sbn),
      usdcBalance(sbn),
      isRegistered(sbn),
    ]);
    return {
      exists: true,
      created,
      address: wallet.address,
      network: network ?? networkName(),
      ethWei: eth,
      usdc: Number(usdc) / 1e6,
      registeredAsIssuer: registered,
      explorerUrl: addressUrl(sbn.deployment, wallet.address),
      myBonds: listMarkets(),
    };
  }),
);

server.registerTool(
  'fund_wallet_testnet',
  {
    title: 'Fund wallet (testnet only)',
    description:
      'Top up the local wallet with free Base Sepolia gas (via the sellbonds.now dispenser) and test USDC. Testnet only — on mainnet the wallet must be funded externally.',
    inputSchema: {},
  },
  wrap(async () => {
    loadOrCreateWallet();
    const sbn = connect('base-sepolia');
    const result = await ensureFunded(sbn);
    return { address: sbn.account.address, ...result };
  }),
);

// ---------- write tools ----------

server.registerTool(
  'issue_bond',
  {
    title: 'Issue a bond (raise)',
    description:
      'One-shot raise: ensures the wallet is funded (testnet) and registered as an issuer, deploys a bond market with your terms, and sets its on-chain name/description. ALWAYS set an honest name + description — unnamed bonds get skipped by lenders. On mainnet requires acknowledge_risks=true after the human has confirmed the risks.',
    inputSchema: {
      capUsdc: z.number().positive().describe('Max capital to raise, in USDC (e.g. 10000)'),
      aprPct: z.number().min(0).max(100).optional().describe('Annual coupon for lenders, percent (e.g. 8.5)'),
      type: z.enum(['open', 'fixed']).optional().describe("'open' (revolving, default) or 'fixed' (matures)"),
      term: z.string().optional().describe("Fixed-term duration, e.g. '90d' or '1y' (fixed type only)"),
      name: z.string().max(80).optional().describe('Short honest label, e.g. "GPU cluster Q3"'),
      description: z.string().max(500).optional().describe('What the money funds — honest, no invented returns'),
      network: networkParam,
      acknowledge_risks: z.boolean().optional().describe('Required true on mainnet, only after human confirmation'),
    },
  },
  wrap(
    async (a: {
      capUsdc: number;
      aprPct?: number;
      type?: 'open' | 'fixed';
      term?: string;
      name?: string;
      description?: string;
      network?: string;
      acknowledge_risks?: boolean;
    }) => {
      if (isMainnet(a.network) && !a.acknowledge_risks) throw new Error(RISK_GATE);
      loadOrCreateWallet();
      const sbn = connect(a.network);
      await ensureFunded(sbn);
      await registerSelf(sbn);
      const market = await deployMarket(sbn, {
        type: a.type ?? 'open',
        capUsdc: a.capUsdc,
        aprPct: a.aprPct,
        namePrefix: a.name,
        term: a.term,
      });
      let noteSet = false;
      if (a.name || a.description) {
        try {
          await describeBond(sbn, market.market as Address, a.name ?? '', a.description ?? '');
          noteSet = true;
        } catch {
          /* non-fatal */
        }
      }
      return {
        market: market.market,
        name: market.name,
        symbol: market.symbol,
        type: market.type,
        issuer: sbn.account.address,
        explorerUrl: market.explorerUrl,
        deployTxUrl: market.txUrl,
        bondPage: `${SITE}/bond/${String(market.market).toLowerCase()}`,
        noteSet,
        next: 'Lenders fund it with the deposit tool (or: sbn deposit <market> <usdc>). Draw capital with borrow; repay with repay.',
      };
    },
  ),
);

server.registerTool(
  'deposit',
  {
    title: 'Fund a bond (lend)',
    description:
      'Lend USDC into a bond and receive its interest-accruing bond token. Uncollateralized — you can lose everything if the issuer defaults. On mainnet requires acknowledge_risks=true after the human has confirmed the risks.',
    inputSchema: {
      market: marketParam,
      amountUsdc: z.number().positive().describe('USDC to lend (human units)'),
      network: networkParam,
      acknowledge_risks: z.boolean().optional().describe('Required true on mainnet, only after human confirmation'),
    },
  },
  wrap(async (a: { market: string; amountUsdc: number; network?: string; acknowledge_risks?: boolean }) => {
    if (isMainnet(a.network) && !a.acknowledge_risks) throw new Error(RISK_GATE);
    const sbn = connect(a.network);
    const hash = await deposit(sbn, a.market as Address, a.amountUsdc);
    return { txHash: hash, txUrl: txUrl(sbn.deployment, hash), deposited: a.amountUsdc, market: a.market };
  }),
);

server.registerTool(
  'borrow',
  {
    title: 'Draw down raised capital (issuer)',
    description: 'Move raised USDC from your bond market to your wallet, leaving the reserve ratio behind.',
    inputSchema: { market: marketParam, amountUsdc: z.number().positive(), network: networkParam },
  },
  wrap(async (a: { market: string; amountUsdc: number; network?: string }) => {
    const sbn = connect(a.network);
    const hash = await borrow(sbn, a.market as Address, a.amountUsdc);
    return { txHash: hash, txUrl: txUrl(sbn.deployment, hash), borrowed: a.amountUsdc, market: a.market };
  }),
);

server.registerTool(
  'repay',
  {
    title: 'Repay a bond (issuer)',
    description: 'Return principal + interest to the bond market. On-time repayment builds your on-chain credit record.',
    inputSchema: { market: marketParam, amountUsdc: z.number().positive(), network: networkParam },
  },
  wrap(async (a: { market: string; amountUsdc: number; network?: string }) => {
    const sbn = connect(a.network);
    const hash = await repay(sbn, a.market as Address, a.amountUsdc);
    return { txHash: hash, txUrl: txUrl(sbn.deployment, hash), repaid: a.amountUsdc, market: a.market };
  }),
);

server.registerTool(
  'withdraw',
  {
    title: 'Queue a withdrawal (lender)',
    description:
      'Queue redemption of your bond tokens (all of them if amountUsdc is omitted). Returns the batch expiry — claim after it passes with the claim tool.',
    inputSchema: { market: marketParam, amountUsdc: z.number().positive().optional(), network: networkParam },
  },
  wrap(async (a: { market: string; amountUsdc?: number; network?: string }) => {
    const sbn = connect(a.network);
    const { hash, expiry } = await queueWithdrawal(sbn, a.market as Address, a.amountUsdc);
    return { txHash: hash, txUrl: txUrl(sbn.deployment, hash), expiry, next: `After expiry ${expiry}, call claim with this market + expiry.` };
  }),
);

server.registerTool(
  'claim',
  {
    title: 'Claim a matured withdrawal (lender)',
    description: 'Execute a withdrawal batch after its expiry to receive USDC.',
    inputSchema: { market: marketParam, expiry: z.number().int().describe('Batch expiry from the withdraw tool'), network: networkParam },
  },
  wrap(async (a: { market: string; expiry: number; network?: string }) => {
    const sbn = connect(a.network);
    const hash = await executeWithdrawal(sbn, a.market as Address, sbn.account.address as Address, a.expiry);
    return { txHash: hash, txUrl: txUrl(sbn.deployment, hash) };
  }),
);

server.registerTool(
  'close_bond',
  {
    title: 'Close a bond (issuer)',
    description: 'Settle and close a bond market: repays outstanding debt from your wallet and ends the bond.',
    inputSchema: { market: marketParam, network: networkParam },
  },
  wrap(async (a: { market: string; network?: string }) => {
    const sbn = connect(a.network);
    const hash = await closeMarket(sbn, a.market as Address);
    return { txHash: hash, txUrl: txUrl(sbn.deployment, hash), closed: a.market };
  }),
);

server.registerTool(
  'describe_bond',
  {
    title: 'Name/describe a bond (issuer)',
    description:
      'Set or update the on-chain name + description of a bond you issued. Honest labels matter — unnamed bonds get skipped by lenders.',
    inputSchema: {
      market: marketParam,
      name: z.string().max(80).describe('Short label, e.g. "GPU cluster Q3"'),
      description: z.string().max(500).describe('What the money funds'),
      network: networkParam,
    },
  },
  wrap(async (a: { market: string; name: string; description: string; network?: string }) => {
    const sbn = connect(a.network);
    await describeBond(sbn, a.market as Address, a.name, a.description);
    return { market: a.market, name: a.name, description: a.description, bondPage: `${SITE}/bond/${a.market.toLowerCase()}` };
  }),
);

// ---------- start ----------

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`sellbonds-mcp ready (network default: ${networkName()}) — docs: ${SITE}/llms.txt`);
