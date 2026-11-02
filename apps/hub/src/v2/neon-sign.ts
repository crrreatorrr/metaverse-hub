import { AdditiveBlending, Box3, LOD, Mesh, MeshStandardMaterial, Vector3, type Object3D } from 'three';
import { WORLD_ROOT, animated, glow, loadGLTF } from './core';

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
  const [near, far] = await Promise.all([
    loadGLTF(`${WORLD_ROOT}v2/web/I9-neon-sign.glb`),
    loadGLTF(`${WORLD_ROOT}v2/web/I9-neon-sign-lod1.glb`),
  ]);
  const lod = new LOD();
  lod.name = 'club-neon-sign';
  const lit: { mat: MeshStandardMaterial; base: number }[] = [];
  for (const [gltf, distance] of [[near, 0], [far, lod1Distance]] as const) {
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
    lod.addLevel(root, distance);
  }
  const collider = near.scene.getObjectByName('sign_collider');
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
