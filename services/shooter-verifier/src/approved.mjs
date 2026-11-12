// Reviewed server-owned allowlist. A pin update cannot silently upgrade existing
// runs: retain old bundles/manifests until their accepted work is resolved.
export const APPROVED = Object.freeze({
  artifact: 'shooter-sim',
  sourceCommit: '2215995f40d999f31336815296e1e7b7726f932a',
  sha256: '4968fa64a1be5b74afbf6a788a8438234615996e7d3d82cf657edd8251ab6905',
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
