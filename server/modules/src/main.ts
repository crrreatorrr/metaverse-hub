function guard(fn: nkruntime.RpcFunction, ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  try {
    return fn(ctx, logger, nk, payload);
  } catch (e) {
    var mapped = HubRpc.mapError(e);
    if (mapped) return HubRpc.fail(mapped, mapped);
    logger.error("rpc failure " + String(e));
    throw e;
  }
}

function rpcHealthcheck(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(HubRpc.health, ctx, logger, nk, payload);
}

function rpcProfile(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(HubRpc.profile, ctx, logger, nk, payload);
}

function rpcPortalEnter(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(HubRpc.portalEnter, ctx, logger, nk, payload);
}

function rpcSessionEvent(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(HubRpc.sessionEvent, ctx, logger, nk, payload);
}

function rpcSessionClose(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(HubRpc.sessionClose, ctx, logger, nk, payload);
}

function rpcScoreSubmit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(HubRpc.scoreSubmit, ctx, logger, nk, payload);
}

function rpcTicketsEarn(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(HubRpc.ticketsEarn, ctx, logger, nk, payload);
}

function rpcTicketsExchange(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(HubRpc.ticketsExchange, ctx, logger, nk, payload);
}

function rpcTicketsSpend(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(HubRpc.ticketsSpend, ctx, logger, nk, payload);
}

function rpcTicketsSell(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(HubRpc.ticketsSell, ctx, logger, nk, payload);
}

function rpcTicketsBalance(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(HubRpc.ticketsBalance, ctx, logger, nk, payload);
}

function rpcRecoveryCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(HubRpc.recoveryCreate, ctx, logger, nk, payload);
}

function rpcRecoveryRedeem(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(HubRpc.recoveryRedeem, ctx, logger, nk, payload);
}

function rpcVerseBoard(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(HubRpc.verseBoard, ctx, logger, nk, payload);
}

function rpcAccountClaim(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(HubRpc.accountClaim, ctx, logger, nk, payload);
}

function rpcSprotoDevReplay(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(SprotoDuel.rpcReplay, ctx, logger, nk, payload);
}

function rpcHubJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(HubRealtimeRpc.join, ctx, logger, nk, payload);
}

function rpcChatReport(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(HubRealtimeRpc.report, ctx, logger, nk, payload);
}

type HubState = HubMatch.State;
function hubInit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, params: { [key: string]: unknown }) {
  return HubMatch.handler.matchInit(ctx, logger, nk, params);
}
function hubJoinAttempt(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: HubState, presence: nkruntime.Presence, metadata: { [key: string]: unknown }) {
  return HubMatch.handler.matchJoinAttempt(ctx, logger, nk, dispatcher, tick, state, presence, metadata);
}
function hubJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: HubState, presences: nkruntime.Presence[]) {
  return HubMatch.handler.matchJoin(ctx, logger, nk, dispatcher, tick, state, presences);
}
function hubLeave(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: HubState, presences: nkruntime.Presence[]) {
  return HubMatch.handler.matchLeave(ctx, logger, nk, dispatcher, tick, state, presences);
}
function hubLoop(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: HubState, messages: nkruntime.MatchMessage[]) {
  return HubMatch.handler.matchLoop(ctx, logger, nk, dispatcher, tick, state, messages);
}
function hubTerminate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: HubState, graceSeconds: number) {
  return HubMatch.handler.matchTerminate(ctx, logger, nk, dispatcher, tick, state, graceSeconds);
}
function hubSignal(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: HubState, data: string) {
  return HubMatch.handler.matchSignal(ctx, logger, nk, dispatcher, tick, state, data);
}

type DuelState = SprotoDuel.DuelState;
// Nakama resolves match handlers by top-level function name, so each callback is a named wrapper.
function sprotoDuelInit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, params: { [key: string]: unknown }) {
  return SprotoDuel.handler.matchInit(ctx, logger, nk, params);
}
function sprotoDuelJoinAttempt(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: DuelState, presence: nkruntime.Presence, metadata: { [key: string]: unknown }) {
  return SprotoDuel.handler.matchJoinAttempt(ctx, logger, nk, dispatcher, tick, state, presence, metadata);
}
function sprotoDuelJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: DuelState, presences: nkruntime.Presence[]) {
  return SprotoDuel.handler.matchJoin(ctx, logger, nk, dispatcher, tick, state, presences);
}
function sprotoDuelLeave(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: DuelState, presences: nkruntime.Presence[]) {
  return SprotoDuel.handler.matchLeave(ctx, logger, nk, dispatcher, tick, state, presences);
}
function sprotoDuelLoop(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: DuelState, messages: nkruntime.MatchMessage[]) {
  return SprotoDuel.handler.matchLoop(ctx, logger, nk, dispatcher, tick, state, messages);
}
function sprotoDuelTerminate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: DuelState, graceSeconds: number) {
  return SprotoDuel.handler.matchTerminate(ctx, logger, nk, dispatcher, tick, state, graceSeconds);
}
function sprotoDuelSignal(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: DuelState, data: string) {
  return SprotoDuel.handler.matchSignal(ctx, logger, nk, dispatcher, tick, state, data);
}
// The one matchmaker hook Nakama allows. Games route through HubGames.register (Contract C4).
function hubMatchmakerMatched(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, matches: nkruntime.MatchmakerResult[]): string | void {
  return HubRt.onMatched(ctx, logger, nk, matches);
}

function rtBeforeMatchmakerAdd(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, envelope: nkruntime.Envelope): nkruntime.Envelope | void {
  return HubRt.beforeMatchmakerAdd(ctx, logger, nk, envelope);
}

function rtBeforeMatchCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, envelope: nkruntime.Envelope): nkruntime.Envelope | void {
  return HubRt.beforeMatchCreate(ctx, logger, nk, envelope);
}

function rtBeforeChannelJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, envelope: nkruntime.Envelope): nkruntime.Envelope | void {
  return HubChat.beforeJoin(ctx, logger, nk, envelope);
}

function rtBeforeChannelMessageSend(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, envelope: nkruntime.Envelope): nkruntime.Envelope | void {
  return HubChat.beforeSend(ctx, logger, nk, envelope);
}

function rtBeforeChannelMessageEdit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, envelope: nkruntime.Envelope): nkruntime.Envelope | void {
  return HubChat.beforeReadonly(ctx, logger, nk, envelope);
}

function beforeCustom(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: { [key: string]: unknown }): { [key: string]: unknown } {
  return HubRpc.beforeAuthenticateCustom(ctx, logger, nk, data);
}

function beforeHub(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: { [key: string]: unknown }): { [key: string]: unknown } {
  return HubRpc.beforeAuthenticateDevice(ctx, logger, nk, data);
}

function beforeClosed(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: { [key: string]: unknown }): { [key: string]: unknown } {
  return HubRpc.beforeAuthenticateClosed(ctx, logger, nk, data);
}

function beforeRefresh(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: { [key: string]: unknown }): { [key: string]: unknown } {
  return HubRpc.beforeSessionRefresh(ctx, logger, nk, data);
}

function beforeLinkCustom(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: { [key: string]: unknown }): { [key: string]: unknown } {
  return HubRpc.beforeLinkCustom(ctx, logger, nk, data);
}

function beforeLinkDevice(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: { [key: string]: unknown }): { [key: string]: unknown } {
  return HubRpc.beforeLinkDevice(ctx, logger, nk, data);
}

function InitModule(
  _ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  initializer: nkruntime.Initializer,
): void {
  HubSchema.apply(nk, logger);
  initializer.registerRpc("healthcheck", rpcHealthcheck);
  initializer.registerRpc("profile.get", rpcProfile);
  initializer.registerRpc("portal.enter", rpcPortalEnter);
  initializer.registerRpc("session.event", rpcSessionEvent);
  initializer.registerRpc("session.close", rpcSessionClose);
  initializer.registerRpc("score.submit", rpcScoreSubmit);
  initializer.registerRpc("tickets.earn", rpcTicketsEarn);
  initializer.registerRpc("tickets.exchange", rpcTicketsExchange);
  initializer.registerRpc("tickets.spend", rpcTicketsSpend);
  initializer.registerRpc("tickets.sell", rpcTicketsSell);
  initializer.registerRpc("tickets.balance", rpcTicketsBalance);
  initializer.registerRpc("recovery.create", rpcRecoveryCreate);
  initializer.registerRpc("recovery.redeem", rpcRecoveryRedeem);
  initializer.registerRpc("verse.board", rpcVerseBoard);
  initializer.registerRpc("account.claim", rpcAccountClaim);
  initializer.registerRpc("sproto.dev_replay", rpcSprotoDevReplay);
  initializer.registerMatch("sproto_duel", {
    matchInit: sprotoDuelInit,
    matchJoinAttempt: sprotoDuelJoinAttempt,
    matchJoin: sprotoDuelJoin,
    matchLeave: sprotoDuelLeave,
    matchLoop: sprotoDuelLoop,
    matchTerminate: sprotoDuelTerminate,
    matchSignal: sprotoDuelSignal,
  });
  initializer.registerRpc("hub.join", rpcHubJoin);
  initializer.registerRpc("chat.report", rpcChatReport);
  initializer.registerMatch("hub", {
    matchInit: hubInit,
    matchJoinAttempt: hubJoinAttempt,
    matchJoin: hubJoin,
    matchLeave: hubLeave,
    matchLoop: hubLoop,
    matchTerminate: hubTerminate,
    matchSignal: hubSignal,
  });
  initializer.registerMatchmakerMatched(hubMatchmakerMatched);
  initializer.registerRtBefore("MatchmakerAdd", rtBeforeMatchmakerAdd);
  initializer.registerRtBefore("MatchCreate", rtBeforeMatchCreate);
  initializer.registerRtBefore("ChannelJoin", rtBeforeChannelJoin);
  initializer.registerRtBefore("ChannelMessageSend", rtBeforeChannelMessageSend);
  initializer.registerRtBefore("ChannelMessageUpdate", rtBeforeChannelMessageEdit);
  initializer.registerRtBefore("ChannelMessageRemove", rtBeforeChannelMessageEdit);

  // Game registrations (Contract C5). Inside its block a game adds only
  // initializer.registerMatch(...) / initializer.registerRpc(...) lines (plus PB's
  // boot-time world creation). Each argument is a top-level named function.
  // >>> game: sproto (Sproto Duel) registrations
  // <<< game: sproto
  // ----
  // >>> game: peoples-bitcoin registrations
  // <<< game: peoples-bitcoin

  initializer.registerBeforeAuthenticateCustom(beforeCustom);
  initializer.registerBeforeAuthenticateDevice(beforeHub);
  // Email auth is on in Nakama with no extra provider config. Same hub scope as device.
  initializer.registerBeforeAuthenticateEmail(beforeHub);
  // These providers are not configured. Reject them instead of minting a session.
  // The generic Authenticate hook is the same: this runtime registers no providers.
  initializer.registerBeforeAuthenticate(beforeClosed);
  initializer.registerBeforeAuthenticateApple(beforeClosed);
  initializer.registerBeforeAuthenticateFacebook(beforeClosed);
  initializer.registerBeforeAuthenticateFacebookInstantGame(beforeClosed);
  initializer.registerBeforeAuthenticateGameCenter(beforeClosed);
  initializer.registerBeforeAuthenticateGoogle(beforeClosed);
  initializer.registerBeforeAuthenticateSteam(beforeClosed);
  initializer.registerBeforeSessionRefresh(beforeRefresh);
  initializer.registerBeforeLinkCustom(beforeLinkCustom);
  initializer.registerBeforeUnlinkCustom(beforeLinkCustom);
  initializer.registerBeforeLinkDevice(beforeLinkDevice);
  initializer.registerBeforeUnlinkDevice(beforeLinkDevice);
  // Provider-agnostic link and unlink are closed: this runtime registers no providers.
  initializer.registerBeforeLink(beforeClosed);
  initializer.registerBeforeUnlink(beforeClosed);
  // Plaza shard 1 lives for the whole process; more shards open on demand (hub.join).
  nk.matchCreate("hub", { shard: "1" });
  logger.info("metaverse hub runtime ready");
}
