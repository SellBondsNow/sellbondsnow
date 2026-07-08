// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.20;

/// @title MockUSDC
/// @notice A freely-mintable, 6-decimal ERC-20 used as the default bond asset on
/// sellbonds.now TESTNET deployments (Base Sepolia and other test chains).
///
/// This exists so that AI agents can run the full bond lifecycle — deploy a
/// market, deposit, borrow, repay — without having to source real testnet USDC
/// from a third-party faucet. `mint` is intentionally permissionless: anyone can
/// mint any amount to any address. That is acceptable (and desirable) for a
/// testnet asset whose only purpose is exercising the protocol.
///
/// DO NOT deploy this on a mainnet. On mainnet, markets use the canonical Circle
/// USDC at its real address; the sellbonds.now deploy script wires that instead.
contract MockUSDC {
  string public constant name = 'USD Coin (sellbonds.now testnet)';
  string public constant symbol = 'USDC';
  uint8 public constant decimals = 6;

  /// @notice Default amount handed out by {drip}: 1,000,000 USDC (6 decimals).
  uint256 public constant DRIP_AMOUNT = 1_000_000e6;

  uint256 public totalSupply;
  mapping(address => uint256) public balanceOf;
  mapping(address => mapping(address => uint256)) public allowance;

  event Transfer(address indexed from, address indexed to, uint256 value);
  event Approval(address indexed owner, address indexed spender, uint256 value);

  error InsufficientBalance();
  error InsufficientAllowance();
  error MainnetDeploymentForbidden();

  /// @notice Hard guard: this permissionless-mint token must never exist on a
  /// value-bearing mainnet. Reverts deployment on known mainnet chain ids. The
  /// deploy script also gates this (it wires canonical USDC on mainnets), but the
  /// guard makes a mistake impossible at the contract level.
  constructor() {
    uint256 id = block.chainid;
    if (id == 1 || id == 8453 || id == 42161 || id == 10 || id == 137 || id == 56 || id == 43114) {
      revert MainnetDeploymentForbidden();
    }
  }

  /// @notice Mint `amount` test USDC to `to`. Permissionless (testnet only).
  function mint(address to, uint256 amount) external {
    _mint(to, amount);
  }

  /// @notice Mint the default {DRIP_AMOUNT} of test USDC to the caller.
  function drip() external {
    _mint(msg.sender, DRIP_AMOUNT);
  }

  function _mint(address to, uint256 amount) internal {
    totalSupply += amount;
    unchecked {
      balanceOf[to] += amount;
    }
    emit Transfer(address(0), to, amount);
  }

  function approve(address spender, uint256 amount) external returns (bool) {
    allowance[msg.sender][spender] = amount;
    emit Approval(msg.sender, spender, amount);
    return true;
  }

  function transfer(address to, uint256 amount) external returns (bool) {
    _transfer(msg.sender, to, amount);
    return true;
  }

  function transferFrom(address from, address to, uint256 amount) external returns (bool) {
    uint256 allowed = allowance[from][msg.sender];
    if (allowed != type(uint256).max) {
      if (allowed < amount) revert InsufficientAllowance();
      unchecked {
        allowance[from][msg.sender] = allowed - amount;
      }
    }
    _transfer(from, to, amount);
    return true;
  }

  function _transfer(address from, address to, uint256 amount) internal {
    uint256 bal = balanceOf[from];
    if (bal < amount) revert InsufficientBalance();
    unchecked {
      balanceOf[from] = bal - amount;
      balanceOf[to] += amount;
    }
    emit Transfer(from, to, amount);
  }
}
