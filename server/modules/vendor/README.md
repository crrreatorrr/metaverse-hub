# Vendored simulations

`server/modules/append-vendor.mjs` appends every `*.js` here to the Nakama module. Each bundle has a
`*.pin.json` that a CI script checks against the bundle and against the game repo's `main`.

| Bundle | Built in | Check |
|---|---|---|
| `shooter-sim.js` | sproto-shooter, `npm run build:server-sim` | `scripts/check-shooter-sim-version.mjs` (CI `verify` job) |
| `coop-sim.js` | Sproto-Coop-Battle., `scripts/build-server-sim.mjs` | `scripts/check-coop-sim-version.mjs` (compares bundle hashes, not commits) |
| `sproto-sim.js` | Sproto-Fighter, `scripts/build-sim-bundle.mjs` | `scripts/check-sproto-sim-version.mjs` (compares `SIM_VERSION`, not commits) |

## Shooter campaign verifier

### What the check accepts

`check-shooter-sim-version.mjs` first checks the local files: the bundle hash, the commit baked into the
bundle, `ShooterRewards.COMMIT`/`BUNDLE_SHA256`/`FINGERPRINT`, protocol 1, and that the bundle cannot
mint Tickets. Then it reads sproto-shooter `main` and passes in one of two cases:

- `pin-is-main`: `main` is the pinned commit.
- `ancestor-unchanged`: the pinned commit is an ancestor of `main` (GitHub compare
  `<pin>...<main>` says `ahead` with the pin as merge base), and none of the changed files feeds the
  campaign bundle.

A file feeds the bundle (`scripts/shooter-pin-drift.mjs`) when it is:

- listed in the pin's `bundleInputs`, the esbuild metafile inputs of `src/server/verify.js` at the
  pinned commit
- under `src/core/`, `src/data/`, `src/server/` or `src/sim/`, except `src/sim/pvp/` (the free 1v1
  arena, a separate export; if the campaign ever imports from it, that edits a recorded input)
- `scripts/build-server-sim.mjs`, `package-lock.json`, or any `package.json`, `tsconfig*.json` or
  `jsconfig*.json`

Everything else fails: a changed source (the failure lists the files), a pin that is not an ancestor of
`main`, or a compare that GitHub truncated at 300 files. `--strict` (or `SHOOTER_PIN_STRICT=1`)
restores the old rule that `main` must equal the pin.

Locally, Node's `fetch` ignores `HTTPS_PROXY`. Behind a proxy, run it with `NODE_USE_ENV_PROXY=1`.

### Re-vendoring

Do this when the check fails with `bundle-sources-changed`, or to move the pin forward.

1. In a clean clone of sproto-shooter at the new commit (not a working checkout), run `npm ci` and
   `npm run build:server-sim`. It writes `build/shooter-sim.js` and `build/shooter-sim.pin.json`.
2. Copy `build/shooter-sim.js` here.
3. In `shooter-sim.pin.json`, set `commit`/`sourceCommit`, `sha256`/`bundleSha256` and `bundleBytes`
   from the built pin. If `contentFingerprint` or the protocol changed, that is a contract change: stop
   and update the hub's Shooter settlement deliberately.
4. Regenerate `bundleInputs`: the sorted keys of the esbuild metafile `inputs` for an esbuild build of
   `src/server/verify.js` with the options in `build-server-sim.mjs` and `metafile: true`.
5. Set `COMMIT` and `BUNDLE_SHA256` in `server/modules/src/games/shooter_rewards.ts`.
6. Run `node scripts/check-shooter-sim-version.mjs` and `npm test` (the goja parity test runs the bundle).

The bundle bakes in its source commit, so its bytes and hash change on every re-vendor even when the
code is the same. The content fingerprint (`3c657fb5`) is what clients and stored receipts use.
