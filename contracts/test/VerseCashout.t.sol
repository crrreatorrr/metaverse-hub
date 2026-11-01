// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {VerseCashout} from "../src/VerseCashout.sol";
import {
    MockToken,
    NoReturnToken,
    FalseToken,
    FeeToken,
    SilentToken,
    HookToken,
    ITransferHook
} from "./mocks/Tokens.sol";

abstract contract CashoutBase is Test {
    uint256 internal constant SIGNER_KEY = 0xA11CE;
    uint256 internal constant UNIT = 1e8;

    MockToken internal token;
    VerseCashout internal cashout;
    address internal signerAddr;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        signerAddr = vm.addr(SIGNER_KEY);
        token = new MockToken(8);
        cashout = new VerseCashout(IERC20Metadata(address(token)), signerAddr);
        token.mint(address(cashout), 1_000_000 * UNIT);
    }

    function voucher(uint256 id, address to, uint256 amount) internal view returns (VerseCashout.Voucher memory) {
        return VerseCashout.Voucher({id: id, recipient: to, amount: amount, expiry: block.timestamp + 30 days});
    }

    function sign(VerseCashout c, uint256 key, VerseCashout.Voucher memory v) internal view returns (bytes memory) {
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(key, c.voucherDigest(v));
        return abi.encodePacked(r, s, vv);
    }

    function sign(VerseCashout.Voucher memory v) internal view returns (bytes memory) {
        return sign(cashout, SIGNER_KEY, v);
    }
}

contract VerseCashoutTest is CashoutBase {
    event Claimed(uint256 indexed id, address indexed recipient, uint256 amount, uint256 tokens);

    function test_constructor_sets_immutables() public view {
        assertEq(address(cashout.token()), address(token));
        assertEq(cashout.signer(), signerAddr);
        assertEq(cashout.unit(), UNIT);
    }

    function test_constructor_rejects_zero_addresses() public {
        vm.expectRevert(VerseCashout.ZeroAddress.selector);
        new VerseCashout(IERC20Metadata(address(0)), signerAddr);
        vm.expectRevert(VerseCashout.ZeroAddress.selector);
        new VerseCashout(IERC20Metadata(address(token)), address(0));
    }

    function test_constructor_rejects_huge_decimals() public {
        MockToken weird = new MockToken(37);
        vm.expectRevert(abi.encodeWithSelector(VerseCashout.BadDecimals.selector, uint8(37)));
        new VerseCashout(IERC20Metadata(address(weird)), signerAddr);
    }

    function test_claim_pays_one_token_per_verse() public {
        VerseCashout.Voucher memory v = voucher(1, alice, 50);
        bytes memory sig = sign(v);
        vm.expectEmit(address(cashout));
        emit Claimed(1, alice, 50, 50 * UNIT);
        vm.prank(alice);
        cashout.claim(v, sig);
        assertEq(token.balanceOf(alice), 50 * UNIT);
        assertTrue(cashout.claimed(1));
    }

    function test_claim_twice_reverts() public {
        VerseCashout.Voucher memory v = voucher(1, alice, 5);
        bytes memory sig = sign(v);
        vm.startPrank(alice);
        cashout.claim(v, sig);
        vm.expectRevert(abi.encodeWithSelector(VerseCashout.AlreadyClaimed.selector, 1));
        cashout.claim(v, sig);
        vm.stopPrank();
        assertEq(token.balanceOf(alice), 5 * UNIT);
    }

    function test_same_id_different_amount_reverts() public {
        VerseCashout.Voucher memory v = voucher(7, alice, 5);
        bytes memory first = sign(v);
        vm.prank(alice);
        cashout.claim(v, first);
        VerseCashout.Voucher memory w = voucher(7, alice, 6);
        bytes memory sig = sign(w);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VerseCashout.AlreadyClaimed.selector, 7));
        cashout.claim(w, sig);
    }

    function test_only_recipient_can_claim() public {
        VerseCashout.Voucher memory v = voucher(1, alice, 5);
        bytes memory sig = sign(v);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(VerseCashout.NotRecipient.selector, 1));
        cashout.claim(v, sig);
    }

    function test_changed_recipient_breaks_signature() public {
        VerseCashout.Voucher memory v = voucher(1, alice, 5);
        bytes memory sig = sign(v);
        v.recipient = bob;
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(VerseCashout.BadSignature.selector, 1));
        cashout.claim(v, sig);
    }

    function test_changed_amount_breaks_signature() public {
        VerseCashout.Voucher memory v = voucher(1, alice, 5);
        bytes memory sig = sign(v);
        v.amount = 5000;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VerseCashout.BadSignature.selector, 1));
        cashout.claim(v, sig);
    }

    function test_changed_expiry_breaks_signature() public {
        VerseCashout.Voucher memory v = voucher(1, alice, 5);
        bytes memory sig = sign(v);
        v.expiry += 1;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VerseCashout.BadSignature.selector, 1));
        cashout.claim(v, sig);
    }

    function test_wrong_signer_reverts() public {
        VerseCashout.Voucher memory v = voucher(1, alice, 5);
        bytes memory sig = sign(cashout, 0xB0B, v);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VerseCashout.BadSignature.selector, 1));
        cashout.claim(v, sig);
    }

    function test_garbage_signatures_revert() public {
        VerseCashout.Voucher memory v = voucher(1, alice, 5);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(VerseCashout.BadSignature.selector, 1));
        cashout.claim(v, "");
        vm.expectRevert(abi.encodeWithSelector(VerseCashout.BadSignature.selector, 1));
        cashout.claim(v, new bytes(65));
        vm.expectRevert(abi.encodeWithSelector(VerseCashout.BadSignature.selector, 1));
        cashout.claim(v, new bytes(64));
        vm.stopPrank();
    }

    function test_high_s_signature_rejected() public {
        VerseCashout.Voucher memory v = voucher(1, alice, 5);
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, cashout.voucherDigest(v));
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 highS = bytes32(n - uint256(s));
        uint8 flipped = vv == 27 ? 28 : 27;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VerseCashout.BadSignature.selector, 1));
        cashout.claim(v, abi.encodePacked(r, highS, flipped));
    }

    function test_compact_signature_rejected() public {
        VerseCashout.Voucher memory v = voucher(1, alice, 5);
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, cashout.voucherDigest(v));
        bytes32 vs = bytes32(uint256(s) | (uint256(vv - 27) << 255));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VerseCashout.BadSignature.selector, 1));
        cashout.claim(v, abi.encodePacked(r, vs));
    }

    function test_claim_at_expiry_ok_after_reverts() public {
        VerseCashout.Voucher memory v = voucher(1, alice, 5);
        VerseCashout.Voucher memory w = voucher(2, alice, 5);
        bytes memory sv = sign(v);
        bytes memory sw = sign(w);
        vm.warp(v.expiry);
        vm.prank(alice);
        cashout.claim(v, sv);
        vm.warp(w.expiry + 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VerseCashout.Expired.selector, 2));
        cashout.claim(w, sw);
    }

    function test_zero_amount_rejected() public {
        VerseCashout.Voucher memory v = voucher(1, alice, 0);
        bytes memory sig = sign(v);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VerseCashout.ZeroAmount.selector, 1));
        cashout.claim(v, sig);
    }

    function test_overflowing_amount_reverts_without_marking() public {
        VerseCashout.Voucher memory v = voucher(1, alice, type(uint256).max);
        bytes memory sig = sign(v);
        vm.prank(alice);
        vm.expectRevert();
        cashout.claim(v, sig);
        assertFalse(cashout.claimed(1));
    }

    function test_empty_float_reverts_and_voucher_stays_claimable() public {
        VerseCashout.Voucher memory v = voucher(1, alice, 2_000_000);
        bytes memory sig = sign(v);
        vm.prank(alice);
        vm.expectRevert();
        cashout.claim(v, sig);
        assertFalse(cashout.claimed(1));
        token.mint(address(cashout), 2_000_000 * UNIT);
        vm.prank(alice);
        cashout.claim(v, sig);
        assertEq(token.balanceOf(alice), 2_000_000 * UNIT);
    }

    function test_replay_on_other_chain_fails() public {
        VerseCashout.Voucher memory v = voucher(1, alice, 5);
        bytes memory sig = sign(v);
        vm.chainId(block.chainid + 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VerseCashout.BadSignature.selector, 1));
        cashout.claim(v, sig);
    }

    function test_replay_on_other_deployment_fails() public {
        VerseCashout other = new VerseCashout(IERC20Metadata(address(token)), signerAddr);
        token.mint(address(other), 100 * UNIT);
        VerseCashout.Voucher memory v = voucher(1, alice, 5);
        bytes memory sig = sign(v);
        vm.prank(alice);
        cashout.claim(v, sig);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VerseCashout.BadSignature.selector, 1));
        other.claim(v, sig);
    }

    function test_batch_pays_sum_in_one_transfer() public {
        VerseCashout.Voucher[] memory vs = new VerseCashout.Voucher[](3);
        bytes[] memory sigs = new bytes[](3);
        for (uint256 i; i < 3; ++i) {
            vs[i] = voucher(10 + i, alice, 5);
            sigs[i] = sign(vs[i]);
        }
        vm.prank(alice);
        cashout.claimBatch(vs, sigs);
        assertEq(token.balanceOf(alice), 15 * UNIT);
        assertTrue(cashout.claimed(10) && cashout.claimed(11) && cashout.claimed(12));
    }

    function test_batch_with_duplicate_id_reverts_whole_batch() public {
        VerseCashout.Voucher[] memory vs = new VerseCashout.Voucher[](2);
        bytes[] memory sigs = new bytes[](2);
        vs[0] = voucher(1, alice, 5);
        vs[1] = vs[0];
        sigs[0] = sign(vs[0]);
        sigs[1] = sigs[0];
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VerseCashout.AlreadyClaimed.selector, 1));
        cashout.claimBatch(vs, sigs);
        assertFalse(cashout.claimed(1));
        assertEq(token.balanceOf(alice), 0);
    }

    function test_batch_with_foreign_voucher_reverts() public {
        VerseCashout.Voucher[] memory vs = new VerseCashout.Voucher[](2);
        bytes[] memory sigs = new bytes[](2);
        vs[0] = voucher(1, alice, 5);
        vs[1] = voucher(2, bob, 5);
        sigs[0] = sign(vs[0]);
        sigs[1] = sign(vs[1]);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VerseCashout.NotRecipient.selector, 2));
        cashout.claimBatch(vs, sigs);
    }

    function test_batch_shape_checks() public {
        VerseCashout.Voucher[] memory none = new VerseCashout.Voucher[](0);
        bytes[] memory noSigs = new bytes[](0);
        vm.expectRevert(VerseCashout.BadBatch.selector);
        cashout.claimBatch(none, noSigs);

        VerseCashout.Voucher[] memory one = new VerseCashout.Voucher[](1);
        one[0] = voucher(1, alice, 5);
        bytes[] memory two = new bytes[](2);
        vm.expectRevert(VerseCashout.BadBatch.selector);
        cashout.claimBatch(one, two);

        uint256 n = cashout.MAX_BATCH() + 1;
        VerseCashout.Voucher[] memory big = new VerseCashout.Voucher[](n);
        bytes[] memory bigSigs = new bytes[](n);
        vm.expectRevert(VerseCashout.BadBatch.selector);
        cashout.claimBatch(big, bigSigs);
    }

    function test_max_batch_fits() public {
        uint256 n = cashout.MAX_BATCH();
        VerseCashout.Voucher[] memory vs = new VerseCashout.Voucher[](n);
        bytes[] memory sigs = new bytes[](n);
        for (uint256 i; i < n; ++i) {
            vs[i] = voucher(1000 + i, alice, 1);
            sigs[i] = sign(vs[i]);
        }
        vm.prank(alice);
        uint256 before = gasleft();
        cashout.claimBatch(vs, sigs);
        assertLt(before - gasleft(), 5_000_000);
        assertEq(token.balanceOf(alice), n * UNIT);
    }

    function test_rejects_ether() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(cashout).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function testFuzz_claim_pays_exact(uint256 id, uint96 amount, uint32 ttl) public {
        amount = uint96(bound(amount, 1, 1_000_000));
        VerseCashout.Voucher memory v =
            VerseCashout.Voucher({id: id, recipient: alice, amount: amount, expiry: block.timestamp + ttl});
        bytes memory sig = sign(v);
        uint256 floatBefore = token.balanceOf(address(cashout));
        vm.prank(alice);
        cashout.claim(v, sig);
        assertEq(token.balanceOf(alice), uint256(amount) * UNIT);
        assertEq(token.balanceOf(address(cashout)), floatBefore - uint256(amount) * UNIT);
    }

    function testFuzz_any_other_key_rejected(uint256 key) public {
        key = bound(key, 1, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140);
        vm.assume(key != SIGNER_KEY);
        VerseCashout.Voucher memory v = voucher(1, alice, 5);
        bytes memory sig = sign(cashout, key, v);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VerseCashout.BadSignature.selector, 1));
        cashout.claim(v, sig);
    }
}

contract TokenBehaviourTest is Test {
    uint256 internal constant SIGNER_KEY = 0xA11CE;
    address internal alice = makeAddr("alice");

    function sign(VerseCashout c, VerseCashout.Voucher memory v) internal view returns (bytes memory) {
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, c.voucherDigest(v));
        return abi.encodePacked(r, s, vv);
    }

    function test_no_return_token_works() public {
        NoReturnToken t = new NoReturnToken();
        VerseCashout c = new VerseCashout(IERC20Metadata(address(t)), vm.addr(SIGNER_KEY));
        t.mint(address(c), 100e8);
        VerseCashout.Voucher memory v =
            VerseCashout.Voucher({id: 1, recipient: alice, amount: 3, expiry: block.timestamp + 1});
        bytes memory sig = sign(c, v);
        vm.prank(alice);
        c.claim(v, sig);
        assertEq(t.balanceOf(alice), 3e8);
    }

    function test_false_returning_token_reverts_and_does_not_mark() public {
        FalseToken t = new FalseToken();
        VerseCashout c = new VerseCashout(IERC20Metadata(address(t)), vm.addr(SIGNER_KEY));
        t.mint(address(c), 100e18);
        VerseCashout.Voucher memory v =
            VerseCashout.Voucher({id: 1, recipient: alice, amount: 3, expiry: block.timestamp + 1});
        bytes memory sig = sign(c, v);
        vm.prank(alice);
        vm.expectRevert();
        c.claim(v, sig);
        assertFalse(c.claimed(1));
    }

    function test_fee_on_transfer_token_reverts_short_payment() public {
        FeeToken t = new FeeToken();
        VerseCashout c = new VerseCashout(IERC20Metadata(address(t)), vm.addr(SIGNER_KEY));
        t.mint(address(c), 100e18);
        VerseCashout.Voucher memory v =
            VerseCashout.Voucher({id: 1, recipient: alice, amount: 3, expiry: block.timestamp + 1});
        bytes memory sig = sign(c, v);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VerseCashout.ShortPayment.selector, 3e18, 3e18 - 3e16));
        c.claim(v, sig);
        assertFalse(c.claimed(1));
    }

    function test_silent_failing_token_reverts_short_payment() public {
        SilentToken t = new SilentToken();
        VerseCashout c = new VerseCashout(IERC20Metadata(address(t)), vm.addr(SIGNER_KEY));
        t.mint(address(c), 1e8);
        VerseCashout.Voucher memory v =
            VerseCashout.Voucher({id: 1, recipient: alice, amount: 3, expiry: block.timestamp + 1});
        bytes memory sig = sign(c, v);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VerseCashout.ShortPayment.selector, 3e8, 0));
        c.claim(v, sig);
        assertFalse(c.claimed(1));
    }

    function test_decimals_zero_and_eighteen() public {
        MockToken t0 = new MockToken(0);
        MockToken t18 = new MockToken(18);
        assertEq(new VerseCashout(IERC20Metadata(address(t0)), vm.addr(SIGNER_KEY)).unit(), 1);
        assertEq(new VerseCashout(IERC20Metadata(address(t18)), vm.addr(SIGNER_KEY)).unit(), 1e18);
    }
}

/// Recipient contract that tries to re-enter claim from the token's transfer hook.
contract Reenterer is ITransferHook {
    VerseCashout public cashout;
    VerseCashout.Voucher public v;
    bytes public sig;
    VerseCashout.Voucher public other;
    bytes public otherSig;
    bytes public replayError;
    bytes public otherError;
    uint256 public hooks;

    function setup(
        VerseCashout c,
        VerseCashout.Voucher calldata v_,
        bytes calldata s_,
        VerseCashout.Voucher calldata o,
        bytes calldata os
    ) external {
        cashout = c;
        v = v_;
        sig = s_;
        other = o;
        otherSig = os;
    }

    function go() external {
        cashout.claim(v, sig);
    }

    function goOther() external {
        cashout.claim(other, otherSig);
    }

    function onTokenTransfer(uint256) external {
        hooks++;
        if (hooks > 1) return;
        try cashout.claim(v, sig) {}
        catch (bytes memory err) {
            replayError = err;
        }
        try cashout.claim(other, otherSig) {}
        catch (bytes memory err) {
            otherError = err;
        }
    }
}

contract ReentrancyTest is Test {
    uint256 internal constant SIGNER_KEY = 0xA11CE;

    function test_reentry_is_refused_and_each_voucher_pays_once() public {
        HookToken t = new HookToken();
        VerseCashout c = new VerseCashout(IERC20Metadata(address(t)), vm.addr(SIGNER_KEY));
        t.mint(address(c), 1000e18);
        Reenterer r = new Reenterer();
        VerseCashout.Voucher memory v =
            VerseCashout.Voucher({id: 1, recipient: address(r), amount: 5, expiry: block.timestamp + 1});
        VerseCashout.Voucher memory o =
            VerseCashout.Voucher({id: 2, recipient: address(r), amount: 7, expiry: block.timestamp + 1});
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(SIGNER_KEY, c.voucherDigest(v));
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(SIGNER_KEY, c.voucherDigest(o));
        r.setup(c, v, abi.encodePacked(r1, s1, v1), o, abi.encodePacked(r2, s2, v2));
        r.go();
        bytes memory guard = abi.encodeWithSignature("ReentrancyGuardReentrantCall()");
        assertEq(r.replayError(), guard);
        assertEq(r.otherError(), guard);
        assertEq(t.balanceOf(address(r)), 5e18);
        assertFalse(c.claimed(2), "a refused re-entry leaves the other voucher claimable");
        r.goOther();
        assertEq(t.balanceOf(address(r)), 12e18);
        assertEq(t.balanceOf(address(c)), 988e18);
    }
}
