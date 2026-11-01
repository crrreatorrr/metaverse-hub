# VerseCashout

The claim contract for Verse → HPOS10I `$BITCOIN` cash-out. Design: [docs/crypto-exchange-design.md](../docs/crypto-exchange-design.md).

- **1 Verse = 1 whole `$BITCOIN`.** A voucher's `amount` is whole Verse. The contract pays `amount × 10^decimals` base units, where `decimals` is read from the token at deploy.
- **Ownerless and immutable.** There is no admin, no pause, no signer rotation, and no way to withdraw the float. The only state-changing calls are `claim` and `claimBatch`. A new signer means a new deployment.
- **Vouchers** are EIP-712 typed data, `Voucher(uint256 id,address recipient,uint256 amount,uint256 expiry)`, in domain `VerseCashout` / `1` / chain id / contract address. Only the `recipient` can submit one. Each `id` pays once. A voucher is valid while `block.timestamp <= expiry`.
- **The float** is refilled with plain ERC-20 transfers to the contract address. Whatever is in the contract is the most that can be lost.
- **Exact payment.** Each claim checks that the recipient's balance rose by exactly `amount × unit`, and reverts otherwise. A token that silently fails, charges a fee, or rebases can therefore never mark a voucher claimed without paying it. `claim` and `claimBatch` are `nonReentrant`.
- **Event:** `Claimed(uint256 indexed id, address indexed recipient, uint256 amount, uint256 tokens)`, where `amount` is whole Verse and `tokens` is base units.

## Layout

| Path | What |
| --- | --- |
| `src/VerseCashout.sol` | The contract |
| `test/VerseCashout.t.sol` | Unit and fuzz tests, token-behaviour and reentrancy tests |
| `test/VerseCashout.invariant.t.sol` | Invariant campaign: conservation, pay-once, no forgery |
| `test/Vector.t.sol`, `test/vectors/voucher.json` | Shared EIP-712 vector. `server/chain/test/voucher.test.ts` checks the same file |
| `test/exploits/` | Proofs of concept and pinned behaviour from the independent exploit review passes |
| `script/Deploy.s.sol` | Deploy with argument checks |

`lib/forge-std` and `lib/openzeppelin-contracts` are git submodules pinned to `v1.17.0` and `v5.7.0`. After cloning, run `git submodule update --init --recursive`.

## Run the tests

With Foundry installed:

```bash
cd contracts && forge test
```

If `forge` cannot download `solc`, point it at any 0.8.28 compiler with `FOUNDRY_SOLC=/path/to/solc FOUNDRY_OFFLINE=true`.

## Deploy checklist

The constructor arguments can never be changed after deploy, and the contract can never give its float back. Check every line before broadcasting.

1. **Token.** `CASHOUT_TOKEN` is `0x72e4f9F808C49A2a61dE9C5896298920Dc4EEEa9` on mainnet. Confirm on Etherscan, against the project's official channels, that it:
   - is that address;
   - is **not** an upgradeable proxy and has no admin who could change it (`unit` is fixed at deploy);
   - takes **no** fee on transfer (every claim checks the full amount arrived and reverts otherwise);
   - reverts on a short balance.
2. **Decimals.** `CASHOUT_EXPECT_DECIMALS` is the token's `decimals()` as shown on Etherscan. The script refuses to deploy if they differ.
3. **Signer.**
   - `CASHOUT_SIGNER` is the Ethereum address of the voucher signer's KMS key. Derive it from the KMS public key with `npm run signer-address` in `server/chain`.
   - Mainnet and Sepolia use **different** KMS keys. The mainnet run needs `CASHOUT_SEPOLIA_SIGNER` and refuses to deploy if it equals the mainnet signer.
4. **Proof that the key exists.** Run `npm run signer-proof -- <chainId> <token>` in `server/chain` and put the output in `CASHOUT_SIGNER_PROOF`. The script recovers the signer from it and refuses to deploy otherwise. This rules out precompiles, the cashout's own address, and keys that do not exist. The script also refuses the deploying account as signer.
5. **`CASHOUT_CHAIN_ID`** must be `1` or `11155111` and must equal the RPC's chain.
6. **Sepolia first.** Run once against Sepolia with a test token and run the full end-to-end flow. Then deploy to mainnet:

   ```bash
   forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --broadcast --verify
   ```

7. **Verify.** Verify the source on Etherscan. Read back `token()`, `signer()` and `unit()` and compare them with steps 1–3.
8. **Canary claim.** Send exactly **1 whole token** to the contract. Issue a 1-Verse voucher to a team wallet through the real signer service, and claim it on mainnet. Only after that claim succeeds, and the watcher records it, send the first real float.
9. **Refill in whole tokens only.** Anything below one whole token can never leave the contract.
