declare namespace nkruntime {
  interface Context {
    userId?: string;
    username?: string;
    sessionId?: string;
    /** Session vars (scope, game, sid, ranked). Null for sessions without vars; always guard. */
    vars?: { [key: string]: string } | null;
    env: { [key: string]: string };
  }

  interface Logger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug(message: string): void;
  }

  interface Account {
    user?: { userId?: string; username?: string };
    email?: string;
    devices?: { id?: string }[];
    customId?: string;
  }

  interface StorageWrite {
    collection: string;
    key: string;
    userId: string;
    value: { [key: string]: unknown };
    /** OCC: "" or omitted = no check, "*" = only if absent, otherwise the version read. */
    version?: string;
    permissionRead: number;
    permissionWrite: number;
  }

  interface StorageReadRequest {
    collection: string;
    key: string;
    userId: string;
  }

  interface StorageObject {
    collection: string;
    key: string;
    userId: string;
    value: { [key: string]: unknown };
    version: string;
    permissionRead: number;
    permissionWrite: number;
    createTime: number;
    updateTime: number;
  }

  interface StorageWriteAck {
    collection: string;
    key: string;
    userId: string;
    version: string;
  }

  interface StorageDeleteRequest {
    collection: string;
    key: string;
    userId: string;
    version?: string;
  }

  /** One row of nk.matchList / nk.matchGet. `size` is live; the label can lag. */
  interface Match {
    matchId: string;
    authoritative: boolean;
    label: string;
    size: number;
    tickRate: number;
    handlerName: string;
  }

  interface User {
    userId: string;
    username: string;
    displayName?: string;
    avatarUrl?: string;
    metadata?: { [key: string]: unknown };
    online?: boolean;
  }

  interface FriendList {
    friends?: { user: User; state: number; updateTime?: number }[];
    cursor?: string;
  }

  /** Realtime envelope seen by RT before-hooks (camelCase keys, e.g. channelJoin, matchmakerAdd). */
  interface Envelope {
    cid?: string;
    channelJoin?: { target?: string; type?: number; persistence?: boolean; hidden?: boolean };
    channelMessageSend?: { channelId?: string; content?: string };
    channelMessageUpdate?: { channelId?: string; messageId?: string; content?: string };
    channelMessageRemove?: { channelId?: string; messageId?: string };
    matchmakerAdd?: {
      minCount?: number;
      maxCount?: number;
      query?: string;
      countMultiple?: number;
      stringProperties?: { [key: string]: string };
      numericProperties?: { [key: string]: number };
    };
    matchCreate?: { name?: string };
    matchJoin?: { matchId?: string; token?: string; metadata?: { [key: string]: string } };
    [key: string]: unknown;
  }

  type RtBeforeHook = (ctx: Context, logger: Logger, nk: Nakama, envelope: Envelope) => Envelope | void;

  interface Nakama {
    sqlQuery(query: string, args: unknown[]): { [key: string]: unknown }[];
    sqlExec(query: string, args: unknown[]): { rowsAffected: number };
    uuidv4(): string;
    sha256Hash(input: string): string;
    authenticateTokenGenerate(
      userId: string,
      username: string,
      exp: number | null,
      vars: { [key: string]: string },
    ): { token: string; exp: number };
    accountGetId(userId: string): Account;
    accountUpdateId(
      userId: string,
      username: string | null,
      displayName: string | null,
      timezone: string | null,
      location: string | null,
      langTag: string | null,
      avatarUrl: string | null,
      metadata: { [key: string]: unknown } | null,
    ): void;
    linkEmail(userId: string, email: string, password: string): void;
    linkCustom(userId: string, customId: string): void;
    linkDevice(userId: string, deviceId: string): void;
    unlinkDevice(userId: string, deviceId: string): void;
    storageWrite(objects: StorageWrite[]): StorageWriteAck[];
    storageRead(keys: StorageReadRequest[]): StorageObject[];
    storageDelete(objects: StorageDeleteRequest[]): void;
    matchList(limit: number, authoritative?: boolean | null, label?: string | null, minSize?: number | null, maxSize?: number | null, query?: string | null): Match[];
    matchGet(id: string): Match | null;
    matchSignal(id: string, data: string): string;
    usersGetId(userIds: string[], facebookIds?: string[] | null): User[];
    usersGetUsername(usernames: string[]): User[];
    /** Values must be string, number or boolean; objects throw (store JSON strings). TTL in seconds, 0 = none. */
    localcacheGet(key: string): string | number | boolean | null | undefined;
    localcachePut(key: string, value: string | number | boolean, ttl?: number): void;
    localcacheDelete(key: string): void;
    stringToBinary(str: string): ArrayBuffer;
    notificationSend(userId: string, subject: string, content: { [key: string]: unknown }, code: number, senderId?: string | null, persistent?: boolean): void;
    friendsList(userId: string, limit?: number, state?: number | null, cursor?: string): FriendList;
  }

  interface Initializer {
    registerRpc(id: string, fn: RpcFunction): void;
    /** id: "ChannelJoin", "ChannelMessageSend", "ChannelMessageUpdate", "ChannelMessageRemove", "MatchmakerAdd", "MatchCreate", … */
    registerRtBefore(id: string, fn: RtBeforeHook): void;
    registerBeforeAuthenticate(fn: BeforeHook): void;
    registerBeforeAuthenticateApple(fn: BeforeHook): void;
    registerBeforeAuthenticateCustom(fn: BeforeHook): void;
    registerBeforeAuthenticateDevice(fn: BeforeHook): void;
    registerBeforeAuthenticateEmail(fn: BeforeHook): void;
    registerBeforeAuthenticateFacebook(fn: BeforeHook): void;
    registerBeforeAuthenticateFacebookInstantGame(fn: BeforeHook): void;
    registerBeforeAuthenticateGameCenter(fn: BeforeHook): void;
    registerBeforeAuthenticateGoogle(fn: BeforeHook): void;
    registerBeforeAuthenticateSteam(fn: BeforeHook): void;
    registerBeforeSessionRefresh(fn: BeforeHook): void;
    registerBeforeLinkCustom(fn: BeforeHook): void;
    registerBeforeLink(fn: BeforeHook): void;
    registerBeforeLinkDevice(fn: BeforeHook): void;
    registerBeforeUnlinkCustom(fn: BeforeHook): void;
    registerBeforeUnlink(fn: BeforeHook): void;
    registerBeforeUnlinkDevice(fn: BeforeHook): void;
  }

  type RpcFunction = (ctx: Context, logger: Logger, nk: Nakama, payload: string) => string;
  type BeforeHook = (ctx: Context, logger: Logger, nk: Nakama, data: { [key: string]: unknown }) => { [key: string]: unknown };
}
