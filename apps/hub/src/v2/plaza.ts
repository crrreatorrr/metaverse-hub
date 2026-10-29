import {
  AdditiveBlending,
  Box3,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from 'three';
import { WORLD_ROOT, animated, glow, loadGLTF, neonMat } from './core';

export const R = 110;
export const S = 4096;
const toPx = (x: number) => ((x / R + 1) / 2) * S;

export interface FloorPath {
  a: number;
  tint: string;
  paws?: boolean;
}

export function drawFloor(paths: readonly FloorPath[]): { map: CanvasTexture; emissiveMap: CanvasTexture } {
  const base = document.createElement('canvas');
  base.width = base.height = S;
  const emi = document.createElement('canvas');
  emi.width = emi.height = S;
  const b = base.getContext('2d');
  const e = emi.getContext('2d');
  if (!b || !e) throw new Error('2d context unavailable');
  b.fillStyle = '#100a1d';
  b.fillRect(0, 0, S, S);
  b.strokeStyle = 'rgba(120,100,200,0.10)';
  b.lineWidth = 2;
  for (let r = 6; r < R; r += 4) {
    b.beginPath();
    b.arc(S / 2, S / 2, (r / R) * S / 2, 0, Math.PI * 2);
    b.stroke();
  }
  for (let a = 0; a < 360; a += 3) {
    const t = (a * Math.PI) / 180;
    b.beginPath();
    b.moveTo(S / 2 + Math.sin(t) * 0.12 * S, S / 2 - Math.cos(t) * 0.12 * S);
    b.lineTo(S / 2 + Math.sin(t) * 0.5 * S, S / 2 - Math.cos(t) * 0.5 * S);
    b.stroke();
  }
  e.fillStyle = '#000';
  e.fillRect(0, 0, S, S);
  const P = (x: number, z: number): [number, number] => [toPx(x), toPx(z)];
  const rings: readonly (readonly [number, string, number])[] = [
    [27, '#00e5ff', 10],
    [44, '#ff3bd4', 6],
    [72, '#00e5ff', 6],
    [100, '#a855ff', 8],
    [108, '#00e5ff', 12],
  ];
  for (const [r, c, w] of rings) {
    e.strokeStyle = c;
    e.lineWidth = w;
    e.shadowColor = c;
    e.shadowBlur = 18;
    e.beginPath();
    e.arc(S / 2, S / 2, (r / R) * S / 2, 0, Math.PI * 2);
    e.stroke();
  }
  const rnd = mulberry(7);
  for (let i = 0; i < 220; i += 1) {
    const a0 = rnd() * Math.PI * 2;
    if (paths.some((p) => Math.abs(angDiff(a0, p.a)) < 0.12)) continue;
    const r0 = 28 + rnd() * 76;
    const r1 = Math.min(107, r0 + 4 + rnd() * 18);
    const a1 = a0 + (rnd() - 0.5) * 0.12;
    const c = rnd() < 0.6 ? '#00d9ff' : '#ff3bd4';
    e.strokeStyle = c;
    e.shadowColor = c;
    e.shadowBlur = 8;
    e.lineWidth = 3;
    e.beginPath();
    e.moveTo(...P(Math.sin(a0) * r0, -Math.cos(a0) * r0));
    e.lineTo(...P(Math.sin(a0) * r1, -Math.cos(a0) * r1));
    const steps = 12;
    for (let k = 1; k <= steps; k += 1) {
      const a = a0 + ((a1 - a0) * k) / steps;
      e.lineTo(...P(Math.sin(a) * r1, -Math.cos(a) * r1));
    }
    e.stroke();
    e.fillStyle = c;
    e.beginPath();
    e.arc(...P(Math.sin(a1) * r1, -Math.cos(a1) * r1), 7, 0, Math.PI * 2);
    e.fill();
    e.beginPath();
    e.arc(...P(Math.sin(a0) * r0, -Math.cos(a0) * r0), 5, 0, Math.PI * 2);
    e.fill();
  }
  for (const p of paths) {
    const W = 14;
    const r0 = 26;
    const r1 = R;
    const ux = Math.sin(p.a);
    const uz = -Math.cos(p.a);
    const nx = -uz;
    const nz = ux;
    const quad = (ctx: CanvasRenderingContext2D, w: number) => {
      ctx.beginPath();
      ctx.moveTo(...P(ux * r0 + nx * w, uz * r0 + nz * w));
      ctx.lineTo(...P(ux * r1 + nx * w, uz * r1 + nz * w));
      ctx.lineTo(...P(ux * r1 - nx * w, uz * r1 - nz * w));
      ctx.lineTo(...P(ux * r0 - nx * w, uz * r0 - nz * w));
      ctx.closePath();
    };
    b.fillStyle = '#2a2244';
    quad(b, W / 2);
    b.fill();
    b.strokeStyle = 'rgba(200,180,255,0.18)';
    b.lineWidth = 3;
    for (let r = r0; r < r1; r += 3) {
      b.beginPath();
      b.moveTo(...P(ux * r + nx * W / 2, uz * r + nz * W / 2));
      b.lineTo(...P(ux * r - nx * W / 2, uz * r - nz * W / 2));
      b.stroke();
    }
    e.strokeStyle = p.tint;
    e.shadowColor = p.tint;
    e.shadowBlur = 20;
    e.lineWidth = 9;
    for (const w of [W / 2, -W / 2]) {
      e.beginPath();
      e.moveTo(...P(ux * r0 + nx * w, uz * r0 + nz * w));
      e.lineTo(...P(ux * r1 + nx * w, uz * r1 + nz * w));
      e.stroke();
    }
    e.lineWidth = 6;
    e.globalAlpha = 0.55;
    for (let r = r0 + 8; r < r1 - 6; r += 9) {
      e.beginPath();
      e.moveTo(...P(ux * r + nx * 3, uz * r + nz * 3));
      e.lineTo(...P(ux * (r + 2.5), uz * (r + 2.5)));
      e.lineTo(...P(ux * r - nx * 3, uz * r - nz * 3));
      e.stroke();
    }
    e.globalAlpha = 1;
    if (p.paws) {
      for (let r = 60, k = 0; r < 104; r += 9, k += 1) {
        const off = k % 2 ? 2.8 : -2.8;
        const slide = k % 2 ? 9 : -9;
        drawPaw(e, ...P(ux * r + nx * (off + slide), uz * r + nz * (off + slide)), k % 2 ? '#00f0ff' : '#ff3bd4', p.a);
      }
    }
  }
  e.shadowBlur = 0;
  const mk = (canvas: HTMLCanvasElement) => {
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  };
  return { map: mk(base), emissiveMap: mk(emi) };
}

function drawPaw(e: CanvasRenderingContext2D, x: number, y: number, c: string, a: number): void {
  e.save();
  e.translate(x, y);
  e.rotate(a);
  e.fillStyle = c;
  e.shadowColor = c;
  e.shadowBlur = 20;
  const s = 34;
  e.beginPath();
  e.ellipse(0, 0, s, s * 0.8, 0, 0, Math.PI * 2);
  e.fill();
  for (const [dx, dy] of [[-1.1, -1.3], [-0.4, -1.8], [0.4, -1.8], [1.1, -1.3]] as const) {
    e.beginPath();
    e.ellipse(dx * s, dy * s, s * 0.32, s * 0.4, 0, 0, Math.PI * 2);
    e.fill();
  }
  e.restore();
}

const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildFloor(parent: Object3D, paths: readonly FloorPath[]): Mesh {
  const { map, emissiveMap } = drawFloor(paths);
  const mat = new MeshStandardMaterial({
    map,
    color: '#ffffff',
    roughness: 0.22,
    metalness: 0.75,
    emissive: '#ffffff',
    emissiveMap,
    emissiveIntensity: 1.6,
    envMapIntensity: 0.9,
  });
  mat.name = 'plaza-floor';
  const floor = new Mesh(new CircleGeometry(R, 160), mat);
  floor.rotation.x = -Math.PI / 2;
  floor.name = 'plaza-floor';
  parent.add(floor);
  glow(floor);
  const rim = new Mesh(new TorusGeometry(R, 0.35, 8, 256), neonMat('#00e6ff', 4));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.15;
  rim.name = 'plaza-rim';
  parent.add(glow(rim));
  const outer = new Mesh(new RingGeometry(R, 1400, 128), new MeshStandardMaterial({ color: '#1a0f2c', roughness: 0.95 }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.03;
  outer.name = 'outer-ground';
  parent.add(outer);
  return floor;
}

export function buildPedestal(parent: Object3D): { top: number; rings: Mesh[] } {
  const g = new Group();
  g.name = 'statue-pedestal';
  const stone = new MeshStandardMaterial({ color: '#2a2340', roughness: 0.35, metalness: 0.5 });
  const tiers: readonly (readonly [number, number, number])[] = [[24, 25, 1.3], [20.5, 21.5, 1.3], [17, 18, 1.3]];
  let y = 0;
  tiers.forEach(([rt, rb, h], i) => {
    const mesh = new Mesh(new CylinderGeometry(rt, rb, h, 96), stone);
    mesh.position.y = y + h / 2;
    g.add(mesh);
    const edge = new Mesh(new TorusGeometry(rt, 0.12, 6, 160), neonMat(i % 2 ? '#ff3bd4' : '#00e6ff', 3.5));
    edge.rotation.x = Math.PI / 2;
    edge.position.y = y + h;
    g.add(glow(edge));
    y += h;
  });
  const colors = ['#00e6ff', '#ff3bd4', '#ffc233', '#39ff6a'];
  const rings: Mesh[] = [];
  [-0.62, -0.21, 0.21, 0.62].forEach((a, i) => {
    const ring = new Mesh(new TorusGeometry(1.9, 0.22, 12, 64), neonMat(colors[i] ?? '#00e6ff', 5));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(Math.sin(a) * 22.6, 1.32 + 0.12, Math.cos(a) * 22.6);
    ring.name = `statue-ring-${i}`;
    g.add(glow(ring));
    rings.push(ring);
  });
  parent.add(g);
  return { top: y, rings };
}

export async function buildPortal(tint: string, h = 8): Promise<Group> {
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
    uniforms: { t: { value: 0 }, tint: { value: tc }, aspect: { value: W / H } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float t; uniform vec3 tint; uniform float aspect; varying vec2 vUv;
      void main(){ vec2 q = vUv; vec2 p = vec2((q.x-.5)*2.*aspect, q.y*2.-1.);
        float inside = q.y < .62 ? step(abs(q.x-.5), .5) : step(length(vec2((q.x-.5)*2.*aspect, (q.y-.62)/.38*aspect)), aspect);
        vec2 c = vec2(0., .05); vec2 d = p-c; float r = length(d); float a = atan(d.y,d.x);
        float sw = sin(a*5. + r*10. - t*4.)*.5+.5; float core = exp(-r*2.2);
        vec3 col = tint*(0.55+1.2*sw*(1.-r*.45)) + vec3(1.)*core*.9;
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
  const beam = new Mesh(new CylinderGeometry(W * 0.35, W * 0.55, 70, 24, 1, true), beamMat);
  beam.position.y = 35 + h;
  g.add(beam);
  animated.push((t) => {
    swirl.uniforms.t.value = t;
  });
  return g;
}
