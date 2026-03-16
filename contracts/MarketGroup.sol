// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import "./interfaces/IMarketGroup.sol";
import "./interfaces/IOpaqueMarket.sol";

/// @title MarketGroup - Multi-Outcome Market Coordinator
/// @notice Lightweight coordinator for multi-outcome prediction markets (e.g. elections).
///         Each outcome maps to an OpaqueMarket. Resolving the group resolves all sub-markets:
///         the winner gets resolve(true), all losers get resolve(false).
/// @dev Does NOT inherit ZamaEthereumConfig — no FHE ops needed, saves massive gas.
///      MarketGroup acts as the resolver for all sub-markets.
contract MarketGroup is IMarketGroup {
    // ═══════════════════════════════════════
    // CUSTOM ERRORS
    // ═══════════════════════════════════════

    error OnlyOwner();
    error AlreadyResolved();
    error InvalidIndex();
    error NoOutcomes();
    error ZeroAddress();

    struct Outcome {
        string label;
        address market;
    }

    string public question;
    string public category;
    address public owner;
    bool public resolved;
    uint256 public winningIndex;
    Outcome[] public outcomes;

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(string memory _question, string memory _category) {
        question = _question;
        category = _category;
        owner = msg.sender;
    }

    /// @notice Add an outcome (label + associated OpaqueMarket address)
    /// @dev Only callable before resolution. Sub-market should have resolver = address(this).
    function addOutcome(string calldata label, address market) external onlyOwner {
        if (resolved) revert AlreadyResolved();
        if (market == address(0)) revert ZeroAddress();

        outcomes.push(Outcome(label, market));
        emit OutcomeAdded(outcomes.length - 1, label, market);
    }

    /// @notice Resolve the group: winner market gets resolve(true), all losers get resolve(false)
    /// @param winnerIndex Index into the outcomes array
    function resolveGroup(uint256 winnerIndex) external onlyOwner {
        if (resolved) revert AlreadyResolved();
        if (outcomes.length == 0) revert NoOutcomes();
        if (winnerIndex >= outcomes.length) revert InvalidIndex();

        resolved = true;
        winningIndex = winnerIndex;

        // Resolve all sub-markets
        for (uint256 i = 0; i < outcomes.length; i++) {
            IOpaqueMarket(outcomes[i].market).resolve(i == winnerIndex);
        }

        emit GroupResolved(winnerIndex, outcomes[winnerIndex].label);
    }

    // ═══════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════

    function outcomeCount() external view returns (uint256) {
        return outcomes.length;
    }

    function getGroupInfo()
        external
        view
        returns (
            string memory _question,
            uint256 _outcomeCount,
            bool _resolved,
            uint256 _winningIndex,
            string memory _category
        )
    {
        return (question, outcomes.length, resolved, winningIndex, category);
    }

    function getOutcome(uint256 index) external view returns (string memory label, address market) {
        if (index >= outcomes.length) revert InvalidIndex();
        Outcome storage o = outcomes[index];
        return (o.label, o.market);
    }
}
