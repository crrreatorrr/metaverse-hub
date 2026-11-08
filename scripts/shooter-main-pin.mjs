// Decide whether sproto-shooter main still matches a vendored sim pin.
// An identical main passes. A newer main passes only when the pin commit is its
// ancestor and no sim, protocol, content, or bundle-build file changed. Any
// other history, a truncated compare, or a sim-path edit fails closed.
const REPO = 'crrreatorrr/sproto-shooter';

const SIM_PREFIXES = [
  'src/sim/',
  'src/server/',
  'src/net/',
  'src/data/',
  'src/core/',
];

const SIM_FILES = new Set([
  'scripts/build-server-sim.mjs',
]);

export function isSimSource(path) {
  if (SIM_FILES.has(path)) return true;
  return SIM_PREFIXES.some((prefix) => path.startsWith(prefix));
}

async function fetchJson(url, token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'metaverse-hub-shooter-sim-check',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  return { status: response.status, body: await response.json() };
}

async function github(url) {
  const token = process.env.GITHUB_TOKEN || '';
  let last = 'no response';
  for (const auth of token ? [token, ''] : ['']) {
    try {
      const result = await fetchJson(url, auth);
      if (result.status === 200 && result.body) return result.body;
      last = `GitHub API HTTP ${result.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(last);
}

export async function shooterMainSha() {
  const body = await github(`https://api.github.com/repos/${REPO}/commits/main`);
  if (!body.sha || !/^[0-9a-f]{40}$/.test(body.sha)) throw new Error('shooter main sha missing');
  return body.sha;
}

/**
 * Returns the shooter main sha. Throws when the pin cannot be trusted against it.
 * The vendored bytes stay the pin commit. This does not accept a changed fingerprint.
 */
export async function assertShooterMain(pinCommit) {
  if (!isSimSource('src/sim/pvp/rules.js') || !isSimSource('src/server/verify.js') || !isSimSource('scripts/build-server-sim.mjs')) {
    throw new Error('sim source predicate missed a sim path');
  }
  if (isSimSource('src/render/renderer.js') || isSimSource('src/game/Game.js') || isSimSource('docs/shooter-pvp-protocol.md')) {
    throw new Error('sim source predicate includes a non-sim path');
  }
  if (!/^[0-9a-f]{40}$/.test(pinCommit)) throw new Error(`bad pin commit ${pinCommit}`);
  const main = await shooterMainSha();
  if (main === pinCommit) return { main, same: true, files: [] };
  const body = await github(`https://api.github.com/repos/${REPO}/compare/${pinCommit}...${main}`);
  if (body.status !== 'ahead') {
    throw new Error(`shooter main ${main} is ${body.status || 'unrelated'} relative to pin ${pinCommit}`);
  }
  if (!Array.isArray(body.files)) throw new Error('shooter compare did not list files');
  if (body.files.length >= 300) throw new Error('shooter compare file list is truncated');
  const files = body.files.map((file) => String(file.filename || ''));
  const touched = files.filter(isSimSource);
  if (touched.length) {
    throw new Error(`shooter main ${main} changes sim sources since ${pinCommit}: ${touched.join(', ')}`);
  }
  return { main, same: false, files };
}
