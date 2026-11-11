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
function multiply403FNV(encoded) {
  var h = 0x811c9dc5, length = encoded.length;
  for (var i = 0; i < length; i++) {
    h ^= encoded.charCodeAt(i);
    // FNV prime = 2^24 + 403. Signed32 * 403 plus the signed shift
    // stays below 2^40 + 2^31, so every integer is exact before |0.
    h = (h * 403 + (h << 24)) | 0;
  }
  return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}
function textFromUnits(units) {
  if (!Array.isArray(units) || units.length > 262144) throw new Error('benchmark_input_shape');
  for (var index = 0; index < units.length; index++) {
    if (typeof units[index] !== 'number' || units[index] < 0 || units[index] > 65535 || Math.floor(units[index]) !== units[index]) throw new Error('benchmark_input_shape');
  }
  var text = '';
  for (index = 0; index < units.length; index += 1024) text += String.fromCharCode.apply(null, units.slice(index, index + 1024));
  if (text.length !== units.length) throw new Error('benchmark_input_shape');
  for (index = 0; index < units.length; index++) if (text.charCodeAt(index) !== units[index]) throw new Error('benchmark_input_shape');
  return text;
}
function hashBenchmarkJSON(encodedCase) {
  var input = JSON.parse(encodedCase), canonical, canonicalSHA = null, serialization = null;
  // Goja's native JSON parser replaces lone-surrogate escapes. Reconstruct
  // synthetic test vectors before timing; actual checkpoint JSON stays native.
  if (input.kind === 'text') canonical = textFromUnits(input.value);
  if (input.name === 'canonical_edges') {
    var edge = {};
    edge[String.fromCharCode(65535)] = String.fromCharCode(55296);
    edge['10'] = -0; edge['2'] = 2; edge.a = [null, true, false, String.fromCharCode(0)];
    edge[String.fromCharCode(55296)] = String.fromCharCode(57343);
    edge[String.fromCharCode(55357, 56960)] = String.fromCharCode(101, 769);
    input.value = edge;
  }
  if (input.kind === 'canonical') {
    var before = __benchNow(); canonical = stable(input.value);
    serialization = { coldMs: __benchNow() - before, warmMs: [] };
    for (var n = 0; n < 2; n++) {
      before = __benchNow(); var again = stable(input.value); serialization.warmMs.push(__benchNow() - before);
      if (again !== canonical) throw new Error('benchmark_parity_serialization');
    }
    canonicalSHA = __benchSHA(canonical);
  }
  var names = ['original','cached_imul_length','shift_add_mod32','multiply403_shift24'], functions = [fnv,cachedFNV,shiftFNV,multiply403FNV], rows = [], expected = null;
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
