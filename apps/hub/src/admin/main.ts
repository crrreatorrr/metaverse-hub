// Feedback admin panel (/admin/). Lists the notes players send with N-N from the hub and the
// games, one tab per game, and moves them open → in progress → fixed → resolved. The server
// (feedback.admin.*) checks the login and refuses "resolved" without a verification note.
import { HubSdkError, createNakamaClient, getOrCreateDeviceId } from '@metaverse/hub-sdk';
import './admin.css';

interface Note {
  id: string;
  game: string;
  userId: string;
  username: string;
  source: string;
  status: Status;
  categories: string[];
  note: string;
  level: string;
  mode: string;
  position: { x: number; y: number; z: number | null } | null;
  version: string;
  clientTime: string;
  gameTime: number | null;
  hasImage: boolean;
  resolution: string;
  verification: string;
  fixedCommit: string;
  createdAt: string;
  updatedAt: string;
  meta?: Record<string, unknown>;
}

type Status = 'open' | 'in_progress' | 'fixed' | 'resolved';
type Counts = Record<string, Partial<Record<Status, number>>>;

/** A Check run (feedback.admin.check): one pass by the agent over every note not yet resolved. */
interface Run {
  id: number;
  state: 'queued' | 'running' | 'done' | 'failed' | 'canceled';
  requestedBy: string;
  worker: string;
  summary: string;
  noteCount: number;
  requestedAt: string;
  startedAt: string | null;
  heartbeatAt: string | null;
  finishedAt: string | null;
}

const STATUS_LABEL: Record<Status, string> = { open: 'Open', in_progress: 'In progress', fixed: 'Fixed, to verify', resolved: 'Resolved' };
const STATUS_COLOR: Record<Status, string> = { open: '#f5b942', in_progress: '#3de1ff', fixed: '#8d7dff', resolved: '#4ade80' };
const CATEGORY_LABEL: Record<string, string> = {
  broke: 'Something broke',
  unclear: 'Unclear what to do',
  too_hard: 'Too hard',
  too_easy: 'Too easy',
  controls: 'Controls feel off',
  performance: 'Performance issue',
  other: 'Other',
};
const GAME_LABEL: Record<string, string> = {
  hub: 'Hub',
  hpos10i: 'HPOS10I',
  nobu: 'NOBU',
  'peoples-bitcoin': "People's Bitcoin",
  sproto: 'Sproto Duel',
  'sproto-fighter': 'Sproto Fighter',
  'sproto-arcade': 'Sproto Arcade',
  'sproto-shooter': 'Sproto Shooter',
  'sproto-coop-battle': 'Sproto Coop Battle',
};
const TOKEN_KEY = 'hub:feedback-admin';

const client = createNakamaClient({ serverUrl: '', serverKey: __NAKAMA_SERVER_KEY__ });
const app = document.querySelector<HTMLElement>('#admin')!;
let sessionToken = '';
let adminToken = '';
let games: string[] = Object.keys(GAME_LABEL);
let counts: Counts = {};
let items: Note[] = [];
let total = 0;
let selectedId = '';
const filter = { game: '', status: '', category: '', q: '', level: '' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function rpc<T>(id: string, body: Record<string, unknown>): Promise<T> {
  if (!sessionToken) sessionToken = (await client.authenticateDevice(getOrCreateDeviceId())).token;
  try {
    return await client.rpc<T>(id, body, { token: sessionToken });
  } catch (error) {
    // An expired device session: sign the device in again once.
    if (error instanceof HubSdkError && error.status === 401) {
      sessionToken = (await client.authenticateDevice(getOrCreateDeviceId())).token;
      return client.rpc<T>(id, body, { token: sessionToken });
    }
    throw error;
  }
}

function adminRpc<T>(id: string, body: Record<string, unknown> = {}): Promise<T> {
  return rpc<T>(id, { ...body, token: adminToken }).catch((error: unknown) => {
    if (error instanceof HubSdkError && error.code === 'unauthorized') {
      adminToken = '';
      sessionStorage.removeItem(TOKEN_KEY);
      showLogin('Your login expired. Sign in again.');
    }
    throw error;
  });
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function clock(seconds: number | null): string {
  if (seconds === null) return '';
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ login

function showLogin(message = ''): void {
  window.clearTimeout(runTimer);
  app.replaceChildren();
  const form = el('form', 'login');
  const user = el('input', 'field');
  user.autocomplete = 'username';
  const pass = el('input', 'field');
  pass.type = 'password';
  pass.autocomplete = 'current-password';
  const error = el('div', 'error', message);
  error.setAttribute('role', 'alert');
  const submit = el('button', 'btn primary', 'Sign in');
  submit.type = 'submit';
  const userLabel = el('label', '', 'User');
  userLabel.append(user);
  const passLabel = el('label', '', 'Password');
  passLabel.append(pass);
  form.append(el('h1', '', 'Feedback admin'), userLabel, passLabel, error, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.disabled = true;
    error.textContent = '';
    rpc<{ token: string }>('feedback.admin.login', { user: user.value.trim(), pass: pass.value })
      .then((result) => {
        adminToken = result.token;
        sessionStorage.setItem(TOKEN_KEY, adminToken);
        return showPanel();
      })
      .catch((e: unknown) => {
        const code = e instanceof HubSdkError ? e.code : '';
        error.textContent = code === 'bad_login' ? 'Wrong user or password.' : code === 'rate_limited' ? 'Too many attempts. Wait ten minutes.' : 'The hub server did not answer.';
      })
      .finally(() => {
        submit.disabled = false;
      });
  });
  app.append(form);
  user.focus();
}

// ------------------------------------------------------------------ panel

let listBox: HTMLElement;
let detailBox: HTMLElement;
let tabsBox: HTMLElement;
let mapBox: HTMLElement;
let totalLabel: HTMLElement;

async function showPanel(): Promise<void> {
  app.replaceChildren();
  const wrap = el('div', 'wrap');
  const top = el('div', 'top');
  const who = el('div', 'who');
  const exportJson = el('button', 'btn', 'Export JSON');
  exportJson.addEventListener('click', () => download('json'));
  const exportCsv = el('button', 'btn', 'Export CSV');
  exportCsv.addEventListener('click', () => download('csv'));
  const out = el('button', 'btn', 'Sign out');
  out.addEventListener('click', () => {
    adminToken = '';
    sessionStorage.removeItem(TOKEN_KEY);
    showLogin();
  });
  checkButton = el('button', 'btn primary', 'Check');
  checkButton.title = 'Start the agent on every note that is not resolved yet';
  checkButton.addEventListener('click', () => void startCheck());
  who.append(checkButton, exportJson, exportCsv, out);
  top.append(el('h1', '', 'Feedback'), who);
  runBox = el('div', 'runbar');
  runBox.setAttribute('role', 'status');
  runBox.hidden = true;

  tabsBox = el('div', 'tabs');
  tabsBox.setAttribute('role', 'tablist');

  const filters = el('div', 'filters');
  const status = el('select', 'field');
  status.setAttribute('aria-label', 'Status');
  status.append(new Option('Any status', ''), ...(Object.keys(STATUS_LABEL) as Status[]).map((s) => new Option(STATUS_LABEL[s], s)));
  status.addEventListener('change', () => {
    filter.status = status.value;
    void load();
  });
  const category = el('select', 'field');
  category.setAttribute('aria-label', 'Option');
  category.append(new Option('Any option', ''), ...Object.entries(CATEGORY_LABEL).map(([id, label]) => new Option(label, id)));
  category.addEventListener('change', () => {
    filter.category = category.value;
    void load();
  });
  const search = el('input', 'field grow');
  search.type = 'search';
  search.placeholder = 'Search notes, players, IDs, levels';
  let timer = 0;
  search.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      filter.q = search.value.trim();
      void load();
    }, 250);
  });
  const refresh = el('button', 'btn', 'Refresh');
  refresh.addEventListener('click', () => void load());
  totalLabel = el('span', 'who');
  filters.append(status, category, search, refresh, totalLabel);

  const cols = el('div', 'cols');
  const left = el('div');
  mapBox = el('div');
  listBox = el('div', 'list');
  left.append(mapBox, listBox);
  detailBox = el('div');
  cols.append(left, detailBox);
  wrap.append(top, runBox, tabsBox, filters, cols);
  app.append(wrap);
  await load();
  await loadRuns();
}

/** Reloads the notes. `keepDetail` leaves the open note's panel alone (the run bar's refresh). */
async function load(keepDetail = false): Promise<void> {
  const body: Record<string, unknown> = { limit: 300 };
  if (filter.game) body.game = filter.game;
  if (filter.status) body.status = filter.status;
  if (filter.category) body.category = filter.category;
  if (filter.q) body.q = filter.q;
  let result: { items: Note[]; total: number; counts: Counts; games: string[] };
  try {
    result = await adminRpc('feedback.admin.list', body);
  } catch {
    if (adminToken) listBox.replaceChildren(el('div', 'empty', 'Could not load notes. Check the hub server and press Refresh.'));
    return;
  }
  items = result.items;
  total = result.total;
  counts = result.counts;
  games = result.games;
  renderTabs();
  renderMap();
  renderList();
  if (keepDetail && selectedId) return;
  if (selectedId && items.some((n) => n.id === selectedId)) void select(selectedId);
  else detailBox.replaceChildren(el('div', 'empty', items.length ? 'Pick a note to see its screenshot and details.' : ''));
}

function renderTabs(): void {
  const tab = (game: string, label: string) => {
    const node = el('button', 'tab');
    node.type = 'button';
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-selected', String(filter.game === game));
    const scope = game ? [counts[game] ?? {}] : Object.values(counts);
    const open = scope.reduce((sum, c) => sum + (c.open ?? 0) + (c.in_progress ?? 0) + (c.fixed ?? 0), 0);
    const all = scope.reduce((sum, c) => sum + (c.open ?? 0) + (c.in_progress ?? 0) + (c.fixed ?? 0) + (c.resolved ?? 0), 0);
    const n = el('span', open ? 'n hot' : 'n', `${open} open / ${all}`);
    node.append(el('span', '', label), n);
    node.addEventListener('click', () => {
      filter.game = game;
      filter.level = '';
      selectedId = '';
      void load();
    });
    return node;
  };
  tabsBox.replaceChildren(tab('', 'All'), ...games.map((game) => tab(game, GAME_LABEL[game] ?? game)));
}

function renderList(): void {
  totalLabel.textContent = total > items.length ? `Showing ${items.length} of ${total}` : `${total} note${total === 1 ? '' : 's'}`;
  const shown = filter.level ? items.filter((n) => n.level === filter.level) : items;
  if (!shown.length) {
    listBox.replaceChildren(el('div', 'empty', 'No notes match. Players send them by pressing N twice.'));
    return;
  }
  listBox.replaceChildren(
    ...shown.map((note) => {
      const row = el('button', 'row');
      row.type = 'button';
      row.setAttribute('aria-current', String(note.id === selectedId));
      const l1 = el('div', 'l1');
      l1.append(el('span', 'id', note.id), el('span', `pill ${note.status}`, STATUS_LABEL[note.status]));
      for (const c of note.categories) l1.append(el('span', 'pill cat', CATEGORY_LABEL[c] ?? c));
      if (note.source === 'crash') l1.append(el('span', 'pill cat', 'After an error'));
      const l3 = el('div', 'l3');
      l3.append(el('span', '', note.username), el('span', '', when(note.createdAt)));
      if (note.level) l3.append(el('span', '', note.level));
      if (!filter.game) l3.append(el('span', '', GAME_LABEL[note.game] ?? note.game));
      row.append(l1, el('div', 'note', note.note || '(no note)'), l3);
      row.addEventListener('click', () => void select(note.id));
      return row;
    }),
  );
}

// Position map: where on a level the notes were sent. One game and one level at a time.
function renderMap(): void {
  mapBox.replaceChildren();
  if (!filter.game) return;
  const placed = items.filter((n) => n.position);
  if (!placed.length) return;
  const levels = Array.from(new Set(placed.map((n) => n.level))).sort();
  if (!levels.includes(filter.level)) filter.level = levels.length === 1 ? levels[0]! : '';
  const panel = el('div', 'panel');
  panel.style.marginBottom = '12px';
  const head = el('div', 'legend');
  const pick = el('select', 'field');
  pick.setAttribute('aria-label', 'Level');
  pick.append(new Option('All levels (pick one to map)', ''), ...levels.map((l) => new Option(l || '(no level)', l)));
  pick.value = filter.level;
  pick.addEventListener('change', () => {
    filter.level = pick.value;
    renderMap();
    renderList();
  });
  head.append(el('strong', '', 'Where notes were sent'), pick);
  for (const s of Object.keys(STATUS_LABEL) as Status[]) {
    const item = el('span');
    const dot = el('span', 'dot');
    dot.style.background = STATUS_COLOR[s];
    item.append(dot, STATUS_LABEL[s]);
    head.append(item);
  }
  panel.append(head);
  const points = placed.filter((n) => n.level === filter.level);
  if (filter.level !== '' || levels.length === 1) {
    const canvas = el('canvas', 'map');
    panel.append(canvas);
    mapBox.append(panel);
    drawMap(canvas, points);
  } else {
    mapBox.append(panel);
  }
}

function drawMap(canvas: HTMLCanvasElement, points: Note[]): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d');
  if (!g || !points.length) return;
  g.scale(dpr, dpr);
  // 3D games walk on the x/z plane; 2D games use x/y with y growing downward.
  const flat = points.some((n) => n.position!.z !== null);
  const px = (n: Note) => n.position!.x;
  const py = (n: Note) => (flat ? (n.position!.z ?? 0) : n.position!.y);
  let minX = Math.min(...points.map(px));
  let maxX = Math.max(...points.map(px));
  let minY = Math.min(...points.map(py));
  let maxY = Math.max(...points.map(py));
  const padX = Math.max(1, (maxX - minX) * 0.08);
  const padY = Math.max(1, (maxY - minY) * 0.08);
  minX -= padX;
  maxX += padX;
  minY -= padY;
  maxY += padY;
  const margin = 26;
  const scale = Math.min((w - margin * 2) / (maxX - minX), (h - margin * 2) / (maxY - minY));
  const ox = (w - (maxX - minX) * scale) / 2;
  const oy = (h - (maxY - minY) * scale) / 2;
  const at = (n: Note): [number, number] => [ox + (px(n) - minX) * scale, oy + (py(n) - minY) * scale];
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.strokeRect(ox, oy, (maxX - minX) * scale, (maxY - minY) * scale);
  g.fillStyle = '#a8b4ca';
  g.font = '11px ui-monospace, monospace';
  g.fillText(`x ${minX.toFixed(0)} … ${maxX.toFixed(0)}`, ox, oy + (maxY - minY) * scale + 14);
  g.fillText(`${flat ? 'z' : 'y'} ${minY.toFixed(0)} … ${maxY.toFixed(0)}`, ox, oy - 6);
  for (const n of points) {
    const [x, y] = at(n);
    g.beginPath();
    g.arc(x, y, n.id === selectedId ? 7 : 5, 0, Math.PI * 2);
    g.fillStyle = STATUS_COLOR[n.status];
    g.globalAlpha = n.status === 'resolved' ? 0.5 : 0.9;
    g.fill();
    g.globalAlpha = 1;
    if (n.id === selectedId) {
      g.lineWidth = 2;
      g.strokeStyle = '#fff';
      g.stroke();
    }
  }
  canvas.onclick = (event) => {
    const r = canvas.getBoundingClientRect();
    let best: Note | null = null;
    let bestD = 14 * 14;
    for (const n of points) {
      const [x, y] = at(n);
      const d = (x - (event.clientX - r.left)) ** 2 + (y - (event.clientY - r.top)) ** 2;
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (best) void select(best.id);
  };
}

// ------------------------------------------------------------------ check runs
//
// Check queues one run on the hub server. The worker on the owner's machine
// (scripts/feedback-worker.mjs) claims it and starts the agent, which works the notes and moves
// their statuses. The server allows one queued-or-running run, so a second Check shows the run
// already in flight instead of starting another.

let runBox: HTMLElement;
let checkButton: HTMLButtonElement;
let runTimer = 0;
let lastRun = '';

const RUN_LABEL: Record<Run['state'], string> = {
  queued: 'Waiting for the worker',
  running: 'Working',
  done: 'Last check finished',
  failed: 'Last check failed',
  canceled: 'Last check canceled',
};

async function startCheck(): Promise<void> {
  checkButton.disabled = true;
  try {
    const result = await adminRpc<{ run: Run | null; created: boolean }>('feedback.admin.check');
    if (!result.run) renderRun(null, null, 'Nothing to check: every note is resolved.');
    else renderRun(result.run, null, result.created ? '' : 'A check is already in progress.');
  } catch {
    renderRun(null, null, 'Could not start a check. Is the hub server up?');
    checkButton.disabled = false;
    return;
  }
  scheduleRuns(3000);
}

async function cancelRun(run: Run): Promise<void> {
  if (!window.confirm(`Cancel check #${run.id}? Notes keep the status the agent gave them so far.`)) return;
  try {
    await adminRpc('feedback.admin.run', { id: run.id, state: 'canceled' });
  } catch {
    // Already finished: the next poll shows how it ended.
  }
  await loadRuns();
}

function scheduleRuns(ms: number): void {
  window.clearTimeout(runTimer);
  runTimer = window.setTimeout(() => void loadRuns(), ms);
}

async function loadRuns(): Promise<void> {
  const token = adminToken;
  if (!token) return;
  let result: { active: Run | null; runs: Run[] };
  try {
    result = await adminRpc('feedback.admin.runs', { limit: 1 });
  } catch {
    if (adminToken === token) scheduleRuns(30000);
    return;
  }
  // Signed out (or in again) while this was in flight: the panel it was for is gone.
  if (adminToken !== token) return;
  const latest = result.active ?? result.runs[0] ?? null;
  renderRun(result.active, result.active ? null : latest);
  // The agent changes note statuses while it works: refresh the list with each heartbeat, but
  // leave the open note's form alone so nothing typed there is lost.
  const key = latest ? `${latest.id}:${latest.state}:${latest.heartbeatAt ?? ''}` : '';
  if (lastRun && key !== lastRun) void load(true);
  lastRun = key;
  scheduleRuns(result.active ? 5000 : 30000);
}

function renderRun(active: Run | null, last: Run | null, message = ''): void {
  checkButton.disabled = !!active;
  checkButton.textContent = active ? 'Checking…' : 'Check';
  const run = active ?? last;
  if (!run && !message) {
    runBox.hidden = true;
    return;
  }
  runBox.hidden = false;
  runBox.className = `runbar ${run ? run.state : ''}`;
  const parts: (Node | string)[] = [];
  if (run) {
    parts.push(el('b', '', `${RUN_LABEL[run.state]} · check #${run.id}`));
    const detail: string[] = [`${run.noteCount} note${run.noteCount === 1 ? '' : 's'}`];
    if (run.state === 'queued') detail.push(`asked ${when(run.requestedAt)}; start the worker on your computer if it is not running`);
    if (run.state === 'running') detail.push(`on ${run.worker} since ${when(run.startedAt ?? run.requestedAt)}`);
    if (run.finishedAt && !active) detail.push(when(run.finishedAt));
    parts.push(el('span', '', detail.join(' · ')));
    if (run.summary) parts.push(el('span', 'sum', run.summary));
  }
  if (message) parts.push(el('span', 'msg', message));
  runBox.replaceChildren(...parts);
  if (active) {
    const cancel = el('button', 'btn', 'Cancel');
    cancel.addEventListener('click', () => void cancelRun(active));
    runBox.append(cancel);
  }
}

// ------------------------------------------------------------------ detail

async function select(id: string): Promise<void> {
  selectedId = id;
  renderList();
  renderMap();
  let result: { item: Note; image: string | null; events: { status: string; by: string; summary: string; at: string }[] };
  try {
    result = await adminRpc('feedback.admin.get', { id });
  } catch {
    return;
  }
  if (selectedId !== id) return;
  const note = result.item;
  const meta = note.meta ?? {};
  const panel = el('div', 'panel');
  const title = el('h2');
  title.append(el('span', '', note.id), el('span', `pill ${note.status}`, STATUS_LABEL[note.status]));
  for (const c of note.categories) title.append(el('span', 'pill cat', CATEGORY_LABEL[c] ?? c));
  panel.append(title, el('div', 'note', note.note || '(no note)'));

  if (result.image && /^data:image\/(jpeg|webp|png);base64,/.test(result.image)) {
    const img = el('img', 'shot');
    img.src = result.image;
    img.alt = `Screenshot sent with ${note.id}`;
    panel.append(img);
  } else {
    panel.append(el('div', 'gone', note.status === 'resolved' ? 'Screenshot deleted when this note was resolved.' : 'No screenshot was sent with this note.'));
  }

  const kv = el('dl', 'kv');
  const row = (label: string, value: unknown) => {
    if (value === null || value === undefined || value === '') return;
    kv.append(el('dt', '', label), el('dd', '', typeof value === 'string' ? value : JSON.stringify(value)));
  };
  row('Player', `${note.username} (${note.userId})`);
  row('Game', GAME_LABEL[note.game] ?? note.game);
  row('Sent', `${when(note.createdAt)} (server)`);
  row('Player clock', note.clientTime ? `${note.clientTime} · ${String(meta.timezone ?? '')}` : '');
  row('In-game time', clock(note.gameTime));
  row('Level', note.level);
  row('Mode', note.mode);
  row('Position', note.position ? `x ${note.position.x}, y ${note.position.y}${note.position.z === null ? '' : `, z ${note.position.z}`}` : '');
  row('Version', note.version);
  row('Paused', meta.paused === undefined ? '' : meta.paused ? 'Yes' : 'No, game kept running');
  row('Frame rate', meta.perf);
  row('Player state', meta.player);
  row('Extra', meta.extra);
  row('Screen', meta.viewport);
  row('Input', meta.input);
  row('Browser', meta.userAgent);
  row('Page', meta.page);
  row('Session length', typeof meta.sessionSeconds === 'number' ? clock(meta.sessionSeconds) : '');
  const details = el('div');
  details.append(el('h3', '', 'Details'), kv);
  panel.append(details);

  const list = (label: string, value: unknown) => {
    if (!Array.isArray(value) || !value.length) return;
    const box = el('div');
    box.append(el('h3', '', label), el('pre', '', value.map((v) => JSON.stringify(v)).join('\n')));
    panel.append(box);
  };
  list('Recent errors', meta.errors);
  list('What happened just before', meta.breadcrumbs);

  // Status form.
  const form = el('form', 'form');
  const status = el('select', 'field');
  status.append(...(Object.keys(STATUS_LABEL) as Status[]).map((s) => new Option(STATUS_LABEL[s], s)));
  status.value = note.status;
  const resolution = el('textarea', 'field');
  resolution.value = note.resolution;
  resolution.maxLength = 600;
  const verification = el('textarea', 'field');
  verification.value = note.verification;
  verification.maxLength = 600;
  const commit = el('input', 'field');
  commit.value = note.fixedCommit;
  commit.maxLength = 120;
  const comment = el('input', 'field');
  comment.maxLength = 600;
  const error = el('div', 'error');
  error.setAttribute('role', 'alert');
  const save = el('button', 'btn primary', 'Save');
  save.type = 'submit';
  const labelled = (text: string, field: HTMLElement) => {
    const label = el('label', '', text);
    label.append(field);
    return label;
  };
  const line = el('div', 'line');
  line.append(save, error);
  form.append(
    el('h3', '', 'Status'),
    labelled('Status', status),
    labelled('Resolution summary (what changed)', resolution),
    labelled('How the fix was verified (needed to resolve)', verification),
    labelled('Fixing commit or pull request', commit),
    labelled('Comment for the history (optional)', comment),
    line,
  );
  if (note.hasImage) form.append(el('div', 'who', 'Resolving deletes the screenshot. The note, its details and its place on the map stay.'));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save.disabled = true;
    error.textContent = '';
    // Only what was changed here: the agent may have moved this note since the form opened,
    // and resending the old values would undo its work.
    const body: Record<string, unknown> = { id: note.id, comment: comment.value };
    if (status.value !== note.status) body.status = status.value;
    if (resolution.value !== note.resolution) body.resolution = resolution.value;
    if (verification.value !== note.verification) body.verification = verification.value;
    if (commit.value !== note.fixedCommit) body.fixedCommit = commit.value;
    adminRpc('feedback.admin.update', body)
      .then(() => load())
      .catch((e: unknown) => {
        const code = e instanceof HubSdkError ? e.code : '';
        error.textContent =
          code === 'verification_required'
            ? 'Say how the fix was verified before resolving.'
            : code === 'resolution_required'
              ? 'Add a short resolution summary before resolving.'
              : 'Could not save. Try again.';
        save.disabled = false;
      });
  });
  panel.append(form);

  if (result.events.length) {
    const history = el('div', 'history');
    for (const e of result.events) {
      const item = el('div');
      item.append(el('b', '', STATUS_LABEL[e.status as Status] ?? e.status), ` · ${when(e.at)} · ${e.by} · ${e.summary}`);
      history.append(item);
    }
    const box = el('div');
    box.append(el('h3', '', 'History'), history);
    panel.append(box);
  }
  detailBox.replaceChildren(panel);
}

// ------------------------------------------------------------------ export

function download(kind: 'json' | 'csv'): void {
  const name = `feedback-${filter.game || 'all'}-${new Date().toISOString().slice(0, 10)}.${kind}`;
  let text: string;
  if (kind === 'json') {
    text = JSON.stringify(items, null, 2);
  } else {
    const columns: (keyof Note)[] = ['id', 'game', 'status', 'username', 'createdAt', 'categories', 'note', 'level', 'mode', 'version', 'resolution', 'verification', 'fixedCommit'];
    const cell = (value: unknown) => {
      let s = Array.isArray(value) ? value.join('; ') : String(value ?? '');
      // Keep spreadsheet apps from running a note as a formula.
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replaceAll('"', '""')}"`;
    };
    text = [columns.join(','), ...items.map((n) => columns.map((c) => cell(n[c])).join(','))].join('\r\n');
  }
  const url = URL.createObjectURL(new Blob([text], { type: kind === 'json' ? 'application/json' : 'text/csv' }));
  const link = el('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

adminToken = sessionStorage.getItem(TOKEN_KEY) ?? '';
if (adminToken) void showPanel();
else showLogin();
