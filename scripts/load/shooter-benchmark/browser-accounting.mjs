// Pure observation contracts. These classify measured facts, never authorize pay.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REASON = /^[a-z][a-z0-9_]{0,79}$/;
const OUTCOMES = Object.freeze({ invalid: 'rejected', authorization_denied: 'authorization_denied',
  pending_retryable: 'service_unavailable', unsupported_version: 'unsupported' });
function invalid(code) { throw new Error(code); }
export function boundOwnerStatus(value, runId) {
  if (!UUID.test(runId) || !value || value.protocol !== 2 || value.runId !== runId) invalid('owner_status_binding_mismatch');
  if (!['open', 'sealed', 'terminal', 'expired', 'invalid', 'quarantined'].includes(value.state)) invalid('owner_status_state_invalid');
  return value;
}
export function safeReason(value, fallback) { return typeof value === 'string' && REASON.test(value) ? value : fallback; }
export function serviceOutcome(value) {
  if (!value || typeof value !== 'object' || (value.protocol !== undefined && value.protocol !== 2)
    || typeof value.reason !== 'string' || !REASON.test(value.reason)) return null;
  if (typeof value.state !== 'string' || !Object.prototype.hasOwnProperty.call(OUTCOMES, value.state)) return null;
  return { status: OUTCOMES[value.state], rawReason: value.reason, serviceState: value.state };
}
export function clientStartOutcome(code, evidence = {}) {
  if (['legacy_selected', 'unsupported_protocol', 'unsupported_manifest', 'unsupported_version'].includes(code)) {
    return serviceOutcome({ state: 'unsupported_version', reason: code });
  }
  if (['identity_changed', 'session_expired', 'session_closed', 'upload_expired', 'start_not_authorized',
    'unauthorized', 'not_game_session', 'revoked'].includes(code)) return serviceOutcome({ state: 'authorization_denied', reason: code });
  if (code === 'transport_timeout') return serviceOutcome({ state: 'pending_retryable', reason: code });
  if (['network_unavailable', 'transport_unknown'].includes(code) && evidence.requestFailed === true) {
    return serviceOutcome({ state: 'pending_retryable', reason: 'network_request_failed' });
  }
  return null;
}
export function outcomeError(value) {
  const outcome = serviceOutcome(value);
  if (!outcome) invalid('unknown_service_outcome');
  const error = new Error('known_service_outcome'); error.outcome = outcome; return error;
}
export function recordPaymentFacts(row, value, runId, observedAtMs) {
  const status = boundOwnerStatus(value, runId);
  const received = status.received?.tick, verified = status.verified?.tick, payment = status.payment?.state;
  if (!Number.isSafeInteger(received) || received < 0 || received > 162000 || !Number.isSafeInteger(verified)
    || verified < 0 || verified > received) invalid('browser_owner_cursor_invalid');
  if (!['none', 'pending', 'paid', 'ineligible', 'authorization_denied', 'pending_retryable'].includes(payment)) invalid('browser_payment_state_invalid');
  const clear = status.terminal?.outcome === 'clear' && Number.isSafeInteger(received) && received > 0 && verified === received;
  if (payment === 'paid' && (!clear || status.payment.tickets !== 20)) invalid('browser_paid_projection_invalid');
  // Keep these bound server facts even if subsequent wire/DOM readback fails.
  row.acceptedTick = received; row.verifiedTick = verified;
  if (!row.observedPaid) row.paymentObservation = payment || 'not_observed';
  if (!row.everObservedEligible && payment === 'ineligible') row.eligibilityState = 'observed_nonpayable';
  if (clear && ['paid', 'pending'].includes(payment)) {
    row.everObservedEligible = true; row.eligibilityState = 'observed_eligible';
    row.eligibilityEvidence ||= `authoritative_clear_${payment}`;
    row.milestones.firstEligibleObservedMs ??= observedAtMs;
  }
  if (payment === 'paid') {
    row.observedPaid = true; row.paymentObservation = 'paid'; row.milestones.paidObservedMs ??= observedAtMs;
  }
}
export function successfulPaid(row) {
  return row.status === 'paid' && row.observedPaid === true && row.finalPausedProof === true
    && row.finalCoherentProof === true && row.finishAckObserved === true && row.recordedFrames > 0
    && row.submittedFrames === row.recordedFrames && row.acceptedTick === row.recordedFrames && row.verifiedTick === row.recordedFrames;
}
export function browserActorCounts(rows) {
  const eligible = rows.filter(row => row.everObservedEligible === true);
  const receipts = rows.filter(row => row.observedPaid === true);
  return { accountedActors: rows.length, startedActors: rows.filter(row => row.runBindingHash).length,
    positiveRecordedActors: rows.filter(row => row.recordedFrames > 0).length,
    observedMovementActors: rows.filter(row => row.observedMovementFrames > 0).length,
    observedFireActors: rows.filter(row => row.observedFireFrames > 0).length,
    explicitFinishAckActors: rows.filter(row => row.finishAckObserved).length,
    eligible: eligible.length, observedPaid: receipts.length, paid: rows.filter(successfulPaid).length,
    eligibleWithObservedReceipt: eligible.filter(row => row.observedPaid === true).length,
    eligibleUnpaid: eligible.filter(row => row.observedPaid !== true).length,
    eligibleCensored: eligible.filter(row => row.observedPaid !== true && (row.status === 'censored' || row.paymentCensored)).length,
    eligibilityUnknownActors: rows.filter(row => row.eligibilityState === 'unknown').length,
    recordedCountUnknownActors: rows.filter(row => row.recordedFrames === null).length,
    clientFrameEvidenceTruncatedActors: rows.filter(row => row.clientFrames?.truncated).length,
    censoredActors: rows.filter(row => row.status === 'censored').length,
    rawReasons: rows.reduce((out, row) => { const key = `${row.status}:${row.rawReason ?? row.stopReason ?? 'unspecified'}`; out[key] = (out[key] ?? 0) + 1; return out; }, {}) };
}
