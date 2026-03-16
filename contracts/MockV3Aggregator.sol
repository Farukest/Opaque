// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

/// @title MockV3Aggregator - Mock Chainlink V3 Aggregator for testing OracleResolver
/// @dev Implements latestRoundData() returning configurable price and timestamp
contract MockV3Aggregator {
    uint8 public decimals;
    int256 public latestAnswer;
    uint256 public latestTimestamp;
    uint80 public latestRound;

    constructor(uint8 _decimals, int256 _initialAnswer) {
        decimals = _decimals;
        latestAnswer = _initialAnswer;
        latestTimestamp = block.timestamp;
        latestRound = 1;
    }

    function updateAnswer(int256 _answer) external {
        latestAnswer = _answer;
        latestTimestamp = block.timestamp;
        latestRound++;
    }

    function updateRoundData(uint80 _roundId, int256 _answer, uint256 _timestamp, uint256 /* _startedAt */) external {
        latestRound = _roundId;
        latestAnswer = _answer;
        latestTimestamp = _timestamp;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (latestRound, latestAnswer, latestTimestamp, latestTimestamp, latestRound);
    }
}
