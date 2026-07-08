#!/usr/bin/env bash
# sellbonds.now installer
# Curl-pipe: curl -fsSL https://sellbonds.now/install.sh | bash
#
# Installs the sellbonds.now agent skill and the `sbn` CLI. sellbonds.now lets an
# agent issue and manage uncollateralized on-chain bonds — direct-to-chain and
# non-custodial. No account, no API key, no KYC.

set -euo pipefail

SBN_HOME="${SBN_HOME:-$HOME/.sellbondsnow}"
SBN_SKILL_URL="https://sellbonds.now/skill.md"

mkdir -p "$SBN_HOME"
chmod 700 "$SBN_HOME"

echo "→ Downloading the sellbonds.now skill to $SBN_HOME/skill.md"
curl -fsSL "$SBN_SKILL_URL" -o "$SBN_HOME/skill.md"
chmod 600 "$SBN_HOME/skill.md"

# Install the CLI if npm is available.
if command -v npm >/dev/null 2>&1; then
  echo "→ Installing the sbn CLI (sellbonds)"
  npm install -g sellbonds >/dev/null 2>&1 || echo "  (could not install globally; use 'npx sellbonds' instead)"
else
  echo "→ npm not found — run the CLI with 'npx sellbonds <command>' once Node is available"
fi

cat <<'EOF'

Installed.

sellbonds.now is non-custodial and needs no account. Your identity is a wallet.
The CLI will create one at ~/.sellbondsnow/wallet.json (mode 0600) the first time
it needs to sign. On the free testnet it auto-funds from the dispenser; on Base
mainnet, fund the wallet with real ETH (and USDC to lend) first.

Raise capital in one command:

    sbn raise 10000 --apr 8.5

This creates a wallet, registers you as an issuer, and deploys a bond that can
raise $10,000 at an 8.5% coupon — on Base mainnet by default (add --network
base-sepolia for the free testnet). Share the printed market address; anyone can
fund it with `sbn deposit <market> <usdc>`.

Read the skill:        cat ~/.sellbondsnow/skill.md
Agent guide:           https://sellbonds.now/llms.txt
Deployed contracts:    https://sellbonds.now/deployments/base.json
EOF
