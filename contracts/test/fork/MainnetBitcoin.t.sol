// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {VerseCashout} from "../../src/VerseCashout.sol";
import {Deploy} from "../../script/Deploy.s.sol";

interface IBitcoinToken {
    function owner() external view returns (address);
    function transferDelayEnabled() external view returns (bool);
    function _reduceBuyTaxAt() external view returns (uint256);
    function _reduceSellTaxAt() external view returns (uint256);
    function _maxTxAmount() external view returns (uint256);
    function _maxWalletSize() external view returns (uint256);
}

interface IUniswapV2Factory {
    function getPair(address, address) external view returns (address);
}

/// VerseCashout against the real HPOS10I $BITCOIN on a mainnet fork. This is the launch step
/// from docs/crypto-exchange-design.md: the token-behaviour PoCs were written against mock
/// tokens because the build environment had no RPC; these run them against the real token.
///
/// Skipped unless MAINNET_RPC_URL is set (CI has no RPC). Run with:
///
///   MAINNET_RPC_URL=... forge test --match-path test/fork/MainnetBitcoin.t.sol -vv
///
/// FORK_BLOCK pins a block; without it the fork is taken at the latest block, which is what the
/// launch check needs (the token's state at the time of deploy).
///
/// No vm.setEnv here: DeployScript.t.sol sets CASHOUT_* in the same process, so the deploy
/// script's canary is called directly with arguments instead of through runWith().
contract MainnetBitcoinForkTest is Test {
    address internal constant BITCOIN = 0x72e4f9F808C49A2a61dE9C5896298920Dc4EEEa9;
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant UNIV2_FACTORY = 0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f;
    /// keccak256 of the token's runtime code, read from mainnet on 2026-11-01.
    bytes32 internal constant BITCOIN_CODEHASH = 0x750e546985eaaa50e8e5c52e33409c5666ceae31374436d043c657562e251dd2;
    /// Storage slot of the token's private `_buyCount` (verified source, Bitcoin v0.8.19).
    uint256 internal constant BUY_COUNT_SLOT = 14;
    uint256 internal constant UNIT = 1e8;

    uint256 internal constant SIGNER_KEY = uint256(keccak256("fork signer"));
    address internal signerAddr;
    address internal holder; // the Uniswap V2 pair: the largest holder that is always funded
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    IERC20 internal token = IERC20(BITCOIN);
    VerseCashout internal cashout;
    bool internal forked;

    function setUp() public {
        string memory rpc = vm.envOr("MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        uint256 pin = vm.envOr("FORK_BLOCK", uint256(0));
        if (pin == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, pin);
        forked = true;
        signerAddr = vm.addr(SIGNER_KEY);
        holder = IUniswapV2Factory(UNIV2_FACTORY).getPair(BITCOIN, WETH);
        cashout = new VerseCashout(IERC20Metadata(BITCOIN), signerAddr);
    }

    modifier onFork() {
        if (!forked) vm.skip(true);
        _;
    }

    function _fund(address to, uint256 wholeTokens) internal {
        vm.prank(holder);
        assertTrue(token.transfer(to, wholeTokens * UNIT), "holder transfer");
    }

    function _voucher(uint256 id, address to, uint256 amount) internal view returns (VerseCashout.Voucher memory) {
        return VerseCashout.Voucher({id: id, recipient: to, amount: amount, expiry: block.timestamp + 30 days});
    }

    function _sign(VerseCashout.Voucher memory v) internal view returns (bytes memory) {
        (uint8 sv, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, cashout.voucherDigest(v));
        return abi.encodePacked(r, s, sv);
    }

    // ---- Deploy checklist step 1-2: the token itself ------------------------------------------

    /// Not a proxy, no admin, 8 decimals, and the code is exactly what was reviewed.
    function test_tokenIsImmutableAndOwnerless() public onFork {
        assertEq(BITCOIN.codehash, BITCOIN_CODEHASH, "token runtime code changed");
        assertEq(IERC20Metadata(BITCOIN).decimals(), 8);
        assertEq(IERC20Metadata(BITCOIN).symbol(), "BITCOIN");
        assertEq(IBitcoinToken(BITCOIN).owner(), address(0), "owner renounced: no addBots, no removeLimits");
        bytes32 impl = vm.load(BITCOIN, 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc);
        assertEq(impl, bytes32(0), "EIP-1967 implementation slot");
        assertEq(cashout.unit(), UNIT);
    }

    /// The token taxes transfers at `_initialBuyTax` (15%) until `_buyCount > _reduceBuyTaxAt`,
    /// and that applies to plain wallet transfers too. Both are past that point for good: the
    /// owner is renounced, so `_reduceBuyTaxAt` can never move again and `_buyCount` only grows.
    function test_taxesArePermanentlyOff() public onFork {
        IBitcoinToken t = IBitcoinToken(BITCOIN);
        uint256 buyCount = uint256(vm.load(BITCOIN, bytes32(BUY_COUNT_SLOT)));
        assertGt(buyCount, t._reduceBuyTaxAt(), "buy tax still on");
        assertGt(buyCount, t._reduceSellTaxAt(), "sell tax still on");
        assertFalse(t.transferDelayEnabled());
        assertEq(t._maxTxAmount(), token.totalSupply(), "limits removed");
        assertEq(t._maxWalletSize(), token.totalSupply(), "limits removed");
    }

    /// No fee on transfer, to an EOA or to a contract (the cashout).
    function test_transfersAreExact() public onFork {
        uint256 before = token.balanceOf(alice);
        _fund(alice, 7);
        assertEq(token.balanceOf(alice) - before, 7 * UNIT);

        vm.prank(alice);
        token.transfer(address(cashout), 3 * UNIT);
        assertEq(token.balanceOf(address(cashout)), 3 * UNIT);
        assertEq(token.balanceOf(alice), before + 4 * UNIT);
    }

    /// A short balance reverts instead of returning false.
    function test_shortBalanceReverts() public onFork {
        _fund(alice, 1);
        vm.prank(alice);
        vm.expectRevert();
        token.transfer(bob, 2 * UNIT);
    }

    // ---- The cashout on the real token -------------------------------------------------------

    function test_claimPaysExactly() public onFork {
        _fund(address(cashout), 10);
        VerseCashout.Voucher memory v = _voucher(1, alice, 5);
        bytes memory sig = _sign(v); // before vm.prank: _sign calls the cashout
        vm.expectEmit(address(cashout));
        emit VerseCashout.Claimed(1, alice, 5, 5 * UNIT);
        vm.prank(alice);
        cashout.claim(v, sig);
        assertEq(token.balanceOf(alice), 5 * UNIT);
        assertEq(token.balanceOf(address(cashout)), 5 * UNIT);
        assertTrue(cashout.claimed(1));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VerseCashout.AlreadyClaimed.selector, 1));
        cashout.claim(v, sig);
    }

    function test_claimBatchPaysExactly() public onFork {
        _fund(address(cashout), 10);
        VerseCashout.Voucher[] memory vs = new VerseCashout.Voucher[](3);
        bytes[] memory sigs = new bytes[](3);
        for (uint256 i; i < 3; ++i) {
            vs[i] = _voucher(10 + i, bob, i + 1);
            sigs[i] = _sign(vs[i]);
        }
        vm.prank(bob);
        cashout.claimBatch(vs, sigs);
        assertEq(token.balanceOf(bob), 6 * UNIT);
        assertEq(token.balanceOf(address(cashout)), 4 * UNIT);
    }

    /// A voucher larger than the float reverts without being marked claimed, and pays once the
    /// float is refilled.
    function test_shortFloatRevertsThenPaysAfterRefill() public onFork {
        _fund(address(cashout), 2);
        VerseCashout.Voucher memory v = _voucher(7, alice, 3);
        bytes memory sig = _sign(v);
        vm.prank(alice);
        vm.expectRevert();
        cashout.claim(v, sig);
        assertFalse(cashout.claimed(7));

        _fund(address(cashout), 1);
        vm.prank(alice);
        cashout.claim(v, sig);
        assertEq(token.balanceOf(alice), 3 * UNIT);
        assertEq(token.balanceOf(address(cashout)), 0);
    }

    /// Gas for the largest batch on the real token stays well inside a block.
    function test_maxBatchGas() public onFork {
        uint256 n = cashout.MAX_BATCH();
        _fund(address(cashout), n);
        VerseCashout.Voucher[] memory vs = new VerseCashout.Voucher[](n);
        bytes[] memory sigs = new bytes[](n);
        for (uint256 i; i < n; ++i) {
            vs[i] = _voucher(100 + i, alice, 1);
            sigs[i] = _sign(vs[i]);
        }
        vm.prank(alice);
        uint256 g = gasleft();
        cashout.claimBatch(vs, sigs);
        g -= gasleft();
        emit log_named_uint("claimBatch(64) gas", g);
        assertLt(g, 3_000_000);
        assertEq(token.balanceOf(alice), n * UNIT);
    }

    /// Deploy checklist step 6: the script's own canary, on the real token at the fork block.
    function test_deployScriptCanary() public onFork {
        Deploy d = new Deploy();
        d.canary(BITCOIN, holder);
    }

    /// The Deploy script pins the same address this test runs against.
    function test_deployScriptPinsThisToken() public onFork {
        bytes memory code = type(Deploy).runtimeCode;
        bytes memory needle = abi.encodePacked(BITCOIN);
        bool found;
        for (uint256 i; i + needle.length <= code.length && !found; ++i) {
            bool m = true;
            for (uint256 j; j < needle.length && m; ++j) {
                m = code[i + j] == needle[j];
            }
            found = m;
        }
        assertTrue(found, "MAINNET_BITCOIN in Deploy.s.sol differs");
    }
}
