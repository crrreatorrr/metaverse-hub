import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { PortalConfig } from '../../config';
import { portalPosition } from '../../layout';
import { animated, bakeInstanceColors, groundY, instanced, part } from '../../v2/core';
import { SIGN_FONT, buildingSign } from '../../v2/signs';

const Y = -Math.PI / 2;
const at = <T extends { position: Vector3; rotation: Euler }>(obj: T, x: number, y: number, z: number, ry = 0): T => {
  obj.position.set(x, y, z);
  obj.rotation.y = ry;
  return obj;
};

/** A marked walk-through entrance at the existing travel trigger. */
export function buildPlazaEntrance(portal: PortalConfig): Group {
  const entrance = new Group();
  entrance.name = `plaza-entrance-${portal.id}`;
  const at = portalPosition(portal.angle, portal.distance);
  entrance.position.set(at.x, 0, at.z);
  entrance.rotation.y = Math.atan2(-Math.sin(portal.angle), Math.cos(portal.angle));
  const frame = new MeshStandardMaterial({ color: '#57504b', roughness: 0.9 });
  const post = new BoxGeometry(0.34, 4.8, 0.42);
  for (const x of [-3.0, 3.0]) {
    const pillar = new Mesh(post, frame);
    pillar.position.set(x, 2.4, 0);
    entrance.add(pillar);
  }
  const sign = buildingSign(`entrance-sign-${portal.id}`, portal.label, 'Walk in to play', '#dbc9a2', '', false);
  sign.scale.setScalar(0.57);
  sign.position.set(0, 4.8, 0.23);
  entrance.add(sign);
  return entrance;
}

export async function castle(): Promise<{ group: Group; depth: number; portalZ: number }> {
  const g = new Group();
  g.name = 'castle';
  const mtn = await part('C1-mountain', { h: 30, yaw: 0, glow: 0 });
  mtn.scale.set(1.35, 1, 1.15);
  g.add(mtn);
  const gy = (x: number, z: number) => groundY(mtn, x, z, 26) - 0.6;
  g.add(at(await part('C2-tower', { h: 46, yaw: Y, glow: 0 }), 0, gy(0, -10), -10));
  g.add(at(await part('C3-cluster', { h: 38, yaw: Y, glow: 0 }), 22, gy(22, -6), -6, -0.25));
  g.add(at(await part('C4-hall', { h: 24, yaw: Y, glow: 0 }), -24, gy(-24, -4), -4, 0.2));
  g.add(at(await part('C5-viaduct', { h: 15, yaw: Y, glow: 0 }), -24, gy(-24, -22) * 0.7, -22, 0.25));
  const portalZ = 46;
  return { group: g, depth: 86, portalZ };
}

export async function whiteHouse(): Promise<{ group: Group; depth: number; portalZ: number }> {
  const g = new Group();
  g.name = 'white-house';
  const main = await part('W1-main', { h: 30, yaw: Y, glow: 0 });
  g.add(main);
  const size = main.userData.size as Vector3;
  const mw = size.x;
  const md = size.z;
  const portico = await part('W2-portico', { h: 27, yaw: Y, glow: 0 });
  g.add(at(portico, 0, 0, md / 2 + (portico.userData.size as Vector3).z / 2 - 3));
  const wingL = await part('W3-wing', { h: 24, yaw: Y, glow: 0 });
  const ww = (wingL.userData.size as Vector3).x;
  g.add(at(wingL, -(mw / 2 + ww / 2 - 1.5), 0, -2));
  const wingR = await part('W3-wing', { h: 24, yaw: Y, glow: 0 });
  wingR.scale.x = -1;
  g.add(at(wingR, mw / 2 + ww / 2 - 1.5, 0, -2));
  const pole = new Mesh(
    new CylinderGeometry(0.25, 0.3, 14, 8),
    new MeshStandardMaterial({ color: '#dddddd', metalness: 0.6, roughness: 0.3 }),
  );
  pole.position.set(0, 37, -2);
  g.add(pole);
  const flag = new Mesh(
    new PlaneGeometry(7, 4.2, 24, 8),
    new MeshStandardMaterial({ map: usFlag(), side: DoubleSide, roughness: 0.7 }),
  );
  flag.position.set(3.6, 41.5, -2);
  flag.name = 'flag';
  g.add(flag);
  const fp = flag.geometry.attributes.position;
  if (!fp) throw new Error('flag is missing positions');
  const f0 = new Float32Array(fp.array);
  animated.push((t) => {
    const arr = fp.array as Float32Array;
    for (let i = 0; i < fp.count; i += 1) {
      const x = f0[i * 3] ?? 0;
      arr[i * 3 + 2] = Math.sin(x * 1.3 - t * 4) * 0.25 * ((x + 3.5) / 7);
    }
    fp.needsUpdate = true;
  });
  g.add(coinField(26, 40, md / 2 + 26));
  return { group: g, depth: md + 20, portalZ: md / 2 + 30 };
}

function usFlag(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 380;
  c.height = 200;
  const x = c.getContext('2d');
  if (!x) throw new Error('2d context unavailable');
  for (let i = 0; i < 13; i += 1) {
    x.fillStyle = i % 2 ? '#ffffff' : '#b22234';
    x.fillRect(0, (i * 200) / 13, 380, 200 / 13 + 1);
  }
  x.fillStyle = '#3c3b6e';
  x.fillRect(0, 0, 152, 108);
  x.fillStyle = '#fff';
  for (let r = 0; r < 9; r += 1) {
    for (let k = 0; k < (r % 2 ? 5 : 6); k += 1) {
      x.beginPath();
      x.arc(12 + k * 25 + (r % 2 ? 12 : 0), 8 + r * 11.5, 3, 0, 7);
      x.fill();
    }
  }
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function coinField(n: number, spread: number, z0: number): InstancedMesh {
  const geo = new CylinderGeometry(1.1, 1.1, 0.22, 32);
  geo.rotateX(Math.PI / 2);
  const mat = new MeshStandardMaterial({
    color: '#ffcc33',
    metalness: 1,
    roughness: 0.25,
  });
  const im = new InstancedMesh(geo, mat, n);
  im.name = 'gold-coins';
  const seeds = Array.from({ length: n }, () => ({
    x: (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * spread),
    y: 14 + Math.random() * 24,
    z: z0 + (Math.random() - 0.5) * 22,
    p: Math.random() * 6,
  }));
  const m = new Matrix4();
  const q = new Quaternion();
  const e = new Euler();
  const v = new Vector3();
  const one = new Vector3(1, 1, 1);
  const upd = (t: number) => {
    seeds.forEach((s, i) => {
      e.set(0, t * 1.5 + s.p, 0.2);
      q.setFromEuler(e);
      v.set(s.x, s.y + Math.sin(t + s.p) * 1.2, s.z);
      m.compose(v, q, one);
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
  };
  upd(0);
  animated.push(upd);
  im.computeBoundingSphere();
  if (im.boundingSphere) im.boundingSphere.radius += 30;
  return im;
}

export async function greenHill(): Promise<{ group: Group; depth: number; portalZ: number }> {
  const g = new Group();
  g.name = 'green-hill';
  const terr = await part('G1-terrain', { h: 34, yaw: Y, glow: 0 });
  g.add(terr);
  const terrSize = terr.userData.size as Vector3;
  const tw = terrSize.x;
  const td = terrSize.z;
  g.add(at(await part('G2-plateau', { h: 48, glow: 0 }), -tw / 2 - 6, 0, -td / 2 + 4, 0.3));
  g.add(at(await part('G2-plateau', { h: 40, glow: 0 }), tw / 2 + 5, 0, -td / 4, -0.2));
  const plat = new InstancedMesh(
    new BoxGeometry(8, 2.2, 5),
    new MeshStandardMaterial({ map: checker(), roughness: 0.8 }),
    4,
  );
  const spots: readonly (readonly [number, number, number])[] = [
    [-tw / 2 - 18, 30, 10],
    [tw / 2 + 18, 26, 8],
    [tw / 2 + 14, 44, -14],
    [0, 52, -td / 2],
  ];
  spots.forEach((p, i) => plat.setMatrixAt(i, new Matrix4().makeTranslation(p[0], p[1], p[2])));
  plat.instanceMatrix.needsUpdate = true;
  g.add(plat);
  g.add(at(waterfall(9, 26), 0, 13, td / 2 - 3));
  g.add(await instanced('G3-palm', [
    { p: [-tw / 2 + 3, 34, 4] },
    { p: [-tw / 2 + 10, 30, 12], r: 1 },
    { p: [tw / 2 - 6, 34, -4], r: 2 },
    { p: [tw / 2 + 2, 0, td / 2 + 8], r: 0.5, s: 1.1 },
    { p: [-tw / 2 - 6, 0, td / 2 + 6], r: 2.4, s: 1.2 },
    { p: [tw / 2 + 14, 0, 6], r: 1.5 },
    { p: [-tw / 2 - 16, 0, -4], r: 0.3 },
    { p: [4, 34, -td / 2 + 6], r: 2.2 },
  ], { h: 16, glow: 0 }));
  return { group: g, depth: td, portalZ: td / 2 + 16 };
}

function checker(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  if (!x) throw new Error('2d context unavailable');
  for (let i = 0; i < 8; i += 1) {
    for (let j = 0; j < 8; j += 1) {
      x.fillStyle = (i + j) % 2 ? '#8a4b1c' : '#c9893f';
      x.fillRect(i * 16, j * 16, 16, 16);
    }
  }
  x.fillStyle = '#3fd13a';
  x.fillRect(0, 0, 128, 22);
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  return texture;
}

function waterfall(w: number, h: number): Mesh {
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { t: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform float t; varying vec2 vUv; void main(){ float s = fract(vUv.y*6. + t*1.6 + sin(vUv.x*40.)*.1); float streak = smoothstep(.0,.5,s)*smoothstep(1.,.6,s);
      vec3 c = mix(vec3(.25,.65,1.), vec3(.85,.97,1.), streak); gl_FragColor = vec4(c*1.05, .6); }`,
  });
  animated.push((t) => {
    material.uniforms.t.value = t;
  });
  const mesh = new Mesh(new PlaneGeometry(w, h), material);
  mesh.name = 'waterfall';
  return mesh;
}

export async function club(): Promise<{ group: Group; depth: number; door: Group }> {
  const g = new Group();
  g.name = 'bahamas-club';
  g.add(at(await part('B1-building', { h: 27, yaw: 0, glow: 0 }), -17, 0, 8));
  g.add(at(await part('B2-tree', { h: 40, glow: 0 }), 10, 0, -2, 0.6));
  g.add(at(await part('B3-tailfin', { h: 30, yaw: Y, glow: 0 }), 34, 0, 2, -0.35));
  g.add(await instanced('B4-table', [
    { p: [14, 0, 20] },
    { p: [24, 0, 22], r: 0.2 },
    { p: [18, 0, 30], r: -0.1 },
    { p: [30, 0, 32], r: 0.3 },
    { p: [6, 0, 30], r: 0.1 },
  ], { h: 3.2, glow: 0 }));
  g.add(await instanced('B5-palm', [
    { p: [-40, 0, -2] },
    { p: [-36, 0, -16], r: 1, s: 0.9 },
    { p: [48, 0, 14], r: 2 },
    { p: [46, 0, -8], r: 0.4, s: 1.1 },
    { p: [-20, 0, -22], r: 1.2 },
  ], { h: 26, glow: 0 }));
  const plank = new BoxGeometry(0.9, 4, 0.3);
  const fenceMat = new MeshStandardMaterial({ roughness: 0.6 });
  const pts: number[] = [];
  for (let x = -40; x <= 42; x += 1.25) if (Math.abs(x - 2) > 5) pts.push(x);
  const fence = new InstancedMesh(plank, fenceMat, pts.length);
  const cols = ['#e5262b', '#ffd21f', '#1f4fd1'];
  pts.forEach((x, i) => {
    fence.setMatrixAt(i, new Matrix4().makeTranslation(x, 2, 38));
    fence.setColorAt(i, new Color(cols[i % 3] ?? '#ffffff'));
  });
  fence.name = 'picket-fence';
  g.add(bakeInstanceColors(fence));
  const crest = new Mesh(
    new PlaneGeometry(7, 5.2),
    new MeshStandardMaterial({ map: textTex('10', '#f0ddb3', '#313d51', 512, 380, SIGN_FONT), roughness: 0.8 }),
  );
  crest.position.set(-17, 31, 14);
  crest.name = 'sign-10';
  g.add(crest);
  const banner = new Mesh(
    new PlaneGeometry(18, 3.6),
    new MeshStandardMaterial({ map: textTex('CLUB HPOS10I', '#ffffff', '#1f4fd1', 1024, 180, SIGN_FONT), roughness: 0.6 }),
  );
  banner.position.set(10, 2.4, 38.3);
  banner.name = 'sign-hpos10i-banner';
  g.add(banner);
  g.add(at(signpost(), 2, 0, 41, 0.15));
  const door = new Group();
  door.name = 'club-door';
  const trim = new MeshStandardMaterial({ color: '#7b6d5e', roughness: 0.8 });
  const lintel = new Mesh(new BoxGeometry(5.6, 0.36, 0.45), trim);
  lintel.position.y = 4.2;
  door.add(lintel);
  for (const x of [-2.6, 2.6]) {
    const post = new Mesh(new BoxGeometry(0.36, 4.2, 0.36), trim);
    post.position.set(x, 2.1, 0);
    door.add(post);
  }
  const barSign = buildingSign('sign-the-bar', 'THE BAR', '', '#dbc9a2', '', false);
  barSign.position.set(0, 5.2, 0.24);
  door.add(barSign);
  at(door, -17, 0, 22);
  g.add(door);
  return { group: g, depth: 70, door };
}

function signpost(): Group {
  const g = new Group();
  g.name = 'sign-nassau-bahamas';
  const wood = new MeshStandardMaterial({ color: '#7a4a24', roughness: 0.8 });
  const post = new Mesh(new CylinderGeometry(0.35, 0.4, 9, 8), wood);
  post.position.y = 4.5;
  g.add(post);
  const boards: readonly (readonly [string, number, number, string])[] = [
    ['NASSAU', 7.4, 0.25, '#2bd4ff'],
    ['BAHAMAS', 5.6, -0.3, '#ffd21f'],
  ];
  for (const [txt, y, r, col] of boards) {
    const board = new Mesh(
      new BoxGeometry(6.4, 1.5, 0.25),
      new MeshStandardMaterial({ map: textTex(txt, col, '#5a3418', 640, 160, SIGN_FONT), roughness: 0.7 }),
    );
    board.position.set(r > 0 ? 3 : -3, y, 0);
    board.rotation.y = r;
    g.add(board);
  }
  return g;
}

export function textTex(txt: string, fg: string, bg: string, w: number, h: number, font: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  if (!x) throw new Error('2d context unavailable');
  x.fillStyle = bg;
  x.fillRect(0, 0, w, h);
  x.strokeStyle = 'rgba(255,255,255,.35)';
  x.lineWidth = 6;
  x.strokeRect(6, 6, w - 12, h - 12);
  x.fillStyle = fg;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  let size = h * 0.62;
  x.font = `bold ${size}px ${font}, Arial Black, sans-serif`;
  while (size > 18 && x.measureText(txt).width > w - 36) {
    size -= 2;
    x.font = `bold ${size}px ${font}, Arial Black, sans-serif`;
  }
  x.fillText(txt, w / 2, h / 2 + 4);
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export async function kennel(): Promise<{ group: Group; depth: number; portalZ: number }> {
  const g = new Group();
  g.name = 'kennel';
  const house = await part('K1-house', { h: 50, yaw: Y, glow: 0 });
  g.add(house);
  const houseSize = house.userData.size as Vector3;
  const hd = houseSize.z;
  const hw = houseSize.x;
  const bowl = await part('K3-bowl', { h: 7, yaw: Y, metal: 0.6, glow: 0 });
  bowl.scale.setScalar(1.6);
  g.add(at(bowl, -hw / 2 + 2, 0, hd / 2 + 22));
  g.add(await instanced('K2-bone', [
    { p: [hw / 2 + 10, 0, hd / 2 + 6], r: 0.6 },
    { p: [hw / 2 + 4, 0, -hd / 4], r: 2 },
    { p: [-hw / 2 - 10, 0, -6], r: 1.1 },
    { p: [hw / 2 - 2, 0, hd / 2 + 20], r: -0.4 },
  ], { h: 3.4, useLod1: false, glow: 0 }));
  return { group: g, depth: hd, portalZ: hd / 2 + 6 };
}
