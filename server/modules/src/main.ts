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

function rpcSessionRedeem(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(HubRpc.sessionRedeem, ctx, logger, nk, payload);
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

function beforeCustom(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: { [key: string]: unknown }): { [key: string]: unknown } {
  return HubRpc.beforeAuthenticateCustom(ctx, logger, nk, data);
}

function beforeDevice(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: { [key: string]: unknown }): { [key: string]: unknown } {
  return HubRpc.beforeAuthenticateDevice(ctx, logger, nk, data);
}

function beforeRefresh(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: { [key: string]: unknown }): { [key: string]: unknown } {
  return HubRpc.beforeSessionRefresh(ctx, logger, nk, data);
}

function beforeLink(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: { [key: string]: unknown }): { [key: string]: unknown } {
  return HubRpc.beforeLinkIdentity(ctx, logger, nk, data);
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
  initializer.registerRpc("session.redeem", rpcSessionRedeem);
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
  initializer.registerBeforeAuthenticateCustom(beforeCustom);
  initializer.registerBeforeAuthenticateDevice(beforeDevice);
  initializer.registerBeforeSessionRefresh(beforeRefresh);
  initializer.registerBeforeLinkCustom(beforeLink);
  initializer.registerBeforeLinkDevice(beforeLink);
  initializer.registerBeforeUnlinkCustom(beforeLink);
  initializer.registerBeforeUnlinkDevice(beforeLink);
  logger.info("metaverse hub runtime ready");
}
