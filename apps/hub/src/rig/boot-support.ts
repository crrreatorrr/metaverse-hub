import { Matrix4, Vector3, type Object3D, type SkinnedMesh } from 'three';

/** Keep the rendered boots above the capsule floor after the mixer blends its poses. */
export function createBootSupport(rig: Object3D, pivot: Object3D, avatar: Object3D) {
  if (rig.userData.boot_support !== true) return null;
  const boots: { mesh: SkinnedMesh; vertices: number[] }[] = [];
  rig.traverse((object) => {
    const mesh = object as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const joints = mesh.geometry.getAttribute('skinIndex');
    const weights = mesh.geometry.getAttribute('skinWeight');
    if (!joints || !weights) return;
    const vertices = [];
    for (let i = 0; i < joints.count; i += 1) {
      let dominant = 0;
      for (let j = 1; j < weights.itemSize; j += 1) {
        if (weights.getComponent(i, j) > weights.getComponent(i, dominant)) dominant = j;
      }
      const bone = mesh.skeleton.bones[joints.getComponent(i, dominant)];
      if (bone && /^(Left|Right)(Leg|Foot|ToeBase)$/.test(bone.name)) vertices.push(i);
    }
    if (vertices.length) boots.push({ mesh, vertices });
  });
  if (!boots.length) return null;

  const floor = pivot.position.y;
  const toAvatar = new Matrix4();
  const toLocal = new Matrix4();
  const point = new Vector3();
  let lift = 0;
  return (dt: number, grounded: boolean): void => {
    const previous = lift;
    lift *= Math.exp(-24 * dt);
    if (grounded) {
      // Measure from the original pivot so the previous correction cannot feed back.
      pivot.position.y = floor;
      avatar.updateWorldMatrix(true, false);
      pivot.updateMatrixWorld(true);
      toAvatar.copy(avatar.matrixWorld).invert();
      let low = Infinity;
      for (const { mesh, vertices } of boots) {
        toLocal.multiplyMatrices(toAvatar, mesh.matrixWorld);
        for (const index of vertices) {
          mesh.getVertexPosition(index, point).applyMatrix4(toLocal);
          low = Math.min(low, point.y);
        }
      }
      // Limit sudden height changes when blending swings a boot across the floor.
      const maxRise = Math.min(0.028, 1.7 * dt);
      lift = Math.max(lift, Math.min(floor - low, previous + maxRise));
    }
    pivot.position.y = floor + lift;
  };
}
