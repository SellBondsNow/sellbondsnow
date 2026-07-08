# sellbonds

The official SDK + CLI for **[sellbonds.now](https://sellbonds.now)** — issue and manage
uncollateralized on-chain bonds straight from an AI agent.

Direct-to-chain and **non-custodial**: the SDK talks to the deployed bond factory
(a fork of [Wildcat Protocol V2](https://github.com/wildcat-finance/v2-protocol))
on **Base mainnet** (chain 8453), with **Base Sepolia** available for free testing.
sellbonds.now never holds your keys or your funds. There is no
API server in the loop — the SDK builds and signs transactions locally with a
wallet stored at `~/.sellbondsnow/wallet.json`.

## Install

```bash
npm install -g sellbonds     # or: npx sellbonds <command>
```

## One-shot: raise capital

```bash
sbn raise 10000 --apr 8.5
```

This creates a local wallet if you don't have one, registers you as an issuer,
and deploys an open-term bond market with a $10,000 cap paying 8.5%. It prints the
market address and a block-explorer link. On the free testnet (Base Sepolia) the
wallet is auto-funded by the sellbonds.now dispenser (ETH + test USDC); on Base
mainnet you fund the wallet with real ETH and USDC yourself.

## CLI

| Command | What it does |
|---|---|
| `sbn raise <usdc>` | Wallet → fund → register → deploy a bond, in one go |
| `sbn deploy --cap <usdc> [flags]` | Deploy a bond market with explicit terms |
| `sbn status <market>` | Live market state (raised, APR, reserves, …) |
| `sbn list` | Markets you've issued from this machine |
| `sbn wallet` | Show your address + balances |
| `sbn wallet new` / `sbn wallet import <pk>` | Create / import a key |
| `sbn fund` | Top up gas + USDC (testnet dispenser; mainnet = bring your own) |
| `sbn register` | Register this wallet as a bond issuer (one time) |
| `sbn deposit <market> <usdc>` | Buy a bond (lend) |
| `sbn borrow <market> <usdc>` | Draw down raised capital (issuer) |
| `sbn repay <market> <usdc>` | Repay principal + interest |
| `sbn withdraw <market> [usdc]` | Queue a withdrawal (lender) |
| `sbn claim <market> <expiry>` | Claim an expired withdrawal batch |
| `sbn close <market>` | Settle and close a market |
| `sbn backup-closer <market> <addr>` | Set an emergency closer (e.g. a multisig) |

Deploy flags: `--type open|fixed`, `--apr`, `--penalty`, `--reserve`, `--term`
(fixed only, e.g. `1y`), `--batch`, `--grace`, `--min-deposit`, `--no-transfers`,
`--name`, `--symbol`. Global: `--network`, `--json`, `-h`.

Add `--json` to any command for machine-readable output.

## Programmatic

```ts
import { connect, ensureFunded, registerSelf, deployMarket } from 'sellbonds';

const sbn = connect(); // base mainnet by default; uses ~/.sellbondsnow/wallet.json
await ensureFunded(sbn);
await registerSelf(sbn);

const bond = await deployMarket(sbn, {
  type: 'open',
  capUsdc: 10_000,
  aprPct: 8.5,
});
console.log(bond.market, bond.explorerUrl);
```

## Configuration

Environment overrides (handy for local/anvil or a fresh deployment):

- `SBN_NETWORK` — network name (default `base`; use `base-sepolia` for the free testnet)
- `SBN_RPC_URL`, `SBN_EXPLORER`, `SBN_FAUCET_URL`
- `SBN_ARCH_CONTROLLER`, `SBN_HOOKS_FACTORY`, `SBN_OPEN_TERM_TEMPLATE`,
  `SBN_FIXED_TERM_TEMPLATE`, `SBN_USDC`
- `SBN_PRIVATE_KEY` — sign with this key instead of the keystore
- `SBN_HOME` — keystore directory (default `~/.sellbondsnow`)

## Security

The wallet key is stored in plaintext at `~/.sellbondsnow/wallet.json` (mode
`0600`). This is appropriate for testnet and autonomous agents. **Do not** put
mainnet funds behind this key without hardening (hardware wallet, KMS, or an
encrypted keystore). Set a `backup-closer` (e.g. a multisig) on important markets
so they can still be wound down if the issuer key is lost.

## License

Apache-2.0. Bond mechanics are a fork of Wildcat Protocol V2 — see
`packages/contracts/UPSTREAM.md`.
