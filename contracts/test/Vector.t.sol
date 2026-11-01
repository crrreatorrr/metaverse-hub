// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {VerseCashout} from "../src/VerseCashout.sol";
import {MockToken} from "./mocks/Tokens.sol";
import {Deploy} from "../script/Deploy.s.sol";

/// Shared EIP-712 vector. server/chain/test/voucher.test.ts must produce the same digest
/// and signature from test/vectors/voucher.json, so Solidity and TypeScript agree on encoding.
contract VectorTest is Test {
    function test_shared_voucher_vector() public {
        string memory json = vm.readFile("test/vectors/voucher.json");
        vm.chainId(vm.parseJsonUint(json, ".chainId"));
        address at = vm.parseJsonAddress(json, ".contract");
        uint256 key = vm.parseJsonUint(json, ".signerKey");
        MockToken t = new MockToken(8);
        deployCodeTo("VerseCashout.sol:VerseCashout", abi.encode(IERC20Metadata(address(t)), vm.addr(key)), at);
        VerseCashout c = VerseCashout(at);
        VerseCashout.Voucher memory v = VerseCashout.Voucher({
            id: vm.parseJsonUint(json, ".voucher.id"),
            recipient: vm.parseJsonAddress(json, ".voucher.recipient"),
            amount: vm.parseJsonUint(json, ".voucher.amount"),
            expiry: vm.parseJsonUint(json, ".voucher.expiry")
        });
        bytes32 digest = c.voucherDigest(v);
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(key, digest);
        emit log_named_bytes32("digest", digest);
        emit log_named_bytes("signature", abi.encodePacked(r, s, vv));
        assertEq(digest, vm.parseJsonBytes32(json, ".digest"));
        assertEq(abi.encodePacked(r, s, vv), vm.parseJsonBytes(json, ".signature"));
        assertEq(vm.addr(key), vm.parseJsonAddress(json, ".signer"));
    }

    /// Deploy.proofDigest must match the chain service's `signer-proof` command (src/proof.ts).
    function test_shared_signer_proof_vector() public {
        string memory json = vm.readFile("test/vectors/signer-proof.json");
        Deploy d = new Deploy();
        bytes32 digest = d.proofDigest(
            vm.parseJsonUint(json, ".chainId"),
            vm.parseJsonAddress(json, ".token"),
            vm.parseJsonAddress(json, ".signer")
        );
        assertEq(digest, vm.parseJsonBytes32(json, ".digest"));
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(vm.parseJsonUint(json, ".signerKey"), digest);
        assertEq(abi.encodePacked(r, s, vv), vm.parseJsonBytes(json, ".signature"));
    }
}
