// Decide whether sproto-shooter main may sit ahead of the vendored campaign pin.
// Pure: the caller fetches main's sha and GitHub's compare of <pin>...<main>.
//
// It passes when main is the pin, or when the pin is an ancestor of main and no
// file that feeds the campaign bundle changed in between. "Feeds" is deliberately
// wider than the bundle's import graph:
//   - every input esbuild recorded for src/server/verify.js (pin.bundleInputs)
//   - anything under src/core/, src/data/, src/server/ or src/sim/, except the
//     free 1v1 arena's own src/sim/pvp/ (a separate export; if the campaign ever
//     imports from it, that import edits a recorded input, and the new file joins
//     bundleInputs at the next re-vendor)
//   - the build script, and package/tsconfig/jsconfig files anywhere (esbuild
//     version and module resolution)
// A new import always edits an existing input, so a graph change cannot slip by.

export const COMPARE_FILE_LIMIT = 300;

const PREFIXES = ['src/core/', 'src/data/', 'src/server/', 'src/sim/'];
const EXEMPT_PREFIXES = ['src/sim/pvp/'];
const TOOLING = ['scripts/build-server-sim.mjs', 'package-lock.json', 'npm-shrinkwrap.json'];
const RESOLVER_CONFIG = /(^|\/)(package\.json|[tj]sconfig(\.[^/]*)?\.json)$/;

export function feedsCampaignBundle(path, bundleInputs) {
  if (!path) return false;
  if (bundleInputs.includes(path)) return true;
  if (TOOLING.includes(path) || RESOLVER_CONFIG.test(path)) return true;
  if (EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
  return PREFIXES.some((prefix) => path.startsWith(prefix));
}

const short = (sha) => String(sha || '').slice(0, 7);

/**
 * @param {{ pinCommit: string, mainSha: string, compare: any, bundleInputs: string[], strict: boolean }} input
 * @returns {{ ok: boolean, case: string, message: string, offending?: string[] }}
 */
export function decideShooterPin({ pinCommit, mainSha, compare, bundleInputs, strict }) {
  if (mainSha === pinCommit) {
    return { ok: true, case: 'pin-is-main', message: `shooter main ${mainSha} is the pinned commit` };
  }
  if (strict) {
    return { ok: false, case: 'strict-mismatch', message: `shooter main ${mainSha} != vendored ${pinCommit} (--strict)` };
  }
  if (!Array.isArray(bundleInputs) || bundleInputs.length === 0) {
    return { ok: false, case: 'unverifiable', message: 'the pin records no bundleInputs, so a moved main cannot be checked' };
  }
  if (!compare || typeof compare !== 'object') {
    return { ok: false, case: 'unverifiable', message: `no compare of ${short(pinCommit)}...${short(mainSha)}` };
  }
  const base = compare.merge_base_commit && compare.merge_base_commit.sha;
  if (compare.status !== 'ahead' || base !== pinCommit) {
    return {
      ok: false,
      case: 'not-ancestor',
      message: `pinned ${pinCommit} is not an ancestor of shooter main ${mainSha} (compare status ${compare.status}, merge base ${base})`,
    };
  }
  if (!Array.isArray(compare.files)) {
    return { ok: false, case: 'unverifiable', message: 'compare response has no file list' };
  }
  if (compare.files.length >= COMPARE_FILE_LIMIT) {
    return {
      ok: false,
      case: 'unverifiable',
      message: `compare lists ${compare.files.length} files, GitHub's cap, so changes may be hidden; re-vendor`,
    };
  }
  const offending = [];
  for (const file of compare.files) {
    const now = file && file.filename;
    const before = file && file.previous_filename;
    if (feedsCampaignBundle(now, bundleInputs) || feedsCampaignBundle(before, bundleInputs)) {
      offending.push(before && before !== now ? `${before} -> ${now}` : now);
    }
  }
  if (offending.length) {
    return {
      ok: false,
      case: 'bundle-sources-changed',
      message: `shooter main ${mainSha} changed campaign-bundle sources since ${pinCommit}; re-vendor`,
      offending,
    };
  }
  const ahead = Number(compare.ahead_by) || 0;
  return {
    ok: true,
    case: 'ancestor-unchanged',
    message: `pinned ${short(pinCommit)} is an ancestor of shooter main ${short(mainSha)}; the ${ahead} commit(s) since change ${compare.files.length} file(s), none feeding the campaign bundle`,
  };
}
