import {
  BoxGeometry, CanvasTexture, CylinderGeometry, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, TextureLoader, type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import woodUrl from './job-art/walnut.webp';
import paperUrl from './job-art/rag-paper.webp';
import cutsUrl from './job-art/relic-cuts.webp';
import { RELIC_JOBS } from './relic-jobs';

const WIDTH = 2.76;
const HEIGHT = 1.96;
const COLS = 4;
const ROWS = Math.ceil(RELIC_JOBS.length / COLS);
const CELL = 320;

function batch(parts: BufferGeometry[]) {
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}

export function buildJobBoard() {
  const root = new Group();
  root.name = 'bar-job-board';
  // The last open bay on the entrance wall, beyond the row of pictures.
  root.position.set(-13.45, 1.92, 0.065);
  const loader = new TextureLoader();
  const wood = loader.load(woodUrl);
  wood.colorSpace = SRGBColorSpace;
  wood.anisotropy = 8;
  const timber = new MeshStandardMaterial({ map: wood, roughness: 0.94 });
  const planks: BufferGeometry[] = [];
  for (let row = 0; row < 5; row++) {
    const height = HEIGHT / 5;
    planks.push(new BoxGeometry(WIDTH, height - 0.009, 0.09)
      .rotateY(row % 2 ? Math.PI : 0).translate(0, HEIGHT / 2 - (row + 0.5) * height, 0));
  }
  // Rails stand proud of the slats. Rotate the end pieces so their grain runs vertically.
  for (const side of [-1, 1]) {
    planks.push(new BoxGeometry(WIDTH + 0.12, 0.088, 0.15).translate(0, side * HEIGHT / 2, 0.028));
    planks.push(new BoxGeometry(HEIGHT, 0.086, 0.12).rotateZ(Math.PI / 2).translate(side * WIDTH / 2, 0, 0.015));
  }
  root.add(new Mesh(batch(planks), timber));

  const canvas = document.createElement('canvas');
  canvas.width = COLS * CELL;
  canvas.height = (ROWS + 1) * CELL;
  const atlas = new CanvasTexture(canvas);
  atlas.colorSpace = SRGBColorSpace;
  atlas.anisotropy = 8;
  const notices: BufferGeometry[] = [];
  const nails: BufferGeometry[] = [];
  function nail(x: number, y: number, z: number) {
    nails.push(new CylinderGeometry(0.014, 0.018, 0.013, 7).rotateX(Math.PI / 2).translate(x, y, z));
  }
  for (const x of [-WIDTH / 2, WIDTH / 2]) for (const y of [-HEIGHT / 2, HEIGHT / 2]) nail(x, y, 0.11);

  // Every paper has its own tilted, curling silhouette, but they share one atlas and draw call.
  const title = new PlaneGeometry(WIDTH - 0.16, 0.34);
  const titleUV = title.attributes.uv;
  for (let i = 0; i < titleUV.count; i++) titleUV.setY(i, (ROWS + titleUV.getY(i)) / (ROWS + 1));
  notices.push(title.translate(0, 0.746, 0.067));
  RELIC_JOBS.forEach((_, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    const x = (col - 1.5) * 0.65, y = 0.19 - row * 0.73;
    const sheet = new PlaneGeometry(0.6, 0.67, 6, 4);
    const pos = sheet.attributes.position, uv = sheet.attributes.uv;
    for (let j = 0; j < pos.count; j++) {
      const u = uv.getX(j), v = uv.getY(j);
      const curl = (1 - v) ** 3 * (0.011 + (i % 2 ? u : 1 - u) ** 3 * 0.047);
      pos.setZ(j, curl);
      if (v === 0) pos.setY(j, pos.getY(j) + 0.007 * Math.sin(j * 13 + i));
      uv.setXY(j, (col + u) / COLS, (ROWS - 1 - row + v) / (ROWS + 1));
    }
    const tilt = Math.sin(i * 3.3 + 1) * 0.034;
    notices.push(sheet.rotateZ(tilt).translate(x, y, 0.073 + (i % 3) * 0.001));
    nail(x - Math.sin(tilt) * 0.30, y + Math.cos(tilt) * 0.30, 0.085);
  });
  root.add(new Mesh(batch(notices), new MeshBasicMaterial({ map: atlas, transparent: true, toneMapped: false })));
  root.add(new Mesh(batch(nails), new MeshStandardMaterial({ color: '#827768', metalness: 0.7, roughness: 0.56 })));

  const paper = new Image();
  const cuts = new Image();
  let inventory: ReadonlySet<string> = new Set();
  function paint(owned: ReadonlySet<string>) {
    inventory = owned;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    ctx.clearRect(0, 0, w, canvas.height);
    ctx.textAlign = 'center';
    // Painted signboard lettering sits inside a clipped-corner, gold-lined cartouche.
    ctx.beginPath();
    ctx.moveTo(25, 10);
    ctx.lineTo(w - 25, 10);
    ctx.lineTo(w - 6, 48);
    ctx.lineTo(w - 6, 265);
    ctx.lineTo(w - 25, 304);
    ctx.lineTo(25, 304);
    ctx.lineTo(6, 265);
    ctx.lineTo(6, 48);
    ctx.closePath();
    ctx.fillStyle = 'rgba(46, 27, 19, .84)';
    ctx.fill();
    ctx.strokeStyle = '#b38d58';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = '#f4d093';
    ctx.font = 'bold 144px Georgia, serif';
    ctx.fillText('RELIC BOUNTIES', w / 2, 198, w - 170);
    ctx.font = 'bold 57px Georgia, serif';
    ctx.fillText('✦', 44, 168);
    ctx.fillText('✦', w - 44, 168);
    ctx.font = 'bold 54px Georgia, serif';
    const collected = RELIC_JOBS.filter(({ relic }) => owned.has(relic.id)).length;
    ctx.fillText(`${collected} OF ${RELIC_JOBS.length} COLLECTED`, w / 2, 277);
    ctx.fillRect(70, 250, 228, 5);
    ctx.fillRect(w - 298, 250, 228, 5);

    RELIC_JOBS.forEach(({ game, relic, cut }, i) => {
      ctx.save();
      ctx.translate(i % COLS * CELL, (1 + Math.floor(i / COLS)) * CELL);
      ctx.fillStyle = '#e9d1a5';
      ctx.fillRect(0, 0, CELL, CELL);
      if (paper.naturalWidth) ctx.drawImage(paper, 0, 0, CELL, CELL);
      ctx.strokeStyle = '#765239';
      ctx.lineWidth = 3;
      ctx.strokeRect(8, 7, CELL - 16, CELL - 14);
      ctx.fillStyle = '#623b2b';
      ctx.font = 'bold 22px Georgia, serif';
      ctx.fillText(game.label.toUpperCase(), CELL / 2, 55, CELL - 38);
      if (cuts.naturalWidth) ctx.drawImage(cuts, cut * 192, 0, 192, 192, 80, 53, 160, 160);
      ctx.fillStyle = '#3a261a';
      ctx.font = 'bold 42px Georgia, serif';
      ctx.fillText(relic.name, CELL / 2, 244, CELL - 30);
      const done = owned.has(relic.id);
      ctx.fillStyle = done ? '#335843' : '#8a3929';
      ctx.font = 'bold 24px Georgia, serif';
      ctx.fillText(done ? '★ COLLECTED ★' : '— OPEN JOB —', CELL / 2, 290);
      ctx.restore();
    });
    atlas.needsUpdate = true;
  }
  paper.onload = cuts.onload = () => paint(inventory);
  paper.src = paperUrl;
  cuts.src = cutsUrl;
  return { root, paint };
}
