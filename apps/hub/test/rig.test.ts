// Gait retarget and foot-plant checks on the shipped avatar GLBs (apps/hub/public/world/v2/avatar).
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { AnimationMixer, Box3, Object3D, Quaternion, Vector3, type AnimationClip, type SkinnedMesh } from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { AVATAR_BLEND, CHARACTERS, SPRINT_SPEED, WALK_SPEED, characterHeight, fliesWhenMoving, walksWithRun } from '../src/config';
import { createBootSupport } from '../src/rig/boot-support';
import { measureGroundSpeed, retargetClip } from '../src/rig/gait';
import { applyGaitProfile } from '../src/rig/gait-profile';
import { buildLocomotion, groundSpeedOf, onWizardSkeleton, P4_CLIPS } from '../src/rig/locomotion';
import { loadGLB } from './support/load-glb';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));

function clip(clips: readonly AnimationClip[], name: string): AnimationClip {
  const found = clips.find((entry) => entry.name === name);
  assert.ok(found, `clip ${name}`);
  return found;
}

/** Rest-pose height of the whole rig. The rigs ship normalised, so this is close to the avatar fit's body span. */
function restHeight(root: Object3D): number {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root, true);
  return box.max.y - box.min.y;
}

/** Boot geometry can be weighted to a shin instead of a foot or toe. */
function checkBootClearance(root: Object3D, clips: readonly AnimationClip[], fit: number): void {
  const boots: { mesh: SkinnedMesh; indices: number[] }[] = [];
  const vertex = new Vector3();
  root.traverse((obj) => {
    const mesh = obj as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const joints = mesh.geometry.getAttribute('skinIndex');
    const weights = mesh.geometry.getAttribute('skinWeight');
    const indices = [];
    for (let i = 0; i < joints.count; i += 1) {
      let strongest = 0;
      for (let j = 1; j < weights.itemSize; j += 1) {
        if (weights.getComponent(i, j) > weights.getComponent(i, strongest)) strongest = j;
      }
      const bone = mesh.skeleton.bones[joints.getComponent(i, strongest)];
      if (bone && /^(Left|Right)(Leg|Foot|ToeBase)$/.test(bone.name)) indices.push(i);
    }
    if (indices.length) boots.push({ mesh, indices });
  });
  assert.ok(boots.length > 0);
  const lowest = () => {
    root.parent?.updateWorldMatrix(true, false);
    root.updateMatrixWorld(true);
    let y = Infinity;
    for (const { mesh, indices } of boots) {
      for (const index of indices) {
        mesh.getVertexPosition(index, vertex).applyMatrix4(mesh.matrixWorld);
        y = Math.min(y, vertex.y);
      }
    }
    return y;
  };
  const floor = lowest();
  const mixer = new AnimationMixer(root);
  for (const name of P4_CLIPS) {
    const gait = clip(clips, name);
    mixer.clipAction(gait).play();
    for (let i = 0; i < 120; i += 1) {
      mixer.setTime(gait.duration * i / 120);
      assert.ok(lowest() >= floor - 0.001, `Mega Tinubu's ${name} boot clips the floor at sample ${i}`);
    }
    mixer.stopAllAction();
  }
  const avatar = new Object3D();
  const pivot = new Object3D();
  avatar.add(pivot);
  pivot.add(root);
  root.scale.setScalar(fit);
  root.position.y = -floor * fit;
  const support = createBootSupport(root, pivot, avatar);
  assert.ok(support);
  const idle = mixer.clipAction(clip(clips, 'idle')).play();
  mixer.update(0.5);
  const sprint = mixer.clipAction(clip(clips, 'dash')).play();
  sprint.timeScale = SPRINT_SPEED / (fit * groundSpeedOf(sprint.getClip()));
  idle.crossFadeTo(sprint, AVATAR_BLEND.idleToMove, false);
  for (let i = 0; i < 22; i += 1) {
    mixer.update(1 / 60);
    support(1 / 60, true);
  }
  idle.reset().setEffectiveWeight(1).play();
  sprint.crossFadeTo(idle, AVATAR_BLEND.moveToIdle, false);
  for (let i = 0; i < 12; i += 1) {
    mixer.update(1 / 60);
    support(1 / 60, true);
    assert.ok(lowest() >= -0.001, `Mega Tinubu's boot clips while stopping at frame ${i}`);
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
}

async function main(): Promise<void> {
  const wizard = await loadGLB(`${PUBLIC}world/v2/avatar/wizard.glb`);

  // 1. The planted-foot measurement reproduces P4's authored speeds (speed_mps is in fitted hub metres).
  for (const name of P4_CLIPS) {
    const authored = clip(wizard.animations, name).userData as { speed_mps: number; fit_scale: number };
    const measured = measureGroundSpeed(SkeletonUtils.clone(wizard.scene), clip(wizard.animations, name));
    const expected = authored.speed_mps / authored.fit_scale;
    assert.ok(Math.abs(measured - expected) / expected < 0.02, `wizard ${name}: measured ${measured}, authored ${expected}`);
    const source = clip(wizard.animations, name);
    const played = applyGaitProfile(source, wizard.scene.userData.native_locomotion_v1);
    assert.notEqual(played, source, `Wizard playback has its own ${name} calibration`);
    assert.equal(source.userData.speed_mps, authored.speed_mps, 'the donor retains its authored speed');
  }
  assert.equal(measureGroundSpeed(SkeletonUtils.clone(wizard.scene), clip(wizard.animations, 'idle')), 0, 'idle has no stride');

  // 2. Retargeting a rig onto itself is the identity (up to the 60 fps resample).
  const jog = clip(wizard.animations, 'jog');
  const self = retargetClip(SkeletonUtils.clone(wizard.scene), jog, SkeletonUtils.clone(wizard.scene));
  {
    const a = SkeletonUtils.clone(wizard.scene);
    const b = SkeletonUtils.clone(wizard.scene);
    const mixA = new AnimationMixer(a);
    const mixB = new AnimationMixer(b);
    mixA.clipAction(jog).play();
    mixB.clipAction(self).play();
    const qa = new Quaternion();
    const qb = new Quaternion();
    for (const t of [0, 0.13, 0.27, 0.41, jog.duration]) {
      mixA.setTime(t);
      mixB.setTime(t);
      a.updateMatrixWorld(true);
      b.updateMatrixWorld(true);
      for (const name of ['Hips', 'Spine', 'LeftUpLeg', 'RightLeg', 'LeftFoot', 'RightForeArm', 'Head']) {
        a.getObjectByName(name)!.getWorldQuaternion(qa);
        b.getObjectByName(name)!.getWorldQuaternion(qb);
        assert.ok(qa.angleTo(qb) < 0.03, `self retarget ${name} at ${t}: ${qa.angleTo(qb)} rad`);
      }
      const ha = a.getObjectByName('Hips')!.getWorldPosition(new Vector3());
      const hb = b.getObjectByName('Hips')!.getWorldPosition(new Vector3());
      assert.ok(ha.distanceTo(hb) < 0.005, `self retarget hips at ${t}`);
    }
  }

  let onSkeleton = 0;
  let offSkeleton = 0;
  // 3. Every pickable character on the wizard's skeleton gets jog + dash with a measured stride, and plays them inside the clamp band
  //    (0.5–2.5x, see avatar.ts), so the feet stay planted at the controller's 7.8 and 16 m/s.
  for (const character of CHARACTERS) {
    const rig = await loadGLB(`${PUBLIC}${character.asset}`);
    const clips = buildLocomotion(rig, wizard);
    if (!onWizardSkeleton(rig.scene)) {
      // Mixamo shooter cast, the beast, the dragon: their own clips, not retargeted (avatar.ts resolves them).
      // Only gait clips with a planted foot are measured; the dragon flies, so nothing of his is.
      assert.equal(clips, rig.animations, `${character.id} keeps its own clips`);
      for (const gait of clips) {
        if (groundSpeedOf(gait) > 0) assert.ok(['walk', 'run'].includes(gait.name), `${character.id} ${gait.name} is not a gait clip`);
      }
      if (character.id === 'dragon') assert.ok(clips.every((gait) => groundSpeedOf(gait) === 0), 'the dragon has no foot contact');
      offSkeleton += 1;
      continue;
    }
    onSkeleton += 1;
    if (character.id === 'hexsahil') {
      const original = SkeletonUtils.clone(rig.scene);
      const { dash } = original.userData.locomotion_v1 as {
        dash: { phase: number; lift: number[]; groundSpeed: number };
      };
      delete original.userData.locomotion_v1;
      const uncalibrated = clip(buildLocomotion({ scene: original, animations: rig.animations }, wizard), 'dash');
      const calibrated = clip(clips, 'dash');
      const time = (1 + dash.phase) * calibrated.duration;
      const value = (gait: AnimationClip, track: string, t: number) => {
        const key = gait.tracks.find((entry) => entry.name === track);
        assert.ok(key);
        return key.InterpolantFactoryMethodLinear().evaluate(t);
      };
      const before = value(uncalibrated, 'Hips.position', time);
      const after = value(calibrated, 'Hips.position', 0);
      assert.ok(Math.abs(after[0]! - before[0]!) < 1e-5 && Math.abs(after[2]! - before[2]!) < 1e-5);
      assert.ok(Math.abs(after[1]! - before[1]! - dash.lift[0]!) < 1e-5);
      const sourceHand = new Quaternion().fromArray(value(uncalibrated, 'LeftHand.quaternion', time)).normalize();
      const fittedHand = new Quaternion().fromArray(value(calibrated, 'LeftHand.quaternion', 0)).normalize();
      assert.ok(sourceHand.angleTo(fittedHand) < 0.001, 'gait phase shifts the existing hand pose with the feet');
      assert.equal(groundSpeedOf(calibrated), dash.groundSpeed);
    }
    const fit = characterHeight(character) / restHeight(SkeletonUtils.clone(rig.scene));
    for (const [name, actual] of [['jog', WALK_SPEED], ['dash', SPRINT_SPEED]] as const) {
      const gait = clip(clips, name);
      const ground = groundSpeedOf(gait) * fit;
      assert.ok(ground > 0, `${character.id} ${name} has a measured stride`);
      const rate = actual / ground;
      assert.ok(rate > 0.5 && rate < 2.5, `${character.id} ${name}: playback ${rate.toFixed(2)}x is outside 0.5–2.5x`);
      if (character.id !== 'wizard') {
        assert.equal((gait.userData as { retargeted?: boolean }).retargeted, true, `${character.id} ${name} is retargeted`);
        assert.equal(gait.userData.speed_mps, undefined, `${character.id} ${name} drops the wizard's speed_mps`);
      }
    }
    // Retargeted feet still reach the floor: lowest toe within a few cm of the rig's own idle.
    const probe = SkeletonUtils.clone(rig.scene);
    const lowest = (gait: AnimationClip) => {
      const mixer = new AnimationMixer(probe);
      mixer.clipAction(gait).play();
      let low = Infinity;
      for (let i = 0; i <= 40; i += 1) {
        mixer.setTime((gait.duration * i) / 40);
        probe.updateMatrixWorld(true);
        for (const toe of ['LeftToeBase', 'RightToeBase']) low = Math.min(low, probe.getObjectByName(toe)!.getWorldPosition(new Vector3()).y);
      }
      mixer.stopAllAction();
      mixer.uncacheRoot(probe);
      return low;
    };
    const floor = lowest(clip(clips, 'idle'));
    for (const name of P4_CLIPS) {
      const drift = Math.abs(lowest(clip(clips, name)) - floor) * fit;
      assert.ok(drift < 0.06, `${character.id} ${name}: toes ${drift.toFixed(3)} m off the idle floor`);
    }
    if (character.id === 'megatinubu') checkBootClearance(SkeletonUtils.clone(rig.scene), clips, fit);
  }
  // 4. The Sproto Shooter cast ship a standing `idle` and a measured `run` (the plaza plays it for both gaits, see
  //    `walksWithRun`); the jade dragon hovers in `idle` and flies `walk` and `run`.
  //    The Sproto Soldier's `walk` is a jog authored for the plaza, so it keeps it.
  const shooterCast = ['soldier', 'laser', 'shooterbot', 'monster', 'beast', 'cargolem', 'mole'];
  for (const character of CHARACTERS.filter((entry) => shooterCast.includes(entry.id))) {
    assert.equal(walksWithRun(character), character.id !== 'soldier', `${character.id} walk gait`);
    const rig = await loadGLB(`${PUBLIC}${character.asset}`);
    const clips = buildLocomotion(rig, null);
    clip(clips, 'idle');
    for (const name of ['walk', 'run']) assert.ok(groundSpeedOf(clip(clips, name)) > 0, `${character.id} ${name} has a planted-foot stride`);
  }
  {
    const dragon = CHARACTERS.find((entry) => entry.id === 'dragon');
    assert.ok(dragon && !walksWithRun(dragon), 'the dragon flies its own walk');
    const rig = await loadGLB(`${PUBLIC}${dragon.asset}`);
    for (const name of ['idle', 'walk', 'run', 'fly', 'fireball']) clip(rig.animations, name);
  }

  // 5. The Flying Midget stays airborne in the clip it moves with (avatar.ts plays its own `run` for walk and sprint).
  {
    const flyer = CHARACTERS.find((entry) => entry.id === 'flyer');
    assert.ok(flyer && fliesWhenMoving(flyer), 'the Flying Midget flies when it moves');
    assert.ok(CHARACTERS.filter((entry) => fliesWhenMoving(entry)).length === 1, 'only the Flying Midget flies');
    const rig = await loadGLB(`${PUBLIC}${flyer.asset}`);
    const probe = SkeletonUtils.clone(rig.scene);
    const rest = new Box3().setFromObject(probe, true).min.y;
    const mixer = new AnimationMixer(probe);
    mixer.clipAction(clip(rig.animations, 'run')).play();
    let low = Infinity;
    for (let i = 0; i <= 40; i += 1) {
      mixer.setTime((clip(rig.animations, 'run').duration * i) / 40);
      probe.updateMatrixWorld(true);
      for (const toe of ['LeftToeBase', 'RightToeBase']) low = Math.min(low, probe.getObjectByName(toe)!.getWorldPosition(new Vector3()).y);
    }
    assert.ok(low - rest > 0.15, `Flying Midget run: toes reach ${(low - rest).toFixed(3)} above the rest floor`);
  }

  // The Sproto Duel cast (wizard, the stage-one bosses and the shooter's later stages) is on the wizard's skeleton.
  assert.ok(onSkeleton >= 15, `wizard-skeleton characters: ${onSkeleton}`);
  console.log(`rig: ${onSkeleton} characters on the wizard skeleton, ${offSkeleton} on their own clips`);
  console.log('rig tests passed');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
