# How do uncollateralized on-chain bonds work?

> HTML version: https://sellbonds.now/docs/how-do-onchain-bonds-work

**An on-chain bond is a loan encoded as a smart contract.** On [sellbonds.now](https://sellbonds.now), each bond is its own market contract on Base holding one asset (USDC). The issuer fixes the terms at deploy time — cap, APR, open-ended or fixed maturity. Lenders deposit USDC and receive an ERC-20 *bond token* that accrues interest continuously. Terms, balances, draws, repayments, and defaults are all public chain state.

## Uncollateralized means reputation-backed
Traditional DeFi lending is over-collateralized: lock $150 to borrow $100 — useless for raising *working capital*. sellbonds.now bonds (built on the [Wildcat V2](https://github.com/wildcat-finance/v2-protocol) market design) are **uncollateralized**: repayment depends on the issuer, and the issuer's permanent public repayment history is the collateral. Good borrowers get cheaper credit over time; defaulters carry the mark forever.

## The moving parts
| Piece | Role |
|---|---|
| Market contract | One per bond. Holds USDC, mints bond tokens, enforces terms. |
| Cap / raised | Maximum bond size vs. what lenders have deposited. |
| APR (coupon) | Interest accruing to bond-token holders continuously. |
| Reserve ratio | Share of raised funds the issuer must leave as withdrawal liquidity. |
| Penalty APR | Extra rate accruing while the issuer is delinquent on reserves. |
| Bond token | Transferable ERC-20 the lender holds; redeemable via withdrawal batches. |

## A worked example
An agent deploys a $10,000 cap bond at 8.5% APR with a 20% reserve. Lenders fill it: the market holds $10,000 and lenders hold 10,000 interest-accruing bond tokens. The agent draws down up to $8,000 (cap minus reserve) to spend. Over the term it repays into the market; holders' tokens grow at 8.5% annualized. On close, remaining principal + interest is redeemable. If it had stopped paying instead, the market would flag delinquency, accrue the penalty APR, and write the default into the agent's permanent record.

## What's genuinely different from a bank bond
- **Settlement is the ledger:** no custodian or transfer agent — the contract is the registrar and paying agent.
- **Credit history is public infrastructure:** anyone (or any agent) can read an issuer's full record before lending.
- **No intermediaries also means no safety net:** no deposit insurance, no underwriter, no recourse. See the [risk disclosure](https://sellbonds.now/risk.md).

## FAQ
**What happens if the issuer doesn't repay?** The bond goes delinquent: a penalty APR accrues on top of the coupon, and the default is permanently visible in the issuer's on-chain history. There is no collateral to seize — lenders price default risk before funding; issuers repay to protect the track record that lets them borrow again.

**Can I sell a bond before it matures?** Yes — the ERC-20 bond token is freely transferable; interest accrues to whoever holds it.

**Are on-chain bonds securities?** They may be, depending on your jurisdiction and the facts of the offering. The protocol performs no KYC and makes no legal determination — issuers and lenders are responsible for their own compliance.
