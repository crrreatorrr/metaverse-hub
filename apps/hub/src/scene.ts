import {
  AdditiveBlending,
  ACESFilmicToneMapping,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  FogExp2,
  GLSL3,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
  BoxGeometry,
  PlaneGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  CAMERA_FOV,
  MONUMENT_RADIUS,
  PEDESTAL_HEIGHT,
  PILLAR_HEIGHT,
  PILLAR_WIDTH,
  PLAZA_RADIUS,
  PORTAL_DISTANCE,
  PORTALS,
  SOCKETS,
} from './config';
import { barScreenPose, createBarGeometry, createBlockoutGeometry } from './blockouts';
import { buildCollider, type Collider } from './collider';
import { bollardPositions, pillarBoxes, portalPosition, type BoxSpec } from './layout';
import { STAND_Y } from './physics';

export interface HubWorld {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  collider: Collider;
  rig: Group;
  bob: Group;
  avatar: Group;
  shadow: Mesh;
  shadowMat: MeshBasicMaterial;
  labels: Sprite[];
  neonTime: { value: number };
  sockets: { mesh: Mesh; on: boolean }[];
  setRelics: (ids: readonly string[]) => void;
  setBoard: (title: string, rows: readonly (readonly [string, string])[], sample: boolean) => void;
}

function shade(hex: string, scalar: number): Color {
  return new Color(hex).multiplyScalar(scalar);
}

function baked(source: BufferGeometry, matrix: Matrix4, color: Color | null): BufferGeometry {
  const geo = source.index ? source.toNonIndexed() : source.clone();
  geo.applyMatrix4(matrix);
  geo.computeVertexNormals();
  for (const name of ['uv', 'uv1', 'uv2', 'tangent', 'color']) {
    if (geo.getAttribute(name)) geo.deleteAttribute(name);
  }
  if (color) {
    const count = geo.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3));
  }
  return geo;
}

function compose(x: number, y: number, z: number, rotX: number, rotY: number): Matrix4 {
  const obj = new Object3D();
  obj.position.set(x, y, z);
  obj.rotation.set(rotX, rotY, 0);
  obj.updateMatrix();
  return obj.matrix.clone();
}

function looking(x: number, y: number, z: number, tx: number, ty: number, tz: number): Matrix4 {
  const obj = new Object3D();
  obj.position.set(x, y, z);
  obj.lookAt(tx, ty, tz);
  obj.updateMatrix();
  return obj.matrix.clone();
}

function merge(parts: BufferGeometry[], label: string): BufferGeometry {
  const geometry = mergeGeometries(parts, false);
  if (!geometry) throw new Error(`Failed to merge ${label}`);
  return geometry;
}

function paintFloor(): CanvasTexture {
  const size = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  const cx = size / 2;
  const bg = ctx.createRadialGradient(cx, cx, size * 0.04, cx, cx, size * 0.52);
  bg.addColorStop(0, '#221c3a');
  bg.addColorStop(0.45, '#141226');
  bg.addColorStop(1, '#07060f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  ctx.translate(cx, cx);
  for (let i = 0; i < 16; i += 1) {
    ctx.rotate(Math.PI / 8);
    ctx.beginPath();
    ctx.moveTo(size * 0.08, 0);
    ctx.lineTo(size * 0.48, 0);
    ctx.strokeStyle = i % 4 === 0 ? 'rgba(61, 225, 255, 0.28)' : 'rgba(150, 120, 255, 0.12)';
    ctx.lineWidth = i % 4 === 0 ? 4 : 2;
    ctx.stroke();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const rings = [0.16, 0.28, 0.4, 0.55, 0.7, 0.84, 0.95];
  rings.forEach((t, index) => {
    ctx.beginPath();
    ctx.arc(cx, cx, t * cx * 0.98, 0, Math.PI * 2);
    ctx.strokeStyle = index % 2 === 0 ? 'rgba(61, 225, 255, 0.55)' : 'rgba(255, 46, 166, 0.28)';
    ctx.lineWidth = index === rings.length - 1 ? 10 : 3;
    ctx.stroke();
  });

  ctx.beginPath();
  ctx.arc(cx, cx, 0.1 * cx, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(155, 140, 255, 0.8)';
  ctx.lineWidth = 8;
  ctx.stroke();

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function paintScoreboard(
  canvas: HTMLCanvasElement,
  title: string,
  rows: readonly (readonly [string, string])[],
  sample: boolean,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = '#090d18';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(245, 185, 66, 0.06)';
  for (let y = 0; y < h; y += 6) ctx.fillRect(0, y, w, 2);
  ctx.strokeStyle = '#f5b942';
  ctx.lineWidth = 16;
  ctx.strokeRect(24, 24, w - 48, h - 48);
  ctx.fillStyle = '#f5b942';
  ctx.font = '700 72px sans-serif';
  ctx.fillText(title, 72, 130);
  ctx.fillStyle = '#8ea2b8';
  ctx.font = '32px sans-serif';
  ctx.fillText(sample ? 'SAMPLE STANDINGS  ·  VERSE EARNED' : 'VERSE EARNED', 72, 180);
  rows.slice(0, 8).forEach((row, index) => {
    const y = 280 + index * 78;
    ctx.fillStyle = '#9be7ff';
    ctx.font = '700 48px sans-serif';
    ctx.fillText(String(index + 1), 72, y);
    ctx.fillStyle = '#e8f4ff';
    ctx.font = '48px sans-serif';
    ctx.fillText(row[0], 160, y);
    ctx.fillStyle = '#f5b942';
    ctx.font = '700 48px sans-serif';
    ctx.fillText(row[1], w - 280, y);
  });
}

function holoSprite(lines: { text: string; color: string; size: number }[], worldWidth: number): Sprite {
  const w = 1024;
  const h = 420;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.fillStyle = 'rgba(6, 10, 20, 0.55)';
  ctx.strokeStyle = lines[0]?.color ?? '#9be7ff';
  ctx.lineWidth = 10;
  roundRect(ctx, 16, 16, w - 32, h - 32, 36);
  ctx.fill();
  ctx.stroke();
  const total = lines.reduce((sum, line) => sum + line.size, 0) + (lines.length - 1) * 18;
  let y = (h - total) / 2;
  for (const line of lines) {
    y += line.size;
    ctx.fillStyle = line.color;
    ctx.font = `700 ${line.size}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(line.text, w / 2, y);
    y += 18;
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const sprite = new Sprite(material);
  sprite.scale.set(worldWidth, worldWidth * (h / w), 1);
  return sprite;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function radialShadow(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  const gradient = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function boxMatrix(spec: BoxSpec): Matrix4 {
  return new Matrix4().compose(
    new Vector3(spec.x, spec.y, spec.z),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), spec.rotY),
    new Vector3(1, 1, 1),
  );
}

function portalLines(id: string, mature: boolean | undefined): { text: string; color: string; size: number }[] {
  if (id === 'hpos10i') return [
    { text: 'GREEN HILL ZONE', color: '#c8f7c8', size: 72 },
    { text: 'HPOS10I', color: '#ffd0ec', size: 108 },
  ];
  if (id === 'nobu') return [
    { text: 'KENNEL', color: '#f0d2b0', size: 80 },
    { text: 'NOBU', color: '#dff6ff', size: 108 },
  ];
  if (id === 'pb') return [
    { text: 'WHITE HOUSE', color: '#f7f4ee', size: 80 },
    { text: "THE PEOPLE'S BITCOIN", color: '#ffe7b0', size: 64 },
    { text: mature ? '18+' : 'PORTAL', color: '#f5b942', size: 56 },
  ];
  return [
    { text: 'CASTLE', color: '#d7d3ea', size: 80 },
    { text: 'SPROTO DUEL', color: '#efe7ff', size: 96 },
  ];
}

function buildAvatar(): Group {
  const clothParts: BufferGeometry[] = [];
  const cloth = (geo: BufferGeometry, x: number, y: number, z: number, color: string, rotX = 0) => {
    clothParts.push(baked(geo, compose(x, y, z, rotX, 0), new Color(color)));
  };
  cloth(new BoxGeometry(0.16, 0.64, 0.18), -0.11, -STAND_Y + 0.32, 0, '#1a142c');
  cloth(new BoxGeometry(0.16, 0.64, 0.18), 0.11, -STAND_Y + 0.32, 0, '#1a142c');
  cloth(new CylinderGeometry(0.22, 0.26, 0.58, 6), 0, -STAND_Y + 0.9, 0, '#241838');
  cloth(new IcosahedronGeometry(0.2, 0), 0, -STAND_Y + 1.32, 0, '#2c2148');
  const hood = new IcosahedronGeometry(0.26, 0);
  hood.scale(1, 0.82, 1.05);
  cloth(hood, 0, -STAND_Y + 1.36, 0.04, '#321c52');
  cloth(new BoxGeometry(0.3, 0.08, 0.06), 0, -STAND_Y + 0.92, -0.24, '#ff2ea6');

  const avatar = new Group();
  avatar.add(new Mesh(
    merge(clothParts, 'avatar'),
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.08, flatShading: true }),
  ));
  const visor = new Mesh(
    new BoxGeometry(0.22, 0.07, 0.05),
    new MeshBasicMaterial({ color: 0x3de1ff, toneMapped: false }),
  );
  visor.position.set(0, -STAND_Y + 1.3, -0.18);
  avatar.add(visor);
  return avatar;
}

function neonMaterial(time: { value: number }): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    uniforms: { uTime: time },
    toneMapped: false,
    vertexShader: `
      in vec3 color;
      out vec3 vColor;
      out vec3 vNormal;
      out vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vColor = color;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      precision highp float;
      in vec3 vColor;
      in vec3 vNormal;
      in vec3 vWorld;
      uniform float uTime;
      out vec4 fragColor;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - clamp(abs(dot(normalize(vNormal), viewDir)), 0.0, 1.0), 1.65);
        float pulse = 0.84 + 0.16 * sin(uTime * 2.3);
        vec3 col = vColor * (0.5 + fres * 0.85) * pulse;
        fragColor = vec4(col, 1.0);
      }
    `,
  });
}

export function createWorld(): HubWorld {
  const scene = new Scene();
  scene.background = new Color(0x090712);
  scene.fog = new FogExp2(0x120814, 0.015);
  scene.add(new HemisphereLight(0x9bb4ff, 0x2a1230, 0.72));
  const sun = new DirectionalLight(0xfff4e8, 1.55);
  sun.position.set(-18, 30, 12);
  scene.add(sun);

  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.08, 200);
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const sky = new Mesh(
    new SphereGeometry(90, 28, 16),
    new ShaderMaterial({
      glslVersion: GLSL3,
      side: BackSide,
      depthWrite: false,
      toneMapped: false,
      vertexShader: `
        out vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        precision highp float;
        in vec3 vWorld;
        out vec4 fragColor;
        void main() {
          float h = normalize(vWorld).y;
          vec3 top = vec3(0.03, 0.025, 0.07);
          vec3 horizon = vec3(0.18, 0.05, 0.12);
          float t = smoothstep(-0.05, 0.65, h);
          fragColor = vec4(mix(horizon, top, t), 1.0);
        }
      `,
    }),
  );
  sky.frustumCulled = false;
  scene.add(sky);

  const starPositions: number[] = [];
  let seed = 7;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 80; i += 1) {
    const theta = rand() * Math.PI * 2;
    const y = 8 + rand() * 40;
    const r = 28 + rand() * 30;
    starPositions.push(Math.cos(theta) * r, y, Math.sin(theta) * r);
  }
  const stars = new Points(
    new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(starPositions), 3)),
    new PointsMaterial({ color: 0xc9e4ff, size: 0.14, sizeAttenuation: true, fog: false, transparent: true, opacity: 0.85 }),
  );
  scene.add(stars);

  const floor = new Mesh(
    new CircleGeometry(PLAZA_RADIUS, 64),
    new MeshBasicMaterial({ map: paintFloor(), toneMapped: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  scene.add(floor);

  const stoneParts: BufferGeometry[] = [];
  const pushStone = (geo: BufferGeometry, matrix: Matrix4) => {
    stoneParts.push(baked(geo, matrix, null));
  };
  pushStone(new CylinderGeometry(MONUMENT_RADIUS, MONUMENT_RADIUS, PEDESTAL_HEIGHT, 8), compose(0, PEDESTAL_HEIGHT / 2, 0, 0, 0));
  pushStone(new CylinderGeometry(0.42, 0.55, 0.9, 6), compose(0, PEDESTAL_HEIGHT + 0.45, 0, 0, 0));
  pushStone(new ConeGeometry(0.32, 1.1, 6), compose(0, 5.15, 0, 0, 0));
  for (const spec of pillarBoxes()) {
    pushStone(new BoxGeometry(spec.sx, spec.sy, spec.sz), boxMatrix(spec));
  }
  for (const portal of PORTALS) {
    const atPortal = portalPosition(portal.angle, PORTAL_DISTANCE);
    const matrix = new Matrix4().compose(
      new Vector3(atPortal.x, PILLAR_HEIGHT + 0.1, atPortal.z),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -portal.angle),
      new Vector3(1, 1, 1),
    );
    pushStone(new BoxGeometry(3.5, 0.28, PILLAR_WIDTH + 0.06), matrix);
  }
  const curbCount = 28;
  for (let i = 0; i < curbCount; i += 1) {
    const angle = (i / curbCount) * Math.PI * 2;
    const pos = portalPosition(angle, 28.5);
    const arc = (Math.PI * 2 * 28.5) / curbCount;
    const matrix = new Matrix4().compose(
      new Vector3(pos.x, 0.42, pos.z),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -angle),
      new Vector3(1, 1, 1),
    );
    pushStone(new BoxGeometry(arc + 0.5, 0.84, 0.66), matrix);
  }
  for (const post of bollardPositions()) {
    pushStone(new CylinderGeometry(0.18, 0.24, 1.05, 6), compose(post.x, 0.52, post.z, 0, 0));
  }
  scene.add(new Mesh(
    merge(stoneParts, 'stone'),
    new MeshStandardMaterial({ color: 0x1b1730, roughness: 0.88, metalness: 0.06, flatShading: true }),
  ));
  const blockMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.04, flatShading: true });
  scene.add(new Mesh(createBlockoutGeometry(), blockMat));
  scene.add(new Mesh(createBarGeometry(), blockMat));

  const neonTime = { value: 0 };
  const neonParts: BufferGeometry[] = [];
  const pushNeon = (geo: BufferGeometry, matrix: Matrix4, color: Color) => {
    neonParts.push(baked(geo, matrix, color));
  };
  const ringGeo = new TorusGeometry(1.35, 0.12, 6, 22);
  for (const portal of PORTALS) {
    const pos = portalPosition(portal.angle, PORTAL_DISTANCE);
    pushNeon(ringGeo, looking(pos.x, 1.55, pos.z, 0, 1.55, 0), new Color(portal.color));
  }
  pushNeon(new TorusGeometry(1.15, 0.1, 6, 20), compose(0, 3.35, 0, 0, 0), shade('#9b8cff', 0.42));
  pushNeon(new CircleGeometry(0.98, 18), compose(0, 3.35, 0.02, 0, 0), shade('#100818', 0.35));
  pushNeon(new CircleGeometry(0.98, 18), compose(0, 3.35, -0.02, 0, Math.PI), shade('#100818', 0.35));
  pushNeon(new BoxGeometry(1.7, 0.08, 0.08), compose(0, 3.35, 0.08, 0, 0), shade('#c4b8ff', 0.35));
  pushNeon(new BoxGeometry(0.08, 1.7, 0.08), compose(0, 3.35, 0.08, 0, 0), shade('#c4b8ff', 0.35));
  pushNeon(new TorusGeometry(4.02, 0.07, 5, 8), compose(0, PEDESTAL_HEIGHT, 0, Math.PI / 2, 0), shade('#3de1ff', 0.7));
  const socketRing = new TorusGeometry(0.36, 0.055, 5, 14);
  for (const socket of SOCKETS) {
    const pos = portalPosition(socket.angle, 2.25);
    pushNeon(socketRing, looking(pos.x, 3.35, pos.z, 0, 3.35, 0), shade(socket.color, 0.45));
  }
  const socketLights: { id: string; mesh: Mesh; material: MeshBasicMaterial; base: Color; on: boolean }[] = [];
  for (const socket of SOCKETS) {
    const pos = portalPosition(socket.angle, 2.25);
    const material = new MeshBasicMaterial({
      color: socket.color,
      transparent: true,
      opacity: 0.22,
      toneMapped: false,
    });
    const mesh = new Mesh(new OctahedronGeometry(0.18, 0), material);
    mesh.position.set(pos.x, 3.35, pos.z);
    socketLights.push({ id: socket.id, mesh, material, base: new Color(socket.color), on: false });
  }
  for (const post of bollardPositions()) {
    pushNeon(new BoxGeometry(0.22, 0.12, 0.22), compose(post.x, 1.1, post.z, 0, 0), shade('#3de1ff', 0.9));
  }
  scene.add(new Mesh(merge(neonParts, 'neon'), neonMaterial(neonTime)));
  for (const light of socketLights) scene.add(light.mesh);

  function setRelics(ids: readonly string[]): void {
    const owned = new Set(ids);
    for (const light of socketLights) {
      light.on = owned.has(light.id);
      light.material.color.copy(light.base);
      if (!light.on) light.material.color.multiplyScalar(0.35);
      light.material.opacity = light.on ? 1 : 0.22;
      light.mesh.scale.setScalar(light.on ? 1.45 : 0.8);
    }
  }

  const glowParts: BufferGeometry[] = [];
  const disc = new CircleGeometry(2.05, 20);
  for (const portal of PORTALS) {
    const pos = portalPosition(portal.angle, PORTAL_DISTANCE);
    glowParts.push(baked(disc, compose(pos.x, 0.045, pos.z, -Math.PI / 2, 0), new Color(portal.color)));
  }
  const glow = new Mesh(
    merge(glowParts, 'glow'),
    new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      opacity: 0.55,
    }),
  );
  glow.renderOrder = 1;
  scene.add(glow);

  const scoreCanvas = document.createElement('canvas');
  scoreCanvas.width = 1280;
  scoreCanvas.height = 720;
  paintScoreboard(scoreCanvas, 'TOTAL', [], true);
  const scoreTexture = new CanvasTexture(scoreCanvas);
  scoreTexture.colorSpace = SRGBColorSpace;
  const scorePose = barScreenPose();
  const scoreboard = new Mesh(
    new PlaneGeometry(3.15, 1.75),
    new MeshBasicMaterial({ map: scoreTexture, toneMapped: false }),
  );
  scoreboard.position.set(scorePose.x, scorePose.y, scorePose.z);
  scoreboard.rotation.y = scorePose.rotY;
  scene.add(scoreboard);
  function setBoard(title: string, rows: readonly (readonly [string, string])[], sample: boolean): void {
    paintScoreboard(scoreCanvas, title, rows, sample);
    scoreTexture.needsUpdate = true;
  }

  const labels: Sprite[] = [];
  for (const portal of PORTALS) {
    const pos = portalPosition(portal.angle, PORTAL_DISTANCE);
    const outX = Math.sin(portal.angle);
    const outZ = -Math.cos(portal.angle);
    const sprite = holoSprite(portalLines(portal.id, portal.mature), portal.id === 'pb' ? 5.6 : 4.8);
    sprite.position.set(pos.x + outX * 1.6, 4.55, pos.z + outZ * 1.6);
    labels.push(sprite);
    scene.add(sprite);
  }
  const hall = holoSprite(
    [
      { text: 'HALL OF CHAMPIONS', color: '#efeaff', size: 78 },
      { text: 'SEALED', color: '#b9a6ff', size: 92 },
    ],
    4.4,
  );
  hall.position.set(0, 2.15, 4.55);
  const barSign = holoSprite(
    [
      { text: 'BAR', color: '#f5b942', size: 140 },
      { text: 'SCOREBOARD', color: '#ffe7b0', size: 64 },
    ],
    3.2,
  );
  const barAt = barScreenPose();
  barSign.position.set(barAt.x, 4.3, barAt.z);
  labels.push(barSign);
  scene.add(barSign);
  labels.push(hall);
  scene.add(hall);

  const rig = new Group();
  const bob = new Group();
  const avatar = buildAvatar();
  bob.add(avatar);
  rig.add(bob);
  scene.add(rig);

  const shadowMat = new MeshBasicMaterial({
    map: radialShadow(),
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const shadow = new Mesh(new CircleGeometry(0.7, 16), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  shadow.renderOrder = 1;
  scene.add(shadow);

  const collider = buildCollider();
  return {
    scene, camera, renderer, collider, rig, bob, avatar, shadow, shadowMat, labels, neonTime, sockets: socketLights, setRelics, setBoard,
  };
}
