# Wildcat Fork — Smart Contract Requirements

> **Status:** initial draft (2026-05-27)
> **Audience:** test brief — every requirement is phrased so we can write a Foundry test (or note that it cannot be).
> **Scope:** smart contracts only, `packages/contracts/`. Off-chain surface (API, SDK, subgraph) deferred.
> **Asset scope:** USDC-only at v1. Broader ERC-20 constraints documented under [ASSET COMPATIBILITY](#asset-compatibility) but not validated end-to-end.
> **Adversary model:** belt-and-suspenders — random griefers, MEV searchers, sophisticated protocol-on-protocol attackers, adversarial AI agents, oracle manipulators, state-level censors, social engineers, storage attackers. Not all items map to on-chain tests; items that don't are flagged `(review-only)`.

## How to read this doc

Each requirement is a checklist item with a stable ID. Format:

```
- **CAT-NNN** *(SEVERITY)*: Statement. **Test:** how to verify. **Status:** ✅ implemented / 🟡 partial / ⬜ not yet / 🔍 review-only.
```

Severity:
- `CRITICAL` — direct loss of user funds, total protocol compromise, or violates a core fork invariant
- `HIGH` — significant fund risk, broken accounting, or breaks an upstream invariant
- `MEDIUM` — degraded UX, indexing breakage, recoverable accounting drift
- `LOW` — cosmetic, documentation, minor inefficiency

Category prefixes are listed in the [Table of Contents](#table-of-contents) below.

---

## Table of contents

**Functional**
1. [BOR — Borrower onboarding](#bor--borrower-onboarding)
2. [LEN — Lender access](#len--lender-access)
3. [MD  — Market deployment](#md--market-deployment)
4. [DEP — Deposit lifecycle](#dep--deposit-lifecycle)
5. [BWR — Borrow lifecycle](#bwr--borrow-lifecycle)
6. [WDR — Withdrawal lifecycle](#wdr--withdrawal-lifecycle)
7. [RPY — Repayment](#rpy--repayment)
8. [INT — Interest accrual](#int--interest-accrual)
9. [CLS — Market closure](#cls--market-closure)
10. [TOK — Market token (ERC-20)](#tok--market-token-erc-20)

**Security**
11. [AUT — Access control](#aut--access-control)
12. [REE — Reentrancy](#ree--reentrancy)
13. [MTH — Math, overflow, precision](#mth--math-overflow-precision)
14. [SLO — Storage layout](#slo--storage-layout)
15. [INI — Initialization safety](#ini--initialization-safety)

**Protocol design**
16. [SAN — Sanctions sentinel](#san--sanctions-sentinel)
17. [SPX — Sphere-X integration](#spx--sphere-x-integration)
18. [ARC — Arch controller registry](#arc--arch-controller-registry)
19. [EVT — Event emission](#evt--event-emission)
20. [ERR — Error semantics](#err--error-semantics)
21. [AST — Asset compatibility](#ast--asset-compatibility)
22. [DPL — Deployment](#dpl--deployment)
23. [MCH — Multi-chain parity](#mch--multi-chain-parity)

**Fork-specific (sellbonds.now)**
24. [SBN — sellbonds.now patches](#sbn--sellbondsnow-patches)
25. [UPS — Upstream invariants preserved](#ups--upstream-invariants-preserved)

**Exploitability**
26. [ADV — Adversarial scenarios](#adv--adversarial-scenarios)

**Operational**
27. [OPS — Operational / recovery](#ops--operational--recovery)
28. [TST — Test coverage requirements](#tst--test-coverage-requirements)

---

## BOR — Borrower onboarding

The fork's defining change. Upstream requires manual approval by the Wildcat multisig. Ours allows any address to self-register.

- **BOR-001** *(CRITICAL)*: Any EOA may call `WildcatArchController.registerSelf()` and be added to the borrowers set without owner approval. **Test:** prank as fuzz-generated EOA → call `registerSelf()` → assert `isRegisteredBorrower(addr)` and `BorrowerAdded` emitted. **Status:** ✅ `test_registerSelf_AnyAddress`.
- **BOR-002** *(HIGH)*: Calling `registerSelf()` twice from the same address reverts with `BorrowerAlreadyExists`. **Test:** prank → `registerSelf` succeeds → second call reverts. **Status:** ✅ `test_registerSelf_BorrowerAlreadyExists`.
- **BOR-003** *(HIGH)*: `registerSelf()` emits `BorrowerAdded(msg.sender)` exactly once per successful call. **Test:** `vm.expectEmit` + indexed args. **Status:** ✅ `test_registerSelf`.
- **BOR-004** *(CRITICAL)*: After `registerSelf()`, the address satisfies the borrower precondition for `HooksFactory.deployMarket`. **Test:** prank EOA → `registerSelf` → `deployMarket` succeeds (no `NotApprovedBorrower` revert). **Status:** ⬜ (integration test pending).
- **BOR-005** *(HIGH)*: A contract address (not just an EOA) may call `registerSelf()`. **Test:** deploy a helper contract that calls `registerSelf()` in its constructor → assert registered. **Status:** ⬜.
- **BOR-006** *(MEDIUM)*: `registerSelf()` is callable when paused/throttled by no global gate (no kill switch at v1). **Test:** assert no modifier other than implicit ones gates `registerSelf`. **Status:** 🔍 (code review).
- **BOR-007** *(HIGH)*: The admin `registerBorrower(address)` path remains `onlyOwner` and functional. **Test:** owner calls it → added; non-owner calls revert `Unauthorized`. **Status:** ✅ `test_registerBorrower`, `test_registerBorrower_Unauthorized`.
- **BOR-008** *(HIGH)*: Both `registerSelf` and `registerBorrower` write to the same backing set; `getRegisteredBorrowers()` returns the union. **Test:** mix both paths → assert union. **Status:** ✅ `test_registerSelf_CoexistsWithAdminPath`.
- **BOR-009** *(HIGH)*: `removeBorrower(address)` remains `onlyOwner`; there is intentionally no `removeSelf()` at v1 to prevent griefing. **Test:** non-owner removeBorrower reverts. **Status:** ✅ `test_removeBorrower_Unauthorized`.
- **BOR-010** *(HIGH)*: Removing a borrower from the set does NOT brick that borrower's existing markets (markets reference the borrower address, not a registry lookup at runtime). **Test:** deploy market → borrower removed → assert market still allows deposit/withdraw/repay. **Status:** ⬜.
- **BOR-011** *(HIGH)*: A borrower removed from the registry cannot deploy *new* markets. **Test:** registerSelf → removeBorrower (via owner) → deployMarket reverts `NotApprovedBorrower`. **Status:** ⬜.
- **BOR-012** *(LOW)*: `registerSelf()` succeeds even when called from a contract during its own construction. **Test:** factory contract that registers itself in constructor. **Status:** ⬜.
- **BOR-013** *(MEDIUM)*: `BorrowerAdded` event topic ordering matches upstream so subgraphs are compatible. **Test:** decode topic[0] keccak hash of upstream signature. **Status:** ✅ implicitly via test_registerSelf.
- **BOR-014** *(LOW)*: Address(0) calling `registerSelf` is either rejected or registers the zero address harmlessly (document which). **Test:** `vm.prank(address(0))` → `registerSelf` → observe behavior; if it succeeds, assert no operational consequence. **Status:** ⬜.
- **BOR-015** *(MEDIUM)*: `registerSelf` is not `nonReentrant`-marked but cannot be exploited via reentrancy (no external calls in its body). **Test:** static analysis + code review. **Status:** 🔍.
- **BOR-016** *(HIGH)*: There is no per-block / per-address rate limit on `registerSelf`. Document this is intentional; spam is gas-priced. **Test:** loop 100 calls in one tx (from different prank-addresses) → all succeed → measure gas; flag if any > 100k gas per call. **Status:** ⬜.

## LEN — Lender access

Open-by-default lender semantics. Upstream gates lenders via role providers; we configure hooks templates to wave everyone through.

- **LEN-001** *(CRITICAL)*: When a market is deployed with `depositRequiresAccess=false`, any address may deposit successfully. **Test:** deploy → unauthorized account deposits → succeeds, balance correct. **Status:** ⬜.
- **LEN-002** *(CRITICAL)*: When a market is deployed with `transferRequiresAccess=false`, anyone holding market tokens may transfer them to anyone else. **Test:** deposit → transfer to non-whitelisted addr → assert balance moved. **Status:** ⬜.
- **LEN-003** *(HIGH)*: When `depositRequiresAccess=true`, unauthorized deposits revert with `NotApprovedLender`. **Test:** deploy gated, deposit without role → revert. **Status:** ⬜.
- **LEN-004** *(HIGH)*: When `transferRequiresAccess=true`, unauthorized transfers revert; on-chain transfer hooks consulted before balance update. **Test:** assert `onTransfer` called pre-transfer; hook revert reverts transfer. **Status:** ⬜.
- **LEN-005** *(HIGH)*: Borrower sets access flags via `hooksData` at market deploy time; flags are immutable per market thereafter. **Test:** deploy → attempt to change → revert (no public setter). **Status:** ⬜.
- **LEN-006** *(MEDIUM)*: Role providers still resolvable when access flags are on (upstream KYC machinery preserved end-to-end). **Test:** deploy gated market with a `UniversalProvider` → addresses returned by provider may deposit. **Status:** ⬜.
- **LEN-007** *(CRITICAL)*: The sanctions sentinel runs on every deposit, withdrawal, and transfer regardless of access flags — sanctioned addresses are intercepted even in an "open" market. **Test:** open-access market + Chainalysis-stubbed sanction on Alice → Alice deposit redirects to escrow. **Status:** ⬜.
- **LEN-008** *(CRITICAL)*: A lender cannot bypass the sentinel by going through `transferFrom` or `permit`. **Test:** sanctioned `from`/`to` for both flows → escrow path triggered. **Status:** ⬜.
- **LEN-009** *(HIGH)*: `Deposit(account, assetAmount, scaledAmount)` event emitted on every successful deposit with correct scaled amount. **Test:** `vm.expectEmit` with computed scaledAmount. **Status:** ⬜.
- **LEN-010** *(HIGH)*: Hook reverts in `onDeposit` / `onQueueWithdrawal` / `onTransfer` bubble to the caller with the hook's error selector. **Test:** mock hook that reverts with sentinel error → assert outer call reverts same. **Status:** ⬜.
- **LEN-011** *(MEDIUM)*: Manually-approved-lender set on `BaseAccessControls` remains functional alongside open access flags. **Test:** borrower grants role to Alice → Alice can deposit even if open access is off. **Status:** ⬜.
- **LEN-012** *(MEDIUM)*: `depositUpTo` semantics (partial fill when over `maxTotalSupply`) work identically to upstream. **Test:** deposit exceeding cap → partial fill, return value reflects accepted amount. **Status:** ⬜.
- **LEN-013** *(LOW)*: Zero-amount deposit reverts with `NullMintAmount` (or equivalent) — no silent no-op. **Test:** `deposit(0)` → revert. **Status:** ⬜.

## MD — Market deployment

- **MD-001** *(CRITICAL)*: `HooksFactory.deployMarket` reverts if `msg.sender` is not a registered borrower (`NotApprovedBorrower`). **Test:** unregistered EOA → `deployMarket` → revert. **Status:** ⬜.
- **MD-002** *(HIGH)*: Parameter validation in `MarketConstraintHooks._onCreateMarket` enforces non-negative bounds on every numeric input. **Test:** for each of `annualInterestBips`, `reserveRatioBips`, `delinquencyGracePeriod`, `withdrawalBatchDuration`, fuzz invalid → revert with the matching `*OutOfBounds` error. **Status:** ⬜.
- **MD-003** *(HIGH)*: `annualInterestBips` upper bound preserved at 10,000 (100% APR). We did NOT raise this cap (only `MaximumDelinquencyFeeBips` and `MaximumLoanTerm`). **Test:** `annualInterestBips=10_001` reverts; `=10_000` succeeds. **Status:** ⬜.
- **MD-004** *(CRITICAL)*: Origination fee for both default templates is 0 at deploy time. **Test:** `hooksFactory.getHooksTemplateDetails(template).originationFeeAmount == 0`. **Status:** ✅ enforced in `DeployBase` script.
- **MD-005** *(HIGH)*: `protocolFeeBips` for both default templates is 0 at deploy. **Test:** as above for `protocolFeeBips`. **Status:** ✅ script.
- **MD-006** *(HIGH)*: Market CREATE2 address is deterministic from `(borrower, salt, hooksInstance, asset)`. **Test:** computeCreate2Address → matches actual deployment address. **Status:** ⬜.
- **MD-007** *(HIGH)*: Same `(borrower, salt)` tuple cannot be reused; second `deployMarket` reverts. **Test:** deploy → repeat with same salt → revert. **Status:** ⬜.
- **MD-008** *(HIGH)*: `MarketDeployed`-style event emitted on factory and on ArchController. **Test:** capture both events. **Status:** ⬜.
- **MD-009** *(HIGH)*: Deployed market is registered on ArchController via the factory (it's a controller). **Test:** `archController.isRegisteredMarket(market)` true after deploy. **Status:** ⬜.
- **MD-010** *(HIGH)*: A hooks instance is created in the same tx as the market (or pre-deployed and re-used per `deployMarket` vs `deployMarketAndHooks`). **Test:** factory event ordering. **Status:** ⬜.
- **MD-011** *(HIGH)*: Market reads its parameters from the factory via the transient-storage `getMarketParameters` pattern; reverts cleanly if called outside that flow. **Test:** call `getMarketParameters` directly when not deploying → revert. **Status:** ⬜.
- **MD-012** *(MEDIUM)*: Disabled templates reject new market deploys (`HooksTemplateNotAvailable`). **Test:** disable template → `deployMarket` with it → revert. **Status:** ⬜.
- **MD-013** *(MEDIUM)*: Only `archController.owner()` can add or disable templates. **Test:** non-owner calls revert. **Status:** ⬜.
- **MD-014** *(HIGH)*: Deploying a market with a non-existent template reverts `HooksTemplateNotFound`. **Test:** random template address → revert. **Status:** ⬜.
- **MD-015** *(HIGH)*: Market deployment is atomic — if any sub-step reverts, no state is changed. **Test:** mock a hook that reverts in `onCreateMarket` → assert ArchController has no new market, factory has no new entry. **Status:** ⬜.
- **MD-016** *(MEDIUM)*: Market name and symbol prefixes are non-empty and bounded length. **Test:** empty prefix reverts; >32 bytes reverts. **Status:** ⬜.
- **MD-017** *(HIGH)*: Each market's `asset()` matches what was passed at deploy. **Test:** deploy with mock USDC → `market.asset() == mockUSDC`. **Status:** ⬜.

## DEP — Deposit lifecycle

- **DEP-001** *(CRITICAL)*: `deposit(amount)` pulls `amount` of the asset from `msg.sender` to the market. **Test:** `asset.balanceOf` deltas equal `amount`. **Status:** ⬜.
- **DEP-002** *(CRITICAL)*: Lender's scaled balance increases by `amount / scaleFactor` (modulo rounding). **Test:** assert pre/post `scaledBalanceOf`. **Status:** ⬜.
- **DEP-003** *(HIGH)*: Lender's nominal balance (via `balanceOf`) increases by ≈ `amount` (rounding down). **Test:** assert `balanceOf` delta is within 1 wei of `amount`. **Status:** ⬜.
- **DEP-004** *(HIGH)*: `Deposit(account, assetAmount, scaledAmount)` emitted with correct values. **Test:** vm.expectEmit. **Status:** ⬜.
- **DEP-005** *(CRITICAL)*: Deposits to a closed market revert `DepositToClosedMarket`. **Test:** closeMarket → deposit → revert. **Status:** ⬜.
- **DEP-006** *(HIGH)*: Deposits that would push supply over `maxTotalSupply` revert `MaxSupplyExceeded`; `depositUpTo` partial-fills. **Test:** both behaviors. **Status:** ⬜.
- **DEP-007** *(HIGH)*: Deposits below `minimumDeposit` (if set in hooks) revert. **Test:** set minimumDeposit; under → revert; equal → succeed. **Status:** ⬜.
- **DEP-008** *(CRITICAL)*: Deposit is `nonReentrant`. **Test:** malicious ERC-20 attempts reentrant deposit → second call reverts. **Status:** ⬜.
- **DEP-009** *(HIGH)*: Deposit handles non-standard ERC-20 returns (e.g. USDT, which returns no bool) via `SafeERC20`. **Test:** non-standard mock token → still works. **Status:** ⬜ (deferred: USDC-only at v1; document in AST).
- **DEP-010** *(HIGH)*: Deposit interaction with `onDeposit` hook is ordered: pull funds → mint scaled → call hook. Document the order and test it. **Test:** mock hook checks state mid-call. **Status:** ⬜.
- **DEP-011** *(MEDIUM)*: Multiple deposits in the same block accumulate correctly. **Test:** N deposits in same block → scaled balance == sum. **Status:** ⬜.
- **DEP-012** *(CRITICAL)*: Deposit when sentinel flags the lender redirects to escrow rather than minting tokens to the sanctioned address. **Test:** flag depositor → deposit → escrow has assets, sanctioned addr has zero tokens. **Status:** ⬜.

## BWR — Borrow lifecycle

- **BWR-001** *(CRITICAL)*: `borrow(amount)` transfers `amount` of asset from the market to the borrower. **Test:** balance deltas. **Status:** ⬜.
- **BWR-002** *(CRITICAL)*: Borrowing is `onlyBorrower`. **Test:** non-borrower call reverts. **Status:** ⬜.
- **BWR-003** *(HIGH)*: Borrowing more than `(currentlyHeld - requiredReserves)` reverts `BorrowAmountTooHigh`. **Test:** compute max → borrow that → succeed; +1 wei → revert. **Status:** ⬜.
- **BWR-004** *(HIGH)*: Borrow reverts on a closed market (`BorrowFromClosedMarket`). **Test:** close → borrow → revert. **Status:** ⬜.
- **BWR-005** *(CRITICAL)*: Borrow reverts when the borrower is sanctioned (`BorrowWhileSanctioned`). **Test:** chainalysis-stub sanction on borrower → borrow → revert. **Status:** ⬜.
- **BWR-006** *(HIGH)*: `Borrow(amount)` event emitted. **Test:** expectEmit. **Status:** ⬜.
- **BWR-007** *(CRITICAL)*: Borrow is `nonReentrant`. **Test:** malicious asset attempts reentrant borrow. **Status:** ⬜.
- **BWR-008** *(MEDIUM)*: Borrow does NOT change `scaledTotalSupply` (only changes the market's asset balance). **Test:** before/after supply unchanged. **Status:** ⬜.
- **BWR-009** *(HIGH)*: Borrow at exactly the reserve floor is allowed; one wei over is rejected. **Test:** boundary test. **Status:** ⬜.

## WDR — Withdrawal lifecycle

- **WDR-001** *(CRITICAL)*: `queueWithdrawal(amount)` removes the lender's tokens from the active supply and places them in the current withdrawal batch. **Test:** balance moves to pending, scaledTotalSupply decreases. **Status:** ⬜.
- **WDR-002** *(HIGH)*: A new batch is started when the previous one expires; queued requests in the same block share a batch. **Test:** two queueWithdrawal calls same block → same batch ID. **Status:** ⬜.
- **WDR-003** *(CRITICAL)*: At batch expiry, available reserves are distributed pro-rata across the batch's lenders. **Test:** two lenders, 60/40 split → assert payouts. **Status:** ⬜.
- **WDR-004** *(CRITICAL)*: If reserves don't cover the batch, the batch is marked unpaid; market becomes delinquent. **Test:** under-reserved batch → assert `isDelinquent`, `timeDelinquent` starts. **Status:** ⬜.
- **WDR-005** *(HIGH)*: Lenders claim via `executeWithdrawal(batchId)` after the batch is settled. **Test:** claim → asset balance + 1. **Status:** ⬜.
- **WDR-006** *(HIGH)*: FixedTermHooks blocks withdrawals before `fixedTermEndTime` (`WithdrawBeforeTermEnd`). **Test:** queueWithdrawal pre-term → revert. **Status:** ⬜.
- **WDR-007** *(HIGH)*: After term end, FixedTermHooks allows withdrawal normally. **Test:** warp past term → succeeds. **Status:** ⬜.
- **WDR-008** *(CRITICAL)*: Sanctioned lender's withdrawal is redirected to escrow (`SanctionedAccountAssetsSentToEscrow`). **Test:** sanction → withdraw → escrow has funds. **Status:** ⬜.
- **WDR-009** *(HIGH)*: `repayAndProcessUnpaidWithdrawalBatches` settles unpaid batches FIFO and respects `maxBatches`. **Test:** queue 3 batches unpaid → call with `maxBatches=2` → first 2 paid, third still unpaid. **Status:** ⬜.
- **WDR-010** *(HIGH)*: A withdrawal request for an account with insufficient balance reverts. **Test:** queueWithdrawal > balance → revert. **Status:** ⬜.
- **WDR-011** *(MEDIUM)*: Zero-amount queueWithdrawal reverts `NullWithdrawalAmount`. **Test:** queueWithdrawal(0) → revert. **Status:** ⬜.

## RPY — Repayment

- **RPY-001** *(CRITICAL)*: `repay(amount)` pulls `amount` from `msg.sender` (anyone can repay, not just borrower). **Test:** third-party prank → repay → market asset balance + amount. **Status:** ⬜.
- **RPY-002** *(HIGH)*: Repay emits `DebtRepaid(amount)` (or upstream-equivalent name). **Test:** expectEmit. **Status:** ⬜.
- **RPY-003** *(HIGH)*: Repay does NOT change `scaledTotalSupply`. Debt is implicit in `scaledTotalSupply × scaleFactor` vs market asset balance. **Test:** before/after supply unchanged. **Status:** ⬜.
- **RPY-004** *(HIGH)*: Repay to a closed market reverts `RepayToClosedMarket`. **Test:** close → repay → revert. **Status:** ⬜.
- **RPY-005** *(CRITICAL)*: Repay is `nonReentrant`. **Test:** malicious asset attempts reentrant repay. **Status:** ⬜.
- **RPY-006** *(HIGH)*: Repay cures delinquency when reserves return to threshold; `timeDelinquent` decrements from the cure point forward. **Test:** delinquency → repay enough → assert `isDelinquent=false`. **Status:** ⬜.
- **RPY-007** *(HIGH)*: `repayAndProcessUnpaidWithdrawalBatches` is functionally `repay` + batch-processing in one tx; both effects observed atomically. **Test:** unpaid batches → call → assets distributed and `repaid` event. **Status:** ⬜.
- **RPY-008** *(MEDIUM)*: Zero-amount repay reverts `NullRepayAmount`. **Test:** repay(0) → revert. **Status:** ⬜.
- **RPY-009** *(HIGH)*: `onRepay` hook is called with the repay amount; hook revert reverts the repay. **Test:** mock hook → revert. **Status:** ⬜.

## INT — Interest accrual

The hairiest math in the protocol. Upstream is audited; we did not change the math. Tests below should be regressions confirming our patch hasn't drifted the math.

- **INT-001** *(CRITICAL)*: `scaleFactor` is monotonically non-decreasing. **Test:** invariant test — N random ops → assert `scaleFactor_new >= scaleFactor_old`. **Status:** ⬜.
- **INT-002** *(CRITICAL)*: Interest accrues at exactly `annualInterestBips` per year on `scaledTotalSupply` while market is healthy. **Test:** warp 1 year → assert `scaleFactor` delta matches formula. **Status:** ⬜.
- **INT-003** *(CRITICAL)*: When delinquent past the grace period, penalty APR (`delinquencyFeeBips`) stacks on top of the base rate. **Test:** trigger delinquency, warp past grace, warp 1 year → assert combined rate accrued. **Status:** ⬜.
- **INT-004** *(CRITICAL)*: Delinquency timer is asymmetric — only decrements while healthy. **Test:** delinquent for X seconds → cure → wait X seconds → `timeDelinquent` ≈ 0. Then resume delinquency → timer accumulates again. **Status:** ⬜.
- **INT-005** *(HIGH)*: `updateState()` is idempotent within a single block (no double-accrual). **Test:** call twice same block → state unchanged second time. **Status:** ⬜.
- **INT-006** *(CRITICAL)*: Scale factor uses RAY (1e27) precision. Rounding always favors the protocol (lender) over the borrower. **Test:** boundary cases — verify rounding direction matches upstream. **Status:** ⬜.
- **INT-007** *(HIGH)*: No interest accrues on closed markets after closure block. **Test:** close → warp → `scaleFactor` unchanged. **Status:** ⬜.
- **INT-008** *(HIGH)*: Penalty APR with our raised `MaximumDelinquencyFeeBips = type(uint16).max`: assert no overflow in `scaleFactor` math at the new boundary. **Test:** set penalty=65535, warp 1 year, → `scaleFactor` must not overflow `uint112`. **Status:** ⬜.
- **INT-009** *(CRITICAL)*: `MaximumLoanTerm = type(uint32).max` with valid `fixedTermEndTime`: assert no integer overflow in any accrual math up to the boundary. **Test:** set term = `block.timestamp + type(uint32).max - 1` → deposit/warp/repay across the full term. **Status:** ⬜.
- **INT-010** *(MEDIUM)*: Interest accrued during a partial year is correctly computed (linear interpolation between accrual points). **Test:** warp 6 months → assert ~half year's interest. **Status:** ⬜.

## CLS — Market closure

- **CLS-001** *(CRITICAL)*: `closeMarket()` is callable only by `borrower` OR by `backupCloser` (when set). **Test:** stranger call reverts `CallerNotBorrowerOrBackupCloser`. **Status:** ✅ `test_closeMarket_revertsForStrangerEvenWhenBackupSet`.
- **CLS-002** *(HIGH)*: `closeMarket()` is callable by the borrower whether or not `backupCloser` is set. **Test:** ✅ `test_closeMarket_byBorrowerStillWorks`. **Status:** ✅.
- **CLS-003** *(HIGH)*: When `backupCloser` is set, that address may also call `closeMarket`. **Test:** ✅ `test_closeMarket_byBackupCloserWhenSet`. **Status:** ✅.
- **CLS-004** *(HIGH)*: Setting `backupCloser` to `address(0)` clears the override; the previous backup can no longer call `closeMarket`. **Test:** ✅ `test_closeMarket_revertsForOldBackupAfterClear`. **Status:** ✅.
- **CLS-005** *(HIGH)*: Setting a new `backupCloser` revokes the old one immediately. **Test:** ✅ `test_closeMarket_revertsForOldBackupAfterRotation`. **Status:** ✅.
- **CLS-006** *(HIGH)*: `setBackupCloser` is `onlyBorrower`; backupCloser cannot rotate itself. **Test:** ✅ `test_setBackupCloser_revertsForNonBorrower`. **Status:** ✅.
- **CLS-007** *(HIGH)*: `setBackupCloser` emits `BackupCloserUpdated(old, new)`. **Test:** ✅ `test_setBackupCloser_byBorrower`. **Status:** ✅.
- **CLS-008** *(CRITICAL)*: `closeMarket()` reverts if any unpaid withdrawal batch exists. **Test:** queue unpaid batch → close → revert `CloseMarketWithUnpaidWithdrawals`. **Status:** ⬜.
- **CLS-009** *(CRITICAL)*: Closure under-collateralized: borrower must transfer the shortfall in the same tx (pull via `safeTransferFrom`). **Test:** debts > assets → close requires allowance → succeeds when set, reverts when not. **Status:** ⬜.
- **CLS-010** *(CRITICAL)*: Closure over-collateralized: excess assets are returned to the borrower. **Test:** assets > debts → close → borrower's asset balance increases by surplus. **Status:** ⬜.
- **CLS-011** *(HIGH)*: After closure, `state.isClosed` is true and APR is zeroed. **Test:** post-close state. **Status:** ⬜.
- **CLS-012** *(HIGH)*: Calling `closeMarket()` on an already-closed market reverts `MarketAlreadyClosed`. **Test:** close twice → revert. **Status:** ⬜.
- **CLS-013** *(CRITICAL)*: `closeMarket` is `nonReentrant`. **Test:** malicious asset reentrant attempt. **Status:** ⬜.
- **CLS-014** *(HIGH)*: `closeMarket` works correctly even when `backupCloser` was rotated mid-flight (current state observed). **Test:** rotate during stale call → no logic glitch. **Status:** 🔍.
- **CLS-015** *(MEDIUM)*: FixedTermHooks: closure before `fixedTermEndTime` requires `allowClosureBeforeTerm=true`. **Test:** flag false → pre-term close → revert. **Status:** ⬜.

## TOK — Market token (ERC-20)

- **TOK-001** *(CRITICAL)*: Market token implements ERC-20: `transfer`, `transferFrom`, `approve`, `balanceOf`, `totalSupply`, `name`, `symbol`, `decimals`. **Test:** standard ERC-20 compliance suite. **Status:** ⬜.
- **TOK-002** *(HIGH)*: `decimals()` matches the underlying asset's decimals (e.g. 6 for USDC). **Test:** assert match. **Status:** ⬜.
- **TOK-003** *(HIGH)*: `balanceOf` returns `scaledBalanceOf × scaleFactor / RAY` (rebasing semantics). **Test:** time warp → balance increases. **Status:** ⬜.
- **TOK-004** *(CRITICAL)*: `transfer` calls `onTransfer` hook before state change; revert on revert. **Test:** mock hook revert → transfer reverts. **Status:** ⬜.
- **TOK-005** *(CRITICAL)*: When `transfersDisabled=true`, all transfers revert (`TransfersDisabled`). **Test:** flag set → transfer → revert. **Status:** ⬜.
- **TOK-006** *(HIGH)*: ERC-2612 permit support (if upstream has it). **Test:** assert presence; if absent, document. **Status:** 🔍.
- **TOK-007** *(HIGH)*: Transfer of zero reverts `NullTransferAmount` (no silent no-op). **Test:** transfer(0) → revert. **Status:** ⬜.
- **TOK-008** *(HIGH)*: Approve of zero/non-zero respects ERC-20 spec; `transferFrom` decrements allowance. **Test:** standard allowance tests. **Status:** ⬜.
- **TOK-009** *(CRITICAL)*: Transfer to address(0) is rejected (no accidental burns). **Test:** transfer to zero → revert. **Status:** ⬜.
- **TOK-010** *(HIGH)*: `scaledBalanceOf` is the canonical user balance for indexing; balance rebases as `scaleFactor` grows. **Test:** scaledBalanceOf stable across time; balanceOf grows. **Status:** ⬜.
- **TOK-011** *(MEDIUM)*: Self-transfer is a no-op (or rejected, per upstream policy). **Test:** transfer to self → assert behavior matches upstream. **Status:** ⬜.
- **TOK-012** *(HIGH)*: Sanctioned `from` or `to` triggers the sentinel escrow path on transfer. **Test:** sanction → transfer → escrow. **Status:** ⬜.

## AUT — Access control

- **AUT-001** *(CRITICAL)*: Every borrower-only function is modified with `onlyBorrower` (or our `onlyBorrowerOrBackupCloser` for `closeMarket` only). **Test:** static enumeration of all external functions; assert modifier present. **Status:** 🔍 + ⬜ (write a script).
- **AUT-002** *(CRITICAL)*: `ArchController` owner-gated functions are modified `onlyOwner`. **Test:** enumeration. **Status:** 🔍.
- **AUT-003** *(CRITICAL)*: `HooksFactory` arch-controller-owner-gated functions (`addHooksTemplate`, `updateHooksTemplateFees`, `disableHooksTemplate`) revert for non-owners. **Test:** non-owner calls each → revert. **Status:** ⬜.
- **AUT-004** *(HIGH)*: `onlyBorrowerOrBackupCloser` is used by `closeMarket` and ONLY `closeMarket` (no over-broad application). **Test:** grep ensures sole call site. **Status:** 🔍.
- **AUT-005** *(HIGH)*: `setBackupCloser` cannot be called by the current `backupCloser` (only the borrower can rotate). **Test:** ✅ implied by `test_setBackupCloser_revertsForNonBorrower`. **Status:** ✅.
- **AUT-006** *(HIGH)*: `rescueTokens` is `onlyBorrower`. **Test:** non-borrower → revert. **Status:** ⬜.
- **AUT-007** *(HIGH)*: `rescueTokens` cannot rescue the underlying asset or the market token itself (`BadRescueAsset`). **Test:** rescue underlying → revert. **Status:** ⬜.
- **AUT-008** *(CRITICAL)*: `nukeFromOrbit` (sentinel-triggered emergency withdraw) is callable only by the sentinel address. **Test:** non-sentinel call → `BadLaunchCode`. **Status:** ⬜.
- **AUT-009** *(MEDIUM)*: Owner-only functions on the ArchController emit consistent events on success. **Test:** ✅ partially via existing tests. **Status:** 🟡.
- **AUT-010** *(HIGH)*: There is no privilege escalation path: ownership of ArchController, borrower role, or feeRecipient cannot be assumed by another address without an explicit transfer call. **Test:** code review + grep for storage writes to `owner` / `borrower`. **Status:** 🔍.

## REE — Reentrancy

- **REE-001** *(CRITICAL)*: Every state-changing external function on the market is `nonReentrant`. **Test:** grep + per-function exploit attempt with a malicious ERC-20. **Status:** ⬜.
- **REE-002** *(CRITICAL)*: `nonReentrant` storage slot is reset to "not entered" after the call (no permanent lockup). **Test:** two sequential calls in independent txs succeed. **Status:** ⬜.
- **REE-003** *(HIGH)*: Read-only reentrancy: view functions called mid-flight return stale state (we don't read post-write within a nonReentrant call). **Test:** mock attacker reads `balanceOf` from inside a transfer hook. **Status:** ⬜.
- **REE-004** *(HIGH)*: `closeMarket` flow does not re-enter via the borrower's `safeTransferFrom` (when pulling shortfall). **Test:** malicious borrower contract attempts reentrant call → reverts. **Status:** ⬜.
- **REE-005** *(CRITICAL)*: Cross-function reentrancy via `transferFrom` → calling `repay` mid-deposit cannot corrupt state. **Test:** crafted scenario. **Status:** ⬜.
- **REE-006** *(HIGH)*: Hook callbacks cannot themselves re-enter the market in a way that bypasses `nonReentrant`. **Test:** malicious hook attempts deposit during `onDeposit`. **Status:** ⬜.

## MTH — Math, overflow, precision

- **MTH-001** *(CRITICAL)*: No arithmetic overflow at integer-type boundaries. **Test:** fuzz at the extremes of `uint16`, `uint32`, `uint112`, `uint128`. **Status:** ⬜.
- **MTH-002** *(CRITICAL)*: Scale factor (uint112) cannot overflow even with our raised penalty cap. Worst case: penalty=65535 bips, base=10000 bips, delinquent for the maximum term. **Test:** compute the worst-case scaleFactor end-value; assert ≤ uint112.max. **Status:** ⬜.
- **MTH-003** *(HIGH)*: Division never rounds in favor of the user against the protocol. **Test:** check `scaleAmount` and `unscaleAmount` rounding directions. **Status:** ⬜.
- **MTH-004** *(HIGH)*: RAY math (`1e27`) precision: small balances (1 wei) survive a round-trip scale→unscale. **Test:** scaledBalance == 1 → balanceOf produces consistent value across time. **Status:** ⬜.
- **MTH-005** *(MEDIUM)*: Bips operations bound their inputs (`0 <= x <= 10000` for non-penalty, `0 <= x <= type(uint16).max` for penalty post-fork). **Test:** boundary inputs accepted. **Status:** ⬜.
- **MTH-006** *(HIGH)*: `MarketState` fields are correctly packed; storage write/read round-trips preserve all fields. **Test:** write known state → read back → assert equal. **Status:** ⬜.
- **MTH-007** *(MEDIUM)*: `timeDelinquent` math: timer increment when delinquent, decrement when healthy, both monotonic within a single block. **Test:** invariant check. **Status:** ⬜.
- **MTH-008** *(HIGH)*: All `safeCast` calls in fee/balance math handle the new wider parameter space (post-fork uncapped values). **Test:** fuzz with penalty in the upper uint16 range. **Status:** ⬜.

## SLO — Storage layout

- **SLO-001** *(CRITICAL)*: Our new `backupCloser` storage slot in `WildcatMarketBase` does not collide with any inherited contract slot. **Test:** `forge inspect WildcatMarket storage-layout` → assert unique slots. **Status:** ⬜.
- **SLO-002** *(CRITICAL)*: The Sphere-X engine storage slot remains at its EIP-1967-derived address (we didn't relocate it). **Test:** inspect slot, compare to upstream commit. **Status:** ⬜.
- **SLO-003** *(HIGH)*: ArchController's borrower / controller / factory sets occupy non-overlapping storage. **Test:** layout dump. **Status:** ⬜.
- **SLO-004** *(MEDIUM)*: Adding the `backupCloser` slot did not push any existing slot into an unexpected position (no slot ID delta beyond the added one). **Test:** diff upstream vs fork storage layout. **Status:** ⬜.
- **SLO-005** *(LOW)*: Immutable values (factory, asset, borrower, sentinel) are read from bytecode, not storage; no storage cost for them. **Test:** `forge inspect` shows them as immutable. **Status:** ⬜.

## INI — Initialization safety

- **INI-001** *(CRITICAL)*: Each contract is initialized exactly once via its constructor; no re-init path exists. **Test:** look for any "initialize" functions; assert disabled on deployed instances. **Status:** ⬜.
- **INI-002** *(HIGH)*: HooksFactory constructor cannot be called with a zero archController or sentinel. **Test:** zero inputs → revert (or document as caller responsibility). **Status:** ⬜.
- **INI-003** *(HIGH)*: WildcatSanctionsSentinel can be constructed with a zero `chainalysisSanctionsList` (we want this for testnet via NullSanctionsOracle deployment) — assert that NOT explicitly checked at construction. **Test:** construct with NullSanctionsOracle address → succeeds. **Status:** ✅ implicitly via `NullSanctionsOracleWiredToSentinelTest`.
- **INI-004** *(HIGH)*: `archController.sphereXEngine()` returning `address(0)` does not brick market deployment. **Test:** fresh ArchController, no sphereXEngine → deploy market → succeeds; guards no-op. **Status:** ⬜ (deploy script implicitly tests this).
- **INI-005** *(CRITICAL)*: `HooksFactory.registerWithArchController` is idempotent — can be called multiple times without error. **Test:** call twice → second call no-op (or expected revert documented). **Status:** ⬜.

## SAN — Sanctions sentinel

- **SAN-001** *(CRITICAL)*: `NullSanctionsOracle.isSanctioned(addr)` returns `false` for every address including known OFAC addresses. **Test:** ✅ `test_isSanctioned_knownOFACAddresses`. **Status:** ✅.
- **SAN-002** *(CRITICAL)*: A sentinel wired to `NullSanctionsOracle` reports every address as unsanctioned for any borrower. **Test:** ✅ `test_sentinelReportsNoOneSanctioned`. **Status:** ✅.
- **SAN-003** *(HIGH)*: Switching from `NullSanctionsOracle` to a real Chainalysis oracle requires deploying a new sentinel (immutable `chainalysisSanctionsList` cannot change). **Test:** assert no setter for the oracle address. **Status:** ✅ (immutable enforced by Solidity).
- **SAN-004** *(HIGH)*: `overrideSanction(account)` adds the override under `msg.sender` (per-borrower). **Test:** prank as borrower → override → assert mapping. **Status:** ⬜.
- **SAN-005** *(HIGH)*: `removeSanctionOverride` clears the override; subsequent `isSanctioned` query reflects the underlying oracle. **Test:** override → remove → query. **Status:** ⬜.
- **SAN-006** *(CRITICAL)*: Escrow address is deterministic — `getEscrowAddress(borrower, account, asset)` returns the predicted CREATE2 address before deploy. **Test:** predict → trigger deploy via sanction → addresses match. **Status:** ⬜.
- **SAN-007** *(HIGH)*: `createEscrow` is idempotent — calling twice for the same triple returns the same address. **Test:** call twice → no second deploy. **Status:** ⬜.
- **SAN-008** *(HIGH)*: Escrow contracts are added to the borrower's sanctionOverrides mapping (so they can be transferred back into eventually). **Test:** assert after createEscrow. **Status:** ⬜.
- **SAN-009** *(CRITICAL)*: When the oracle is replaced (via new sentinel deployment + ArchController update), previously-running markets must continue using the OLD sentinel. **Test:** deploy market → swap sentinel → market's sentinel still references the old one. **Status:** ⬜.
- **SAN-010** *(HIGH)*: NullSanctionsOracle is a pure-view contract — no state, no events. **Test:** static check; gas test (call cost minimal). **Status:** ⬜.

## SPX — Sphere-X integration

- **SPX-001** *(HIGH)*: Sphere-X engine starts at `address(0)` on our deployments; guards are no-ops. **Test:** deploy ArchController → `sphereXEngine() == address(0)`. **Status:** ⬜.
- **SPX-002** *(HIGH)*: `sphereXGuardExternal` modifier on `closeMarket` (and others) succeeds when engine is zero. **Test:** close market without sphere-x configured → succeeds. **Status:** ⬜.
- **SPX-003** *(MEDIUM)*: ArchController owner can set the sphereXEngine later via the upstream path. **Test:** owner call → engine updated → events emitted. **Status:** ⬜.
- **SPX-004** *(MEDIUM)*: When sphereXEngine is set non-zero, it is consulted on every guarded call; protocol behavior is unchanged for "allowed" patterns. **Test:** mock engine that allows everything → flows continue. **Status:** ⬜.
- **SPX-005** *(HIGH)*: Sphere-X cannot be used to lock the protocol against the borrower (worst-case ArchController owner abuse). **Test:** 🔍 review-only; document upgrade path. **Status:** 🔍.

## ARC — Arch controller registry

- **ARC-001** *(HIGH)*: Sets backing borrowers, controllers, controller factories, markets are accurate after every register/remove call. **Test:** mixed sequence of ops → assert sizes and membership. **Status:** ✅ partially via upstream tests.
- **ARC-002** *(HIGH)*: `getRegisteredBorrowers(start, end)` paginates correctly with both admin-added and self-added entries. **Test:** add 100 mixed → page through. **Status:** ⬜.
- **ARC-003** *(HIGH)*: `isRegisteredBorrower(removed)` returns false after `removeBorrower`. **Test:** ✅ upstream test. **Status:** ✅.
- **ARC-004** *(MEDIUM)*: `getRegisteredMarketsCount` matches `getRegisteredMarkets().length`. **Test:** consistency check. **Status:** ⬜.
- **ARC-005** *(MEDIUM)*: Blacklist functions (`addBlacklist`, `removeBlacklist`) function correctly post-fork. **Test:** ✅ upstream test. **Status:** ✅.
- **ARC-006** *(HIGH)*: Updating sphereXEngine on registered contracts iterates without skipping; failures bubble. **Test:** owner calls → all registered contracts see new engine. **Status:** ⬜.

## EVT — Event emission

- **EVT-001** *(HIGH)*: Every state-changing function emits at least one event. **Test:** static enumeration. **Status:** 🔍.
- **EVT-002** *(HIGH)*: Indexed parameters are appropriate (address fields indexed). **Test:** signature parsing. **Status:** 🔍.
- **EVT-003** *(MEDIUM)*: Our new `BackupCloserUpdated` event signature is stable and indexed. **Test:** ✅ `test_setBackupCloser_byBorrower` uses `vm.expectEmit`. **Status:** ✅.
- **EVT-004** *(MEDIUM)*: Subgraph-relevant events match upstream's signature hash (so the upstream subgraph fork picks them up). **Test:** topic[0] keccak matches expected. **Status:** ⬜.
- **EVT-005** *(MEDIUM)*: No event emitted for a no-op or reverted action. **Test:** revert paths → no events captured. **Status:** ⬜.

## ERR — Error semantics

- **ERR-001** *(HIGH)*: All public revert paths use custom errors (not strings). **Test:** static check. **Status:** 🔍.
- **ERR-002** *(HIGH)*: Our new errors (`CallerNotBorrowerOrBackupCloser`) have unique 4-byte selectors. **Test:** decode selector. **Status:** ⬜.
- **ERR-003** *(MEDIUM)*: Selector for `NotApprovedBorrower` (0x02171e6a) is preserved post-fork. **Test:** keccak of `NotApprovedBorrower()` truncated. **Status:** ⬜.
- **ERR-004** *(MEDIUM)*: Reverts are accompanied by descriptive error names (no anonymous reverts). **Test:** static enumeration. **Status:** 🔍.

## AST — Asset compatibility

- **AST-001** *(HIGH)*: Markets work correctly with USDC (6 decimals, standard ERC-20). **Test:** mock USDC end-to-end lifecycle. **Status:** ⬜.
- **AST-002** *(CRITICAL)*: Fee-on-transfer tokens are unsupported and will produce incorrect accounting; document this and add a runtime guard if cheap. **Test:** mock FoT token → assert mismatch detection (or document). **Status:** 🔍.
- **AST-003** *(CRITICAL)*: Rebasing underlying tokens are unsupported. **Test:** mock rebasing token → assert known mis-accounting OR rejected. **Status:** 🔍.
- **AST-004** *(HIGH)*: 18-decimal tokens work end-to-end. **Test:** mock DAI-like → lifecycle. **Status:** ⬜.
- **AST-005** *(HIGH)*: Tokens with non-standard return values (e.g. USDT's no-return-bool) handled by `SafeERC20`/`SafeTransferLib`. **Test:** mock USDT-like → lifecycle. **Status:** ⬜.
- **AST-006** *(MEDIUM)*: Tokens with permit (EIP-2612) function via the integrated path (if upstream supports). **Test:** permit + deposit. **Status:** 🔍.
- **AST-007** *(LOW)*: Assets with extreme decimals (>18 or 0) are documented either supported or rejected. **Test:** edge case mock. **Status:** ⬜.

## DPL — Deployment

- **DPL-001** *(CRITICAL)*: `DeployBase.s.sol` deploys all 7 contracts (NullSanctionsOracle, ArchController, Sentinel, WildcatMarket init-code storage, HooksFactory, OpenTermHooks template, FixedTermHooks template) in one tx batch. **Test:** ✅ verified against anvil with `FOUNDRY_PROFILE=ir`. **Status:** ✅.
- **DPL-002** *(CRITICAL)*: Deploy must use `FOUNDRY_PROFILE=ir` to compile WildcatMarket under EIP-170's 24,576-byte limit. **Test:** default-profile deploy produces oversized warning + would fail on real chain. **Status:** ✅ documented in script header.
- **DPL-003** *(HIGH)*: Deploy script registers HooksFactory as a controllerFactory on ArchController. **Test:** post-deploy `isRegisteredControllerFactory(factory) == true`. **Status:** ⬜.
- **DPL-004** *(HIGH)*: Deploy script registers both hooks templates with zero origination fee + zero protocol fee. **Test:** read template details post-deploy → all fees zero. **Status:** ⬜.
- **DPL-005** *(HIGH)*: Deploy script writes `deployments/<chain>.json` with all addresses + chain id + deployer + timestamp. **Test:** ✅ run produced the file. **Status:** ✅.
- **DPL-006** *(MEDIUM)*: Contract bytecode hash post-deploy matches what we'd verify on the block explorer (no metadata salt drift). **Test:** `forge inspect` bytecode + compare. **Status:** ⬜.
- **DPL-007** *(HIGH)*: Deploy is idempotent enough that re-running produces a fresh set of contracts (no stomping on prior addresses). **Test:** run twice → two distinct sets. **Status:** ⬜.
- **DPL-008** *(MEDIUM)*: Deploy from a fresh deployer key (no prior nonce) produces deterministic CREATE addresses given fixed nonces. **Test:** simulate twice with same nonce → same addresses. **Status:** 🔍.
- **DPL-009** *(HIGH)*: All deployed contracts can be verified on Basescan/Etherscan with the same Solidity 0.8.25 + ir profile + 50_000 optimizer runs. **Test:** verify each post-deploy (when we run live). **Status:** ⬜.

## MCH — Multi-chain parity

- **MCH-001** *(HIGH)*: Deploy script generalizes via `block.chainid` and outputs an appropriately named JSON file. **Test:** ✅ `_chainSlug` covers Base Sepolia, Base mainnet, Sepolia, Mainnet, Arbitrum {Sepolia, mainnet}. **Status:** ✅.
- **MCH-002** *(HIGH)*: On chains where Chainalysis exists, deploy script wires the real oracle instead of `NullSanctionsOracle`. **Test:** add a chain-conditional in script + test logic. **Status:** ⬜ (script currently always uses Null; needs upgrade for mainnet).
- **MCH-003** *(HIGH)*: Protocol behavior is identical across chains except for the sentinel oracle choice. **Test:** lifecycle test on Sepolia anvil vs Base Sepolia anvil. **Status:** ⬜.
- **MCH-004** *(MEDIUM)*: Address pre-computation (CREATE2 salts) does not assume a specific chain id. **Test:** run on chain id 84532, 8453, 1, 11155111 → behavior consistent. **Status:** ⬜.
- **MCH-005** *(MEDIUM)*: Gas costs are within acceptable bounds on each target chain. **Test:** measure gas for canonical operations on each chain. **Status:** ⬜.

## SBN — sellbonds.now patches

The full list of intentional deltas from upstream. Each should have a specific test proving the change took effect.

- **SBN-001** *(CRITICAL)*: `registerSelf()` exists on ArchController and is permissionless. **Test:** ✅ `test_registerSelf_NoOwnerCheck`. **Status:** ✅.
- **SBN-002** *(HIGH)*: Upstream `registerBorrower(address)` admin path is preserved. **Test:** ✅ `test_registerSelf_CoexistsWithAdminPath`. **Status:** ✅.
- **SBN-003** *(CRITICAL)*: `MaximumDelinquencyFeeBips == type(uint16).max`. **Test:** ✅ `test_getParameterConstraints` (FixedTerm, OpenTerm, MarketLens). **Status:** ✅.
- **SBN-004** *(CRITICAL)*: `MaximumLoanTerm == type(uint32).max`. **Test:** ✅ `test_onCreateMarket_LongTermsAllowed`. **Status:** ✅.
- **SBN-005** *(CRITICAL)*: `backupCloser` exists, defaults to zero, and gates `closeMarket` when set. **Test:** ✅ full `BackupCloserTest` suite. **Status:** ✅.
- **SBN-006** *(CRITICAL)*: `NullSanctionsOracle` exists and is wired to the sentinel by default on Base Sepolia. **Test:** ✅ `NullSanctionsOracleTest`. **Status:** ✅.
- **SBN-007** *(HIGH)*: Origination fees default to zero at deploy. **Test:** ✅ deploy script + post-deploy read. **Status:** ✅ (script-level).
- **SBN-008** *(HIGH)*: Both `OpenTermHooks` and `FixedTermHooks` templates are registered on the factory at deploy. **Test:** post-deploy enumerate templates → both present. **Status:** ⬜.
- **SBN-009** *(MEDIUM)*: `src/sellbondsnow/` directory contains only our additions; upstream `src/` paths are minimally modified. **Test:** diff vs upstream. **Status:** ✅ by construction.
- **SBN-010** *(MEDIUM)*: `test/sellbondsnow/` directory contains only our additions. **Test:** as above. **Status:** ✅.
- **SBN-011** *(HIGH)*: `UPSTREAM.md` records the upstream commit hash and license caveat. **Test:** file exists with required fields. **Status:** ✅.
- **SBN-012** *(HIGH)*: The Apache 2.0 + Commons Clause license file is preserved verbatim. **Test:** `diff LICENSE.md` against upstream. **Status:** ✅.

## UPS — Upstream invariants preserved

Things we did NOT change. Failure here = we broke the protocol's audited foundation.

- **UPS-001** *(CRITICAL)*: All upstream Foundry tests pass (modulo our explicit updates for new constant values). **Test:** ✅ 837/837 passing excluding deprecated `testFail_*`. **Status:** ✅.
- **UPS-002** *(CRITICAL)*: `WildcatMarket.borrow` semantics unchanged. **Test:** upstream `test_borrow*` tests pass. **Status:** ✅.
- **UPS-003** *(CRITICAL)*: `WildcatMarket.repay` semantics unchanged. **Test:** upstream `test_repay*` tests. **Status:** ✅.
- **UPS-004** *(CRITICAL)*: Scale factor math unchanged. **Test:** upstream interest accrual tests. **Status:** ✅.
- **UPS-005** *(CRITICAL)*: Withdrawal batch processing FIFO order unchanged. **Test:** upstream batch tests. **Status:** ✅.
- **UPS-006** *(CRITICAL)*: Delinquency timer asymmetry unchanged. **Test:** upstream delinquency tests. **Status:** ✅.
- **UPS-007** *(HIGH)*: Hook callback signatures unchanged. **Test:** ABI introspection. **Status:** ✅ by construction.
- **UPS-008** *(HIGH)*: Sphere-X integration patterns unchanged outside of our explicit modifications. **Test:** diff vs upstream. **Status:** ✅.
- **UPS-009** *(HIGH)*: Storage layout of pre-existing structs (MarketState, Account, WithdrawalBatch) unchanged. **Test:** layout dump diff. **Status:** ⬜.
- **UPS-010** *(HIGH)*: Sanctions sentinel escrow CREATE2 salt derivation unchanged. **Test:** salt derivation matches upstream. **Status:** ✅ by construction.

## ADV — Adversarial scenarios

Belt-and-suspenders adversary enumeration. Many of these are review-only or partially testable.

### Random griefers

- **ADV-001** *(MEDIUM)*: Spamming `registerSelf()` with thousands of EOAs does not denial-of-service the ArchController (each call is bounded gas). **Test:** loop 1000 prank-addresses → gas linear in N, no global storage cliff. **Status:** ⬜.
- **ADV-002** *(MEDIUM)*: Spamming market deployments with the same borrower hits `BorrowerAlreadyDeployed` (or similar) for repeats. **Test:** N deploys → no resource amplification. **Status:** ⬜.
- **ADV-003** *(LOW)*: Sending dust to a market address pre-deployment does not affect deploy (CREATE2 ignores pre-funding). **Test:** transfer wei to predicted addr → deploy → no change. **Status:** ⬜.
- **ADV-004** *(MEDIUM)*: Donating tokens to a market does not credit a lender. **Test:** direct ERC-20 transfer to market → no balance update for sender. **Status:** ⬜.
- **ADV-005** *(MEDIUM)*: Calling `repay` with a tiny dust amount does not cause accounting drift. **Test:** repeat repay(1) → state stable. **Status:** ⬜.

### MEV / sandwich attackers

- **ADV-006** *(HIGH)*: A searcher cannot frontrun a lender's deposit to extract value (deposit is at a known rate; no slippage parameter exposed to MEV). **Test:** simulate ordering → outcome identical. **Status:** ⬜.
- **ADV-007** *(HIGH)*: Setting `annualInterestBips` via the upstream config setter does not allow sandwiching (rate is point-in-time). **Test:** rate change tx ordering. **Status:** ⬜.
- **ADV-008** *(MEDIUM)*: A backrunner cannot atomically deposit then withdraw to extract accrued interest without time passing. **Test:** deposit + immediate withdraw in same block → no profit. **Status:** ⬜.
- **ADV-009** *(HIGH)*: Sandwich on `closeMarket` cannot drain the surplus (only borrower receives surplus). **Test:** sandwich attempt → surplus only to borrower. **Status:** ⬜.
- **ADV-010** *(MEDIUM)*: Searchers cannot manipulate the `scaleFactor` mid-block. **Test:** updateState called multiple times same block → idempotent. **Status:** ⬜.

### Reentrancy attackers

- **ADV-011** *(CRITICAL)*: Malicious ERC-20 reentering during `deposit` cannot mint extra balance. **Test:** ERC-20 mock with `_beforeTransfer` reentrant call → revert. **Status:** ⬜.
- **ADV-012** *(CRITICAL)*: Malicious ERC-20 reentering during `repay` cannot zero out debt without paying. **Test:** as above. **Status:** ⬜.
- **ADV-013** *(CRITICAL)*: Malicious ERC-20 during `closeMarket`'s `safeTransferFrom` (pulling shortfall) cannot re-enter and close-without-paying. **Test:** crafted. **Status:** ⬜.
- **ADV-014** *(HIGH)*: Read-only reentrancy via `balanceOf` during a hook call returns stale state but cannot exploit it (no external consumer in-flow). **Test:** mock hook reads → no profit path. **Status:** 🔍.

### Frontrunners / replay

- **ADV-015** *(HIGH)*: Two borrowers cannot front-run each other into the same CREATE2 address (salt is per-borrower). **Test:** different borrowers → different addrs. **Status:** ⬜.
- **ADV-016** *(MEDIUM)*: `registerSelf()` race between two contracts trying to register at the same address: only the first succeeds. **Test:** deploy-time CREATE collision → impossible by EVM rules. **Status:** 🔍.
- **ADV-017** *(HIGH)*: Cross-chain replay of a deploy transaction is impossible because contracts reference `block.chainid`-bound state (or document if not). **Test:** review. **Status:** 🔍.

### Spam / DoS

- **ADV-018** *(MEDIUM)*: A borrower deploying many markets does not block other borrowers. **Test:** N deploys by one → other borrowers' deploys unaffected. **Status:** ⬜.
- **ADV-019** *(HIGH)*: A market with many lenders does not have unbounded gas costs in `closeMarket` or `repayAndProcessUnpaidWithdrawalBatches`. **Test:** N lenders, measure gas → linear bounded. **Status:** ⬜.
- **ADV-020** *(HIGH)*: A lender queuing many tiny withdrawals does not corrupt batch processing. **Test:** N queueWithdrawal(1) → batch still processes. **Status:** ⬜.
- **ADV-021** *(MEDIUM)*: The `_hooksTemplates` array on HooksFactory cannot be spammed past a reasonable size (only owner can add). **Test:** non-owner add → revert; owner adds bounded. **Status:** ✅ access-controlled.

### Cross-protocol adversaries (composability)

- **ADV-022** *(HIGH)*: A lending pool that integrates our market token as collateral cannot exploit the rebasing semantics (we expose both `balanceOf` and `scaledBalanceOf`). **Test:** mock external lending integrator → behaves correctly. **Status:** 🔍.
- **ADV-023** *(HIGH)*: A flash-loan-based attempt to deposit + withdraw in same block cannot extract value. **Test:** ✅ implied by ADV-008. **Status:** ⬜.
- **ADV-024** *(HIGH)*: An external protocol holding market tokens cannot cause our market to behave inconsistently when its balance rebases. **Test:** simulate scaleFactor growth → external balanceOf grows; transfer still possible. **Status:** ⬜.
- **ADV-025** *(MEDIUM)*: Self-referential markets (a market whose `asset()` is another sellbonds market's token) — document support or rejection. **Test:** deploy with bond-token-as-asset → behavior. **Status:** ⬜.

### Adversarial AI agents

- **ADV-026** *(MEDIUM)*: An agent that floods the registry with junk entries doesn't degrade the ArchController. **Test:** ✅ ADV-001. **Status:** ⬜.
- **ADV-027** *(HIGH)*: An agent deploying a market and immediately abandoning it (no borrow, never repays) leaves a zombie market that lenders can still cleanly recover from via withdrawal queue + delinquency mechanics. **Test:** deploy → no activity → lender deposits + queues withdrawal → eventually receives funds (or assets are escrowed). **Status:** ⬜.
- **ADV-028** *(MEDIUM)*: Two agents racing to deploy markets with the same parameters do not produce ambiguous state (each gets a unique address). **Test:** two prank-borrowers race → two distinct markets. **Status:** ⬜.
- **ADV-029** *(MEDIUM)*: An agent gaining temporary access to another agent's wallet cannot drain markets faster than `closeMarket` allows (rate of damage bounded by tx cost). **Test:** review. **Status:** 🔍.
- **ADV-030** *(HIGH)*: An agent issuing a bond with `delinquencyFeeBips=type(uint16).max` (the new max) and an extreme term does not break the protocol; lenders simply pay attention or refuse to deposit. **Test:** deploy at max values → flows still execute (deposit, repay, close) without overflow. **Status:** ⬜ (cross-references INT-008, INT-009).

### Oracle manipulation

- **ADV-031** *(HIGH)*: Chainalysis oracle returning malformed data (e.g. always-revert) does not brick the market — transactions revert with the oracle's error. Document failure mode. **Test:** mock oracle that reverts → deposit reverts. **Status:** ⬜.
- **ADV-032** *(HIGH)*: A compromised Chainalysis oracle returning `true` for all addresses would route all transfers to escrow, but cannot extract value (escrow is per-address). **Test:** mock that flags everyone → asset balances safe in per-address escrows. **Status:** ⬜.
- **ADV-033** *(MEDIUM)*: NullSanctionsOracle cannot be upgraded to a malicious implementation post-deploy (no proxy). **Test:** assert no upgrade hook. **Status:** ✅ by construction.

### Sanctioned address abuse

- **ADV-034** *(HIGH)*: An attacker who gets themselves flagged then receives a transfer into our market cannot abuse the escrow flow to extract or freeze value. **Test:** sanctioned recipient receiving transfer → escrowed, no fund loss. **Status:** ⬜.
- **ADV-035** *(MEDIUM)*: Borrower's sanction override applies only to that borrower's market(s). **Test:** override by Borrower A does not affect Borrower B's market. **Status:** ⬜.

### State-level / regulatory

- **ADV-036** *(LOW)*: A regulator-mandated forced upgrade is not possible — contracts are non-upgradeable. **Test:** ✅ by construction (no proxy). **Status:** ✅.
- **ADV-037** *(LOW)*: A state-coerced disabling of the protocol can only happen via the ArchController owner blacklist/template-disable functions; nothing else gates a deployed market's operation. **Test:** review owner powers. **Status:** 🔍.
- **ADV-038** *(MEDIUM)*: ArchController owner cannot drain funds from any deployed market. **Test:** owner-only enumeration → no function with asset.transfer to owner. **Status:** ⬜.

### Social engineering

- **ADV-039** *(HIGH)*: A compromised `backupCloser` can close (settle) a market against the borrower's wishes, but cannot redirect funds elsewhere (closure surplus goes to borrower, shortfall pulled from borrower). **Test:** ✅ ADV → review `closeMarket` body: surplus → borrower, shortfall → borrower. **Status:** ⬜.
- **ADV-040** *(MEDIUM)*: An agent that grants `backupCloser` to an EOA they don't actually control loses the safety guarantee but not funds. **Test:** review. **Status:** 🔍.
- **ADV-041** *(MEDIUM)*: A phished borrower key cannot be revoked by the protocol; the borrower must rotate via market closure + redeployment. **Test:** review. **Status:** 🔍.

### Storage / proxy attacks

- **ADV-042** *(CRITICAL)*: There are no proxies in our deployed contracts (no delegatecall-based upgrade vector). **Test:** ✅ by construction. **Status:** ✅.
- **ADV-043** *(HIGH)*: The market init-code storage contract's runtime code cannot be polluted post-deploy (it's a regular SELFDESTRUCT-able contract? — verify). **Test:** check for any selfdestruct in init-code or stored contracts. **Status:** ⬜.
- **ADV-044** *(MEDIUM)*: CREATE2 salt collisions across borrowers are impossible because salt includes the borrower address. **Test:** review salt derivation. **Status:** ⬜.

### Init-code replay / abuse

- **ADV-045** *(MEDIUM)*: The market init-code storage contract is only used by the HooksFactory; no other party can use it to deploy markets. **Test:** anyone can call create2 with the same init code, but they'd produce a market not registered on ArchController and not callable as a registered market. **Status:** 🔍 (document this is acceptable).

### Signature / permit attacks

- **ADV-046** *(HIGH)*: If permit is used, malleable signatures cannot replay-deposit. **Test:** EIP-2098 / EIP-712 standard checks. **Status:** 🔍.
- **ADV-047** *(MEDIUM)*: Domain separator / chain id is bound to the deploying chain. **Test:** assert eip-712 domain. **Status:** 🔍.

## OPS — Operational / recovery

- **OPS-001** *(HIGH)*: A market with a lost borrower key + zero backupCloser is unrecoverable. Document this as a known operational risk. **Test:** ✅ implied by absence of recovery path; documented in `setBackupCloser` comment. **Status:** ✅ documented.
- **OPS-002** *(HIGH)*: Switching from `NullSanctionsOracle` to a real oracle on a chain that gains Chainalysis support requires: (a) deploy new oracle, (b) deploy new sentinel pointing at it, (c) for new markets, accept the new sentinel. Old markets remain on the old sentinel. **Test:** review documented procedure. **Status:** 🔍 (need to write a runbook).
- **OPS-003** *(HIGH)*: ArchController ownership transfer follows standard `Ownable` semantics (two-step? one-step? — document). **Test:** transferOwnership flow. **Status:** ⬜.
- **OPS-004** *(MEDIUM)*: There is a documented procedure for the case where Sphere-X engine is needed mid-flight (deploy engine → owner sets → engine propagates). **Test:** runbook + dry run. **Status:** ⬜.
- **OPS-005** *(MEDIUM)*: Deploy script can be re-run safely if a prior run was partially successful; `getOrDeploy` semantics in upstream LibDeployment can be ported if needed. **Test:** simulate partial run. **Status:** ⬜.
- **OPS-006** *(LOW)*: A "frozen" market (delinquent forever, no one engages) can be removed from the ArchController registry by the owner without affecting the market's on-chain state. **Test:** owner removeMarket → market still callable directly. **Status:** ⬜.
- **OPS-007** *(HIGH)*: Backup closer should typically be a multisig (e.g. Gnosis Safe). Document the recommended configuration and provide example. **Test:** review docs. **Status:** ⬜.

## TST — Test coverage requirements

These are meta-requirements about how we test, not what we test.

- **TST-001** *(HIGH)*: All borrower-facing functions have at least one happy-path test. **Test:** enumerate `onlyBorrower` functions → confirm each has ≥1 test. **Status:** 🔍.
- **TST-002** *(HIGH)*: All `onlyBorrower` functions have at least one negative test (non-borrower revert). **Test:** as above. **Status:** 🔍.
- **TST-003** *(HIGH)*: All custom errors have at least one test that triggers them. **Test:** static enumeration of `error` declarations vs `vm.expectRevert` usage. **Status:** 🔍.
- **TST-004** *(HIGH)*: Fuzz tests with ≥256 runs for math-heavy functions (`scaleAmount`, `updateState`, withdrawal batch math). **Test:** assert fuzz_runs profile. **Status:** ⬜.
- **TST-005** *(MEDIUM)*: Invariant tests exist for: scaleFactor monotonicity, scaledTotalSupply conservation across non-mint/burn ops, no negative balances. **Test:** confirm invariant test files exist and run. **Status:** ⬜.
- **TST-006** *(HIGH)*: E2E lifecycle test: registerSelf → deployMarket → deposit → borrow → repay → withdraw → close. **Test:** new integration test file. **Status:** ⬜ (task #12).
- **TST-007** *(MEDIUM)*: Each fork-added contract (`NullSanctionsOracle`) has dedicated tests. **Test:** ✅ `test/sellbondsnow/NullSanctionsOracle.t.sol`. **Status:** ✅.
- **TST-008** *(MEDIUM)*: Each modified upstream test has a comment explaining the modification. **Test:** grep "sellbonds.now fork" in modified test files. **Status:** ✅ (comments added in this session).
- **TST-009** *(HIGH)*: Code coverage on `src/sellbondsnow/` is 100%. **Test:** `forge coverage --match-path "test/sellbondsnow/*"`. **Status:** ⬜.
- **TST-010** *(MEDIUM)*: Gas snapshots exist for canonical operations and are committed; large unexpected deltas fail CI. **Test:** `forge snapshot` baseline file. **Status:** ⬜.
- **TST-011** *(LOW)*: Test files mirror src structure: `src/X/Y.sol` → `test/X/Y.t.sol`. **Test:** path correspondence. **Status:** ✅ for our additions.
- **TST-012** *(HIGH)*: There is a CI step that runs the full test suite (excluding upstream `testFail_*` deprecations) and fails on any new red. **Test:** CI config (when set up). **Status:** ⬜.

---

## Status legend & summary

| Symbol | Meaning |
|---|---|
| ✅ | Implemented and verified by test |
| 🟡 | Partially implemented |
| ⬜ | Not yet implemented |
| 🔍 | Review-only (no on-chain test feasible) |

**Status snapshot (2026-05-27):**

| Category | Total | ✅ | 🟡 | ⬜ | 🔍 |
|---|---|---|---|---|---|
| BOR | 16 | 4 | 0 | 10 | 2 |
| LEN | 13 | 0 | 0 | 13 | 0 |
| MD  | 17 | 2 | 0 | 15 | 0 |
| DEP | 12 | 0 | 0 | 12 | 0 |
| BWR |  9 | 0 | 0 |  9 | 0 |
| WDR | 11 | 0 | 0 | 11 | 0 |
| RPY |  9 | 0 | 0 |  9 | 0 |
| INT | 10 | 0 | 0 | 10 | 0 |
| CLS | 15 | 7 | 0 |  7 | 1 |
| TOK | 12 | 0 | 0 | 11 | 1 |
| AUT | 10 | 1 | 1 |  4 | 4 |
| REE |  6 | 0 | 0 |  6 | 0 |
| MTH |  8 | 0 | 0 |  8 | 0 |
| SLO |  5 | 0 | 0 |  5 | 0 |
| INI |  5 | 1 | 0 |  4 | 0 |
| SAN | 10 | 3 | 0 |  7 | 0 |
| SPX |  5 | 0 | 0 |  4 | 1 |
| ARC |  6 | 2 | 0 |  4 | 0 |
| EVT |  5 | 1 | 0 |  2 | 2 |
| ERR |  4 | 0 | 0 |  2 | 2 |
| AST |  7 | 0 | 0 |  4 | 3 |
| DPL |  9 | 3 | 0 |  6 | 0 |
| MCH |  5 | 1 | 0 |  4 | 0 |
| SBN | 12 |10 | 0 |  2 | 0 |
| UPS | 10 | 9 | 0 |  1 | 0 |
| ADV | 47 | 3 | 0 | 32 |12 |
| OPS |  7 | 2 | 0 |  4 | 1 |
| TST | 12 | 3 | 0 |  9 | 0 |
| **Total** | **306** | **52** | **1** | **220** | **33** |

~17% covered by current tests; remaining 83% is the to-do list for hardening before mainnet.

---

## How to use this doc

- **Before adding a new feature**: cross-check against the matching category — does the new code introduce a requirement not listed here? If yes, append it.
- **Before each release**: scan the ⬜ list for the categories the release touches; either close them with tests or explicitly defer.
- **Before mainnet deploy**: every CRITICAL must be ✅ or have a written exception. Every HIGH must be ✅ or 🔍 with reviewer sign-off.
- **When a test fails**: the failing test should map to a specific requirement here; if not, either the requirement is missing or the test is testing the wrong thing.
- **When upstream Wildcat ships a fix**: re-run UPS-001 against the latest mainnet branch; merge their fix if a CRITICAL or HIGH was affected.

---

## Open questions / TODO for next iteration

1. **Asset compatibility deep-dive**: AST section is light. Once we pick the actual USDC contract on Base Sepolia, write a `mockBaseSepoliaUSDC.t.sol` that uses the real bytecode.
2. **Storage layout dump**: SLO-001/002 need an actual `forge inspect` baseline committed so we can diff future changes against it.
3. **Coverage CI**: TST-009 needs `forge coverage` wired into CI with a threshold.
4. **Audit handoff**: when we engage an auditor, this doc becomes the input to their scope. Reformat at that time per their preferred conventions.
5. **Sphere-X production posture**: SPX-005 needs a clear decision before mainnet — do we wire a real engine, run without, or remove the integration entirely?
6. **Wildcat license conversation**: out of scope here, but blocking mainnet. Should be tracked in a separate ops doc.
