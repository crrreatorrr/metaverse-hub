import { Matrix4, Vector3, type Object3D, type SkinnedMesh } from 'three';

interface BootProbe {
  mesh: SkinnedMesh;
  vertices: number[];
  positions: Float32Array;
  joints: Uint16Array;
  weights: Float32Array;
  heights: Float64Array;
}

/** Keep the rendered boots above the capsule floor after the mixer blends its poses. */
export function createBootSupport(rig: Object3D, pivot: Object3D, avatar: Object3D, nativeFeet = false) {
  if (rig.userData.boot_support !== true && !nativeFeet) return null;
  const boots: BootProbe[] = [];
  rig.traverse((object) => {
    const mesh = object as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const positions = mesh.geometry.getAttribute('position');
    const joints = mesh.geometry.getAttribute('skinIndex');
    const weights = mesh.geometry.getAttribute('skinWeight');
    if (!positions || !joints || !weights) return;
    const vertices = [];
    const rest = [];
    const skinJoints = [];
    const skinWeights = [];
    for (let i = 0; i < joints.count; i += 1) {
      let dominant = 0;
      for (let j = 1; j < weights.itemSize; j += 1) {
        if (weights.getComponent(i, j) > weights.getComponent(i, dominant)) dominant = j;
      }
      const bone = mesh.skeleton.bones[joints.getComponent(i, dominant)];
      if (!bone || !/^(?:(?:mixamorig:?)?(?:Left|Right)(?:Leg|Foot|ToeBase)|[LR]_(?:Foot|ToeBase)|leg_lower_[LR])$/.test(bone.name)) continue;
      vertices.push(i);
      rest.push(positions.getX(i), positions.getY(i), positions.getZ(i));
      for (let j = 0; j < 4; j += 1) {
        skinJoints.push(joints.getComponent(i, j) * 4);
        skinWeights.push(weights.getComponent(i, j));
      }
    }
    if (vertices.length) {
      boots.push({
        mesh,
        vertices,
        positions: Float32Array.from(rest),
        joints: Uint16Array.from(skinJoints),
        weights: Float32Array.from(skinWeights),
        heights: new Float64Array(mesh.skeleton.bones.length * 4),
      });
    }
  });
  if (!boots.length) return null;

  const floor = pivot.position.y;
  const toAvatar = new Matrix4();
  const toLocal = new Matrix4();
  const fromBone = new Matrix4();
  const point = new Vector3();
  let lift = 0;
  return (dt: number, grounded: boolean): void => {
    const previous = lift;
    const maxStep = Math.min(0.028, 1.7 * dt);
    lift = Math.max(previous * Math.exp(-24 * dt), previous - maxStep);
    if (grounded) {
      // Measure from the original pivot so the previous correction cannot feed back.
      pivot.position.y = floor;
      avatar.updateWorldMatrix(true, false);
      pivot.updateMatrixWorld(true);
      toAvatar.copy(avatar.matrixWorld).invert();
      let low = Infinity;
      for (const { mesh, vertices, positions, joints, weights, heights } of boots) {
        toLocal.multiplyMatrices(toAvatar, mesh.matrixWorld);
        if (mesh.morphTargetInfluences?.length) {
          for (const index of vertices) {
            mesh.getVertexPosition(index, point).applyMatrix4(toLocal);
            low = Math.min(low, point.y);
          }
          continue;
        }
        // Combine the skin transforms once per bone. Each boot vertex only
        // needs the Y row of the same affine transform the renderer uses.
        toLocal.multiply(mesh.bindMatrixInverse);
        mesh.skeleton.bones.forEach((bone, i) => {
          const matrix = fromBone.multiplyMatrices(toLocal, bone.matrixWorld)
            .multiply(mesh.skeleton.boneInverses[i]!).multiply(mesh.bindMatrix).elements;
          const row = i * 4;
          heights[row] = matrix[1]!;
          heights[row + 1] = matrix[5]!;
          heights[row + 2] = matrix[9]!;
          heights[row + 3] = matrix[13]!;
        });
        for (let i = 0; i < vertices.length; i += 1) {
          const position = i * 3;
          const x = positions[position]!;
          const y = positions[position + 1]!;
          const z = positions[position + 2]!;
          let height = 0;
          for (let j = i * 4; j < i * 4 + 4; j += 1) {
            const weight = weights[j]!;
            if (weight === 0) continue;
            const row = joints[j]!;
            height += weight * (heights[row]! * x + heights[row + 1]! * y + heights[row + 2]! * z + heights[row + 3]!);
          }
          low = Math.min(low, height);
        }
      }
      // Limit sudden height changes when blending swings a boot across the floor.
      lift = Math.max(lift, Math.min(floor - low, previous + maxStep));
    }
    pivot.position.y = floor + lift;
  };
}
