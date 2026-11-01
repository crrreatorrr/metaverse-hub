// Calls into the game schema. The service's login only has EXECUTE on the hub_chain functions.
import pg from 'pg';

export interface ChainConfigRow {
  chain: string;
  chain_id: number;
  token_address: string;
  token_decimals: number | null;
  deposit_address: string | null;
  cashout_address: string | null;
  deposits_enabled: boolean;
  vouchers_enabled: boolean;
}

export interface PendingVoucher {
  id: string;
  voucher_id: string;
  chain_id: string;
  cashout_address: string;
  recipient: string;
  amount: string;
  expiry: string;
}

export interface DueVoucher {
  id: string;
  voucher_id: string;
  cashout_address: string;
}

export class ChainDb {
  constructor(readonly pool: pg.Pool) {}

  static connect(url: string): ChainDb {
    return new ChainDb(new pg.Pool({ connectionString: url, max: 4 }));
  }

  private async value<T>(sql: string, params: unknown[]): Promise<T> {
    const r = await this.pool.query(sql, params);
    return Object.values(r.rows[0] ?? {})[0] as T;
  }

  config(chain: string): Promise<ChainConfigRow | null> {
    return this.value('SELECT game.chain_service_config($1) AS v', [chain]);
  }

  async cursor(chain: string, stream: 'deposits' | 'claims'): Promise<bigint | null> {
    const v = await this.value<string | null>('SELECT game.cursor_get($1, $2) AS v', [chain, stream]);
    return v === null ? null : BigInt(v);
  }

  async setCursor(chain: string, stream: 'deposits' | 'claims', block: bigint, time: Date): Promise<void> {
    await this.pool.query('SELECT game.cursor_set($1, $2, $3, $4)', [chain, stream, block.toString(), time]);
  }

  recordDeposit(chain: string, tx: string, logIndex: number, block: bigint, from: string, amount: bigint) {
    return this.value<Record<string, unknown>>('SELECT game.deposit_record($1, $2, $3, $4, $5, $6) AS v', [
      chain, tx, logIndex, block.toString(), from, amount.toString(),
    ]);
  }

  settlePending(chain: string, limit = 200): Promise<number> {
    return this.value('SELECT game.deposit_settle_pending($1, $2) AS v', [chain, limit]);
  }

  recordClaim(chain: string, cashout: string, id: bigint, recipient: string, amount: bigint, tx: string, block: bigint) {
    return this.value<Record<string, unknown>>('SELECT game.claim_record($1, $2, $3, $4, $5, $6, $7) AS v', [
      chain, cashout, id.toString(), recipient, amount.toString(), tx, block.toString(),
    ]);
  }

  watchList(chain: string): Promise<string[]> {
    return this.value('SELECT game.cashout_watch_list($1) AS v', [chain]);
  }

  async pendingVouchers(chain: string, limit = 50): Promise<PendingVoucher[]> {
    return (await this.pool.query('SELECT * FROM game.voucher_pending($1, $2)', [chain, limit])).rows;
  }

  storeSignature(v: PendingVoucher, signature: string) {
    return this.value<Record<string, unknown>>('SELECT game.voucher_store_signature($1, $2, $3, $4, $5, $6, $7, $8) AS v', [
      v.id, v.voucher_id, v.chain_id, v.cashout_address, v.recipient, v.amount, v.expiry, signature,
    ]);
  }

  async dueVouchers(chain: string, limit = 100): Promise<DueVoucher[]> {
    return (await this.pool.query('SELECT * FROM game.voucher_expiry_due($1, $2)', [chain, limit])).rows;
  }

  refund(id: string, onchainClaimed: boolean) {
    return this.value<Record<string, unknown>>('SELECT game.voucher_refund($1, $2) AS v', [id, onchainClaimed]);
  }

  async alert(chain: string, kind: string, detail: object): Promise<void> {
    await this.pool.query('SELECT game.chain_alert_add($1, $2, $3::jsonb)', [chain, kind, JSON.stringify(detail)]);
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
