export const PREFIX = 'SHOOTER_RESULT_STAGE_V1';
export const MAX_MARKERS = 32;
export const STAGES = Object.freeze([
  'rpc_enter','preflight_done','payload_decoded','authorized','body_checked',
  'checkpoint_envelope_hash_begin','checkpoint_envelope_hash_done',
  'checkpoint_snapshot_hash_begin','checkpoint_snapshot_hash_done',
  'checkpoint_validated','digest_ready','sql_arguments_ready','committed',
  'payment_done','response_serialized','call_exit',
]);
