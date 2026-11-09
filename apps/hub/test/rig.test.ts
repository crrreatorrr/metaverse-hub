// Gait retarget and foot-plant checks on the shipped avatar GLBs (apps/hub/public/world/v2/avatar).
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { AnimationMixer, Box3, Quaternion, Vector3, type AnimationClip, type Object3D } from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CHARACTERS, SPRINT_SPEED, WALK_SPEED, characterHeight } from '../src/config';
import { measureGroundSpeed, retargetClip } from '../src/rig/gait';
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

async function main(): Promise<void> {
  const wizard = await loadGLB(`${PUBLIC}world/v2/avatar/wizard.glb`);

  // 1. The planted-foot measurement reproduces P4's authored speeds (speed_mps is in fitted hub metres).
  for (const name of P4_CLIPS) {
    const authored = clip(wizard.animations, name).userData as { speed_mps: number; fit_scale: number };
    const measured = measureGroundSpeed(SkeletonUtils.clone(wizard.scene), clip(wizard.animations, name));
    const expected = authored.speed_mps / authored.fit_scale;
    assert.ok(Math.abs(measured - expected) / expected < 0.02, `wizard ${name}: measured ${measured}, authored ${expected}`);
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
      // Mixamo shooter cast, the beast, the dragon: their own clips, untouched (avatar.ts resolves them).
      assert.equal(clips, rig.animations, `${character.id} keeps its own clips`);
      assert.ok(clips.every((clip) => groundSpeedOf(clip) === 0), `${character.id} clips are not re-timed`);
      offSkeleton += 1;
      continue;
    }
    onSkeleton += 1;
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
