// Nakama match runtime APIs (authoritative matches: sproto_duel.ts, hub_match.ts, games/*.ts).
// Merges into the nkruntime declarations in nakama.d.ts.
declare namespace nkruntime {
  interface Context {
    matchId?: string;
  }

  interface Presence {
    userId: string;
    sessionId: string;
    username: string;
    node: string;
  }

  interface MatchMessage {
    sender: Presence;
    opCode: number;
    data: string | ArrayBuffer;
    reliable?: boolean;
  }

  interface MatchDispatcher {
    broadcastMessage(opCode: number, data: string | ArrayBuffer | null, presences?: Presence[] | null, sender?: Presence | null, reliable?: boolean): void;
    broadcastMessageDeferred?(opCode: number, data: string | ArrayBuffer | null, presences?: Presence[] | null, sender?: Presence | null, reliable?: boolean): void;
    matchKick(presences: Presence[]): void;
    matchLabelUpdate(label: string): void;
  }

  interface MatchmakerResult {
    properties: { [key: string]: string | number };
    presence: Presence;
  }

  interface Nakama {
    matchCreate(module: string, params: { [key: string]: unknown }): string;
    binaryToString(data: ArrayBuffer): string;
  }

  interface MatchHandler<S> {
    matchInit(ctx: Context, logger: Logger, nk: Nakama, params: { [key: string]: unknown }): { state: S; tickRate: number; label: string };
    matchJoinAttempt(ctx: Context, logger: Logger, nk: Nakama, dispatcher: MatchDispatcher, tick: number, state: S, presence: Presence, metadata: { [key: string]: unknown }): { state: S; accept: boolean; rejectMessage?: string } | null;
    matchJoin(ctx: Context, logger: Logger, nk: Nakama, dispatcher: MatchDispatcher, tick: number, state: S, presences: Presence[]): { state: S } | null;
    matchLeave(ctx: Context, logger: Logger, nk: Nakama, dispatcher: MatchDispatcher, tick: number, state: S, presences: Presence[]): { state: S } | null;
    matchLoop(ctx: Context, logger: Logger, nk: Nakama, dispatcher: MatchDispatcher, tick: number, state: S, messages: MatchMessage[]): { state: S } | null;
    matchTerminate(ctx: Context, logger: Logger, nk: Nakama, dispatcher: MatchDispatcher, tick: number, state: S, graceSeconds: number): { state: S } | null;
    matchSignal(ctx: Context, logger: Logger, nk: Nakama, dispatcher: MatchDispatcher, tick: number, state: S, data: string): { state: S; data?: string } | null;
  }

  type MatchmakerMatchedFunction = (ctx: Context, logger: Logger, nk: Nakama, matches: MatchmakerResult[]) => string | void;

  interface Initializer {
    registerMatch<S>(name: string, handler: MatchHandler<S>): void;
    registerMatchmakerMatched(fn: MatchmakerMatchedFunction): void;
  }
}
