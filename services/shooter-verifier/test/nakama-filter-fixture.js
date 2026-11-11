
// TEST IMAGE ONLY: never copy into the ordinary filtered Nakama target.
var filterFixtureOriginalInit = InitModule;
InitModule = function(ctx, logger, nk, initializer) {
  filterFixtureOriginalInit(ctx, logger, nk, initializer);
  initializer.registerRpc('test.filter.driver', function(_ctx, _logger, db, payload) {
    // The real driver error deliberately reaches Nakama's automatic args logger.
    var checkpoint = JSON.parse(payload);
    db.sqlQuery("WITH tag AS MATERIALIZED (SELECT set_config('application_name','filter-driver-fixture',true)) SELECT $1::jsonb AS private_checkpoint, pg_sleep(30) FROM tag", [JSON.stringify(checkpoint)]);
    return JSON.stringify({unexpected:true});
  });
};
