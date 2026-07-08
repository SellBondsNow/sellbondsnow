// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.20;

import { Test } from 'forge-std/Test.sol';
import { NullSanctionsOracle } from 'src/sellbondsnow/NullSanctionsOracle.sol';
import { WildcatSanctionsSentinel } from 'src/WildcatSanctionsSentinel.sol';

contract NullSanctionsOracleTest is Test {
  NullSanctionsOracle internal oracle;

  function setUp() public {
    oracle = new NullSanctionsOracle();
  }

  function test_isSanctioned_zeroAddress() public view {
    assertFalse(oracle.isSanctioned(address(0)));
  }

  function test_isSanctioned_arbitraryAddress(address addr) public view {
    // No address is ever flagged. This is the entire contract.
    assertFalse(oracle.isSanctioned(addr));
  }

  function test_isSanctioned_knownOFACAddresses() public view {
    // These are real OFAC-sanctioned addresses (Tornado Cash deployments and
    // similar) that the real Chainalysis oracle returns true for. The null
    // oracle returns false even for these. This is the intended posture for
    // chains where Chainalysis doesn't exist; switch oracles for production.
    assertFalse(oracle.isSanctioned(0x8589427373D6D84E98730D7795D8f6f8731FDA16));
    assertFalse(oracle.isSanctioned(0x722122dF12D4e14e13Ac3b6895a86e84145b6967));
    assertFalse(oracle.isSanctioned(0xDD4c48C0B24039969fC16D1cdF626eaB821d3384));
  }
}

contract NullSanctionsOracleWiredToSentinelTest is Test {
  NullSanctionsOracle internal oracle;
  WildcatSanctionsSentinel internal sentinel;
  address internal archController = address(0xA1C);

  function setUp() public {
    oracle = new NullSanctionsOracle();
    sentinel = new WildcatSanctionsSentinel(archController, address(oracle));
  }

  function test_sentinelWiredCorrectly() public view {
    assertEq(sentinel.chainalysisSanctionsList(), address(oracle));
  }

  function test_sentinelReportsNoOneSanctioned(address borrower, address account) public view {
    // When wired to the null oracle, the sentinel reports every address as
    // unsanctioned regardless of borrower override status. This is the
    // expected behaviour on Base Sepolia and any chain without Chainalysis.
    assertFalse(sentinel.isSanctioned(borrower, account));
    assertFalse(sentinel.isFlaggedByChainalysis(account));
  }
}
