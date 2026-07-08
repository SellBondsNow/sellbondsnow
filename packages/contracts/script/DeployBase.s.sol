// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.20;

import 'forge-std/Script.sol';
import 'forge-std/console2.sol';
import 'solady/utils/LibString.sol';

import { WildcatArchController } from 'src/WildcatArchController.sol';
import { WildcatSanctionsSentinel } from 'src/WildcatSanctionsSentinel.sol';
import { HooksFactory } from 'src/HooksFactory.sol';
import { WildcatMarket } from 'src/market/WildcatMarket.sol';
import { OpenTermHooks } from 'src/access/OpenTermHooks.sol';
import { FixedTermHooks } from 'src/access/FixedTermHooks.sol';
import { LibStoredInitCode } from 'src/libraries/LibStoredInitCode.sol';

import { NullSanctionsOracle } from 'src/sellbondsnow/NullSanctionsOracle.sol';
import { MockUSDC } from 'src/sellbondsnow/MockUSDC.sol';

/// @title DeployBase
/// @notice One-shot deployment of the sellbonds.now Wildcat fork to Base mainnet
/// (chain id 8453), Base Sepolia (84532), or any other EVM chain. The script is
/// chain-aware: on mainnets it wires canonical Circle USDC and on testnets it
/// deploys a freely-mintable MockUSDC, and it names the output file after the chain.
///
/// REQUIRES the `ir` profile (`via-ir = true`, 50_000 optimizer runs) or the
/// WildcatMarket creation bytecode exceeds EIP-170's 24,576-byte limit and
/// every real chain will reject the deploy. Anvil silently accepts oversized
/// contracts, so a default-profile run looks like it works but won't.
///
/// Usage (mainnet):
///   export DEPLOYER_PRIVATE_KEY=0x...
///   export RPC_URL_BASE=https://mainnet.base.org   # RPC_URL_BASE_SEPOLIA for testnet
///   export FOUNDRY_PROFILE=ir
///   forge script script/DeployBase.s.sol:DeployBase \
///     --rpc-url $RPC_URL_BASE --broadcast --verify
///
/// Deploys, in order:
///   1. NullSanctionsOracle               (no Chainalysis oracle wired — screening
///                                          is a no-op on every chain; see MCH-002)
///   2. WildcatArchController             (permissionless via registerSelf)
///   3. WildcatSanctionsSentinel          (wired to the null oracle)
///   4. WildcatMarket init-code storage   (template that HooksFactory clones)
///   5. HooksFactory                      (registered as controller factory on ArchController)
///   6. OpenTermHooks template            (registered on factory, zero fees)
///   7. FixedTermHooks template           (registered on factory, zero fees)
///
/// Writes the resulting addresses to deployments/<chain>.json.
contract DeployBase is Script {
  using LibString for address;
  using LibString for uint256;

  // Output file path is chain-aware; e.g. base-sepolia.json, sepolia.json.
  string internal constant DeploymentsDir = 'deployments';

  struct Deployment {
    address deployer;
    address nullOracle;
    address archController;
    address sentinel;
    address marketInitCodeStorage;
    address hooksFactory;
    address openTermTemplate;
    address fixedTermTemplate;
    address testUsdc;
  }

  function run() external {
    uint256 deployerKey = vm.envUint('DEPLOYER_PRIVATE_KEY');
    address deployer = vm.addr(deployerKey);

    console2.log('Chain id:    ', block.chainid);
    console2.log('Deployer:    ', deployer);
    console2.log('Balance:     ', deployer.balance);

    vm.startBroadcast(deployerKey);

    // 1. Null sanctions oracle. Always returns false. Pluggable; replace with
    //    a Chainalysis-backed implementation on chains where that exists.
    NullSanctionsOracle nullOracle = new NullSanctionsOracle();
    console2.log('NullSanctionsOracle:        ', address(nullOracle));

    // 2. Arch controller. Sphere-X engine starts at address(0); guards no-op.
    WildcatArchController archController = new WildcatArchController();
    console2.log('WildcatArchController:      ', address(archController));

    // 3. Sentinel wired to the null oracle.
    WildcatSanctionsSentinel sentinel = new WildcatSanctionsSentinel(
      address(archController),
      address(nullOracle)
    );
    console2.log('WildcatSanctionsSentinel:   ', address(sentinel));

    // 4. Store the WildcatMarket creation code as a contract whose runtime
    //    bytecode IS that creation code, so HooksFactory can CREATE2 clone it.
    bytes memory marketInitCode = type(WildcatMarket).creationCode;
    address marketInitCodeStorage = LibStoredInitCode.deployInitCode(marketInitCode);
    uint256 marketInitCodeHash = uint256(keccak256(marketInitCode));
    console2.log('WildcatMarket initcode store:', marketInitCodeStorage);

    // 5. HooksFactory. Must be registered as a controller factory + controller
    //    on the ArchController so that markets it deploys are recognised.
    HooksFactory hooksFactory = new HooksFactory(
      address(archController),
      address(sentinel),
      marketInitCodeStorage,
      marketInitCodeHash
    );
    console2.log('HooksFactory:               ', address(hooksFactory));

    archController.registerControllerFactory(address(hooksFactory));
    hooksFactory.registerWithArchController();

    // 6 & 7. Hooks templates. The template is itself a deployed contract whose
    //        runtime code is the hook's creation code (so the factory can
    //        extcodecopy it when borrowers spin up new hook instances).
    address openTermTemplate = LibStoredInitCode.deployInitCode(
      type(OpenTermHooks).creationCode
    );
    address fixedTermTemplate = LibStoredInitCode.deployInitCode(
      type(FixedTermHooks).creationCode
    );
    console2.log('OpenTermHooks template:     ', openTermTemplate);
    console2.log('FixedTermHooks template:    ', fixedTermTemplate);

    // Zero fees per the v1 decision: agents can issue free of charge. The fee
    // lever is preserved in case we want to enable it later via config.
    hooksFactory.addHooksTemplate(
      openTermTemplate,
      'OpenTermHooks',
      address(0), // feeRecipient
      address(0), // originationFeeAsset
      0, // originationFeeAmount
      0 // protocolFeeBips
    );
    hooksFactory.addHooksTemplate(
      fixedTermTemplate,
      'FixedTermHooks',
      address(0),
      address(0),
      0,
      0
    );

    // 8. Default bond asset. On testnet chains we deploy a freely-mintable
    //    MockUSDC so agents can run the full lifecycle with no third-party
    //    faucet. On mainnets we point at the canonical Circle USDC instead.
    address testUsdc = _canonicalUsdc(block.chainid);
    if (testUsdc == address(0)) {
      testUsdc = address(new MockUSDC());
      console2.log('MockUSDC (test asset):      ', testUsdc);
    } else {
      console2.log('Canonical USDC (mainnet):   ', testUsdc);
    }

    vm.stopBroadcast();

    _writeDeploymentsJson(
      Deployment({
        deployer: deployer,
        nullOracle: address(nullOracle),
        archController: address(archController),
        sentinel: address(sentinel),
        marketInitCodeStorage: marketInitCodeStorage,
        hooksFactory: address(hooksFactory),
        openTermTemplate: openTermTemplate,
        fixedTermTemplate: fixedTermTemplate,
        testUsdc: testUsdc
      })
    );
  }

  /// @dev Canonical Circle USDC per mainnet chain id; address(0) means "this is a
  ///      testnet, deploy a MockUSDC instead".
  function _canonicalUsdc(uint256 chainId) internal pure returns (address) {
    if (chainId == 8453) return 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913; // Base
    if (chainId == 1) return 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48; // Ethereum
    if (chainId == 42161) return 0xaf88d065e77c8cC2239327C5EDb3A432268e5831; // Arbitrum One
    return address(0);
  }

  function _writeDeploymentsJson(Deployment memory d) internal {
    string memory filename = string.concat(_chainSlug(block.chainid), '.json');
    string memory outPath = string.concat(DeploymentsDir, '/', filename);

    string memory json = string.concat(
      '{\n  "chainId": ',
      block.chainid.toString(),
      ',\n  "chain": "',
      _chainSlug(block.chainid),
      '",\n  "deployer": "',
      d.deployer.toHexString(),
      '",\n  "deployedAt": ',
      block.timestamp.toString(),
      ',\n  "contracts": {'
    );
    json = string.concat(
      json,
      '\n    "NullSanctionsOracle": "',
      d.nullOracle.toHexString(),
      '",\n    "WildcatArchController": "',
      d.archController.toHexString(),
      '",\n    "WildcatSanctionsSentinel": "',
      d.sentinel.toHexString(),
      '",'
    );
    json = string.concat(
      json,
      '\n    "WildcatMarketInitCodeStorage": "',
      d.marketInitCodeStorage.toHexString(),
      '",\n    "HooksFactory": "',
      d.hooksFactory.toHexString(),
      '",\n    "OpenTermHooksTemplate": "',
      d.openTermTemplate.toHexString(),
      '",\n    "FixedTermHooksTemplate": "',
      d.fixedTermTemplate.toHexString(),
      '",\n    "TestUSDC": "',
      d.testUsdc.toHexString(),
      '"\n  }\n}\n'
    );

    vm.writeFile(outPath, json);
    console2.log('Wrote', outPath);
  }

  function _chainSlug(uint256 chainId) internal pure returns (string memory) {
    if (chainId == 84532) return 'base-sepolia';
    if (chainId == 8453) return 'base';
    if (chainId == 11155111) return 'sepolia';
    if (chainId == 1) return 'mainnet';
    if (chainId == 421614) return 'arbitrum-sepolia';
    if (chainId == 42161) return 'arbitrum';
    return string.concat('chain-', chainId.toString());
  }
}
