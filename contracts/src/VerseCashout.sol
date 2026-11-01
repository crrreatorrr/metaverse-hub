// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title VerseCashout
/// @notice Pays out signed Verse vouchers in $BITCOIN at a fixed 1 Verse = 1 whole token.
/// @dev Ownerless and immutable. There is no admin, no pause, no signer rotation and no way to
///      move tokens out except a claim of a valid voucher. The float is refilled with plain
///      ERC-20 transfers. A new signer means a new deployment.
contract VerseCashout is EIP712 {
    using SafeERC20 for IERC20;

    struct Voucher {
        uint256 id;
        address recipient;
        uint256 amount; // whole Verse; paid as amount * unit token base units
        uint256 expiry; // unix seconds; claimable while block.timestamp <= expiry
    }

    bytes32 public constant VOUCHER_TYPEHASH =
        keccak256("Voucher(uint256 id,address recipient,uint256 amount,uint256 expiry)");

    /// @notice Largest batch accepted by claimBatch. Keeps a batch inside one block's gas.
    uint256 public constant MAX_BATCH = 64;

    IERC20 public immutable token;
    address public immutable signer;
    /// @notice Base units in one whole token: 10 ** token.decimals(), read once at deploy.
    uint256 public immutable unit;

    mapping(uint256 id => bool) public claimed;

    event Claimed(uint256 indexed id, address indexed recipient, uint256 amount, uint256 tokens);

    error ZeroAddress();
    error BadDecimals(uint8 decimals);
    error NotRecipient(uint256 id);
    error ZeroAmount(uint256 id);
    error Expired(uint256 id);
    error AlreadyClaimed(uint256 id);
    error BadSignature(uint256 id);
    error BadBatch();

    constructor(IERC20Metadata token_, address signer_) EIP712("VerseCashout", "1") {
        if (address(token_) == address(0) || signer_ == address(0)) revert ZeroAddress();
        uint8 decimals = token_.decimals();
        if (decimals > 36) revert BadDecimals(decimals);
        token = IERC20(address(token_));
        signer = signer_;
        unit = 10 ** uint256(decimals);
    }

    /// @notice Claim one voucher. Only the voucher's recipient can submit it.
    function claim(Voucher calldata voucher, bytes calldata signature) external {
        uint256 tokens = _spend(voucher, signature);
        token.safeTransfer(msg.sender, tokens);
    }

    /// @notice Claim several vouchers for the caller in one transaction and one transfer.
    function claimBatch(Voucher[] calldata vouchers, bytes[] calldata signatures) external {
        uint256 n = vouchers.length;
        if (n == 0 || n > MAX_BATCH || n != signatures.length) revert BadBatch();
        uint256 total;
        for (uint256 i; i < n; ++i) {
            total += _spend(vouchers[i], signatures[i]);
        }
        token.safeTransfer(msg.sender, total);
    }

    /// @notice EIP-712 digest the signer signs for a voucher. Used by off-chain test vectors.
    function voucherDigest(Voucher calldata voucher) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(VOUCHER_TYPEHASH, voucher.id, voucher.recipient, voucher.amount, voucher.expiry))
        );
    }

    /// @dev Checks a voucher, marks it claimed, and returns the token base units it pays.
    ///      Effects happen before the caller's transfer (checks-effects-interactions).
    function _spend(Voucher calldata voucher, bytes calldata signature) private returns (uint256 tokens) {
        uint256 id = voucher.id;
        if (voucher.recipient != msg.sender) revert NotRecipient(id);
        if (voucher.amount == 0) revert ZeroAmount(id);
        if (block.timestamp > voucher.expiry) revert Expired(id);
        if (claimed[id]) revert AlreadyClaimed(id);
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(voucherDigest(voucher), signature);
        if (err != ECDSA.RecoverError.NoError || recovered != signer) revert BadSignature(id);
        claimed[id] = true;
        tokens = voucher.amount * unit;
        emit Claimed(id, msg.sender, voucher.amount, tokens);
    }
}
