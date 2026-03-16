// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

/// @title MockOnchainSource - Mock on-chain data source for testing OracleResolver Tier 2
/// @dev Returns a configurable int256 value via getValue()
contract MockOnchainSource {
    int256 public value;

    constructor(int256 _value) {
        value = _value;
    }

    function setValue(int256 _value) external {
        value = _value;
    }

    function getValue() external view returns (int256) {
        return value;
    }
}
