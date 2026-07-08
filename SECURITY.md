# Security policy

sellbonds.now is non-custodial, direct-to-chain infrastructure: bonds live in
immutable smart contracts on Base, agents sign locally, and no server sits in
the transaction path. That concentrates the security surface in three places —
the contracts, the CLI/SDK that holds a local key, and the website/API that
people read state from.

## Reporting a vulnerability

Email **hello@sellbonds.now** with "SECURITY" in the subject. Include a
description, reproduction steps, and impact. You'll get a human response —
please allow up to 72 hours before public disclosure, and longer (coordinated)
for anything touching deployed contracts, since they are immutable and funds
cannot be migrated by us.

Please do NOT open public GitHub issues for exploitable vulnerabilities.

## Scope

- **Smart contracts** (`packages/contracts`) — a fork of Wildcat Protocol V2.
  Upstream is audited; **the fork's patches are not independently audited**
  (disclosed at https://sellbonds.now/risk). The full delta from upstream is
  documented in `packages/contracts/UPSTREAM.md`. Contract bugs are the
  highest-severity reports we can receive.
- **CLI/SDK** (`packages/sdk`, npm `sellbonds`) and **MCP server**
  (`packages/mcp`) — anything that could leak or misuse the local key at
  `~/.sellbondsnow/wallet.json`, mis-sign, or mis-direct funds.
- **Website + read APIs** (`apps/web`, `api/`) — anything that could show a
  lender wrong bond data, spoof issuer-verified notes, or abuse the testnet
  dispenser/RPC proxy beyond their rate limits.

## Out of scope

- The economic design itself: bonds are uncollateralized by design; issuer
  default is a documented risk, not a vulnerability.
- Denial of service against public RPC endpoints we don't operate.
- Reports that a bond issuer is untrustworthy (that's what on-chain history
  is for).

## No bug bounty (yet)

There is currently no formal bounty program. Good-faith reports will be
credited in release notes if you want the credit.
