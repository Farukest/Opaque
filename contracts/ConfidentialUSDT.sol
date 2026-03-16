// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import "./interfaces/IConfidentialERC20.sol";

/// @title ConfidentialUSDT - Confidential USDT (cUSDT)
/// @notice FHE-encrypted ERC-20 token for the Opaque prediction market.
///         On mainnet, swap with real cUSDT via Zaiffer Protocol (ERC-7984).
contract ConfidentialUSDT is ZamaEthereumConfig, IConfidentialERC20 {
    // ═══════════════════════════════════════
    // CUSTOM ERRORS
    // ═══════════════════════════════════════

    error OnlyOwner();
    error AmountMustBePositive();
    error AmountTooLarge();
    error TransferFromZero();
    error TransferToZero();

    string public constant name = "Confidential USDT";
    string public constant symbol = "cUSDT";
    uint8 public constant decimals = 6;

    // Encrypted balances
    mapping(address => euint64) private _balances;
    // Encrypted allowances: owner => spender => amount
    mapping(address => mapping(address => euint64)) private _allowances;
    // Plaintext allowance tracking for pre-checks (H-4 fix)
    mapping(address => mapping(address => uint64)) private _plaintextAllowances;
    // Track if user has a balance initialized
    mapping(address => bool) private _initialized;

    // Public total supply (plaintext for transparency)
    uint256 public totalSupply;

    address public owner;

    // Events
    event Transfer(address indexed from, address indexed to);
    event Approval(address indexed owner, address indexed spender);
    event Mint(address indexed to, uint256 amount);

    constructor() {
        owner = msg.sender;
    }

    /// @notice Mint tokens to an address (plaintext amount, encrypted internally)
    /// @param to Recipient address
    /// @param amount Amount to mint (plaintext, will be encrypted internally)
    function mint(address to, uint256 amount) external {
        if (msg.sender != owner) revert OnlyOwner();
        if (amount == 0) revert AmountMustBePositive();
        if (amount > type(uint64).max) revert AmountTooLarge();

        euint64 encAmount = FHE.asEuint64(uint64(amount));

        if (!_initialized[to]) {
            _balances[to] = encAmount;
            _initialized[to] = true;
        } else {
            _balances[to] = FHE.add(_balances[to], encAmount);
        }

        FHE.allowThis(_balances[to]);
        FHE.allow(_balances[to], to);

        totalSupply += amount;
        emit Mint(to, amount);
    }

    /// @notice Get encrypted balance (only owner can decrypt via view key)
    function balanceOf(address account) external view returns (euint64) {
        return _balances[account];
    }

    /// @notice Transfer encrypted tokens
    /// @param to Recipient
    /// @param encryptedAmount Encrypted amount to transfer
    /// @param inputProof ZK proof for the encrypted input
    function transfer(address to, externalEuint64 encryptedAmount, bytes calldata inputProof) external returns (ebool) {
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        return _transfer(msg.sender, to, amount);
    }

    /// @notice Transfer with pre-encrypted amount (for contract-to-contract calls)
    function transferEncrypted(address to, euint64 amount) external returns (ebool) {
        return _transfer(msg.sender, to, amount);
    }

    /// @notice Approve spender for encrypted amount
    function approve(address spender, externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        _allowances[msg.sender][spender] = amount;
        FHE.allowThis(_allowances[msg.sender][spender]);
        FHE.allow(_allowances[msg.sender][spender], msg.sender);
        FHE.allow(_allowances[msg.sender][spender], spender);
        emit Approval(msg.sender, spender);
    }

    /// @notice Approve with plaintext amount (convenience helper)
    function approvePlaintext(address spender, uint64 amount) external {
        euint64 encAmount = FHE.asEuint64(amount);
        _allowances[msg.sender][spender] = encAmount;
        _plaintextAllowances[msg.sender][spender] = amount; // H-4 fix: track plaintext for pre-checks
        FHE.allowThis(_allowances[msg.sender][spender]);
        FHE.allow(_allowances[msg.sender][spender], msg.sender);
        FHE.allow(_allowances[msg.sender][spender], spender);
        emit Approval(msg.sender, spender);
    }

    /// @notice Transfer from (for approved spenders)
    function transferFrom(address from, address to, euint64 amount) external returns (ebool) {
        // Check allowance
        euint64 currentAllowance = _allowances[from][msg.sender];
        ebool hasAllowance = FHE.le(amount, currentAllowance);

        // Deduct allowance (0 if not allowed)
        euint64 transferAmount = FHE.select(hasAllowance, amount, FHE.asEuint64(0));
        _allowances[from][msg.sender] = FHE.sub(currentAllowance, transferAmount);
        FHE.allowThis(_allowances[from][msg.sender]);
        FHE.allow(_allowances[from][msg.sender], from);
        FHE.allow(_allowances[from][msg.sender], msg.sender);

        return _transfer(from, to, transferAmount);
    }

    /// @notice TransferFrom that returns actual transferred amount (handles allowance + balance checks)
    /// @dev Use this from contracts that need to know how much was actually transferred.
    ///      Returns 0 if allowance or balance is insufficient (FHE pattern: no revert on encrypted condition).
    function transferFromChecked(
        address from,
        address to,
        euint64 amount
    ) external returns (euint64 actualTransferred) {
        // Check allowance
        euint64 currentAllowance = _allowances[from][msg.sender];
        ebool hasAllowance = FHE.le(amount, currentAllowance);

        // Cap to 0 if no allowance
        euint64 allowedAmount = FHE.select(hasAllowance, amount, FHE.asEuint64(0));
        _allowances[from][msg.sender] = FHE.sub(currentAllowance, allowedAmount);
        FHE.allowThis(_allowances[from][msg.sender]);
        FHE.allow(_allowances[from][msg.sender], from);
        FHE.allow(_allowances[from][msg.sender], msg.sender);

        if (from == address(0)) revert TransferFromZero();
        if (to == address(0)) revert TransferToZero();

        // Initialize recipient if needed
        if (!_initialized[to]) {
            _balances[to] = FHE.asEuint64(0);
            _initialized[to] = true;
            FHE.allowThis(_balances[to]);
            FHE.allow(_balances[to], to);
        }

        // Check sufficient balance
        ebool canTransfer = FHE.le(allowedAmount, _balances[from]);
        actualTransferred = FHE.select(canTransfer, allowedAmount, FHE.asEuint64(0));

        // Update balances
        _balances[from] = FHE.sub(_balances[from], actualTransferred);
        FHE.allowThis(_balances[from]);
        FHE.allow(_balances[from], from);

        _balances[to] = FHE.add(_balances[to], actualTransferred);
        FHE.allowThis(_balances[to]);
        FHE.allow(_balances[to], to);

        // Allow caller (market contract) to use the returned amount
        FHE.allowThis(actualTransferred);
        FHE.allow(actualTransferred, msg.sender);

        emit Transfer(from, to);
        return actualTransferred;
    }

    /// @notice Get encrypted allowance
    function allowance(address owner, address spender) external view returns (euint64) {
        return _allowances[owner][spender];
    }

    /// @notice Get plaintext allowance (only accurate for approvePlaintext approvals)
    /// @dev H-4 fix: enables pre-check in MarketFactory to prevent free market creation
    function allowancePlaintext(address _owner, address spender) external view returns (uint64) {
        return _plaintextAllowances[_owner][spender];
    }

    /// @dev Internal transfer with balance check via FHE.select
    function _transfer(address from, address to, euint64 amount) internal returns (ebool) {
        if (from == address(0)) revert TransferFromZero();
        if (to == address(0)) revert TransferToZero();

        // Initialize recipient if needed
        if (!_initialized[to]) {
            _balances[to] = FHE.asEuint64(0);
            _initialized[to] = true;
            FHE.allowThis(_balances[to]);
            FHE.allow(_balances[to], to);
        }

        // Check sufficient balance
        ebool canTransfer = FHE.le(amount, _balances[from]);
        euint64 transferAmount = FHE.select(canTransfer, amount, FHE.asEuint64(0));

        // Update balances
        _balances[from] = FHE.sub(_balances[from], transferAmount);
        FHE.allowThis(_balances[from]);
        FHE.allow(_balances[from], from);

        _balances[to] = FHE.add(_balances[to], transferAmount);
        FHE.allowThis(_balances[to]);
        FHE.allow(_balances[to], to);

        emit Transfer(from, to);
        return canTransfer;
    }
}
