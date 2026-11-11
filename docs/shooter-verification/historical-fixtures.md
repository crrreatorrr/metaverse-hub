# Historical migration fixtures

The broad duplication suite reconstructs a pre0003 PB database and a genuine
pre-latest verification schema. This is disposable GitHub Actions test
construction, never production rollback, repair or migration reapplication.
It requires the explicit `HUB_MIGRATION_FIXTURE=verification-history` profile.

Before removing any verification DDL, the fixture checks every discovered family
table. Identity, cohort, input, checkpoint, job, attempt, acknowledgment, operator
and derived payment-proof tables must be empty. The known configuration
singletons must be default off, unconfigured and have zero retained/reserved/rate
counters. Unknown nonempty tables fail closed. No accepted evidence is deleted.

All verification-family tables are dropped together without CASCADE, followed
by only their family functions, including the private append alias. Unexpected
dependencies from other objects fail rather than being removed. Legacy wallet,
ledger, run and payment tables remain, with full-row financial hashes checked.
Catalog discovery includes future derived tables such as0058 payment_work.

The pre0003 fixture necessarily parks later migration history while the real
current Nakama runner replays it. It preserves the exact independent PB0050 row
outside that historical cut, verifies its replayed checksum against both the
original row and unchanged code, then restores its original applied timestamp.
Production checksum and out-of-order guards remain unchanged.

The in-order regression reconstructs previous verification DDL from unchanged
registered statement bytes and restores each previous exact checksum/timestamp.
The latest migration remains genuinely unapplied until the actual current
Nakama boot applies it once. All other history, including PB0050, and populated
canonical wallet/ledger/idempotency rows retain their exact IDs and timestamps.
This avoids pretending an applied non-idempotent migration is pending merely
by deleting its ledger row while leaving its tables, columns and triggers.
