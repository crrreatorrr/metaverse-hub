// Wallet RPCs for the Bar exchange machine. Design: docs/crypto-exchange-design.md.
// Hub-scope sessions only: a game session can never link a wallet or cash out.
namespace HubWallet {
  var ADDRESS = /^0x[0-9a-fA-F]{40}$/;
  var SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
  var NONCE = /^[0-9a-f]{64}$/;
  var CHAINS: { [chain: string]: boolean } = { eth: true };
  // Store items that can be paid for with $BITCOIN at checkout. Prices are Verse and are
  // the only prices accepted; the client never sets a price.
  var STORE_PRICES: { [itemId: string]: number } = { pet_hopium_sproto: 400, pet_coom_sproto: 600 };
  var MAX_WITHDRAW = 1000000000;

  function chainOf(body: { [key: string]: unknown }): string {
    var chain = HubRpc.text(body, "chain") || "eth";
    if (!CHAINS[chain]) throw new Error("bad_chain");
    return chain;
  }

  function env(ctx: nkruntime.Context, key: string): string {
    var value = ctx.env ? ctx.env[key] : "";
    if (!value) throw new Error("missing_" + key.toLowerCase());
    return value;
  }

  function result(r: { [key: string]: unknown }): string {
    if (r.error) return HubRpc.fail(String(r.error), String(r.error));
    return HubRpc.ok(r);
  }

  /** Asks the chain service which address signed `message`. Returns "" on any failure. */
  function recoverSigner(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, message: string, signature: string): string {
    var res: nkruntime.HttpResponse;
    try {
      res = nk.httpRequest(
        env(ctx, "CHAIN_SERVICE_URL") + "/verify",
        "post",
        { "content-type": "application/json", "x-chain-service-key": env(ctx, "CHAIN_SERVICE_KEY") },
        JSON.stringify({ message: message, signature: signature }),
        5000,
      );
    } catch (e) {
      logger.error("chain service verify failed " + String(e));
      throw new Error("chain_unavailable");
    }
    if (res.code !== 200) {
      logger.warn("chain service verify status " + res.code);
      return "";
    }
    var data = JSON.parse(res.body) as { address?: unknown };
    return typeof data.address === "string" && ADDRESS.test(data.address) ? data.address : "";
  }

  export function nonce(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = HubRpc.requireHubScope(ctx);
    var body = HubRpc.parse(payload);
    var chain = chainOf(body);
    var address = HubRpc.text(body, "address");
    if (!ADDRESS.test(address)) return HubRpc.fail("bad_address", "Wallet address is not valid");
    return result(HubRpc.queryJson(
      nk,
      "SELECT game.link_nonce_create($1::uuid, $2::text, $3::text, $4::text, $5::text)::text AS result",
      [userId, chain, address, env(ctx, "HUB_DOMAIN"), env(ctx, "HUB_URI")],
    ));
  }

  export function link(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = HubRpc.requireHubScope(ctx);
    var body = HubRpc.parse(payload);
    var nonceValue = HubRpc.text(body, "nonce");
    var signature = HubRpc.text(body, "signature");
    if (!NONCE.test(nonceValue)) return HubRpc.fail("bad_nonce", "Sign-in request is not valid");
    if (!SIGNATURE.test(signature)) return HubRpc.fail("bad_signature", "Signature is not valid");
    var pending = HubRpc.queryJson(
      nk,
      "SELECT COALESCE(game.link_nonce_get($1::uuid, $2::text), '{}'::jsonb)::text AS result",
      [userId, nonceValue],
    );
    if (typeof pending.message !== "string") return HubRpc.fail("bad_nonce", "Sign-in request expired; start again");
    var recovered = recoverSigner(ctx, logger, nk, pending.message, signature);
    return result(HubRpc.queryJson(
      nk,
      "SELECT game.wallet_link_apply($1::uuid, $2::text, $3::text)::text AS result",
      [userId, nonceValue, recovered || "0x0000000000000000000000000000000000000000"],
    ));
  }

  export function status(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama): string {
    var userId = HubRpc.requireHubScope(ctx);
    return result(HubRpc.queryJson(nk, "SELECT game.wallet_status($1::uuid)::text AS result", [userId]));
  }

  export function withdraw(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = HubRpc.requireHubScope(ctx);
    var body = HubRpc.parse(payload);
    var chain = chainOf(body);
    var key = HubRpc.text(body, "key");
    var amount = body.amount;
    if (!key || key.length > 80) return HubRpc.fail("bad_key", "Idempotency key is required");
    if (typeof amount !== "number" || !isFinite(amount) || amount !== Math.floor(amount) || amount <= 0 || amount > MAX_WITHDRAW) {
      return HubRpc.fail("bad_amount", "Cash-out amount must be a whole number of Verse");
    }
    var reqHash = nk.sha256Hash("wallet.withdraw\n" + HubRpc.stable({ amount: amount, chain: chain }));
    return result(HubRpc.queryJson(
      nk,
      "SELECT game.withdraw_verse($1::uuid, $2::text, $3::bigint, $4::text, $5::text)::text AS result",
      [userId, chain, amount, key, reqHash],
    ));
  }

  export function intent(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = HubRpc.requireHubScope(ctx);
    var body = HubRpc.parse(payload);
    var chain = chainOf(body);
    var itemId = HubRpc.text(body, "itemId");
    var price = STORE_PRICES.hasOwnProperty(itemId) ? STORE_PRICES[itemId] : 0;
    if (!price) return HubRpc.fail("bad_item", "That item cannot be bought with $BITCOIN");
    return result(HubRpc.queryJson(
      nk,
      "SELECT game.purchase_intent_create($1::uuid, $2::text, $3::text, $4::bigint)::text AS result",
      [userId, chain, itemId, price],
    ));
  }
}
