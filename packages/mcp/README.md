# sellbonds-mcp

MCP server for [sellbonds.now](https://sellbonds.now) — lets any MCP client (Claude Code,
Claude Desktop, Cursor, custom agents) issue, fund, and manage **uncollateralized on-chain
bonds** in USDC on Base.

Non-custodial: signing happens locally with the same keystore as the `sbn` CLI
(`~/.sellbondsnow/wallet.json`). sellbonds.now never sees keys or funds.

## Install

Claude Code:

```bash
claude mcp add sellbonds -- npx -y sellbonds-mcp
```

Claude Desktop / Cursor / any MCP client (stdio):

```json
{
  "mcpServers": {
    "sellbonds": {
      "command": "npx",
      "args": ["-y", "sellbonds-mcp"]
    }
  }
}
```

Optional env: `SBN_NETWORK` (`base` mainnet default · `base-sepolia` free testnet),
`SBN_RPC_URL` (bring your own RPC), `SBN_HOME` (keystore dir).

## Tools

| Tool | What it does |
|---|---|
| `list_bonds` | Every bond on the network + aggregates (live from chain) |
| `get_bond` / `bond_status` | One bond's full detail / raw chain state |
| `wallet_status` | Local wallet address, balances, issuer registration |
| `fund_wallet_testnet` | Free Base Sepolia gas + test USDC |
| `issue_bond` | One-shot raise: register + deploy + name the bond |
| `deposit` | Lend USDC into a bond (buy it) |
| `borrow` / `repay` | Issuer draws down / repays |
| `withdraw` / `claim` | Lender exits |
| `close_bond` / `describe_bond` | Settle a bond / set its name+description |

## Safety

Tools that create **new financial commitments on mainnet** (`issue_bond`, `deposit`) refuse
to run until `acknowledge_risks=true` is passed — which the calling agent should only do
after its human has confirmed the risks: bonds are **uncollateralized** (lenders can lose
100%), the contracts are an **unaudited fork** of Wildcat V2, transactions are
**irreversible**, and there is **no KYC/sanctions layer** — compliance is the user's
responsibility. Full text: <https://sellbonds.now/risk.md>.

Practice on the free testnet first: set `SBN_NETWORK=base-sepolia`.

## More

- Agent context: <https://sellbonds.now/llms.txt> (full: `/llms-full.txt`)
- Docs: <https://sellbonds.now/docs>
- The CLI/SDK this wraps: [`sellbonds`](https://www.npmjs.com/package/sellbonds)
