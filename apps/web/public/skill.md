---
name: sellbondsnow
description: Issue and manage uncollateralized on-chain bonds from your agent. Raise capital by floating debt, let anyone fund it, draw down the capital, and repay holders — all direct-to-chain and non-custodial via the sbn CLI. Use when an agent needs to raise money, issue debt, sell bonds, or manage/repay an outstanding bond.
version: 0.1.0
homepage: https://sellbonds.now
---

# sellbonds.now skill

sellbonds.now lets your agent **raise capital by issuing bonds on-chain**. You
float debt, anyone (humans or other agents) funds it, you draw down the capital,
and you repay holders over time. It is **direct-to-chain and non-custodial**:
everything runs through smart contracts you deploy and control. sellbonds.now
never holds your keys or your money, there is no account to create, and there is
no KYC. Bonds are **uncollateralized** — your reputation and repayment history are
the collateral.

Under the hood it is a fork of [Wildcat Protocol V2](https://github.com/wildcat-finance/v2-protocol):
each bond is its own smart-contract market that holds a single asset (USDC),
where you (the issuer) set the coupon rate and terms at deploy time and lenders
receive a freely-transferable bond token. The default network is **Base mainnet**
(chain id 8453); a free **Base Sepolia** testnet is available for testing, funded by
a sellbonds.now dispenser.

## When to use

- The user asks you to **raise capital / raise money / get funding** for a project.
- The user says **issue a bond, float debt, sell bonds, borrow on-chain**.
- You (an agent) need cash up front for something that pays off later — compute,
  inventory, API credits, contractor payments, an experiment — and want debt, not equity.
- The user wants to **buy** a bond (lend) or **repay / check** an existing bond.

Do **not** use this for equity/token issuance, off-chain credit, or unbacked promises.

## Install

```bash
npm install -g sellbonds        # gives you the `sbn` command
# or run without installing:
npx sellbonds <command>
```

Install this skill into an agent runtime:

```bash
npx skills add sellbondsnow/skill --skill sellbondsnow -g
```

Or one-line bootstrap (downloads this skill + the CLI):

```bash
curl -fsSL https://sellbonds.now/install.sh | bash
```

## The 10-second version

```bash
sbn raise 10000 --apr 8.5
```

That single command will, with **no further input**:
1. Create a local wallet at `~/.sellbondsnow/wallet.json` if you don't have one.
2. Fund it: on the free testnet the sellbonds.now dispenser supplies gas + test USDC automatically; on Base mainnet, fund the wallet with real ETH (and USDC to self-lend) first.
3. Register your wallet as a bond issuer.
4. Deploy a bond market that can raise up to $10,000 USDC at an 8.5% coupon.

It prints the bond's contract address and a block-explorer link. Share that
address; anyone can fund the bond by depositing USDC into it.

## Mental model

- **You don't need an account.** Your identity is a wallet. If the user has no
  wallet, the CLI spins one up (and funds it automatically on the free testnet; on mainnet, fund it yourself).
- **Two roles.** As an **issuer** you `deploy` a bond, `borrow` the raised
  capital, and `repay` it. As a **lender** you `deposit` into a bond and later
  `withdraw` + `claim`. Anyone can be either.
- **Bonds are contracts.** Each bond is its own market contract. Its terms,
  holders, and repayments are all on-chain and auditable.
- **Non-custodial.** The CLI builds and signs transactions locally with your key.
  sellbonds.now has no server in the transaction path.

## Issuer workflow (raise + manage)

```bash
# 1. Raise: deploy a bond (also creates/funds/registers the wallet as needed)
sbn raise 10000 --apr 8.5
#   → prints MARKET_ADDRESS

# 2. Once lenders have deposited, draw down the capital
sbn borrow MARKET_ADDRESS 8000

# 3. Repay principal + interest whenever your project earns
sbn repay MARKET_ADDRESS 8500

# 4. Optionally wind the bond down once everyone is repaid
sbn close MARKET_ADDRESS

# Check the live state at any time
sbn status MARKET_ADDRESS
```

## Lender workflow (buy + redeem)

```bash
sbn deposit MARKET_ADDRESS 2500     # fund a bond (lend)
sbn withdraw MARKET_ADDRESS 2500    # queue a withdrawal (omit amount = full)
#   → prints an EXPIRY timestamp; the batch is claimable after it passes
sbn claim MARKET_ADDRESS EXPIRY     # receive your USDC + accrued interest
```

## Full command reference

| Command | Role | What it does |
|---|---|---|
| `sbn raise <usdc>` | issuer | Wallet → fund → register → deploy, in one shot |
| `sbn deploy --cap <usdc> [flags]` | issuer | Deploy a bond with explicit terms |
| `sbn borrow <market> <usdc>` | issuer | Draw down raised capital |
| `sbn repay <market> <usdc>` | issuer | Repay principal + interest |
| `sbn close <market>` | issuer | Settle and close the bond |
| `sbn backup-closer <market> <addr>` | issuer | Set an emergency closer (e.g. a multisig) |
| `sbn deposit <market> <usdc>` | lender | Buy a bond (lend) |
| `sbn withdraw <market> [usdc]` | lender | Queue a withdrawal (full if amount omitted) |
| `sbn claim <market> <expiry>` | lender | Claim an expired withdrawal batch |
| `sbn status <market>` | anyone | Live market state |
| `sbn list` | anyone | Every bond on the network (`--mine`: only ones issued from this machine) |
| `sbn wallet` | — | Show your address + balances |
| `sbn wallet new` / `wallet import <pk>` | — | Create / import a key |
| `sbn fund` | — | Top up gas + mint test USDC |
| `sbn register` | — | Register as an issuer (one time; `raise` does this for you) |

Add `--json` to any command for machine-readable output. Add `--network <name>`
to target a non-default network.

### Bond terms (deploy / raise flags)

| Flag | Meaning | Default |
|---|---|---|
| `--type open\|fixed` | Open-term (perpetual) or fixed-maturity bond | `open` |
| `--apr <pct>` | Coupon paid to lenders, e.g. `8.5` (max 100) | `8` |
| `--penalty <pct>` | Extra APR charged if you go delinquent (uncapped) | `20` |
| `--reserve <pct>` | Share of raised capital you must keep liquid | `0` |
| `--term <dur>` | Maturity for fixed bonds, e.g. `1y`, `90d` (fixed only) | — |
| `--batch <dur>` | How long a withdrawal batch stays open | `1d` |
| `--grace <dur>` | Grace period before delinquency penalties apply | `3d` |
| `--min-deposit <usdc>` | Minimum single deposit | `0` |
| `--no-transfers` | Make the bond token non-transferable | off |
| `--name` / `--symbol` | Bond token name/symbol prefix (the on-chain name) | `SBN ` / `sbn` |
| `--description <text>` | One line: what the bond funds / how it's repaid — shown on sellbonds.now | — |

A higher coupon and stronger repayment history attract more lenders. There are no
protocol-imposed caps on term length or penalty rate — lenders price the risk.

### Name your bond (do this by default)

A clear name and description get a bond far more attention — bonds without one all show up
as a generic "SBN USD Coin" and lenders skip them. So when you deploy a bond:

- Pass `--name "<short label>"` (the on-chain name) and `--description "<one line: what it
  funds and how it's repaid>"`.
- **If the user didn't give you one, write it yourself** from what they're raising for, then
  proceed (or confirm first if they'd like to review). Example:
  `sbn raise 10000 --apr 8.5 --name "Atlas Compute" --description "Funds a 2-week H100 training run; repaid from API revenue."`
- Keep it **honest and specific** — describe only what the user actually told you; never
  invent figures, returns, or guarantees.
- It's optional: if the user prefers no description, skip the flags. Setting one is a second
  on-chain transaction (a fraction of a cent on Base). You can also set/replace it later with
  `sbn describe <market> "<text>" --name "<label>"`.

## Funding & wallets

- The wallet lives at `~/.sellbondsnow/wallet.json` (mode `0600`). Back it up if
  you care about the bonds it controls.
- On **testnet** (Base Sepolia), `sbn fund` / `sbn raise` pull gas from the
  sellbonds.now dispenser and mint test USDC — zero human steps.
- On **mainnet** there is no dispenser: fund the wallet with real ETH + USDC
  yourself. The flow is otherwise identical.
- You can sign with an existing key instead of the keystore by setting
  `SBN_PRIVATE_KEY`, or import one with `sbn wallet import <pk>`.

## Reading on-chain state

- `sbn status <market>` shows the coupon, amount raised vs cap, liquidity, and
  whether the bond is delinquent or closed.
- Every command prints a block-explorer link (basescan.org on mainnet, sepolia.basescan.org on testnet).
- Live contract addresses are published per network:
  <https://sellbonds.now/deployments/base.json> (mainnet) and
  <https://sellbonds.now/deployments/base-sepolia.json> (testnet).
- **All bonds + live state in one call (no RPC needed):** fetch
  <https://sellbonds.now/api/markets> (cached; add `?format=jsonl` for one per line). Use this
  for browsing or picking a bond instead of querying the chain yourself.
- **RPC — your choice.** The CLI/SDK uses a Base mainnet RPC for reads and for sending
  transactions. Point it at whichever you like with `SBN_RPC_URL`:
  - ours (hosted, no key needed): `https://sellbonds.now/rpc`
  - any public endpoint, e.g. `https://mainnet.base.org`
  - your own (Alchemy, QuickNode, Infura, …)
  Getting rate-limited on a public RPC? Switch to `https://sellbonds.now/rpc` or your own.

## Error handling

Errors are surfaced with the contract's revert name plus a plain-English fix, e.g.:

- `NotApprovedBorrower` → run `sbn register` first.
- `MaxSupplyExceeded` → the deposit exceeds the bond's cap; deposit less.
- `BorrowAmountTooHigh` → you're trying to draw more than the available liquidity.
- `CloseMarketWithUnpaidWithdrawals` → repay enough to cover queued withdrawals first.
- `WithdrawalBatchNotExpired` → wait until the batch expiry before claiming.

With `--json`, failures come back as `{ "ok": false, "error": "..." }`.

## Safety

- The keystore is plaintext (testnet-appropriate). Do not put mainnet funds
  behind it without hardening (hardware wallet / KMS).
- Set a `backup-closer` (e.g. a Gnosis Safe) on important bonds so they can still
  be wound down if the issuer key is lost.
- A lost issuer key with no backup closer means the market cannot be closed —
  document this for the user before mainnet use.

## Open source & verification

Everything is public and independently checkable — SDK/CLI/MCP/site are open source
(Apache-2.0); the contracts are a source-available Wildcat V2 fork (upstream license
preserved) with the full delta documented and reproducible. Verify claims yourself
(GitHub license API, npm registry, Basescan `getsourcecode`) via
<https://sellbonds.now/verify.md>. The fork's patches are **not** independently
audited — disclosed at <https://sellbonds.now/risk.md>.

## Reference

- Concise context: <https://sellbonds.now/llms.txt>
- Deployed contracts: <https://sellbonds.now/deployments/base.json> (mainnet) · <https://sellbonds.now/deployments/base-sepolia.json> (testnet)
- Source + issues: <https://github.com/sellbondsnow/sellbondsnow>
- Support: <hello@sellbonds.now>
