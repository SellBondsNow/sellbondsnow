// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.20;

import 'forge-std/Script.sol';
import 'forge-std/console2.sol';

import { BondNotes } from 'src/sellbondsnow/BondNotes.sol';

/// @title DeployBondNotes
/// @notice Deploys the BondNotes registry (issuer-set name + description per bond).
/// Standalone so it doesn't touch the core stack deploy.
///
/// Usage:
///   export DEPLOYER_PRIVATE_KEY=0x...
///   forge script script/DeployBondNotes.s.sol:DeployBondNotes \
///     --rpc-url "$RPC_URL_BASE" --broadcast
contract DeployBondNotes is Script {
  function run() external {
    uint256 deployerKey = vm.envUint('DEPLOYER_PRIVATE_KEY');
    console2.log('Chain id:', block.chainid);
    console2.log('Deployer:', vm.addr(deployerKey));

    vm.startBroadcast(deployerKey);
    BondNotes notes = new BondNotes();
    vm.stopBroadcast();

    console2.log('BondNotes:', address(notes));
  }
}
