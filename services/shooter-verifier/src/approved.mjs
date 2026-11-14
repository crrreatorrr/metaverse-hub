// Reviewed server-owned allowlist. A pin update cannot silently upgrade existing
// runs: retain old bundles/manifests until their accepted work is resolved.
export const APPROVED = Object.freeze({
  artifact: 'shooter-sim',
  sourceCommit: '7db4fc4f93333f3977da2159771a060f344b6ea0',
  sha256: 'ab175aae2000991fae582e7c2ee0c1fea952488e89a6888b96eda9c7e0ee2e1e',
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
