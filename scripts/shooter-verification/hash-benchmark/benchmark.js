/* global __benchNow, __benchSHA, stable, fnv */
// Public fixture code; the driver substitutes exact current production function
// source at this single anchor, without editing either production source file.
/* ORIGINAL_FUNCTIONS */

function cachedFNV(encoded) {
  var h = 0x811c9dc5, multiply = Math.imul, length = encoded.length;
  for (var i = 0; i < length; i++) h = multiply(h ^ encoded.charCodeAt(i), 0x01000193);
  return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}
function shiftFNV(encoded) {
  var h = 0x811c9dc5, length = encoded.length;
  for (var i = 0; i < length; i++) {
    h ^= encoded.charCodeAt(i);
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) | 0;
  }
  return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}
function hashBenchmarkJSON(encodedCase) {
  var input = JSON.parse(encodedCase), canonical, canonicalSHA = null, serialization = null;
  if (input.kind === 'canonical') {
    var before = __benchNow(); canonical = stable(input.value);
    serialization = { coldMs: __benchNow() - before, warmMs: [] };
    for (var n = 0; n < 2; n++) {
      before = __benchNow(); var again = stable(input.value); serialization.warmMs.push(__benchNow() - before);
      if (again !== canonical) throw new Error('benchmark_parity_serialization');
    }
    canonicalSHA = __benchSHA(canonical);
  } else canonical = input.value;
  var names = ['original','cached_imul_length','shift_add_mod32'], functions = [fnv,cachedFNV,shiftFNV], rows = [], expected = null;
  for (var j = 0; j < functions.length; j++) {
    before = __benchNow(); var hash = functions[j](canonical); var coldMs = __benchNow() - before;
    if (expected === null) expected = hash;
    if (hash !== expected || hash !== input.expectedHash) throw new Error('benchmark_parity_fnv');
    var row = { variant: names[j], hash: hash, coldMs: coldMs, warmMs: [] };
    for (n = 0; n < 2; n++) {
      before = __benchNow(); var warmHash = functions[j](canonical); row.warmMs.push(__benchNow() - before);
      if (warmHash !== expected) throw new Error('benchmark_parity_fnv');
    }
    rows.push(row);
  }
  if (canonicalSHA !== input.expectedCanonicalSHA) throw new Error('benchmark_parity_canonical');
  return JSON.stringify({ name: input.name, kind: input.kind, codeUnits: canonical.length, canonicalSHA: canonicalSHA, serialization: serialization, variants: rows });
}
globalThis.hashBenchmarkJSON = hashBenchmarkJSON;
