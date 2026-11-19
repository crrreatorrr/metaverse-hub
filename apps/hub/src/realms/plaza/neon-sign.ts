import { AdditiveBlending, Box3, LOD, Mesh, MeshStandardMaterial, Vector3, type Object3D, type Texture } from 'three';
import { WORLD_ROOT, animated, glow, loadGLTF } from '../../v2/core';

/**
 * HarryPotterObamaSonic10Inu neon sign (I9-neon-sign.glb + -lod1).
 * Local origin = wall plane at the panel centre, +Z out of the wall, metres (about 1.45 x 1.5 m, 6 cm deep).
 * Place it on any wall; `userData.collider` is a Box3 in the LOD's local space (already includes `scale`)
 * for a simple box collider. `scale` is uniform and applied to each LOD level, so the LOD itself stays unscaled.
 */
const ORDER: Record<string, number> = {
  sign_wallglow: 1, sign_backing: 2, sign_glow: 3, sign_art: 4, sign_tubes_body: 5, sign_tubes: 6,
};
const BLOOM = new Set(['sign_glow', 'sign_art', 'sign_tubes_body', 'sign_tubes']);
const ADDITIVE = new Set(['sign_glow', 'sign_wallglow']);
const FLICKER = new Set(['sign_tubes', 'sign_tubes_body', 'sign_art', 'sign_glow', 'sign_wallglow']);

export async function loadNeonSign(scale = 1, lod1Distance = 14): Promise<LOD> {
  // LOD1 first so the sign never holds up the Bar; LOD0 replaces it up close when it arrives.
  const nearTask = loadGLTF(`${WORLD_ROOT}v2/web/I9-neon-sign.glb`);
  nearTask.catch(() => undefined);
  const far = await loadGLTF(`${WORLD_ROOT}v2/web/I9-neon-sign-lod1.glb`);
  const lod = new LOD();
  lod.name = 'club-neon-sign';
  const lit: { mat: MeshStandardMaterial; base: number }[] = [];
  const makeLevel = (gltf: { scene: Object3D }): Object3D => {
    const root = gltf.scene.clone(true);
    root.scale.setScalar(scale);
    root.traverse((obj: Object3D) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      const name = mesh.name || mesh.parent?.name || '';
      if (name.startsWith('sign_collider')) {
        mesh.visible = false;
        return;
      }
      mesh.renderOrder = ORDER[name] ?? 0;
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as MeshStandardMaterial[];
      const own = mats.map((m) => m.clone());
      mesh.material = Array.isArray(mesh.material) ? own : own[0];
      for (const mat of own) {
        if (mat.transparent) mat.depthWrite = false;
        if (ADDITIVE.has(name)) mat.blending = AdditiveBlending;
        if (FLICKER.has(name)) lit.push({ mat, base: mat.emissiveIntensity });
      }
      if (BLOOM.has(name)) glow(mesh);
    });
    return root;
  };
  const farLevel = makeLevel(far);
  lod.addLevel(farLevel, 0);
  void nearTask.then((near) => {
    const farEntry = lod.levels.find((entry) => entry.object === farLevel);
    if (farEntry) farEntry.distance = lod1Distance;
    const nearLevel = makeLevel(near);
    // A mount that set an envMap on the sign (the Bar) leaves it in userData.envMap for this level.
    const env = lod.userData.envMap as Texture | undefined;
    if (env) {
      nearLevel.traverse((obj) => {
        const m = (obj as Mesh).material as MeshStandardMaterial | undefined;
        if (m?.isMeshStandardMaterial) { m.envMap = env; m.needsUpdate = true; }
      });
    }
    lod.addLevel(nearLevel, 0);
  }).catch((error: unknown) => console.warn('[club] neon sign LOD0 failed; keeping LOD1', error));
  // LOD1 has the same collider mesh as LOD0.
  const collider = far.scene.getObjectByName('sign_collider');
  const box = collider ? new Box3().setFromObject(collider) : new Box3(new Vector3(-0.73, -0.75, 0), new Vector3(0.73, 0.75, 0.06));
  lod.userData.collider = new Box3(box.min.clone().multiplyScalar(scale), box.max.clone().multiplyScalar(scale));

  // Subtle hum plus an occasional tiny dip (never a strobe).
  let next = 4 + Math.random() * 8;
  let dipAt = -1;
  animated.push((t) => {
    if (dipAt < 0 && t > next) dipAt = t;
    let k = 1 + 0.012 * Math.sin(t * 7.3) + 0.006 * Math.sin(t * 23.1);
    if (dipAt >= 0) {
      const d = t - dipAt;
      if (d < 0.05) k *= 0.8;
      else if (d < 0.09) k *= 0.97;
      else if (d < 0.13) k *= 0.88;
      else {
        dipAt = -1;
        next = t + 5 + Math.random() * 10;
      }
    }
    for (const entry of lit) entry.mat.emissiveIntensity = entry.base * k;
  });
  return lod;
}
