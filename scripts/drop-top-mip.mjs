// Halves KTX2 textures inside GLB files by dropping each texture's top mip level.
// The next level becomes the base, so nothing is re-encoded and the result matches
// what the GPU already samples at a distance.
//
//   node scripts/drop-top-mip.mjs [--normal-only] <file.glb>...
//
// Files are rewritten in place. Every other byte range in the binary chunk is kept as is,
// including EXT_meshopt_compression streams.

import { readFileSync, writeFileSync } from 'node:fs';

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const SCHEME_BASISLZ = 1;
const BASISLZ_HEADER = 20;
const BASISLZ_IMAGE_DESC = 20;

const align = (n, a) => Math.ceil(n / a) * a;

/** Returns a KTX2 file without level 0, or null when the texture has a single level. */
export function dropTopLevel(src) {
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const width = view.getUint32(20, true);
  const height = view.getUint32(24, true);
  const depth = view.getUint32(28, true);
  const layers = Math.max(1, view.getUint32(32, true));
  const faces = view.getUint32(36, true);
  const levels = view.getUint32(40, true);
  const scheme = view.getUint32(44, true);
  if (levels < 2) return null;
  if (depth > 1) throw new Error('3D textures are not supported');
  const dfdOffset = view.getUint32(48, true);
  const dfdLength = view.getUint32(52, true);
  const kvdOffset = view.getUint32(56, true);
  const kvdLength = view.getUint32(60, true);
  const sgdOffset = Number(view.getBigUint64(64, true));
  const sgdLength = Number(view.getBigUint64(72, true));
  const index = [];
  for (let i = 0; i < levels; i += 1) {
    const at = 80 + i * 24;
    index.push({
      offset: Number(view.getBigUint64(at, true)),
      length: Number(view.getBigUint64(at + 8, true)),
      uncompressed: Number(view.getBigUint64(at + 16, true)),
    });
  }
  const kept = index.slice(1);

  let sgd = src.subarray(sgdOffset, sgdOffset + sgdLength);
  if (scheme === SCHEME_BASISLZ) {
    // BasisLZ keeps one image descriptor per level, layer, and face, level 0 first.
    const drop = layers * faces * BASISLZ_IMAGE_DESC;
    const next = new Uint8Array(sgd.length - drop);
    next.set(sgd.subarray(0, BASISLZ_HEADER), 0);
    next.set(sgd.subarray(BASISLZ_HEADER + drop), BASISLZ_HEADER);
    sgd = next;
  }

  const outLevels = levels - 1;
  const headerEnd = 80 + outLevels * 24;
  const outDfd = headerEnd;
  const outKvd = outDfd + dfdLength;
  const outSgd = sgd.length ? align(outKvd + kvdLength, 8) : 0;
  let cursor = sgd.length ? outSgd + sgd.length : outKvd + kvdLength;
  // Supercompressed levels need no alignment. Plain ones keep 16, which covers every block size here.
  const levelAlign = scheme === 0 ? 16 : 1;
  // Keep the file's level order (usually smallest first).
  const order = kept.map((level, i) => ({ ...level, i })).sort((a, b) => a.offset - b.offset);
  const placed = new Array(kept.length);
  for (const level of order) {
    cursor = align(cursor, levelAlign);
    placed[level.i] = cursor;
    cursor += level.length;
  }

  const out = new Uint8Array(cursor);
  const o = new DataView(out.buffer);
  out.set(src.subarray(0, 80), 0);
  o.setUint32(20, Math.max(1, width >> 1), true);
  o.setUint32(24, height ? Math.max(1, height >> 1) : 0, true);
  o.setUint32(40, outLevels, true);
  o.setUint32(48, outDfd, true);
  o.setUint32(56, kvdLength ? outKvd : 0, true);
  o.setBigUint64(64, BigInt(outSgd), true);
  o.setBigUint64(72, BigInt(sgd.length), true);
  kept.forEach((level, i) => {
    const at = 80 + i * 24;
    o.setBigUint64(at, BigInt(placed[i]), true);
    o.setBigUint64(at + 8, BigInt(level.length), true);
    o.setBigUint64(at + 16, BigInt(level.uncompressed), true);
  });
  out.set(src.subarray(dfdOffset, dfdOffset + dfdLength), outDfd);
  out.set(src.subarray(kvdOffset, kvdOffset + kvdLength), outKvd);
  if (sgd.length) out.set(sgd, outSgd);
  kept.forEach((level, i) => out.set(src.subarray(level.offset, level.offset + level.length), placed[i]));
  return out;
}

function normalImages(json) {
  const sources = new Set();
  for (const material of json.materials ?? []) {
    const ref = material.normalTexture;
    if (!ref) continue;
    const texture = json.textures?.[ref.index];
    const source = texture?.extensions?.KHR_texture_basisu?.source ?? texture?.source;
    if (source != null) sources.add(source);
  }
  return sources;
}

export function rewriteGlb(file, { normalOnly = false } = {}) {
  const glb = readFileSync(file);
  if (glb.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${file} is not a GLB`);
  const jsonLength = glb.readUInt32LE(12);
  if (glb.readUInt32LE(16) !== CHUNK_JSON) throw new Error(`${file}: first chunk is not JSON`);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
  const binHeader = 20 + jsonLength;
  if (glb.readUInt32LE(binHeader + 4) !== CHUNK_BIN) throw new Error(`${file}: second chunk is not BIN`);
  const bin = glb.subarray(binHeader + 8, binHeader + 8 + glb.readUInt32LE(binHeader));

  const targets = normalOnly ? normalImages(json) : new Set((json.images ?? []).map((_, i) => i));
  const replaced = new Map();
  const changed = [];
  (json.images ?? []).forEach((image, i) => {
    if (!targets.has(i) || image.mimeType !== 'image/ktx2' || image.bufferView == null) return;
    const bv = json.bufferViews[image.bufferView];
    const start = bv.byteOffset ?? 0;
    const next = dropTopLevel(bin.subarray(start, start + bv.byteLength));
    if (!next) return;
    replaced.set(image.bufferView, next);
    changed.push(`${image.name ?? i} ${bv.byteLength}→${next.length}`);
  });
  if (!replaced.size) return { file, changed, before: glb.length, after: glb.length };

  // Every range that lives in the GLB binary chunk (buffer 0), in file order.
  const ranges = [];
  json.bufferViews.forEach((bv, i) => {
    if (bv.buffer === 0) ranges.push({ owner: bv, offset: bv.byteOffset ?? 0, length: bv.byteLength, data: replaced.get(i) });
    const meshopt = bv.extensions?.EXT_meshopt_compression;
    if (meshopt && meshopt.buffer === 0) ranges.push({ owner: meshopt, offset: meshopt.byteOffset ?? 0, length: meshopt.byteLength });
  });
  ranges.sort((a, b) => a.offset - b.offset);
  const chunks = [];
  let cursor = 0;
  for (const range of ranges) {
    const data = range.data ?? bin.subarray(range.offset, range.offset + range.length);
    const at = align(cursor, 16);
    if (at > cursor) chunks.push(new Uint8Array(at - cursor));
    chunks.push(data);
    range.owner.byteOffset = at;
    range.owner.byteLength = data.length;
    cursor = at + data.length;
  }
  const binOut = Buffer.concat([...chunks, new Uint8Array(align(cursor, 4) - cursor)]);
  json.buffers[0].byteLength = cursor;

  let jsonText = JSON.stringify(json);
  jsonText += ' '.repeat(align(Buffer.byteLength(jsonText), 4) - Buffer.byteLength(jsonText));
  const jsonOut = Buffer.from(jsonText, 'utf8');
  const total = 12 + 8 + jsonOut.length + 8 + binOut.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(GLB_MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonOut.length, 12);
  out.writeUInt32LE(CHUNK_JSON, 16);
  jsonOut.copy(out, 20);
  out.writeUInt32LE(binOut.length, 20 + jsonOut.length);
  out.writeUInt32LE(CHUNK_BIN, 24 + jsonOut.length);
  binOut.copy(out, 28 + jsonOut.length);
  writeFileSync(file, out);
  return { file, changed, before: glb.length, after: total };
}

const args = process.argv.slice(2);
const normalOnly = args.includes('--normal-only');
const files = args.filter((arg) => !arg.startsWith('--'));
if (!files.length) {
  console.error('usage: node scripts/drop-top-mip.mjs [--normal-only] <file.glb>...');
  process.exit(1);
}
for (const file of files) {
  const result = rewriteGlb(file, { normalOnly });
  const mb = (n) => (n / 1048576).toFixed(2);
  console.log(`${file}: ${mb(result.before)} → ${mb(result.after)} MB  (${result.changed.join(', ') || 'unchanged'})`);
}
