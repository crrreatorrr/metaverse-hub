# Migration allocations

Check current main **and open pull requests** before allocating a numeric prefix.
A reserved prefix belongs to its linked work even before merge. Update this list
when merging; do not edit an applied migration's ID or statement body.

| Prefix | Allocation |
| --- | --- |
| 0050 | Historical independent pair: `0050_pb_campaign_pistol_price` (#147) and `0050_shooter_verification_queue` (#141), both merged |
| 0051 | Verification ingestion, #144 |
| 0052 | Verification jobs and leases, #150 |
| 0053 | Scoped worker gateway, #152 |
| 0054 | Atomic verification commits, #153 |
| 0055 | Deferred settlement, in progress |
| 0056 | Verification issuance/finish lifecycle companion, in progress |

The two 0050 migrations merged independently. Their full IDs are ledger keys;
renumbering either could orphan recorded history or replay an already applied
body. The runner permits only those two exact identities to share that prefix,
ordered PB then Shooter. Their SQL concerns independent shop-price and queue
objects. Every other duplicate full ID or numeric prefix remains an error.

The existing checksum, missing-code, advisory-lock and out-of-order checks are
unchanged. Fresh databases apply both. A database with either 0050 recorded and
no later migration can apply its missing sibling while preserving recorded
checksums and `applied_at`. A database with a later recorded migration but a
missing 0050 sibling still fails closed; this patch does not authorize history
rewrites or production recovery operations. Investigate and prepare a separate
reviewed recovery before changing such a database.

All compatibility validation uses disposable GitHub Actions databases. No
production database inspection, migration application or deployment is implied.
