// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {VerseCashout} from "../src/VerseCashout.sol";

/// Deploys VerseCashout. The constructor arguments can never be changed, so the script refuses
/// to deploy unless every one of them is proven, not just plausible. See contracts/README.md.
///
///   CASHOUT_CHAIN_ID         1 (mainnet) or 11155111 (Sepolia); must equal the RPC's chain
///   CASHOUT_TOKEN            $BITCOIN ERC-20 address (pinned on mainnet)
///   CASHOUT_EXPECT_DECIMALS  decimals you verified for the token on Etherscan
///   CASHOUT_SIGNER           voucher signer address (the KMS key's Ethereum address)
///   CASHOUT_SIGNER_PROOF     65-byte signature by that key over proofDigest(chainId, token, signer),
///                            made with `npm run signer-proof` in server/chain. Proves the key exists
///   CASHOUT_SEPOLIA_SIGNER   mainnet only: the Sepolia signer, which must be a different key
///   CASHOUT_TOKEN_HOLDER     an address holding at least one whole token (e.g. the Safe). Used
///                            only in simulation, for a canary claim before anything is broadcast
contract Deploy is Script {
    address internal constant MAINNET_BITCOIN = 0x72e4f9F808C49A2a61dE9C5896298920Dc4EEEa9;
    uint256 internal constant SEPOLIA = 11155111;

    /// Raw digest the signer key signs (no EIP-191 prefix, as a KMS signs a digest).
    function proofDigest(uint256 chainId, address token, address signer) public pure returns (bytes32) {
        return keccak256(abi.encode("VerseCashout signer proof v1", chainId, token, signer));
    }

    /// Chain id as the RPC itself reports it. block.chainid alone is not enough: forge sets it
    /// from --chain / FOUNDRY_CHAIN_ID / foundry.toml when those are present.
    function rpcChainId() public returns (uint256) {
        return vm.parseUint(vm.toString(vm.rpc("eth_chainId", "[]")));
    }

    function run() external returns (VerseCashout cashout) {
        return runWith(rpcChainId());
    }

    /// `rpcChain` is what the RPC reports. Tests pass it directly because they have no RPC.
    function runWith(uint256 rpcChain) public returns (VerseCashout cashout) {
        uint256 chainId = vm.envUint("CASHOUT_CHAIN_ID");
        require(rpcChain == block.chainid, "RPC chain differs from forge's chain id (check --chain / FOUNDRY_CHAIN_ID)");
        address token = vm.envAddress("CASHOUT_TOKEN");
        uint256 expectDecimals = vm.envUint("CASHOUT_EXPECT_DECIMALS");
        address signer = vm.envAddress("CASHOUT_SIGNER");
        bytes memory proof = vm.envBytes("CASHOUT_SIGNER_PROOF");

        require(chainId == block.chainid, "CASHOUT_CHAIN_ID differs from the RPC chain");
        require(chainId == 1 || chainId == SEPOLIA, "only mainnet and Sepolia are supported");
        if (chainId == 1) {
            require(token == MAINNET_BITCOIN, "mainnet token must be HPOS10I $BITCOIN");
            address sepoliaSigner = vm.envAddress("CASHOUT_SEPOLIA_SIGNER");
            require(sepoliaSigner != signer, "mainnet must use a different signer key than Sepolia");
        }
        require(token.code.length > 0, "token has no code on this chain");

        require(uint160(signer) > 0x1ff, "signer is zero or a precompile");
        require(signer.code.length == 0, "signer must be an EOA key, not a contract");
        require(signer != msg.sender && signer != tx.origin, "signer must not be the deploying account");
        address predicted = vm.computeCreateAddress(msg.sender, vm.getNonce(msg.sender));
        require(signer != predicted, "signer is the cashout's own address");
        (address proven, ECDSA.RecoverError err,) = ECDSA.tryRecover(proofDigest(chainId, token, signer), proof);
        require(
            err == ECDSA.RecoverError.NoError && proven == signer,
            "CASHOUT_SIGNER_PROOF is not a signature by the signer"
        );

        uint8 decimals = IERC20Metadata(token).decimals();
        require(decimals == expectDecimals, "token decimals differ from CASHOUT_EXPECT_DECIMALS");
        canary(token, vm.envAddress("CASHOUT_TOKEN_HOLDER"));

        vm.startBroadcast();
        cashout = new VerseCashout(IERC20Metadata(token), signer);
        vm.stopBroadcast();

        require(address(cashout).code.length > 0, "deploy produced no code");
        require(address(cashout.token()) == token, "token immutable mismatch");
        require(cashout.signer() == signer, "signer immutable mismatch");
        require(cashout.unit() == 10 ** expectDecimals, "unit differs from 10**CASHOUT_EXPECT_DECIMALS");
        console2.log("VerseCashout", address(cashout));
        console2.log("chainId", block.chainid);
        console2.log("token", token);
        console2.log("signer", signer);
        console2.log("unit", cashout.unit());
    }

    /// Simulation only (nothing here is broadcast): deploy a throwaway cashout with a throwaway
    /// key, fund it with one whole token from `holder`, claim a 1-Verse voucher, and require
    /// that exactly one token left the contract and exactly one token arrived. This proves on
    /// the real token, at the current block, that the contract can pay at all.
    function canary(address token, address holder) public {
        uint256 pk = uint256(keccak256(abi.encode("VerseCashout canary key", token, block.number)));
        VerseCashout trial = new VerseCashout(IERC20Metadata(token), vm.addr(pk));
        uint256 unit = trial.unit();
        vm.prank(holder);
        (bool sent, bytes memory ret) = token.call(abi.encodeCall(IERC20.transfer, (address(trial), unit)));
        require(
            sent && (ret.length == 0 || abi.decode(ret, (bool))),
            "canary: CASHOUT_TOKEN_HOLDER could not send one token"
        );
        require(
            IERC20(token).balanceOf(address(trial)) == unit,
            "canary: the trial cashout did not receive exactly one token"
        );

        address to = address(uint160(uint256(keccak256("VerseCashout canary recipient"))));
        VerseCashout.Voucher memory v =
            VerseCashout.Voucher({id: 1, recipient: to, amount: 1, expiry: block.timestamp + 1});
        (uint8 sv, bytes32 sr, bytes32 ss) = vm.sign(pk, trial.voucherDigest(v));
        uint256 before = IERC20(token).balanceOf(to);
        vm.prank(to);
        trial.claim(v, abi.encodePacked(sr, ss, sv));
        require(IERC20(token).balanceOf(to) - before == unit, "canary: recipient did not receive exactly one token");
        require(
            IERC20(token).balanceOf(address(trial)) == 0,
            "canary: the trial cashout lost a different amount than it paid"
        );
    }
}
