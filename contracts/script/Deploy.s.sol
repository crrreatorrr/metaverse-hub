// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {VerseCashout} from "../src/VerseCashout.sol";

/// Deploys VerseCashout. The constructor arguments can never be changed, so the script
/// refuses to broadcast unless they match what the checklist in contracts/README.md expects.
///
///   CASHOUT_TOKEN   $BITCOIN ERC-20 address
///   CASHOUT_SIGNER  voucher signer address (the KMS key's Ethereum address)
///   CASHOUT_EXPECT_DECIMALS  decimals you verified for the token on Etherscan
contract Deploy is Script {
    address internal constant MAINNET_BITCOIN = 0x72e4f9F808C49A2a61dE9C5896298920Dc4EEEa9;

    function run() external returns (VerseCashout cashout) {
        address token = vm.envAddress("CASHOUT_TOKEN");
        address signer = vm.envAddress("CASHOUT_SIGNER");
        uint256 expectDecimals = vm.envUint("CASHOUT_EXPECT_DECIMALS");

        require(token.code.length > 0, "token has no code on this chain");
        require(signer != address(0), "signer is zero");
        require(signer.code.length == 0, "signer must be an EOA key, not a contract");
        if (block.chainid == 1) require(token == MAINNET_BITCOIN, "mainnet token must be HPOS10I $BITCOIN");
        uint8 decimals = IERC20Metadata(token).decimals();
        require(decimals == expectDecimals, "token decimals differ from CASHOUT_EXPECT_DECIMALS");

        vm.startBroadcast();
        cashout = new VerseCashout(IERC20Metadata(token), signer);
        vm.stopBroadcast();

        require(address(cashout.token()) == token && cashout.signer() == signer, "immutables mismatch");
        console2.log("VerseCashout", address(cashout));
        console2.log("chainId", block.chainid);
        console2.log("token", token);
        console2.log("signer", signer);
        console2.log("unit", cashout.unit());
    }
}
