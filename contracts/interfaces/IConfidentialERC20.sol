// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import "@fhevm/solidity/lib/FHE.sol";

/// @title IConfidentialERC20 - Interface for Confidential ERC-20 Tokens
/// @notice Defines the encrypted transfer methods used by OpaqueMarket and MarketFactory.
///         On testnet: implemented by ConfidentialUSDT. On mainnet: by real cUSDT (ERC-7984).
interface IConfidentialERC20 {
    function transferEncrypted(address to, euint64 amount) external returns (ebool);
    function transferFromChecked(address from, address to, euint64 amount) external returns (euint64);
    function transferFrom(address from, address to, euint64 amount) external returns (ebool);
    function balanceOf(address account) external view returns (euint64);
    function approve(address spender, externalEuint64 amount, bytes calldata inputProof) external;
    function approvePlaintext(address spender, uint64 amount) external;
    function allowancePlaintext(address owner, address spender) external view returns (uint64);
    function mint(address to, uint256 amount) external;
    function transfer(address to, externalEuint64 encryptedAmount, bytes calldata inputProof) external returns (ebool);
}
