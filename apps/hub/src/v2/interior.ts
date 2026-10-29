import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Quaternion,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  TorusGeometry,
  Vector3,
} from 'three';
import { WORLD_ROOT, animated, bakeInstanceColors, glow, instanced, neonMat, part } from './core';
import { SIGN_FONT } from './signs';

const Y = -Math.PI / 2;
export const INTERIOR_ORIGIN = new Vector3(0, -300, 0);
const W = 20;
const D = 13;
const H = 5.2;

const tex = (draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number): CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  draw(ctx, w, h);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  texture.userData.canvas = canvas;
  return texture;
};

function woodFloor(): CanvasTexture {
  const texture = tex((x, w, h) => {
    const rnd = mul(3);
    for (let i = 0; i < 32; i += 1) {
      const y0 = (i * h) / 32;
      for (let off = (i % 2) * 90; off < w; off += 180) {
        const l = 40 + rnd() * 30;
        x.fillStyle = `hsl(${24 + rnd() * 6},${38 + rnd() * 10}%,${l * 0.6}%)`;
        x.fillRect(off - 90, y0, 180, h / 32);
        x.strokeStyle = 'rgba(0,0,0,.35)';
        x.strokeRect(off - 90, y0, 180, h / 32);
      }
    }
  }, 1024, 1024);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(9, 6);
  return texture;
}

function brick(): CanvasTexture {
  const texture = tex((x, w, h) => {
    x.fillStyle = '#3a2a2a';
    x.fillRect(0, 0, w, h);
    const rnd = mul(5);
    for (let r = 0; r < 16; r += 1) {
      for (let c = -1; c < 9; c += 1) {
        x.fillStyle = `hsl(${8 + rnd() * 10},${25 + rnd() * 15}%,${18 + rnd() * 10}%)`;
        x.fillRect(c * 64 + (r % 2) * 32 + 2, r * 32 + 2, 60, 28);
      }
    }
  }, 512, 512);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(6, 2);
  return texture;
}

function mul(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function footballTV(): CanvasTexture {
  return tex((x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1e7a2a');
    g.addColorStop(1, '#2fa43a');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(255,255,255,.8)';
    x.lineWidth = 3;
    for (let i = 1; i < 10; i += 1) {
      x.beginPath();
      x.moveTo((i * w) / 10, h * 0.25);
      x.lineTo((i * w) / 10 + (i - 5) * 18, h);
      x.stroke();
    }
    x.fillStyle = '#0b1a40';
    x.fillRect(0, 0, w, h * 0.22);
    x.fillStyle = '#d7e8ff';
    for (let i = 0; i < 26; i += 1) x.fillRect(Math.random() * w, h * 0.3 + Math.random() * h * 0.6, 5, 9);
  }, 512, 288);
}

export function makeLeaderboardTexture(): CanvasTexture {
  const texture = tex(() => {}, 1024, 576);
  texture.userData.draw = (rows: readonly (readonly [string, string])[]) => {
    const canvas = texture.userData.canvas as HTMLCanvasElement;
    const x = canvas.getContext('2d');
    if (!x) return;
    const w = canvas.width;
    const h = canvas.height;
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#120a2e');
    g.addColorStop(1, '#2a0b3a');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.strokeStyle = '#00e5ff';
    x.lineWidth = 8;
    x.strokeRect(8, 8, w - 16, h - 16);
    x.textAlign = 'center';
    x.fillStyle = '#ffd21f';
    x.font = `56px ${SIGN_FONT}, Arial Black`;
    x.fillText('HALL OF CHAMPIONS', w / 2, 78);
    x.fillStyle = '#d7e1ff';
    x.font = `28px ${SIGN_FONT}, Arial Black`;
    x.fillText('LIFETIME VERSE EARNED', w / 2, 124);
    x.font = `36px ${SIGN_FONT}, Arial Black`;
    rows.slice(0, 5).forEach((row, i) => {
      const y = 196 + i * 70;
      x.fillStyle = i % 2 ? 'rgba(255,255,255,.05)' : 'rgba(0,229,255,.08)';
      x.fillRect(40, y - 46, w - 80, 60);
      x.textAlign = 'left';
      x.fillStyle = ['#ffd21f', '#d7e1ff', '#ff9a4d'][i] || '#ffffff';
      x.fillText(`#${i + 1}`, 64, y);
      x.fillStyle = '#fff';
      x.fillText(row[0], 180, y);
      x.textAlign = 'right';
      x.fillStyle = '#39ff6a';
      x.fillText(row[1], w - 64, y);
    });
    texture.needsUpdate = true;
  };
  (texture.userData.draw as (rows: readonly (readonly [string, string])[]) => void)([]);
  return texture;
}

function makeStoreTexture(): CanvasTexture {
  return tex((x, w, h) => {
    x.fillStyle = '#081a24';
    x.fillRect(0, 0, w, h);
    x.strokeStyle = '#39ff6a';
    x.lineWidth = 6;
    x.strokeRect(6, 6, w - 12, h - 12);
    x.fillStyle = '#39ff6a';
    x.font = `48px ${SIGN_FONT}, Arial Black`;
    x.textAlign = 'center';
    x.textBaseline = 'alphabetic';
    x.fillText('VERSE STORE', w / 2, 64);
    const colors = ['#ff3bd4', '#00e5ff', '#ffd21f', '#a855ff'];
    let size = 18;
    x.font = `700 ${size}px ${SIGN_FONT}, Arial Black, sans-serif`;
    while (size > 10 && x.measureText('COMING SOON').width > 96) {
      size -= 1;
      x.font = `700 ${size}px ${SIGN_FONT}, Arial Black, sans-serif`;
    }
    colors.forEach((c, i) => {
      x.fillStyle = c;
      x.fillRect(40 + i * 120, 100, 100, 90);
      x.fillStyle = '#fff';
      x.fillText('COMING SOON', 90 + i * 120, 224);
    });
  }, 512, 288);
}

export interface InteriorBuild {
  group: Group;
  exit: Group;
  leaderboard: CanvasTexture;
  storeAnchor: Object3D;
}

export async function buildInterior(parent: Object3D): Promise<InteriorBuild> {
  const g = new Group();
  g.name = 'club-interior';
  g.position.copy(INTERIOR_ORIGIN);
  const floor = new Mesh(new PlaneGeometry(W, D), new MeshStandardMaterial({ map: woodFloor(), roughness: 0.55, metalness: 0.05 }));
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);
  const ceil = new Mesh(new PlaneGeometry(W, D), new MeshStandardMaterial({ color: '#15151b', roughness: 0.9 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  g.add(ceil);
  const plaster = new MeshStandardMaterial({ color: '#cfc2ab', roughness: 0.9 });
  const wall = (w: number, h: number, mat: MeshStandardMaterial, x: number, y: number, z: number, ry: number) => {
    const mesh = new Mesh(new PlaneGeometry(w, h), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    g.add(mesh);
    return mesh;
  };
  wall(W, H, new MeshStandardMaterial({ map: brick(), roughness: 0.9 }), 0, H / 2, -D / 2, 0);
  wall(D, H, plaster, -W / 2, H / 2, 0, Math.PI / 2);
  wall(W, H, plaster, 0, H / 2, D / 2, Math.PI);
  const loader = new TextureLoader();
  const muralTex = await loader.loadAsync(`${WORLD_ROOT}tex/mural.jpg`);
  muralTex.colorSpace = SRGBColorSpace;
  muralTex.anisotropy = 8;
  wall(D, H, new MeshStandardMaterial({ color: '#222', roughness: 0.9 }), W / 2, H / 2, 0, -Math.PI / 2);
  const muralA = wall(7.6, 4.3, new MeshStandardMaterial({
    map: muralTex,
    roughness: 0.7,
    emissive: '#ffffff',
    emissiveMap: muralTex,
    emissiveIntensity: 0.25,
  }), W / 2 - 0.02, 2.45, 2.4, -Math.PI / 2);
  muralA.name = 'graffiti-mural-east';
  const mt2 = muralTex.clone();
  mt2.repeat.set(0.6, 1);
  mt2.offset.set(0.4, 0);
  mt2.needsUpdate = true;
  const muralB = wall(9, 4.3, new MeshStandardMaterial({
    map: mt2,
    roughness: 0.7,
    emissive: '#ffffff',
    emissiveMap: mt2,
    emissiveIntensity: 0.25,
  }), 5.2, 2.45, D / 2 - 0.02, Math.PI);
  muralB.name = 'graffiti-mural-south';
  const col = new Mesh(new BoxGeometry(0.9, H, 0.9), plaster);
  col.position.set(1.7, H / 2, -D / 2 + 0.45);
  g.add(col);
  const steel = new MeshStandardMaterial({ color: '#2b2d33', metalness: 0.7, roughness: 0.45 });
  const beams = new InstancedMesh(new BoxGeometry(0.25, 0.5, D), steel, 6);
  for (let i = 0; i < 6; i += 1) beams.setMatrixAt(i, new Matrix4().makeTranslation(-8 + i * 3.2, H - 0.3, 0));
  g.add(beams);
  const diag = new InstancedMesh(new BoxGeometry(0.08, 0.08, 1.3), steel, 60);
  let k = 0;
  for (let i = 0; i < 6; i += 1) {
    for (let j = 0; j < 10; j += 1) {
      diag.setMatrixAt(k, new Matrix4().compose(
        new Vector3(-8 + i * 3.2, H - 0.85, -5.9 + j * 1.31),
        new Quaternion().setFromEuler(new Euler(j % 2 ? 0.75 : -0.75, 0, 0)),
        new Vector3(1, 1, 1),
      ));
      k += 1;
    }
  }
  g.add(diag);
  const duct = new Mesh(
    new CylinderGeometry(0.45, 0.45, W, 20),
    new MeshStandardMaterial({ color: '#8a8d94', metalness: 0.8, roughness: 0.35 }),
  );
  duct.rotation.z = Math.PI / 2;
  duct.position.set(0, H - 1.0, 2.6);
  g.add(duct);

  const bar = await part('I1-bar', { h: 1.15, yaw: Y, glow: 0.08, metal: 0.8, level: 'lod0' });
  const barSize = bar.userData.size as Vector3;
  bar.scale.x = 10 / barSize.x;
  bar.scale.z = 2.8 / barSize.z;
  bar.position.set(-4, 0, -2.3);
  g.add(bar);
  const shelves = await part('I3-shelf', { h: 3.0, yaw: Y, glow: 0.15, level: 'lod0' });
  shelves.scale.x = 8 / (shelves.userData.size as Vector3).x;
  shelves.position.set(-4.5, 0, -D / 2 + 0.4);
  g.add(shelves);
  const doors = await part('I6-doors', { h: 2.8, yaw: Y, glow: 0.05, level: 'lod0' });
  doors.position.set(3.6, 0, -D / 2 + 0.25);
  g.add(doors);
  const arcade = await part('I7-arcade', { h: 1.95, yaw: Y, glow: 0.3, level: 'lod0' });
  arcade.position.set(1.4, 0, 5.7);
  arcade.rotation.y = Math.PI;
  g.add(arcade);
  const arcade2 = await part('I7-arcade', { h: 1.95, yaw: Y, glow: 0.3, level: 'lod0' });
  arcade2.position.set(9.3, 0, -1.6);
  arcade2.rotation.y = -Math.PI / 2;
  g.add(arcade2);
  const foos = await part('I8-foosball', { h: 0.95, glow: 0.15, level: 'lod0' });
  foos.position.set(3.6, 0, 2.6);
  foos.rotation.y = 0.15;
  g.add(foos);
  const stoolT: { p: [number, number, number]; r?: number }[] = [];
  for (let i = 0; i < 7; i += 1) stoolT.push({ p: [-8.4 + i * 1.4, 0, -0.45], r: Math.PI + (i % 3 - 1) * 0.15 });
  stoolT.push({ p: [1.9, 0, -1.6], r: -Math.PI / 2 }, { p: [1.9, 0, -2.9], r: -Math.PI / 2 });
  g.add(await instanced('I2-stool', stoolT, { h: 1.05, useLod1: false, glow: 0.05 }));
  const lampT: { p: [number, number, number] }[] = [];
  for (let i = 0; i < 5; i += 1) lampT.push({ p: [-8 + i * 2, H - 1.05, -2.4] });
  g.add(await instanced('I4-lamp', lampT, { h: 1.0, useLod1: false, glow: 0.6 }));
  lampT.forEach((lamp, i) => {
    if (i % 2) return;
    const pl = new PointLight('#ffb35c', 6, 9, 1.6);
    pl.position.set(lamp.p[0], lamp.p[1] - 0.2, lamp.p[2]);
    g.add(pl);
  });
  const bulbs = new InstancedMesh(new SphereGeometry(0.16, 10, 8), neonMat('#ffcf7a', 6), lampT.length);
  lampT.forEach((lamp, i) => bulbs.setMatrixAt(i, new Matrix4().makeTranslation(lamp.p[0], lamp.p[1] + 0.28, lamp.p[2])));
  g.add(glow(bulbs));
  const neon = await loader.loadAsync(`${WORLD_ROOT}tex/neon-sign.jpg`);
  neon.colorSpace = SRGBColorSpace;
  const sign = new Mesh(new PlaneGeometry(1.5, 1.95), new MeshBasicMaterial({ map: neon, toneMapped: false }));
  sign.position.set(-4.5, 1.95, -D / 2 + 0.75);
  sign.name = 'club-neon-sign';
  g.add(glow(sign));
  const strip = new Mesh(new BoxGeometry(10, 0.05, 0.05), neonMat('#3de8ff', 3));
  strip.position.set(-4, 1.08, -0.95);
  g.add(glow(strip));
  const tvTex = footballTV();
  const tv = (x: number, y: number, z: number, ry: number, w = 2.2) => {
    const group = new Group();
    group.add(new Mesh(
      new BoxGeometry(w + 0.12, w * 0.5625 + 0.12, 0.1),
      new MeshStandardMaterial({ color: '#0a0a0a', roughness: 0.4 }),
    ));
    const scr = new Mesh(new PlaneGeometry(w, w * 0.5625), new MeshBasicMaterial({ map: tvTex, toneMapped: false }));
    scr.position.z = 0.06;
    group.add(scr);
    group.position.set(x, y, z);
    group.rotation.y = ry;
    group.name = 'tv';
    g.add(group);
    glow(scr);
  };
  tv(-W / 2 + 0.1, 2.9, -2.5, Math.PI / 2, 2.0);
  tv(3.6, 3.75, -D / 2 + 0.1, 0, 2.0);
  tv(-W / 2 + 0.1, 2.9, 2.8, Math.PI / 2, 2.0);

  const store = new Group();
  store.name = 'verse-store-counter';
  const counter = new Mesh(new BoxGeometry(3.2, 1.05, 1.0), new MeshStandardMaterial({ color: '#141826', metalness: 0.6, roughness: 0.3 }));
  counter.position.y = 0.525;
  store.add(counter);
  const top = new Mesh(new BoxGeometry(3.4, 0.08, 1.2), new MeshStandardMaterial({ color: '#e8eef5', metalness: 0.9, roughness: 0.2 }));
  top.position.y = 1.09;
  store.add(top);
  const trim = new Mesh(new BoxGeometry(3.22, 0.06, 0.06), neonMat('#39ff6a', 4));
  trim.position.set(0, 0.2, 0.52);
  store.add(glow(trim));
  const shelf = new Mesh(new BoxGeometry(3.2, 2.4, 0.45), new MeshStandardMaterial({ color: '#1b1f2e', roughness: 0.5 }));
  shelf.position.set(0, 1.2, -1.3);
  store.add(shelf);
  const items = new InstancedMesh(
    new IcosahedronGeometry(0.16, 1),
    new MeshStandardMaterial({ color: '#fff', emissive: '#ffffff', emissiveIntensity: 0.4, metalness: 0.3, roughness: 0.3 }),
    15,
  );
  const icol = ['#ff3bd4', '#00e5ff', '#ffd21f', '#39ff6a', '#a855ff'];
  for (let i = 0; i < 15; i += 1) {
    items.setMatrixAt(i, new Matrix4().makeTranslation(-1.2 + (i % 5) * 0.6, 0.7 + Math.floor(i / 5) * 0.65, -1.05));
    items.setColorAt(i, new Color(icol[i % 5] ?? '#ffffff'));
  }
  store.add(bakeInstanceColors(items));
  const ledge = new InstancedMesh(new BoxGeometry(3.1, 0.04, 0.4), neonMat('#00e5ff', 2), 3);
  for (let i = 0; i < 3; i += 1) ledge.setMatrixAt(i, new Matrix4().makeTranslation(0, 0.52 + i * 0.65, -1.05));
  store.add(glow(ledge));
  const storeMat = new MeshBasicMaterial({ map: makeStoreTexture(), toneMapped: false });
  storeMat.name = 'store_screen';
  const storeScreen = new Mesh(new PlaneGeometry(1.6, 0.9), storeMat);
  storeScreen.name = 'store_screen';
  storeScreen.position.set(0, 1.55, 0.05);
  storeScreen.rotation.x = -0.25;
  store.add(glow(storeScreen));
  const ui = new Object3D();
  ui.name = 'store_ui_anchor';
  ui.position.set(0, 1.6, 0.6);
  store.add(ui);
  store.position.set(7.4, 0, -4.75);
  g.add(store);

  const lb = new Group();
  lb.name = 'leaderboard-wall-screen';
  lb.add(new Mesh(new BoxGeometry(5.0, 2.95, 0.18), new MeshStandardMaterial({ color: '#0b0b10', metalness: 0.5, roughness: 0.35 })));
  const lbTex = makeLeaderboardTexture();
  const lbMat = new MeshBasicMaterial({ map: lbTex, toneMapped: false });
  lbMat.name = 'leaderboard_screen';
  const lbScreen = new Mesh(new PlaneGeometry(4.75, 2.67), lbMat);
  lbScreen.name = 'leaderboard_screen';
  lbScreen.position.z = 0.1;
  lb.add(glow(lbScreen));
  const lbEdge = new Mesh(new BoxGeometry(5.1, 0.05, 0.05), neonMat('#ff3bd4', 4));
  lbEdge.position.set(0, -1.52, 0.1);
  lb.add(glow(lbEdge));
  lb.position.set(W / 2 - 0.12, 3.35, -4.0);
  lb.rotation.y = -Math.PI / 2;
  g.add(lb);
  const bcol = ['#9be15d', '#ffb02e', '#41c7ff', '#ff5ab4', '#7cf0a0'];
  const balloons = new InstancedMesh(
    new SphereGeometry(0.42, 16, 12),
    new MeshStandardMaterial({ roughness: 0.25, metalness: 0.1 }),
    9,
  );
  for (let i = 0; i < 9; i += 1) {
    balloons.setMatrixAt(i, new Matrix4().compose(
      new Vector3(3 + (i % 5) * 1.5, 4.1 + (i % 3) * 0.3, 5.6 - Math.floor(i / 5) * 1.3),
      new Quaternion(),
      new Vector3(1, 1.2, 1),
    ));
    balloons.setColorAt(i, new Color(bcol[i % 5] ?? '#ffffff'));
  }
  g.add(bakeInstanceColors(balloons));
  const exit = new Group();
  exit.name = 'interior-exit';
  const ef = new Mesh(new BoxGeometry(2.2, 2.6, 0.1), new MeshBasicMaterial({ color: '#ffb35c' }));
  ef.position.y = 1.3;
  exit.add(ef);
  const eTrim = new Mesh(new TorusGeometry(1.15, 0.06, 6, 24, Math.PI), neonMat('#ffd21f', 4));
  eTrim.position.y = 2.6;
  exit.add(glow(eTrim));
  exit.position.set(-6, 0, D / 2 - 0.08);
  exit.rotation.y = Math.PI;
  g.add(exit);
  const fill = new PointLight('#ffe2b8', 10, 22, 1.5);
  fill.position.set(-3, 4.4, 2);
  g.add(fill);
  const fill2 = new PointLight('#c9b8ff', 14, 22, 1.4);
  fill2.position.set(6, 4.3, 2);
  g.add(fill2);
  const spot = new PointLight('#5fe3ff', 6, 10, 1.6);
  spot.position.set(8.5, 2.5, -3);
  g.add(spot);
  g.visible = false;
  parent.add(g);
  animated.push((t) => {
    if (Math.floor(t * 2) % 8 === 0) tvTex.offset.x = Math.sin(t) * 0.02;
  });
  return { group: g, exit, leaderboard: lbTex, storeAnchor: ui };
}
