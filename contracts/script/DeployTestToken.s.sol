// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Sepolia stand-in for HPOS10I $BITCOIN. It matches what the real token does today (see
/// test/fork/MainnetBitcoin.t.sol): 8 decimals, a fixed supply of 1,000,000,000 tokens, no fee on
/// transfer, no owner, and a revert on a short balance. The real token's taxes and limits are
/// permanently off (owner renounced, `_buyCount` far past `_reduceBuyTaxAt`), so a plain ERC-20
/// is a faithful model. The name and symbol say "Test" so it can never be mistaken for the real one.
contract TestBitcoin is ERC20 {
    uint256 public constant SUPPLY = 1_000_000_000 * 1e8;

    constructor(address holder) ERC20("Test HarryPotterObamaSonic10Inu", "tBITCOIN") {
        _mint(holder, SUPPLY);
    }

    function decimals() public pure override returns (uint8) {
        return 8;
    }
}

/// Deploys TestBitcoin to Sepolia and mints the whole supply to the broadcasting account.
///
///   forge script script/DeployTestToken.s.sol --tc DeployTestToken --rpc-url "$SEPOLIA_RPC_URL" \
///     --private-key "$SEPOLIA_DEPLOYER_KEY" --broadcast --verify
///
/// Use the printed address as CASHOUT_TOKEN for the Sepolia run of Deploy.s.sol, and the
/// deploying account as CASHOUT_TOKEN_HOLDER.
contract DeployTestToken is Script {
    uint256 internal constant SEPOLIA = 11155111;

    function run() external returns (TestBitcoin token) {
        uint256 rpcChain = vm.parseUint(vm.toString(vm.rpc("eth_chainId", "[]")));
        require(rpcChain == SEPOLIA && block.chainid == SEPOLIA, "test token is for Sepolia only");
        require(msg.sender != DEFAULT_SENDER, "pass --private-key (or --sender) for the deploying account");

        vm.startBroadcast();
        token = new TestBitcoin(msg.sender);
        vm.stopBroadcast();

        require(token.decimals() == 8, "decimals");
        require(token.balanceOf(msg.sender) == token.SUPPLY(), "holder did not receive the supply");
        console2.log("TestBitcoin", address(token));
        console2.log("holder", msg.sender);
    }
}
