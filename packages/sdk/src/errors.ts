import { BaseError, ContractFunctionRevertedError } from 'viem';

// Friendly explanations for the fork's custom revert errors. Maps error name ->
// what it means and what the agent should do about it.
const ERROR_HELP: Record<string, string> = {
  BorrowerAlreadyExists: 'This wallet is already registered as an issuer. You can skip `register` and deploy markets directly.',
  NotApprovedBorrower: 'This wallet is not registered as an issuer yet. Run `sbn register` first.',
  HooksTemplateNotFound: 'The hooks template address is wrong for this network. Check the deployment addresses.',
  SaltDoesNotContainSender: 'The market salt must start with your address. This is an SDK bug — please report it.',
  MarketAlreadyExists: 'A market already exists for that salt. Retry — the SDK will pick a fresh salt.',
  AssetBlacklisted: 'The chosen asset is blacklisted on this deployment.',
  FeeMismatch: 'Origination fee args do not match the template (templates are zero-fee; pass 0).',
  DepositToClosedMarket: 'This market is closed; deposits are no longer accepted.',
  MaxSupplyExceeded: 'Deposit would exceed the market cap (maxTotalSupply). Deposit less or use a market with a higher cap.',
  NullMintAmount: 'Deposit too small — it scales to zero market tokens. Deposit a larger amount.',
  AccountBlocked: 'This address is flagged by the sanctions sentinel and cannot transact.',
  BorrowAmountTooHigh: 'Borrow exceeds available liquidity (assets minus required reserves and pending withdrawals).',
  BorrowFromClosedMarket: 'This market is closed; borrowing is no longer possible.',
  BorrowWhileSanctioned: 'The borrower address is flagged by the sanctions sentinel.',
  NullRepayAmount: 'Repay amount is zero.',
  RepayToClosedMarket: 'This market is closed; use the closure flow instead of repay.',
  CloseMarketWithUnpaidWithdrawals: 'Cannot close: there are unpaid withdrawal batches. Repay enough to cover them first.',
  WithdrawalBatchNotExpired: 'The withdrawal batch has not expired yet. Wait until the batch expiry before claiming.',
  NullWithdrawalAmount: 'Nothing claimable for this account/batch right now.',
  NullBurnAmount: 'Withdrawal amount scales to zero — you may have no balance in this market.',
  CallerNotBorrowerOrBackupCloser: 'Only the issuer (borrower) or the configured backup closer can close this market.',
};

/**
 * Turn a viem/contract error into a concise, agent-readable message. Surfaces
 * the custom revert name plus guidance when we recognise it.
 */
export function explainError(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? revert.reason ?? 'revert';
      const help = ERROR_HELP[name];
      return help ? `${name}: ${help}` : `Reverted: ${name}`;
    }
    return err.shortMessage || err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export class SbnError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'SbnError';
  }
}
