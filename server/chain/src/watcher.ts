// One pass of the chain service: deposits, claims, expiries, then voucher signing.
// Every step is idempotent, so a crash at any point is repaired by the next pass.
import { getAddress, type Address } from 'viem';
import type { ChainDb } from './db.ts';
import type { SignerGuard } from './guard.ts';
import type { ChainReader } from './reader.ts';
import type { DigestSigner } from './signer.ts';
import { signVoucher } from './voucher.ts';

export const SECURITY_ALERTS = new Set(['unknown_claim', 'claim_after_refund', 'claimed_on_chain_without_event', 'cashout_signer_mismatch']);

export interface WatcherDeps {
  chain: 'eth';
  db: ChainDb;
  reader: ChainReader;
  signer: DigestSigner | null;
  guard: SignerGuard | null;
  maxBlockRange: bigint;
  startBlock: bigint | null;
  log: (line: string) => void;
  onAlert: (kind: string, detail: object) => Promise<void>;
}

export interface TickResult {
  deposits: number;
  claims: number;
  refunds: number;
  signed: number;
}

export class Watcher {
  private signerChecked = new Map<string, boolean>();
  private notified = new Set<string>();

  constructor(private readonly d: WatcherDeps) {}

  private async alert(kind: string, detail: object): Promise<void> {
    await this.d.db.alert(this.d.chain, kind, detail);
    await this.raised(kind, detail);
  }

  /** An alert the database already recorded (returned by claim_record or voucher_refund). */
  private async raised(kind: string, detail: object): Promise<void> {
    this.d.log(`ALERT ${kind} ${JSON.stringify(detail)}`);
    if (SECURITY_ALERTS.has(kind) && this.d.guard) this.d.guard.halt(kind);
    await this.d.onAlert(kind, detail);
  }

  private async once(key: string, fn: () => Promise<void>): Promise<void> {
    if (this.notified.has(key)) return;
    this.notified.add(key);
    await fn();
  }

  private async scan(
    stream: 'deposits' | 'claims',
    finalized: bigint,
    each: (from: bigint, to: bigint) => Promise<number>,
  ): Promise<number> {
    const cursor = await this.d.db.cursor(this.d.chain, stream);
    let from = cursor === null ? (this.d.startBlock ?? finalized) : cursor + 1n;
    if (cursor === null && this.d.startBlock === null) this.d.log(`no ${stream} cursor and no START_BLOCK; starting at finalized ${finalized}`);
    let n = 0;
    while (from <= finalized) {
      const to = from + this.d.maxBlockRange - 1n < finalized ? from + this.d.maxBlockRange - 1n : finalized;
      n += await each(from, to);
      await this.d.db.setCursor(this.d.chain, stream, to, await this.d.reader.blockTime(to));
      from = to + 1n;
    }
    return n;
  }

  async tick(): Promise<TickResult> {
    const { db, reader, chain } = this.d;
    const cfg = await db.config(chain);
    if (!cfg) throw new Error(`no chain_config row for ${chain}`);
    const rpcChain = await reader.chainId();
    if (rpcChain !== Number(cfg.chain_id)) {
      await this.once('chain-mismatch', () => this.alert('rpc_chain_mismatch', { rpcChain, configured: cfg.chain_id }));
      throw new Error(`RPC is chain ${rpcChain} but chain_config says ${cfg.chain_id}`);
    }
    const fin = await reader.finalized();
    const result: TickResult = { deposits: 0, claims: 0, refunds: 0, signed: 0 };

    // Deposits: Transfer(from, depositAddress, value) on the token.
    if (cfg.deposit_address && cfg.token_decimals !== null) {
      const token = getAddress(cfg.token_address);
      const to = getAddress(cfg.deposit_address);
      result.deposits = await this.scan('deposits', fin.number, async (a, b) => {
        const logs = await reader.transfers(token, to, a, b);
        logs.sort((x, y) => (x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : x.blockNumber < y.blockNumber ? -1 : 1));
        for (const l of logs) {
          if (l.value === 0n) continue;
          await db.recordDeposit(chain, l.txHash, l.logIndex, l.blockNumber, l.from, l.value);
        }
        return logs.length;
      });
      await db.settlePending(chain);
    }

    // Claims on every cashout contract that can still pay an open voucher.
    const watch = (await db.watchList(chain)).map((a) => getAddress(a));
    result.claims = await this.scan('claims', fin.number, async (a, b) => {
      const logs = await reader.claims(watch, a, b);
      for (const l of logs) {
        const r = await db.recordClaim(chain, l.address, l.id, l.recipient, l.amount, l.txHash, l.blockNumber);
        if (typeof r.alert === 'string') await this.raised(r.alert, { voucherId: l.id.toString(), tx: l.txHash, cashout: l.address });
      }
      return logs.length;
    });

    // Expiries: refund only what the chain confirms was never claimed.
    for (const due of await db.dueVouchers(chain)) {
      const claimed = await reader.isClaimed(getAddress(due.cashout_address), BigInt(due.voucher_id), fin.number);
      const r = await db.refund(due.id, claimed);
      if (r.status === 'refunded') result.refunds++;
      if (typeof r.alert === 'string') await this.raised(r.alert, { voucherId: due.voucher_id });
    }

    // Signing.
    if (this.d.signer && this.d.guard && cfg.vouchers_enabled) {
      result.signed = await this.signPending(Number(cfg.chain_id));
    }
    return result;
  }

  private async cashoutUsesOurKey(cashout: Address): Promise<boolean> {
    const known = this.signerChecked.get(cashout);
    if (known !== undefined) return known;
    const onChain = await this.d.reader.cashoutSigner(cashout);
    const ok = onChain.toLowerCase() === this.d.signer!.address.toLowerCase();
    this.signerChecked.set(cashout, ok);
    if (!ok) await this.alert('cashout_signer_mismatch', { cashout, onChain, ours: this.d.signer!.address });
    return ok;
  }

  private async signPending(chainId: number): Promise<number> {
    const { db, guard, signer, chain } = this.d;
    let signed = 0;
    for (const v of await db.pendingVouchers(chain)) {
      if (Number(v.chain_id) !== chainId) continue;
      const cashout = getAddress(v.cashout_address);
      if (!(await this.cashoutUsesOurKey(cashout))) continue;
      const amount = Number(v.amount);
      const expiry = Number(v.expiry);
      const refused = guard!.reserve(amount, expiry);
      if (refused) {
        await this.once('refused:' + refused, () => this.alert('signer_refused', { reason: refused, voucherId: v.voucher_id }));
        break;
      }
      const signature = await signVoucher(signer!, chainId, cashout, {
        id: BigInt(v.voucher_id),
        recipient: getAddress(v.recipient),
        amount: BigInt(v.amount),
        expiry: BigInt(v.expiry),
      });
      const r = await db.storeSignature(v, signature);
      if (r.status === 'signed') signed++;
    }
    return signed;
  }
}
