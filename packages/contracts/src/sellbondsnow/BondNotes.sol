// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.20;

/// @title BondNotes
/// @notice A permissionless on-chain registry of human-readable notes (a short
/// name + a longer description) for sellbonds.now bond markets.
///
/// A bond market is a Wildcat-fork contract whose on-chain token name is just
/// `prefix + asset.name()` — so there's nowhere on the market itself to record
/// *what the bond is for*. This contract lets the issuer attach that context
/// on-chain, keeping sellbonds.now fully direct-to-chain (no server stores it).
///
/// {describe} is intentionally permissionless: anyone can write a note for any
/// market. That's safe because consumers (e.g. the sellbonds.now dashboard) must
/// only trust a note whose `author` equals the market's actual issuer — its
/// `borrower()`. A forged note from a non-issuer is simply ignored at read time.
contract BondNotes {
  struct Note {
    string name; // short label, e.g. "Atlas Compute"
    string description; // what the bond funds / how it's repaid
    address author; // who set it — verify == market.borrower() before trusting
    uint40 updatedAt; // block timestamp of the last update
  }

  /// @notice Latest note per market. Auto-getter returns
  /// (name, description, author, updatedAt).
  mapping(address => Note) public notes;

  event BondDescribed(
    address indexed market,
    address indexed author,
    string name,
    string description,
    uint256 timestamp
  );

  /// @notice Attach (or overwrite) the note for `market`. Permissionless by design;
  /// read-side code must check `author` against the market's issuer.
  function describe(
    address market,
    string calldata name,
    string calldata description
  ) external {
    notes[market] = Note(name, description, msg.sender, uint40(block.timestamp));
    emit BondDescribed(market, msg.sender, name, description, block.timestamp);
  }
}
