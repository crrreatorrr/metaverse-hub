// Reviewed server-owned allowlist. A pin update cannot silently upgrade existing
// runs: retain old bundles/manifests until their accepted work is resolved.
export const APPROVED = Object.freeze({
  artifact: 'shooter-sim',
  sourceCommit: '7137f558846da4c552f6c21ef74756eb527c657d',
  sha256: 'ae9ede47f2bdb4896820810888e62cca9eb3c9f6675052645dae0fb31518145b',
  protocol: 1,
  contentFingerprint: '73c6eb0f',
  uploadProtocol: 2,
  replayApiVersion: 2,
  checkpointSchema: 2,
  economyPolicy: 1,
});
export const ECONOMY = Object.freeze({ mintsTickets: false, ticketsMintedByArtifact: 0,
  payoutAuthority: 'server', wagerTransfersUncapped: true, wagerMayCreateTickets: false });
export function equalJSON(a, b) {
  const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
export function simulationManifest() {
  const { artifact, sourceCommit, sha256, protocol, contentFingerprint } = APPROVED;
  return { artifact, sourceCommit, sha256, protocol, contentFingerprint };
}
