import { AdditiveBlending, Box3, Color, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, PlaneGeometry, ShaderMaterial, TorusGeometry, Vector3 } from 'three';
import { WORLD_ROOT, animated, glow, loadGLTF, neonMat } from '../v2/core';

export async function buildPortal(tint: string, h = 8, opts: { beam?: boolean; core?: boolean } = {}): Promise<Group> {
  const src = (await loadGLTF(`${WORLD_ROOT}assets/portal-gate.glb`)).scene.clone(true);
  const g = new Group();
  g.name = 'portal';
  const box = new Box3().setFromObject(src);
  const s = h / box.getSize(new Vector3()).y;
  src.scale.setScalar(s);
  src.rotation.y = -Math.PI / 2;
  src.updateMatrixWorld(true);
  const b2 = new Box3().setFromObject(src);
  const c = b2.getCenter(new Vector3());
  src.position.set(-c.x, -b2.min.y, -c.z);
  const tc = new Color(tint);
  src.name = 'portal-gate';
  src.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    const source = mesh.material as MeshStandardMaterial;
    const material = source.clone();
    material.color = tc.clone().lerp(new Color('#ffffff'), 0.15);
    material.emissive = tc.clone();
    material.emissiveMap = material.map;
    material.emissiveIntensity = 2.2;
    material.metalness = 0.2;
    material.roughness = 0.4;
    mesh.material = material;
  });
  g.add(glow(src));
  const sz = b2.getSize(new Vector3());
  const W = Math.max(sz.x, sz.z) * 0.62;
  const H = sz.y * 0.8;
  const swirl = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: { t: { value: 0 }, tint: { value: tc }, aspect: { value: W / H }, coreGlow: { value: opts.core === false ? 0 : 0.9 }, armLight: { value: opts.core === false ? 1 : 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float t; uniform vec3 tint; uniform float aspect; uniform float coreGlow; uniform float armLight; varying vec2 vUv;
      void main(){ vec2 q = vUv; vec2 p = vec2((q.x-.5)*2.*aspect, q.y*2.-1.);
        float inside = q.y < .62 ? step(abs(q.x-.5), .5) : step(length(vec2((q.x-.5)*2.*aspect, (q.y-.62)/.38*aspect)), aspect);
        vec2 c = vec2(0., .05); vec2 d = p-c; float r = length(d); float a = atan(d.y,d.x);
        float sw = sin(a*5. + r*10. - t*4.)*.5+.5; float core = exp(-r*2.2);
        vec3 col = tint*(0.55+1.2*sw*(1.-r*.45)) + vec3(1.)*core*coreGlow + vec3(1.)*pow(sw, 8.)*(1.-r*.5)*armLight;
        float alpha = inside*(0.78 + 0.22*sw);
        gl_FragColor = vec4(col*1.6, alpha); }`,
  });
  const disc = new Mesh(new PlaneGeometry(W, H), swirl);
  disc.position.y = H / 2 + 0.15;
  disc.name = 'portal-swirl';
  g.add(glow(disc));
  const base = new Mesh(new TorusGeometry(W * 0.9, 0.18, 8, 64), neonMat(tint, 5));
  base.rotation.x = Math.PI / 2;
  base.position.y = 0.12;
  g.add(glow(base));
  const beamMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: { tint: { value: tc } },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform vec3 tint; varying vec2 vUv; void main(){ float a = (1.-vUv.y)*0.35*(0.6+0.4*sin(vUv.x*6.2831*3.)); gl_FragColor = vec4(tint*a, a); }`,
  });
  if (opts.beam !== false) {
    const beam = new Mesh(new CylinderGeometry(W * 0.35, W * 0.55, 70, 24, 1, true), beamMat);
    beam.position.y = 35 + h;
    g.add(beam);
  }
  animated.push((t) => {
    swirl.uniforms.t.value = t;
  });
  return g;
}
