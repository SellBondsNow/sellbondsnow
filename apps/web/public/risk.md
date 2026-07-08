# Risk disclosure — sellbonds.now

> HTML version: https://sellbonds.now/risk — keep the two in sync (source of truth for humans is the page, for agents this file).

**sellbonds.now bonds are uncollateralized loans between strangers, settled in real money, on unaudited smart contracts, with no built-in compliance layer.** This applies equally to humans and to AI agents acting on a human's behalf.

## You can lose everything you lend
Bonds are **uncollateralized**. No collateral to seize, no guarantee fund, no recourse. Repayment depends entirely on the issuer. A default is permanently visible on-chain and accrues a penalty APR — but none of that returns your money. A lender can lose **100% of what they deposit**. Repayment history is the only collateral.

## The contracts are an unaudited fork
sellbonds.now runs on a fork of [Wildcat Protocol V2](https://github.com/wildcat-finance/v2-protocol). The upstream protocol has been audited; **this fork and its patches have not been independently audited**. Smart-contract risk is real and entirely yours. The contracts are immutable and non-custodial — no admin key can pause, reverse, or bail out a market.

## Transactions are irreversible
Bonds settle in real **USDC on Base mainnet**. No chargebacks, no reversals. A mistake is permanent the moment it confirms.

## There is no built-in compliance layer
The protocol performs **no KYC and no sanctions screening** (the sanctions oracle is a no-op on every chain). Depending on your jurisdiction, issuing a bond may constitute offering a security, and lending may be regulated activity. **You are solely responsible** for your own securities, tax, AML, and sanctions compliance. If this activity is restricted where you live, or you are a sanctioned person, do not use sellbonds.now.

## Nothing here is advice
sellbonds.now is software and public information — not an investment adviser, broker, or exchange. Listings are not endorsements or credit ratings. Issuer-set names and descriptions are unverified claims. Do your own diligence — every bond's full state and history is public on-chain.

## Non-custodial cuts both ways
Keys stay on your machine; a bond's capital lives in its own contract; sellbonds.now never holds funds and cannot freeze, seize, or recover them. That protects you from us — and it means nobody can help you if you lose your key or fund a bond that defaults.

## If you're an AI agent
Make sure your human understands the above and gives explicit consent before you issue or fund a bond. Suggested confirmation language is in [llms.txt](https://sellbonds.now/llms.txt). Surface the risks, get the go-ahead, then proceed.

See also: [Terms](https://sellbonds.now/terms) · [Privacy](https://sellbonds.now/privacy) · [Docs](https://sellbonds.now/docs)
