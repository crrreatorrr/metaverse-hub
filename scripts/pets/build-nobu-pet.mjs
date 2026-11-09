// Builds the hub pet pet_nobu, the Cone's Tip Relic summon (contract m6-pet-v1, apps/hub/src/v2/pets.json) from the NOBU game's
// own Nobu: public/assets/models/nobu.glb with the retouched nobu_tex_fixed.jpg the game swaps in.
//
//   npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 sharp
//   node scripts/pets/build-nobu-pet.mjs [path/to/nobu] [out dir]
//
// The nobu checkout defaults to ../nobu (run `npm ci` there: its animator imports three). Output goes to
// apps/hub/public/world/v2/pets/. The game animates Nobu procedurally (src/player/nobuAnim.js, applied to
// the bones by src/player/nobuGlb.js), so this script samples that same pose math into the hub's clips.

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder, resample, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const ID = 'pet_nobu';
const PETS = JSON.parse(readFileSync(new URL('../../apps/hub/src/v2/pets.json', import.meta.url), 'utf8'));
const CONTRACT = PETS.contract;
const PET_H = CONTRACT.height_m.nobu;
const FPS = 30;
/** nobuGlb.js normalizes Nobu to 1.5 m; the animator's root offsets are in those metres. */
const GAME_H = 1.5;
/** nobuGlb.js: rest A-pose arm angle away from the body. */
const REST_ARM_OUT = 0.62;
const LODS = [
  { suffix: '', tex: 1024, tris: 5800 },
  { suffix: '-lod1', tex: 512, tris: 2000 },
];

const nobuDir = path.resolve(process.argv[2] ?? '../nobu');
const outDir = path.resolve(process.argv[3] ?? 'apps/hub/public/world/v2/pets');
const SRC_GLB = path.join(nobuDir, 'public/assets/models/nobu.glb');
const SRC_TEX = path.join(nobuDir, 'public/assets/models/nobu_tex_fixed.jpg');
for (const file of [SRC_GLB, SRC_TEX]) if (!existsSync(file)) throw new Error(`missing ${file}`);
const { makePose } = await import(pathToFileURL(path.join(nobuDir, 'src/player/nobuAnim.js')).href);
const { lerp, smooth, easeOutBack } = await import(pathToFileURL(path.join(nobuDir, 'src/core/util.js')).href);

await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

// ---- poses: the game's pose math, with periods fitted to each clip so loops are seamless ----

const AX = new Vector3(1, 0, 0);
const AY = new Vector3(0, 1, 0);
const AZ = new Vector3(0, 0, 1);
const TAU = Math.PI * 2;

/** nobuAnim.js "idle base". */
function base(P, t, period) {
  const breathe = Math.sin((t / period) * TAU);
  P.breathe = breathe * 0.02;
  P.hipsY = breathe * 0.008;
  P.armL.swing = breathe * 0.04;
  P.armR.swing = -breathe * 0.04;
  P.headX = -0.03 + breathe * 0.02;
}

/** nobuAnim.js "run cycle" at blend r and phase ph. */
function cycle(P, r, ph) {
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  P.legL.swing = lerp(P.legL.swing, s * 0.95, r);
  P.legR.swing = lerp(P.legR.swing, -s * 0.95, r);
  P.legL.knee = lerp(P.legL.knee, Math.max(0, c) * 1.3 + 0.15, r);
  P.legR.knee = lerp(P.legR.knee, Math.max(0, -c) * 1.3 + 0.15, r);
  P.armL.swing = lerp(P.armL.swing, -s * 0.95, r);
  P.armR.swing = lerp(P.armR.swing, s * 0.95, r);
  P.armL.elbow = P.armR.elbow = lerp(0.25, 1.45, r);
  P.armL.out = P.armR.out = lerp(0.22, 0.28, r);
  P.hipsY += Math.abs(s) * 0.08 * r - 0.04 * r;
  P.lean = 0.3 * r;
  P.twist = s * 0.18 * r;
  P.headX += -0.18 * r + Math.abs(c) * 0.06 * r;
}

/** Sitting, after the game's "cone" death pose (legs straight out, body dropped) without the sad face. */
function sit(P, k) {
  P.rootY = lerp(P.rootY, -0.4, k);
  for (const leg of [P.legL, P.legR]) {
    leg.swing = lerp(leg.swing, 1.45, k);
    leg.out = lerp(leg.out, 0.22, k);
    leg.knee = lerp(leg.knee, 0.15, k);
  }
  for (const arm of [P.armL, P.armR]) {
    arm.swing = lerp(arm.swing, 0.35, k);
    arm.out = lerp(arm.out, 0.12, k);
    arm.elbow = lerp(arm.elbow, 0.5, k);
  }
  P.lean = lerp(P.lean, -0.12, k);
  P.headX = lerp(P.headX, -0.12, k);
}

/** Crouch, the game's double-jump flip (about the body centre), landing squash. Starts and ends at rest. */
function happy(P, t) {
  base(P, 0, 2);
  if (t < 0.15) {
    const k = smooth(t / 0.15);
    P.scaleY = 1 - 0.2 * k;
    P.scaleXZ = 1 + 0.12 * k;
    P.legL.knee = P.legR.knee = 0.6 * k;
    P.armL.out = P.armR.out = lerp(0.22, 0.6, k);
  } else if (t < 1.15) {
    const u = (t - 0.15) / 1.0;
    const tuck = Math.sin(u * Math.PI);
    P.rootRotX = smooth(u) * TAU;
    P.rootY = tuck * 0.75;
    P.pivotY = 0.75;
    P.legL.swing = P.legR.swing = 1.2 * tuck;
    P.legL.knee = P.legR.knee = 1.9 * tuck;
    P.armL.swing = P.armR.swing = 1.0 * tuck;
    P.armL.out = P.armR.out = lerp(1.9, 0.5, tuck);
    P.lean = 0.4 * tuck;
    const stretch = Math.max(0, 1 - u / 0.15);
    P.scaleY = 1 + 0.15 * stretch;
    P.scaleXZ = 1 - 0.08 * stretch;
  } else {
    const k = 1 - smooth((t - 1.15) / 0.35);
    P.scaleY = 1 - 0.24 * k;
    P.scaleXZ = 1 + 0.16 * k;
    P.legL.knee = P.legR.knee = 0.5 * k;
    P.armL.out = P.armR.out = lerp(0.22, 2.0, k);
  }
}

/** nobuAnim.js _dance (victory), beat and sway fitted to a 2 s loop. */
function dance(P, t) {
  const beat = t * Math.PI * 3;
  const s = Math.sin(beat);
  P.rootY = Math.abs(s) * 0.25;
  P.rootRotY = Math.sin(t * Math.PI) * 0.5;
  P.legL.swing = Math.max(0, s) * 1.5;
  P.legL.knee = Math.max(0, s) * 0.4;
  P.legR.swing = Math.max(0, -s) * 1.5;
  P.legR.knee = Math.max(0, -s) * 0.4;
  P.armL.out = 2.2 + Math.sin(beat * 2) * 0.5;
  P.armR.out = 2.2 - Math.sin(beat * 2) * 0.5;
  P.armL.elbow = P.armR.elbow = 0.8;
  P.headZ = s * 0.3;
}

const POSES = {
  idle: (P, t) => {
    base(P, t, 2);
    P.headY = Math.sin((t / 4) * TAU) * 0.28;
    P.headZ = Math.sin((t / 4) * TAU * 2) * 0.06;
  },
  follow_walk: (P, t) => { base(P, t, 1); cycle(P, 0.55, (t / 1.0) * TAU); },
  follow_run: (P, t) => { base(P, t, 0.6); cycle(P, 1, (t / 0.6) * TAU); },
  sit_enter: (P, t) => { base(P, 0, 2); sit(P, smooth(t / 0.4)); },
  sit: (P, t) => {
    base(P, t, 2);
    sit(P, 1);
    P.headZ = Math.sin((t / 4) * TAU) * 0.14;
    P.headY = Math.sin((t / 4) * TAU) * 0.1;
  },
  emote_happy: happy,
  emote_dance: dance,
  spawn_poof: (P, t) => {
    base(P, 0, 2);
    P.scaleY = P.scaleXZ = Math.max(0.01, easeOutBack(Math.min(1, t / 0.5)));
  },
};

// ---- bake ----

/** Bone rest data in model space, as nobuGlb.js computes it. */
function restBones(doc) {
  const bones = new Map();
  for (const node of doc.getRoot().listNodes()) {
    const parent = node.getParentNode();
    if (!parent || !doc.getRoot().listSkins().some((skin) => skin.listJoints().includes(node))) continue;
    const parentQ = new Quaternion().fromArray(parent.getWorldRotation()).normalize();
    bones.set(node.getName(), { node, rest: new Quaternion().fromArray(node.getRotation()), parentQ, parentInv: parentQ.clone().invert() });
  }
  return bones;
}

/** nobuGlb.js apply(): model-space rotations converted to each bone's local frame. */
function boneQuats(P, bones) {
  const out = {};
  const D = new Quaternion();
  const q = new Quaternion();
  const R = (axis, a) => q.setFromAxisAngle(axis, a);
  const rot = (name, d) => {
    const b = bones.get(name);
    out[name] = b.parentInv.clone().multiply(d).multiply(b.parentQ).multiply(b.rest).normalize().toArray();
  };
  D.copy(R(AX, P.lean)).multiply(R(AZ, P.sway)); rot('Hips', D);
  D.copy(R(AY, P.twist * 0.5)); rot('Spine', D);
  D.copy(R(AY, P.twist * 0.5)).multiply(R(AX, P.breathe * 2)); rot('Spine01', D);
  D.copy(R(AX, P.headX * 0.35)); rot('neck', D);
  D.copy(R(AY, P.headY)).multiply(R(AX, P.headX * 0.65 + P.headLunge * 1.6)).multiply(R(AZ, P.headZ)); rot('Head', D);
  const arm = (side, p, sx) => {
    D.copy(R(AX, -p.swing)).multiply(R(AZ, sx * (p.out - REST_ARM_OUT))); rot(`${side}Arm`, D);
    D.copy(R(AX, -p.elbow * 1.2)); rot(`${side}ForeArm`, D);
  };
  arm('Left', P.armL, 1);
  arm('Right', P.armR, -1);
  const leg = (side, p, sx) => {
    D.copy(R(AX, -p.swing)).multiply(R(AZ, sx * p.out)); rot(`${side}UpLeg`, D);
    D.copy(R(AX, p.knee)); rot(`${side}Leg`, D);
    D.copy(R(AX, -p.knee * 0.35)); rot(`${side}Foot`, D);
  };
  leg('Left', P.legL, 1);
  leg('Right', P.legR, -1);
  return out;
}

/** Height of the skinned mesh in its bind pose (the mesh node's own transform does not apply). */
function skinnedHeight(doc) {
  const node = doc.getRoot().listNodes().find((n) => n.getSkin());
  const skin = node.getSkin();
  const ibm = skin.getInverseBindMatrices().getArray();
  const mats = skin.listJoints().map((joint, i) => new Matrix4().fromArray(joint.getWorldMatrix()).multiply(new Matrix4().fromArray(ibm, i * 16)));
  let min = Infinity;
  let max = -Infinity;
  const v = new Vector3();
  const sum = new Vector3();
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const joints = prim.getAttribute('JOINTS_0');
    const weights = prim.getAttribute('WEIGHTS_0');
    const p = [];
    const j = [];
    const w = [];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p);
      joints.getElement(i, j);
      weights.getElement(i, w);
      sum.set(0, 0, 0);
      for (let k = 0; k < 4; k++) if (w[k] > 0) sum.addScaledVector(v.fromArray(p).applyMatrix4(mats[j[k]]), w[k]);
      min = Math.min(min, sum.y);
      max = Math.max(max, sum.y);
    }
  }
  return max - min;
}

// ---- build ----

const tris = (doc) => doc.getRoot().listMeshes().reduce((n, mesh) => n + mesh.listPrimitives()
  .reduce((a, prim) => a + (prim.getIndices() ?? prim.getAttribute('POSITION')).getCount() / 3, 0), 0);

/** LOD1: the scan has many UV islands, so the regular simplifier stalls near 5.6k tris; collapse across seams. */
function acrossSeams(target) {
  return (doc) => {
    for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION').getArray();
      const uv = prim.getAttribute('TEXCOORD_0').getArray();
      const idx = new Uint32Array(prim.getIndices().getArray());
      const [out] = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, uv, 2, [1, 1], null, target * 3, 1, ['Permissive']);
      prim.getIndices().setArray(pos.length / 3 > 65535 ? out : new Uint16Array(out));
    }
  };
}

async function build(lod) {
  const doc = await io.read(SRC_GLB);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const buffer = root.listBuffers()[0];
  for (const anim of root.listAnimations()) anim.dispose(); // a single static pose, unused by the game

  const jpg = await sharp(SRC_TEX).resize(lod.tex, lod.tex).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  const material = root.listMaterials()[0];
  material.setName(`${ID}_mat`).setRoughnessFactor(0.85).setMetallicFactor(0); // nobuGlb.js: matte, no metal
  material.getBaseColorTexture().setImage(new Uint8Array(jpg)).setMimeType('image/jpeg').setName(`${ID}_tex`).setURI('');
  root.listMeshes()[0].setName(`${ID}_body`);
  root.listNodes().find((n) => n.getMesh()).setName(`${ID}_body`);

  // pet_nobu > pet_nobu_root (the game's animated body group, origin at the feet) > Armature.
  const bones = restBones(doc);
  const rawH = skinnedHeight(doc);
  const armature = scene.listChildren()[0];
  armature.setScale(armature.getScale().map((s) => (s * PET_H) / rawH));
  const body = doc.createNode(`${ID}_root`).addChild(armature);
  body.addChild(doc.createNode('pet_fx_anchor').setTranslation([0, PET_H + 0.08, 0]));
  scene.removeChild(armature);
  scene.addChild(doc.createNode(ID).addChild(body));

  const toPet = PET_H / GAME_H;
  const hips = bones.get('Hips');
  const hipsRest = hips.node.getTranslation();
  // Hips offsets are game metres; the Hips parent (the scaled Armature) is in source units.
  const hipsUnits = toPet / new Vector3().fromArray(hips.node.getParentNode().getWorldMatrix().slice(0, 3)).length();
  for (const [name, { dur }] of Object.entries(CONTRACT.clips)) {
    const n = Math.round(dur * FPS);
    const times = [];
    const tracks = { t: [], r: [], s: [], hips: [], bones: {} };
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * dur;
      const P = makePose();
      POSES[name](P, t);
      const q = new Quaternion().setFromEuler(new Euler(P.rootRotX, P.rootRotY, P.rootRotZ));
      const pivot = new Vector3(0, P.pivotY ?? 0, 0);
      const offset = pivot.clone().sub(pivot.clone().applyQuaternion(q)).add(new Vector3(0, P.rootY, 0)).multiplyScalar(toPet);
      times.push(t);
      tracks.t.push(...offset.toArray());
      tracks.r.push(...q.toArray());
      tracks.s.push(P.scaleXZ, P.scaleY, P.scaleXZ);
      tracks.hips.push(hipsRest[0], hipsRest[1] + P.hipsY * hipsUnits, hipsRest[2]);
      for (const [bone, quat] of Object.entries(boneQuats(P, bones))) (tracks.bones[bone] ??= []).push(...quat);
    }
    const anim = doc.createAnimation(name);
    const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buffer);
    const channel = (node, targetPath, type, values) => {
      const output = doc.createAccessor().setType(type).setArray(new Float32Array(values)).setBuffer(buffer);
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(targetPath).setSampler(sampler));
    };
    channel(body, 'translation', 'VEC3', tracks.t);
    channel(body, 'rotation', 'VEC4', tracks.r);
    channel(body, 'scale', 'VEC3', tracks.s);
    channel(hips.node, 'translation', 'VEC3', tracks.hips);
    for (const [bone, values] of Object.entries(tracks.bones)) channel(bones.get(bone).node, 'rotation', 'VEC4', values);
  }

  await doc.transform(
    weld(),
    lod.suffix ? acrossSeams(lod.tris) : simplify({ simplifier: MeshoptSimplifier, ratio: lod.tris / tris(doc), error: 0.02 }),
    resample({ tolerance: 1e-4 }),
    dedup(),
    prune({ keepLeaves: true }),
    reorder({ encoder: MeshoptEncoder }),
    quantize(),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const file = path.join(outDir, `${ID}${lod.suffix}.glb`);
  await io.write(file, doc);
  console.log(`${path.relative(process.cwd(), file)}: ${tris(doc)} tris, ${statSync(file).size} bytes, source height ${rawH.toFixed(3)}`);
}

for (const lod of LODS) await build(lod);
