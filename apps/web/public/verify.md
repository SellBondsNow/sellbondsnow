# Verify sellbonds.now — every claim, with its proof

> HTML version: https://sellbonds.now/verify
> sellbonds.now is fully public and verifiable. Don't trust this file — run the checks below
> against registries and explorers we don't control.

## The code

| Component | License | Independent check |
|---|---|---|
| Monorepo (SDK/CLI, MCP server, website, API) — https://github.com/sellbondsnow/sellbondsnow | **Apache-2.0** (open source) | `GET https://api.github.com/repos/sellbondsnow/sellbondsnow/license` |
| Smart contracts (`packages/contracts`) | **Apache-2.0 + Commons Clause** (source-available — upstream Wildcat license preserved verbatim) | Read `packages/contracts/LICENSE.md` and `packages/contracts/UPSTREAM.md` in the repo |
| CLI/SDK (`sellbonds` on npm) | Apache-2.0 | npm provenance: `npm view sellbonds dist.attestations` (registry cryptographically links the tarball to the public repo + commit + CI run); `npm audit signatures` verifies it |
| MCP server (`sellbonds-mcp` on npm) | Apache-2.0 | `npm view sellbonds-mcp dist.attestations` |

**Precision:** the contracts carry the upstream Commons Clause (restricts *selling* the
software), so they are **source-available**, not OSI open source. Everything sellbonds.now
wrote from scratch is plain Apache-2.0. sellbonds.now charges no fees and is not affiliated
with, or endorsed by, Wildcat Finance.

## The fork, diffable

The contracts fork [Wildcat Protocol V2](https://github.com/wildcat-finance/v2-protocol) at
commit `2624204522e5e13817ecad3655411bb9fc35ab11`. Upstream is audited; **our patches are not
independently audited** — they are fully inspectable instead:
`packages/contracts/UPSTREAM.md` lists every change and the commands to reproduce the diff.

## The deployed contracts (Base mainnet 8453 = Base Sepolia 84532, deterministic deploy)

Source is verified on Sourcify (open, keyless verification registry). Check any address:

- API (returns `"match": "match"` when on-chain bytecode matches the published source):
  `https://sourcify.dev/server/v2/contract/8453/<address>`
- Rendered verified source: `https://base.blockscout.com/address/<address>?tab=contract`
- Explorer: `https://basescan.org/address/<address>`

| Contract | Address | Status |
|---|---|---|
| WildcatArchController | 0x0dbb4426844266add3ab840935cd1a3a67dd4ef6 | verified (Sourcify match; visible on Basescan) |
| HooksFactory | 0x6fe029dfc85924c83a2f7159292f53b3a9a3806f | verified |
| WildcatSanctionsSentinel | 0x402ead2d9aaeedfb53fda4b39fc668c6545beee9 | verified |
| NullSanctionsOracle | 0x23c8d3ab08e998919d9a1f98a4eb6c5da6c01ae7 | verified |
| BondNotes | 0xbe5369cfcbe284d42306bc462be796a7c764dbe9 | verified |
| OpenTermHooksTemplate * | 0xf45cd0d37b5fdf4b5e54d40d1c95c43018c4b55a | initcode store (data, not a runtime contract) |
| FixedTermHooksTemplate * | 0x2c37ce66c2e9c37789d659e02657faa83ac3d7aa | initcode store |
| WildcatMarketInitCodeStorage * | 0x29741d542e1f6a6ad0ee3e7734cf478755630a24 | initcode store |

**Every bond market contract — the thing that actually holds lender USDC — verifies as
`WildcatMarket`.** Check any bond address from https://sellbonds.now/api/markets via the same
Sourcify URL pattern.

\* The starred addresses are `LibStoredInitCode` stores: creation code stored as raw data
(an SSTORE2-style pattern inherited from Wildcat), not runtime contracts — "source
verification" doesn't apply to them by design. Their integrity is attested indirectly: the
verified HooksFactory pins the market initcode hash as a constructor argument, and every
market deployed from the store verifies as WildcatMarket, proving the stored code compiles
from the public source.

Bond asset: canonical Circle USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
Machine-readable address book: https://sellbonds.now/deployments/base.json

## The 60-second agent check

```sh
# 1. Is the code public and what license?
curl -s https://api.github.com/repos/sellbondsnow/sellbondsnow/license

# 2. Is the npm package provably built from that repo? (provenance attestation)
npm view sellbonds dist.attestations

# 3. Does the money-holding contract's on-chain bytecode match the public source?
curl -s "https://sourcify.dev/server/v2/contract/8453/0x6fe029dfc85924c83a2f7159292f53b3a9a3806f"
# → "match": "match"
```

## What can't be proven (said plainly)

The website is a Vercel build — you can't cryptographically confirm the running site matches
the repo. That's acceptable because the site is not in the transaction path: keys stay local,
the CLI is public code from npm, and the contracts holding funds are bytecode-verified on
chain. What remains genuinely unverified is the fork-patch audit — see
https://sellbonds.now/risk.md.

Security reports: SECURITY.md in the repo · https://sellbonds.now/.well-known/security.txt
