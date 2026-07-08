// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.20;

import '../BaseMarketTest.sol';
import 'src/interfaces/IMarketEventsAndErrors.sol';

contract BackupCloserTest is BaseMarketTest {
  address internal constant BACKUP = address(0xB4C);
  address internal constant STRANGER = address(0x57A);

  // ---- setBackupCloser ----

  function test_backupCloser_defaultsToZero() external view {
    assertEq(market.backupCloser(), address(0));
  }

  function test_setBackupCloser_byBorrower() external asAccount(borrower) {
    vm.expectEmit(address(market));
    emit BackupCloserUpdated(address(0), BACKUP);
    market.setBackupCloser(BACKUP);
    assertEq(market.backupCloser(), BACKUP);
  }

  function test_setBackupCloser_revertsForNonBorrower() external {
    vm.expectRevert(IMarketEventsAndErrors.NotApprovedBorrower.selector);
    vm.prank(STRANGER);
    market.setBackupCloser(BACKUP);
  }

  function test_setBackupCloser_canBeCleared() external asAccount(borrower) {
    market.setBackupCloser(BACKUP);
    assertEq(market.backupCloser(), BACKUP);

    vm.expectEmit(address(market));
    emit BackupCloserUpdated(BACKUP, address(0));
    market.setBackupCloser(address(0));
    assertEq(market.backupCloser(), address(0));
  }

  function test_setBackupCloser_canBeRotated() external asAccount(borrower) {
    address backupA = address(0xB4CA);
    address backupB = address(0xB4CB);

    market.setBackupCloser(backupA);
    assertEq(market.backupCloser(), backupA);

    vm.expectEmit(address(market));
    emit BackupCloserUpdated(backupA, backupB);
    market.setBackupCloser(backupB);
    assertEq(market.backupCloser(), backupB);
  }

  // ---- closeMarket auth ----

  function test_closeMarket_byBorrowerStillWorks() external asAccount(borrower) {
    // Baseline: existing behaviour preserved.
    market.closeMarket();
  }

  function test_closeMarket_byBackupCloserWhenSet() external {
    vm.prank(borrower);
    market.setBackupCloser(BACKUP);

    // Backup can now close.
    vm.prank(BACKUP);
    market.closeMarket();
  }

  function test_closeMarket_revertsForStrangerEvenWhenBackupSet() external {
    vm.prank(borrower);
    market.setBackupCloser(BACKUP);

    vm.expectRevert(IMarketEventsAndErrors.CallerNotBorrowerOrBackupCloser.selector);
    vm.prank(STRANGER);
    market.closeMarket();
  }

  function test_closeMarket_revertsForOldBackupAfterClear() external {
    vm.prank(borrower);
    market.setBackupCloser(BACKUP);
    vm.prank(borrower);
    market.setBackupCloser(address(0));

    vm.expectRevert(IMarketEventsAndErrors.CallerNotBorrowerOrBackupCloser.selector);
    vm.prank(BACKUP);
    market.closeMarket();
  }

  function test_closeMarket_revertsForOldBackupAfterRotation() external {
    address newBackup = address(0xB4CB);
    vm.prank(borrower);
    market.setBackupCloser(BACKUP);
    vm.prank(borrower);
    market.setBackupCloser(newBackup);

    vm.expectRevert(IMarketEventsAndErrors.CallerNotBorrowerOrBackupCloser.selector);
    vm.prank(BACKUP);
    market.closeMarket();

    // The new backup works.
    vm.prank(newBackup);
    market.closeMarket();
  }
}
