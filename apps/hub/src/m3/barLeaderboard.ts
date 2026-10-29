import { DoubleSide, Group, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, BoxGeometry } from 'three';
import { fitText, paintedCanvas } from './canvas';
import {
  BOARD_META,
  formatBoardScore,
  gameForBoard,
  type HubBoardId,
  type LeaderboardPage,
  type LeaderboardProvider,
  type NewNumberOneEvent,
} from './types';

/**
 * World pose of the bar's +X wall screen.
 * The club interior root is (0, -300, 0). The M2 screen is local (9.88, 3.35, -4)
 * with rotation.y = -π/2. This sits 6 cm toward the room so it clears that mesh
 * until the follow-up hides `leaderboard_screen`.
 */
export const BAR_SCREEN_POSE = { x: 9.82, y: -296.65, z: -4, rotationY: -Math.PI / 2 } as const;

export interface BarLeaderboardOptions {
  provider: LeaderboardProvider;
  position?: { readonly x: number; readonly y: number; readonly z: number };
  rotationY?: number;
  /** Seconds each board stays up. Default 8. */
  cycleSeconds?: number;
  /** Seconds before a board is fetched again. Default 45, inside the 30–60s poll. */
  cacheSeconds?: number;
  /** Fires when the top playerId on a board changes after the first load. */
  onNewNumberOne?: (event: NewNumberOneEvent) => void;
}

export interface BarLeaderboard {
  readonly root: Group;
  board(): HubBoardId | null;
  update(now: number): void;
  dispose(): void;
}

/**
 * One canvas on one plane, plus a box bezel. Boards cycle. Data comes only
 * from `LeaderboardProvider` (see `createStubLeaderboardProvider`).
 */
export function addBarLeaderboardScreen(scene: Object3D, opts: BarLeaderboardOptions): BarLeaderboard {
  const boards = opts.provider.boards;
  const cycleSeconds = Math.max(1, opts.cycleSeconds ?? 8);
  const cacheSeconds = Math.max(1, opts.cacheSeconds ?? 45);
  const pose = opts.position ?? BAR_SCREEN_POSE;
  const group = new Group();
  group.name = 'm3-bar';
  group.position.set(pose.x, pose.y, pose.z);
  group.rotation.y = opts.rotationY ?? BAR_SCREEN_POSE.rotationY;

  const bezelGeo = new BoxGeometry(5.05, 2.9, 0.12);
  const bezelMat = new MeshBasicMaterial({ color: '#ff3bd4', toneMapped: false });
  const bezel = new Mesh(bezelGeo, bezelMat);
  bezel.name = 'm3-bar-bezel';
  group.add(bezel);

  const paint = paintedCanvas(1024, 576);
  const screenMat = new MeshBasicMaterial({ map: paint.texture, toneMapped: false, side: DoubleSide });
  const screen = new Mesh(new PlaneGeometry(4.8, 2.7), screenMat);
  screen.name = 'm3-bar-screen';
  screen.position.z = 0.08;
  group.add(screen);
  scene.add(group);

  const cache = new Map<HubBoardId, { at: number; page: LeaderboardPage }>();
  const tops = new Map<HubBoardId, string>();
  let index = 0;
  let shownAt = 0;
  let started = false;
  let displayToken = 0;
  let disposed = false;

  function currentId(): HubBoardId | null {
    return boards[index] ?? null;
  }

  function paintStatus(boardId: HubBoardId, status: string): void {
    const meta = BOARD_META[boardId];
    const { ctx, canvas } = paint;
    const w = canvas.width;
    const h = canvas.height;
    fillChrome(ctx, w, h, meta.title, meta.unit, meta.order, index, boards.length);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#d7e1ff';
    ctx.font = '600 36px sans-serif';
    ctx.fillText(status, w / 2, h / 2);
    paint.touch();
  }

  function apply(page: LeaderboardPage): void {
    const { ctx, canvas } = paint;
    const w = canvas.width;
    const h = canvas.height;
    const dot = Math.max(0, boards.indexOf(page.boardId));
    fillChrome(ctx, w, h, page.title, page.unit, page.order, dot, boards.length);
    const rows = page.rows.slice(0, 10);
    if (rows.length === 0) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#9aa3c7';
      ctx.font = '600 32px sans-serif';
      ctx.fillText('No scores yet', w / 2, h / 2);
    }
    rows.forEach((row, rowIndex) => {
      const y = 168 + rowIndex * 36;
      ctx.fillStyle = rowIndex % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(0,229,255,0.07)';
      ctx.fillRect(36, y - 22, w - 72, 34);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = '700 24px sans-serif';
      ctx.fillStyle = rowIndex === 0 ? '#ffd21f' : '#d7e1ff';
      ctx.fillText(String(row.rank), 52, y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(fitText(ctx, row.name, w - 320), 110, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#39ff6a';
      ctx.fillText(fitText(ctx, formatBoardScore(page.boardId, row.score), 220), w - 52, y);
    });
    paint.touch();
    const top = page.rows[0];
    const prev = tops.get(page.boardId);
    tops.set(page.boardId, top?.playerId ?? '');
    if (prev !== undefined && top && top.playerId !== prev) {
      opts.onNewNumberOne?.({
        boardId: page.boardId,
        title: page.title,
        gameId: gameForBoard(page.boardId),
        row: top,
      });
    }
  }

  function refresh(boardIndex: number, now: number): void {
    const boardId = boards[boardIndex];
    if (!boardId) {
      paintStatusMessage('No boards');
      return;
    }
    const hit = cache.get(boardId);
    if (hit && now - hit.at < cacheSeconds) {
      if (boardIndex === index) apply(hit.page);
      return;
    }
    const token = ++displayToken;
    paintStatus(boardId, 'Loading…');
    void opts.provider.load(boardId).then(
      (page) => {
        if (disposed) return;
        cache.set(boardId, { at: now, page });
        if (token !== displayToken || boardIndex !== index) return;
        apply(page);
      },
      () => {
        if (disposed || token !== displayToken || boardIndex !== index) return;
        paintStatus(boardId, 'Unavailable');
      },
    );
  }

  function paintStatusMessage(status: string): void {
    const { ctx, canvas } = paint;
    fillChrome(ctx, canvas.width, canvas.height, 'LEADERBOARDS', '', null, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#d7e1ff';
    ctx.font = '600 36px sans-serif';
    ctx.fillText(status, canvas.width / 2, canvas.height / 2);
    paint.touch();
  }

  function update(now: number): void {
    if (disposed || boards.length === 0) return;
    if (!started) {
      started = true;
      shownAt = now;
      return;
    }
    if (now - shownAt < cycleSeconds) return;
    shownAt = now;
    index = (index + 1) % boards.length;
    refresh(index, now);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    displayToken += 1;
    scene.remove(group);
    bezelGeo.dispose();
    bezelMat.dispose();
    screen.geometry.dispose();
    screenMat.dispose();
    paint.texture.dispose();
  }

  refresh(0, 0);
  return { root: group, board: currentId, update, dispose };
}

function fillChrome(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  title: string,
  unit: string,
  order: 'asc' | 'desc' | null,
  active: number,
  count: number,
): void {
  const sky = ctx.createLinearGradient(0, 0, w, h);
  sky.addColorStop(0, '#120a2e');
  sky.addColorStop(1, '#2a0b3a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#00e5ff';
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffd21f';
  ctx.font = '700 42px sans-serif';
  ctx.fillText(fitText(ctx, title, w - 80), w / 2, 52);
  ctx.fillStyle = '#d7e1ff';
  ctx.font = '600 20px sans-serif';
  const hint = order === 'asc' ? 'lower is better' : order === 'desc' ? 'higher is better' : '';
  ctx.fillText(fitText(ctx, unit && hint ? `${unit} · ${hint}` : unit || hint, w - 80), w / 2, 92);
  if (count > 1) {
    const gap = 16;
    const total = count * gap;
    for (let i = 0; i < count; i += 1) {
      ctx.fillStyle = i === active ? '#39ff6a' : 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.arc(w / 2 - total / 2 + i * gap + 6, h - 36, i === active ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
