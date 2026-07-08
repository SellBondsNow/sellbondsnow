// Minimal ABIs for the sellbonds.now Wildcat fork. Only the functions, events
// and errors the SDK actually calls are included — verified against the forked
// sources in packages/contracts/src.

export const archControllerAbi = [
  { type: 'function', name: 'registerSelf', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    name: 'isRegisteredBorrower',
    inputs: [{ name: 'borrower', type: 'address' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getRegisteredMarkets',
    inputs: [],
    outputs: [{ type: 'address[]' }],
    stateMutability: 'view',
  },
  { type: 'event', name: 'BorrowerAdded', inputs: [{ name: 'borrower', type: 'address', indexed: true }] },
  { type: 'error', name: 'BorrowerAlreadyExists', inputs: [] },
] as const;

// DeployMarketInputs tuple — field order must match
// src/interfaces/WildcatStructsAndEnums.sol exactly.
const deployMarketInputs = {
  name: 'parameters',
  type: 'tuple',
  components: [
    { name: 'asset', type: 'address' },
    { name: 'namePrefix', type: 'string' },
    { name: 'symbolPrefix', type: 'string' },
    { name: 'maxTotalSupply', type: 'uint128' },
    { name: 'annualInterestBips', type: 'uint16' },
    { name: 'delinquencyFeeBips', type: 'uint16' },
    { name: 'withdrawalBatchDuration', type: 'uint32' },
    { name: 'reserveRatioBips', type: 'uint16' },
    { name: 'delinquencyGracePeriod', type: 'uint32' },
    { name: 'hooks', type: 'uint256' },
  ],
} as const;

export const hooksFactoryAbi = [
  {
    type: 'function',
    name: 'deployMarketAndHooks',
    inputs: [
      { name: 'hooksTemplate', type: 'address' },
      { name: 'hooksTemplateArgs', type: 'bytes' },
      deployMarketInputs,
      { name: 'hooksData', type: 'bytes' },
      { name: 'salt', type: 'bytes32' },
      { name: 'originationFeeAsset', type: 'address' },
      { name: 'originationFeeAmount', type: 'uint256' },
    ],
    outputs: [
      { name: 'market', type: 'address' },
      { name: 'hooksInstance', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'computeMarketAddress',
    inputs: [{ name: 'salt', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'MarketDeployed',
    inputs: [
      { name: 'hooksTemplate', type: 'address', indexed: true },
      { name: 'market', type: 'address', indexed: true },
      { name: 'name', type: 'string', indexed: false },
      { name: 'symbol', type: 'string', indexed: false },
      { name: 'asset', type: 'address', indexed: false },
      { name: 'maxTotalSupply', type: 'uint256', indexed: false },
      { name: 'annualInterestBips', type: 'uint256', indexed: false },
      { name: 'delinquencyFeeBips', type: 'uint256', indexed: false },
      { name: 'withdrawalBatchDuration', type: 'uint256', indexed: false },
      { name: 'reserveRatioBips', type: 'uint256', indexed: false },
      { name: 'delinquencyGracePeriod', type: 'uint256', indexed: false },
      { name: 'hooks', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const marketAbi = [
  // --- writes ---
  { type: 'function', name: 'deposit', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'depositUpTo', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'borrow', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'repay', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    name: 'repayAndProcessUnpaidWithdrawalBatches',
    inputs: [
      { name: 'repayAmount', type: 'uint256' },
      { name: 'maxBatches', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  { type: 'function', name: 'queueWithdrawal', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [{ name: 'expiry', type: 'uint32' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'queueFullWithdrawal', inputs: [], outputs: [{ name: 'expiry', type: 'uint32' }], stateMutability: 'nonpayable' },
  {
    type: 'function',
    name: 'executeWithdrawal',
    inputs: [
      { name: 'accountAddress', type: 'address' },
      { name: 'expiry', type: 'uint32' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  { type: 'function', name: 'closeMarket', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'setBackupCloser', inputs: [{ name: 'newBackupCloser', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'updateState', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  // --- reads ---
  { type: 'function', name: 'asset', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'name', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'symbol', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' },
  { type: 'function', name: 'borrower', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'scaledBalanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'totalSupply', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'totalAssets', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'borrowableAssets', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'coverageLiquidity', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'maximumDeposit', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'annualInterestBips', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'reserveRatioBips', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'isClosed', inputs: [], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'getUnpaidBatchExpiries', inputs: [], outputs: [{ type: 'uint32[]' }], stateMutability: 'view' },
  {
    type: 'function',
    name: 'getAvailableWithdrawalAmount',
    inputs: [
      { name: 'accountAddress', type: 'address' },
      { name: 'expiry', type: 'uint32' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  // --- events ---
  { type: 'event', name: 'Deposit', inputs: [{ name: 'account', type: 'address', indexed: true }, { name: 'assetAmount', type: 'uint256', indexed: false }, { name: 'scaledAmount', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'Borrow', inputs: [{ name: 'assetAmount', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'DebtRepaid', inputs: [{ name: 'from', type: 'address', indexed: true }, { name: 'assetAmount', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'WithdrawalQueued', inputs: [{ name: 'expiry', type: 'uint32', indexed: true }, { name: 'account', type: 'address', indexed: true }, { name: 'scaledAmount', type: 'uint256', indexed: false }, { name: 'normalizedAmount', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'MarketClosed', inputs: [{ name: 'timestamp', type: 'uint256', indexed: false }] },
] as const;

// Standard ERC-20 plus the test-USDC mint/drip helpers.
export const erc20Abi = [
  { type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'allowance', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' },
  { type: 'function', name: 'symbol', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  // test-USDC only (permissionless mint on testnet)
  { type: 'function', name: 'mint', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'drip', inputs: [], outputs: [], stateMutability: 'nonpayable' },
] as const;

// BondNotes registry — issuer-set name + description per bond market.
export const bondNotesAbi = [
  { type: 'function', name: 'describe', inputs: [{ name: 'market', type: 'address' }, { name: 'name', type: 'string' }, { name: 'description', type: 'string' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'notes', inputs: [{ name: 'market', type: 'address' }], outputs: [{ name: 'name', type: 'string' }, { name: 'description', type: 'string' }, { name: 'author', type: 'address' }, { name: 'updatedAt', type: 'uint40' }], stateMutability: 'view' },
] as const;
