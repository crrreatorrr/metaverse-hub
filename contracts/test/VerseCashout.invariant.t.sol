// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {VerseCashout} from "../src/VerseCashout.sol";
import {MockToken} from "./mocks/Tokens.sol";

/// Drives the cashout with a fixed pool of signed vouchers plus forged and replayed ones.
contract CashoutHandler is Test {
    uint256 internal constant SIGNER_KEY = 0xA11CE;
    uint256 internal constant POOL = 40;

    VerseCashout public cashout;
    MockToken public token;
    address[4] public actors;

    VerseCashout.Voucher[] internal pool;
    bytes[] internal sigs;

    uint256 public funded;
    mapping(uint256 => uint256) public timesPaid;
    uint256 public forgedSuccesses;

    constructor(VerseCashout c, MockToken t, uint256 initialFloat) {
        cashout = c;
        token = t;
        funded = initialFloat;
        for (uint256 a; a < 4; ++a) {
            actors[a] = address(uint160(0x1000 + a));
        }
        for (uint256 i; i < POOL; ++i) {
            VerseCashout.Voucher memory v = VerseCashout.Voucher({
                id: i,
                recipient: actors[i % 4],
                amount: 1 + (uint256(keccak256(abi.encode(i))) % 500),
                expiry: block.timestamp + 1 days + (i * 1 hours)
            });
            pool.push(v);
            (uint8 vv, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, c.voucherDigest(v));
            sigs.push(abi.encodePacked(r, s, vv));
        }
    }

    function poolSize() external pure returns (uint256) {
        return POOL;
    }

    function voucherAt(uint256 i) external view returns (VerseCashout.Voucher memory) {
        return pool[i];
    }

    function claim(uint256 i, uint256 callerSeed) external {
        i = bound(i, 0, POOL - 1);
        address caller = callerSeed % 3 == 0 ? actors[callerSeed % 4] : pool[i].recipient;
        uint256 before = token.balanceOf(caller);
        vm.prank(caller);
        try cashout.claim(pool[i], sigs[i]) {
            timesPaid[i] += 1;
            assertEq(token.balanceOf(caller) - before, pool[i].amount * cashout.unit());
        } catch {}
    }

    function claimBatch(uint256 start, uint256 len, uint256 actorSeed) external {
        address who = actors[actorSeed % 4];
        start = bound(start, 0, POOL - 1);
        len = bound(len, 1, 8);
        VerseCashout.Voucher[] memory vs = new VerseCashout.Voucher[](len);
        bytes[] memory ss = new bytes[](len);
        uint256 k;
        for (uint256 i = start; i < POOL && k < len; ++i) {
            if (pool[i].recipient != who) continue;
            vs[k] = pool[i];
            ss[k] = sigs[i];
            k++;
        }
        if (k == 0) return;
        assembly {
            mstore(vs, k)
            mstore(ss, k)
        }
        vm.prank(who);
        try cashout.claimBatch(vs, ss) {
            for (uint256 j; j < k; ++j) {
                timesPaid[vs[j].id] += 1;
            }
        } catch {}
    }

    function forge(uint256 i, uint256 newAmount, uint256 newId, address newRecipient) external {
        i = bound(i, 0, POOL - 1);
        VerseCashout.Voucher memory v = pool[i];
        uint256 mode = newAmount % 3;
        if (mode == 0) v.amount = bound(newAmount, 1, 1e6);
        else if (mode == 1) v.id = bound(newId, POOL, type(uint128).max);
        else v.recipient = newRecipient == address(0) ? address(1) : newRecipient;
        if (v.amount == pool[i].amount && v.id == pool[i].id && v.recipient == pool[i].recipient) return;
        vm.prank(v.recipient);
        try cashout.claim(v, sigs[i]) {
            forgedSuccesses++;
        } catch {}
    }

    function fund(uint256 amount) external {
        amount = bound(amount, 0, 1_000 * cashout.unit());
        token.mint(address(cashout), amount);
        funded += amount;
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 0, 12 hours));
    }

    function actorBalanceSum() external view returns (uint256 sum) {
        for (uint256 a; a < 4; ++a) {
            sum += token.balanceOf(actors[a]);
        }
    }
}

contract VerseCashoutInvariantTest is Test {
    VerseCashout internal cashout;
    MockToken internal token;
    CashoutHandler internal handler;

    function setUp() public {
        vm.warp(1_800_000_000);
        token = new MockToken(8);
        cashout = new VerseCashout(IERC20Metadata(address(token)), vm.addr(0xA11CE));
        uint256 initialFloat = 5_000 * 1e8;
        token.mint(address(cashout), initialFloat);
        handler = new CashoutHandler(cashout, token, initialFloat);
        targetContract(address(handler));
    }

    /// Tokens only leave the contract through claims of pool vouchers.
    function invariant_conservation() public view {
        uint256 paidOut;
        for (uint256 i; i < handler.poolSize(); ++i) {
            if (cashout.claimed(i)) paidOut += handler.voucherAt(i).amount * cashout.unit();
        }
        assertEq(token.balanceOf(address(cashout)) + paidOut, handler.funded());
        assertEq(handler.actorBalanceSum(), paidOut);
    }

    /// Every voucher id pays at most once.
    function invariant_paid_at_most_once() public view {
        for (uint256 i; i < handler.poolSize(); ++i) {
            assertLe(handler.timesPaid(i), 1);
            assertEq(handler.timesPaid(i) == 1, cashout.claimed(i));
        }
    }

    /// Coverage log (run with -vv). A run can legitimately pay nothing, e.g. when its first
    /// call jumps past every expiry, so this only reports.
    function afterInvariant() external {
        uint256 claimedCount;
        for (uint256 i; i < handler.poolSize(); ++i) {
            if (cashout.claimed(i)) claimedCount++;
        }
        emit log_named_uint("claimed vouchers this run", claimedCount);
    }

    /// A voucher changed in any field never claims with the original signature.
    function invariant_no_forgery() public view {
        assertEq(handler.forgedSuccesses(), 0);
    }
}
