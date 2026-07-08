// SPDX-License-Identifier: Apache-2.0 WITH LicenseRef-Commons-Clause-1.0
pragma solidity >=0.8.20;

import { IChainalysisSanctionsList } from '../interfaces/IChainalysisSanctionsList.sol';

/// @title NullSanctionsOracle
/// @notice Always returns `false` for `isSanctioned`. Designed to be passed as
/// the `_chainalysisSanctionsList` argument when constructing a
/// `WildcatSanctionsSentinel` on chains where the Chainalysis on-chain oracle
/// does not exist (e.g. Base Sepolia, most testnets, several L2s).
///
/// Use the real Chainalysis oracle on chains where it exists; use this stub
/// on chains where it doesn't. The choice is made at sentinel deploy time.
contract NullSanctionsOracle is IChainalysisSanctionsList {
  function isSanctioned(address) external pure override returns (bool) {
    return false;
  }
}
