declare namespace nkruntime {
  interface Context {
    userId?: string;
    vars?: { [key: string]: string };
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
    devices?: { id?: string }[];
    customId?: string;
  }

  interface StorageWrite {
    collection: string;
    key: string;
    userId: string;
    value: { [key: string]: string | number | boolean };
    permissionRead: number;
    permissionWrite: number;
  }

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
    linkCustom(userId: string, customId: string): void;
    linkDevice(userId: string, deviceId: string): void;
    unlinkDevice(userId: string, deviceId: string): void;
    storageWrite(objects: StorageWrite[]): void;
  }

  interface Initializer {
    registerRpc(id: string, fn: RpcFunction): void;
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
    registerBeforeLinkDevice(fn: BeforeHook): void;
    registerBeforeUnlinkCustom(fn: BeforeHook): void;
    registerBeforeUnlinkDevice(fn: BeforeHook): void;
  }

  type RpcFunction = (ctx: Context, logger: Logger, nk: Nakama, payload: string) => string;
  type BeforeHook = (ctx: Context, logger: Logger, nk: Nakama, data: { [key: string]: unknown }) => { [key: string]: unknown };
}
