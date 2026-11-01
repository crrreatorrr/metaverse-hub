# VerseCashout

The claim contract for Verse → HPOS10I `$BITCOIN` cash-out. Design: [docs/crypto-exchange-design.md](../docs/crypto-exchange-design.md).

- **1 Verse = 1 whole `$BITCOIN`.** A voucher's `amount` is whole Verse. The contract pays `amount × 10^decimals` base units, where `decimals` is read from the token at deploy.
- **Ownerless and immutable.** There is no admin, no pause, no signer rotation, and no way to withdraw the float. The only state-changing calls are `claim` and `claimBatch`. A new signer means a new deployment.
- **Vouchers** are EIP-712 typed data, `Voucher(uint256 id,address recipient,uint256 amount,uint256 expiry)`, in domain `VerseCashout` / `1` / chain id / contract address. Only the `recipient` can submit one. Each `id` pays once. A voucher is valid while `block.timestamp <= expiry`.
- **The float** is refilled with plain ERC-20 transfers to the contract address. Whatever is in the contract is the most that can be lost.

## Layout

| Path | What |
| --- | --- |
| `src/VerseCashout.sol` | The contract |
| `test/VerseCashout.t.sol` | Unit and fuzz tests, token-behaviour and reentrancy tests |
| `test/VerseCashout.invariant.t.sol` | Invariant campaign: conservation, pay-once, no forgery |
| `test/Vector.t.sol`, `test/vectors/voucher.json` | Shared EIP-712 vector. The TypeScript signer test checks the same file |
| `script/Deploy.s.sol` | Deploy with argument checks |

`lib/forge-std` and `lib/openzeppelin-contracts` are git submodules pinned to `v1.17.0` and `v5.7.0`. After cloning, run `git submodule update --init --recursive`.

## Run the tests

With Foundry installed:

```bash
cd contracts && forge test
```

If `forge` cannot download `solc`, point it at any 0.8.28 compiler with `FOUNDRY_SOLC=/path/to/solc FOUNDRY_OFFLINE=true`.

## Deploy checklist

The constructor arguments can never be changed after deploy. Check every line before broadcasting.

1. `CASHOUT_TOKEN` is `0x72e4f9F808C49A2a61dE9C5896298920Dc4EEEa9` on mainnet. Confirm it on Etherscan against the project's official channels.
2. `CASHOUT_EXPECT_DECIMALS` is the token's `decimals()` as shown on Etherscan. The script refuses to deploy if they differ.
3. `CASHOUT_SIGNER` is the Ethereum address of the voucher signer's KMS key, and it is an EOA. Derive it from the KMS public key, never from a key that has existed outside the KMS.
4. Run once against Sepolia with a test token, run the full end-to-end flow, then deploy to mainnet:

   ```bash
   forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --broadcast --verify
   ```

5. Verify the source on Etherscan. Read back `token()`, `signer()`, and `unit()` and compare them with steps 1–3.
6. Put the contract address in the chain service config (`CASHOUT_ADDRESS`) and send the first small float from the Safe.
