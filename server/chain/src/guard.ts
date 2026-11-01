// The voucher signer's own limits, persisted on the signer's disk rather than in the database.
// If the database is compromised and floods 'issued' rows, the signer still stops at the
// daily cap. A halt (set on a security alert) stops all signing until an operator clears it.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

interface State {
  day: string;
  signedVerse: number;
  halted: string | null;
}

export class SignerGuard {
  private state: State;

  constructor(
    private readonly file: string,
    private readonly dailyMax: number,
    private readonly maxVoucher: number,
    private readonly maxTtlSeconds: number,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.state = existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as State)
      : { day: this.today(), signedVerse: 0, halted: null };
  }

  private today(): string {
    return this.now().toISOString().slice(0, 10);
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.state));
    renameSync(tmp, this.file);
  }

  get halted(): string | null {
    return this.state.halted;
  }

  halt(reason: string): void {
    if (this.state.halted) return;
    this.state.halted = reason;
    this.save();
  }

  /** Reserves `amount` Verse of today's budget, or explains why not. Call before signing. */
  reserve(amount: number, expiry: number): string | null {
    if (this.state.halted) return 'halted: ' + this.state.halted;
    if (this.dailyMax <= 0 || this.maxVoucher <= 0) return 'signer limits are not configured';
    if (amount <= 0 || amount > this.maxVoucher) return `amount ${amount} is over SIGNER_MAX_VOUCHER_VERSE`;
    const ttl = expiry - Math.floor(this.now().getTime() / 1000);
    if (ttl <= 0 || ttl > this.maxTtlSeconds) return `expiry is outside 0..SIGNER_MAX_TTL_SECONDS`;
    if (this.state.day !== this.today()) this.state = { day: this.today(), signedVerse: 0, halted: this.state.halted };
    if (this.state.signedVerse + amount > this.dailyMax) return 'SIGNER_DAILY_MAX_VERSE reached';
    this.state.signedVerse += amount;
    this.save();
    return null;
  }
}
