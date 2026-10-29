interface TicketClaims {
  jti: string;
  sid: string;
  game: string;
  uid: string;
  ranked: boolean;
  exp: number;
  iat: number;
  iss: string;
}

namespace HubTickets {
  var ISSUER = "hub";

  function keyOf(ctx: nkruntime.Context): string {
    var key = ctx.env ? ctx.env.TICKET_HMAC_KEY : "";
    if (!key) throw new Error("missing_ticket_key");
    return key;
  }

  function same(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff = diff | (a.charCodeAt(i) ^ b.charCodeAt(i));
    return diff === 0;
  }

  function sign(nk: nkruntime.Nakama, key: string, payload: string): string {
    return nk.base64UrlEncode(nk.hmacSha256Hash(payload, key), false);
  }

  export function issue(
    ctx: nkruntime.Context,
    nk: nkruntime.Nakama,
    claims: TicketClaims,
  ): string {
    var payload = nk.base64UrlEncode(JSON.stringify(claims), false);
    return payload + "." + sign(nk, keyOf(ctx), payload);
  }

  export function read(ctx: nkruntime.Context, nk: nkruntime.Nakama, ticket: string): TicketClaims | null {
    if (!ticket || ticket.length > 4096) return null;
    var parts = ticket.split(".");
    if (parts.length !== 2) return null;
    var payload = parts[0];
    var sig = parts[1];
    if (!payload || !sig) return null;
    var expected = sign(nk, keyOf(ctx), payload);
    if (!same(expected, sig)) return null;
    var parsed: { [key: string]: unknown };
    try {
      parsed = JSON.parse(nk.binaryToString(nk.base64UrlDecode(payload, false)));
    } catch {
      return null;
    }
    if (!parsed || parsed.iss !== ISSUER) return null;
    if (typeof parsed.jti !== "string" || typeof parsed.sid !== "string") return null;
    if (typeof parsed.game !== "string" || typeof parsed.uid !== "string") return null;
    if (typeof parsed.ranked !== "boolean") return null;
    if (typeof parsed.exp !== "number" || typeof parsed.iat !== "number") return null;
    var claims: TicketClaims = {
      jti: parsed.jti,
      sid: parsed.sid,
      game: parsed.game,
      uid: parsed.uid,
      ranked: parsed.ranked,
      exp: parsed.exp,
      iat: parsed.iat,
      iss: ISSUER,
    };
    return claims;
  }
}
