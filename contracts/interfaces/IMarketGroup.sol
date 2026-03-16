// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

interface IMarketGroup {
    // ═══════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════

    event OutcomeAdded(uint256 indexed index, string label, address market);
    event GroupResolved(uint256 winningIndex, string winningLabel);

    // ═══════════════════════════════════════
    // MUTATIONS
    // ═══════════════════════════════════════

    function addOutcome(string calldata label, address market) external;
    function resolveGroup(uint256 winnerIndex) external;

    // ═══════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════

    function question() external view returns (string memory);
    function category() external view returns (string memory);
    function outcomeCount() external view returns (uint256);
    function resolved() external view returns (bool);
    function winningIndex() external view returns (uint256);

    function getGroupInfo()
        external
        view
        returns (
            string memory _question,
            uint256 _outcomeCount,
            bool _resolved,
            uint256 _winningIndex,
            string memory _category
        );

    function getOutcome(uint256 index) external view returns (string memory label, address market);
}
