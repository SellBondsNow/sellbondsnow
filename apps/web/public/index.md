# sellbonds.now

Agents raise capital by issuing bonds — direct to chain.

Tell your agent to float a bond and it raises capital, draws down the funds, and repays holders. No account, no KYC, no platform fee. sellbonds.now never holds your keys or your money.

## What it is
- Issue **uncollateralized** on-chain bonds from an AI agent. Anyone funds it; the issuer draws down and repays.
- **Direct-to-chain, non-custodial.** No API server, no backend, no API key. The agent signs locally and talks straight to the contracts.
- Built on a fork of [Wildcat Protocol V2](https://github.com/wildcat-finance/v2-protocol). Each bond is its own market contract holding USDC; the issuer sets the coupon (APR) and terms at deploy, and lenders get a freely-transferable bond token.
- Bonds are uncollateralized — repayment history is the collateral.

## Raise in one shot

```bash
sbn raise 10000 --apr 8.5
```

Creates a wallet, registers the issuer, and deploys a bond. On the free testnet it auto-funds the wallet; on mainnet, fund the wallet with ETH (and USDC to self-lend) first.

## Install

```bash
npm install -g sellbonds
# or run without installing:
npx sellbonds <command>
# or:
curl -fsSL https://sellbonds.now/install.sh | bash
```

Install the agent skill:

```bash
npx skills add sellbondsnow/skill --skill sellbondsnow -g
```

## Wallets & funding
- No account. Your identity is a wallet, auto-provisioned at `~/.sellbondsnow/wallet.json` (mode 0600).
- Default network is **Base mainnet** (chain id 8453). Bring your own ETH (gas) and USDC — sellbonds.now never holds funds.
- Free testnet: **Base Sepolia** (chain id 84532). Add `--network base-sepolia` and a sellbonds.now dispenser supplies gas + test USDC automatically.

## When to use
- An agent needs to raise capital / issue debt / sell bonds to fund a project.
- An agent wants to fund a bond (lend) or repay / check an existing bond.
- Do not use for equity issuance, off-chain credit, or unbacked promises.

## Reference
- Agent skill (full guide): https://sellbonds.now/skill.md
- Agent context: https://sellbonds.now/llms.txt
- Deployed contracts: https://sellbonds.now/deployments/base.json (mainnet) · https://sellbonds.now/deployments/base-sepolia.json (testnet)
- Block explorer: https://basescan.org (mainnet) · https://sepolia.basescan.org (testnet)
- Pricing: https://sellbonds.now/pricing.md

## Contact

hello@sellbonds.now
