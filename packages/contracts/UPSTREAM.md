# Upstream provenance

This package is a fork of the Wildcat Protocol V2 contracts, modified for use as the v1 bond primitive on sellbonds.now.

| | |
|---|---|
| Upstream repo | https://github.com/wildcat-finance/v2-protocol |
| Upstream branch | `mainnet` |
| Upstream commit | `2624204522e5e13817ecad3655411bb9fc35ab11` |
| Forked on | 2026-05-27 |
| Upstream license | Apache 2.0 + Commons Clause (see `LICENSE.md`) |

## Why we forked

Upstream Wildcat requires the Wildcat team to manually approve each borrower via `ArchController.registerBorrower(address)` (which is `onlyOwner`). We need permissionless onboarding so AI agents can deploy bond markets without human-in-the-loop approval.

The complete patch spec is the table below plus the tested checklist in
`docs/wildcat_requirements.md` (monorepo root).

## What we changed (complete delta from upstream)

Every intentional difference from the upstream commit above, each backed by a
test — the authoritative tracked list (with test names and status) is
`docs/wildcat_requirements.md` § "SBN — sellbonds.now patches" in the monorepo root:

| Change | What / why |
|---|---|
| Permissionless issuer onboarding | `ArchController.registerSelf()` added so any agent can register as a borrower without Wildcat-multisig approval. The upstream admin path (`registerBorrower`) is preserved. |
| Penalty-rate cap lifted | `MaximumDelinquencyFeeBips` raised to `type(uint16).max` (upstream caps it) — lenders price the risk. |
| Term-length cap lifted | `MaximumLoanTerm` raised to `type(uint32).max`. |
| `backupCloser` | New optional role that can close a market if the issuer disappears; defaults to zero/off. |
| `NullSanctionsOracle` | New contract wired to the sanctions sentinel — **sanctions screening is a no-op on every chain** (disclosed at https://sellbonds.now/risk). |
| Zero origination fees | Deploy script sets origination fees to zero. |
| Both hooks templates registered | Open-term and fixed-term templates registered at deploy. |
| New files kept separate | All additions live in `src/sellbondsnow/` and `test/sellbondsnow/`; upstream paths are minimally modified. |
| MockUSDC (testnet only) | Freely-mintable 6-decimal test USDC deployed on Base Sepolia only; canonical Circle USDC on mainnet. |
| Deploy script | `script/DeployBase.s.sol` — chain-aware deterministic deploy of the full stack. |

Reproduce the exact diff yourself:

```sh
git clone https://github.com/wildcat-finance/v2-protocol wildcat && cd wildcat
git checkout 2624204522e5e13817ecad3655411bb9fc35ab11
diff -r src/ ../sellbondsnow/packages/contracts/src/
```

**The fork's patches have not been independently audited** (upstream has been).
This is disclosed on every agent-facing surface and at https://sellbonds.now/risk.

## Pulling upstream fixes

To compare against upstream and pull in security fixes:

```sh
git remote add wildcat-upstream https://github.com/wildcat-finance/v2-protocol.git
git fetch wildcat-upstream mainnet
git diff wildcat-upstream/mainnet -- packages/contracts/src
```

## License caveat

The upstream Apache 2.0 + Commons Clause restricts *selling* the software
("a product or service whose value derives, entirely or substantially, from
the functionality of the Software"). sellbonds.now's deployment is
non-custodial and charges **zero fees** on issuance, funding, drawdown, and
repayment, which we believe places it outside the Commons Clause "Sell"
restriction; the Apache 2.0 conditions (license preservation, attribution,
stating changes) are met by `LICENSE.md`, `NOTICE`, and this file.

For precision: because of the Commons Clause, this package is
**source-available**, not OSI open source. The rest of the sellbonds.now
monorepo (SDK, CLI, MCP server, website, API) is original work licensed under
plain Apache-2.0. This posture — full public disclosure, no written agreement
with the Wildcat team — was a deliberate decision, recorded here honestly.
sellbonds.now is not affiliated with, or endorsed by, Wildcat Finance.
