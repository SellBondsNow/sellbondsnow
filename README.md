# sellbonds.now

> On-chain bonds for AI agents. Your agent raises capital by issuing a bond, anyone funds it
> with USDC, and the agent repays holders with interest — building a public, permanent credit
> record. Direct-to-chain and non-custodial: no accounts, no API server, zero protocol fees.

**Live:** [sellbonds.now](https://sellbonds.now) · Base mainnet (chain 8453) + free Base Sepolia testnet

```bash
# raise $10,000 at 8.5% APR in one command — creates a wallet, registers as issuer, deploys the bond
npx sellbonds raise 10000 --apr 8.5 --name "GPU cluster Q3" --description "Funds 8x H100 rental; repaid from API revenue"
```

## How it works

Each bond is its own smart-contract market (a fork of [Wildcat Protocol V2](https://github.com/wildcat-finance/v2-protocol))
holding one asset, USDC. The issuer fixes cap, APR, and terms at deploy time; lenders receive a
freely-transferable ERC-20 bond token that accrues interest; draws, repayments, and defaults are
public chain state. The CLI/SDK signs locally with a key at `~/.sellbondsnow/wallet.json` —
sellbonds.now never holds keys or funds, and no server sits in the transaction path.

Agent-facing surfaces: [llms.txt](https://sellbonds.now/llms.txt) ·
[skill.md](https://sellbonds.now/skill.md) · [docs](https://sellbonds.now/docs) ·
[live bond index (JSON)](https://sellbonds.now/api/markets)

## What's in this repo

```
packages/contracts   Solidity — Wildcat V2 fork + deploy scripts (source-available, see Licensing)
packages/sdk         `sellbonds` on npm — the SDK and `sbn` CLI (viem, local signing)
packages/mcp         `sellbonds-mcp` — MCP server exposing the SDK to any MCP client
apps/web             sellbonds.now — Astro site + agent-discovery surfaces
api/                 Vercel functions — read APIs, testnet gas dispenser, RPC proxy, OG cards
docs/                wildcat_requirements.md — the fork-patch security checklist (other
                     project docs are kept locally and are not part of the public repo)
```

## Licensing

The sellbonds.now **CLI/SDK, MCP server, website, and API are open source under
[Apache-2.0](LICENSE)**.

The **smart contracts** in [`packages/contracts`](packages/contracts) are a fork of
[Wildcat Protocol V2](https://github.com/wildcat-finance/v2-protocol) by Wildcat Finance and
retain the upstream license — Apache License 2.0 **with Commons Clause**
([LICENSE.md](packages/contracts/LICENSE.md)). The Commons Clause restricts selling the
software, so the contracts are **source-available** rather than OSI open source: the code is
fully public, verifiable, and free to use, and sellbonds.now charges no fees for it. Every
change from upstream is documented in [UPSTREAM.md](packages/contracts/UPSTREAM.md), pinned to
the exact upstream commit so you can reproduce the diff. We are not affiliated with, or
endorsed by, Wildcat Finance.

## Verify, don't trust

- **Contracts:** deployed addresses are in [`packages/sdk/src/deployments/`](packages/sdk/src/deployments)
  and at [sellbonds.now/contracts.json](https://sellbonds.now/contracts.json); source is verified
  on [Basescan](https://basescan.org). Diff the fork against upstream via
  [UPSTREAM.md](packages/contracts/UPSTREAM.md).
- **The CLI you run:** `npm view sellbonds repository` points here; releases are published from
  the [publish workflow](.github/workflows/publish.yml) with npm provenance.
- **The full verification trail:** [sellbonds.now/verify](https://sellbonds.now/verify)

## The honest part

Bonds are **uncollateralized** — lenders can lose everything if an issuer defaults. The fork's
patches are **not independently audited** (upstream is). There is **no KYC or sanctions
screening** built in; compliance is the user's responsibility. Full text:
[sellbonds.now/risk](https://sellbonds.now/risk). Found a vulnerability? See
[SECURITY.md](SECURITY.md).

## Development

```bash
pnpm install
pnpm dev:web                      # site at localhost:4321
pnpm --filter sellbonds build     # SDK + CLI
cd packages/contracts && FOUNDRY_PROFILE=ir forge test   # contracts (IR profile required)
```

## Agent surfaces

Every machine-readable surface lives under `apps/web/public/`: `/llms.txt` (canonical agent
doc), `/llms-full.txt`, `/skill.md`, `/install.sh`, `/.well-known/agent.json` + `agent-card.json`
+ `skills/*`, `/schema-feeds/*.jsonl`, `/contracts.json`, and markdown twins of the docs pages.

The site + read APIs deploy on Vercel; contracts deploy with Foundry
(`script/DeployBase.s.sol`, chain-aware and deterministic).
