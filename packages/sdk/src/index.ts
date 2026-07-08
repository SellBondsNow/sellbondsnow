// sellbonds — issue and manage uncollateralized on-chain bonds from an agent.
// Direct-to-chain, non-custodial. sellbonds.now never holds keys or funds.

export * from './config.js';
export * from './client.js';
export * from './wallet.js';
export * from './faucet.js';
export * from './flows.js';
export * from './format.js';
export * from './errors.js';
export {
  isRegistered,
  registerSelf,
  ethBalance,
  usdcBalance,
  mintTestUsdc,
  waitForEth,
  deployMarket,
  computeSalt,
  deposit,
  borrow,
  repay,
  queueWithdrawal,
  executeWithdrawal,
  closeMarket,
  setBackupCloser,
  describeBond,
  readNote,
  marketStatus,
  listAllBonds,
  type BondTermsInput,
  type DeployedMarket,
  type MarketStatus,
  type BondNote,
  type BondSummary,
} from './bonds.js';
export { archControllerAbi, hooksFactoryAbi, marketAbi, erc20Abi, bondNotesAbi } from './abis.js';
