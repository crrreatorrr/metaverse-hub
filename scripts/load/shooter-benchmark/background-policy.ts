// Pure finite normal-round workload policy. No authentication, SQL or timers.
import { createHash } from 'node:crypto';
export const BACKGROUND_PROFILE_MS = 900000;
export const NORMAL_ROUND_MS = 90000;
export const PVP_SLOT_LIMIT = 10;
export const PVP_REPLACEMENT_LIMIT = PVP_SLOT_LIMIT * Math.ceil(BACKGROUND_PROFILE_MS / NORMAL_ROUND_MS);
export const PVP_INITIAL_LIMIT = PVP_SLOT_LIMIT;
export const CREATE_RETRY_BUDGET_MS = 10000;
export const CREATE_RETRY_DELAY_MS = 250;
export const CREATE_ATTEMPT_LIMIT = 3;
export const ROOM_OPERATION_LIMIT = (PVP_INITIAL_LIMIT + PVP_REPLACEMENT_LIMIT) * (CREATE_ATTEMPT_LIMIT + 1);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface ParticipantIdentity { accountId: string; sessionId: string; }
export interface ParticipantProof { slot: number; accountBindingHashes: [string, string]; sessionBindingHashes: [string, string]; }
function identities(slot: number, pair: readonly ParticipantIdentity[]): ParticipantProof {
  if (!Number.isInteger(slot) || slot < 0 || slot >= PVP_SLOT_LIMIT || pair.length !== 2
    || pair.some(value => !UUID.test(value.accountId) || !UUID.test(value.sessionId))) throw new Error('background_participant_binding_invalid');
  const accounts = pair.map(value => digest(value.accountId)) as [string, string];
  const sessions = pair.map(value => digest(value.sessionId)) as [string, string];
  if (accounts[0] === accounts[1] || sessions[0] === sessions[1]) throw new Error('background_participants_not_independent');
  return { slot, accountBindingHashes: accounts, sessionBindingHashes: sessions };
}
export class FixedSlotParticipants<T> {
  private readonly slots = new Map<number, Promise<readonly [T, T]>>();
  private readonly bindings = new Map<number, ParticipantProof>();
  constructor(private readonly identify: (value: T) => ParticipantIdentity) {}
  async get(slot: number, create: () => Promise<T>): Promise<readonly [T, T]> {
    if (!Number.isInteger(slot) || slot < 0 || slot >= PVP_SLOT_LIMIT) throw new Error('background_slot_bound');
    let promise = this.slots.get(slot);
    if (!promise) {
      promise = (async () => {
        const a = await create(), b = await create();
        const proof = identities(slot, [this.identify(a), this.identify(b)]);
        for (const prior of this.bindings.values()) {
          if (proof.accountBindingHashes.some(id => prior.accountBindingHashes.includes(id))
            || proof.sessionBindingHashes.some(id => prior.sessionBindingHashes.includes(id))) throw new Error('background_participant_reused_across_slots');
        }
        this.bindings.set(slot, proof);
        return Object.freeze([a, b]) as readonly [T, T];
      })();
      this.slots.set(slot, promise);
    }
    const pair = await promise, actual = identities(slot, pair.map(this.identify)), original = this.bindings.get(slot)!;
    if (actual.accountBindingHashes.some((id, i) => id !== original.accountBindingHashes[i])
      || actual.sessionBindingHashes.some((id, i) => id !== original.sessionBindingHashes[i])) throw new Error('background_original_participant_changed');
    return pair;
  }
  evidence(): ParticipantProof[] {
    return [...this.bindings.values()].sort((a, b) => a.slot - b.slot).map(value => ({ slot: value.slot,
      accountBindingHashes: [...value.accountBindingHashes] as [string, string], sessionBindingHashes: [...value.sessionBindingHashes] as [string, string] }));
  }
}
export function assertOriginalCredential(token: string, identity: ParticipantIdentity, nowMs: number): void {
  let claims: { uid?: unknown; exp?: unknown; vrs?: { scope?: unknown; game?: unknown; sid?: unknown } };
  try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); }
  catch { throw new Error('background_original_credential_invalid'); }
  if (!claims || typeof claims !== 'object') throw new Error('background_original_credential_invalid');
  if (claims.uid !== identity.accountId || claims.vrs?.scope !== 'game' || claims.vrs.game !== 'sproto-shooter'
    || claims.vrs.sid !== identity.sessionId || typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.exp * 1000)
    || !Number.isFinite(nowMs) || claims.exp * 1000 <= nowMs) throw new Error('background_original_credential_expired_or_changed');
}
export function allowOrdinaryCreateRetry(reason: unknown, attempts: number, elapsedMs: number): boolean {
  return reason === 'already_in_match' && attempts < CREATE_ATTEMPT_LIMIT && elapsedMs >= 0
    && elapsedMs + CREATE_RETRY_DELAY_MS < CREATE_RETRY_BUDGET_MS;
}
export class CreateRateBudget {
  private readonly attempts = new Map<string, number[]>();
  note(accountHash: string, nowMs: number): void {
    if (!/^[0-9a-f]{64}$/.test(accountHash) || !Number.isFinite(nowMs)) throw new Error('background_create_budget_invalid');
    if (!this.attempts.has(accountHash) && this.attempts.size >= PVP_SLOT_LIMIT * 2) throw new Error('background_create_account_bound');
    const current = (this.attempts.get(accountHash) || []).filter(time => nowMs - time < 60000);
    if (current.length >= 5) throw new Error('background_create_rate_budget_exhausted');
    current.push(nowMs); this.attempts.set(accountHash, current);
  }
}
