import {
  AuthError,
  EMAIL_RULE,
  PASSWORD_MIN,
  USERNAME_RULE,
  chooseGuest,
  guestThisTab,
  logIn,
  normalizeUsername,
  rememberedUsername,
  resume,
  signUp,
  type HubEntry,
} from './auth';
import '@fontsource/press-start-2p/latin-400.css';
import '@fontsource/vt323/latin-400.css';
import './login.css';
import { PAD, PAD_TUNING, createPadReader, loadMoveStick } from './core/gamepad';
import { createPadFocus } from './core/pad-focus';

/**
 * Sign-up / log-in gate. It is plain DOM and does not import Three.js, so it paints
 * and takes input while the plaza chunk and its models download behind it. The hub
 * awaits `gate.entry`, reports load progress, and calls `ready()` after its first
 * frame. The gate leaves once both sides are done; until then it shows the V token.
 */
export interface Gate {
  readonly entry: Promise<HubEntry>;
  isOpen(): boolean;
  progress(fraction: number): void;
  ready(): void;
  failed(message: string): void;
}

type Mode = 'signup' | 'login';
type Field = 'username' | 'password' | 'email';

const COPY: Record<Mode, { title: string; lede: string; submit: string; busy: string }> = {
  signup: {
    title: 'New game',
    lede: 'Pick a name to keep your Relics and Verse on any device.',
    submit: 'Create account',
    busy: 'Creating account…',
  },
  login: {
    title: 'Continue',
    lede: 'Log in to pick up where you left off.',
    submit: 'Log in',
    busy: 'Logging in…',
  },
};

const HINTS: Record<Field, string> = {
  username: '3–20 letters, numbers, _ or -',
  password: `At least ${PASSWORD_MIN} characters`,
  email: 'Only used to recover your account.',
};

const LEAVE_MS = 650;
const READY_BEAT_MS = 350;

function el<T extends HTMLElement>(id: string, type: new () => T): T {
  const node = document.getElementById(id);
  if (!(node instanceof type)) throw new Error(`Login markup is missing #${id}`);
  return node;
}

function createGate(): Gate {
  const root = el('login', HTMLElement);
  const formView = el('login-form-view', HTMLElement);
  const loadView = el('login-loading', HTMLElement);
  const title = el('login-title', HTMLElement);
  const lede = el('login-lede', HTMLElement);
  const form = el('login-form', HTMLFormElement);
  const tabs = [el('login-tab-signup', HTMLButtonElement), el('login-tab-login', HTMLButtonElement)];
  const inputs: Record<Field, HTMLInputElement> = {
    username: el('login-username', HTMLInputElement),
    password: el('login-password', HTMLInputElement),
    email: el('login-email', HTMLInputElement),
  };
  const hints: Record<Field, HTMLElement> = {
    username: el('login-username-hint', HTMLElement),
    password: el('login-password-hint', HTMLElement),
    email: el('login-email-hint', HTMLElement),
  };
  const emailField = el('login-email-field', HTMLElement);
  const reveal = el('login-reveal', HTMLButtonElement);
  const error = el('login-error', HTMLElement);
  const submit = el('login-submit', HTMLButtonElement);
  const guestButton = el('login-guest', HTMLButtonElement);
  const actions = el('login-actions', HTMLElement);
  const loadTitle = el('login-loading-title', HTMLElement);
  const loadNote = el('login-loading-note', HTMLElement);
  const bar = el('login-bar', HTMLElement);
  const reload = el('login-reload', HTMLButtonElement);
  const foot = el('login-foot', HTMLElement);
  const footText = el('login-foot-text', HTMLElement);
  const footPct = el('login-foot-pct', HTMLElement);

  let mode: Mode = 'signup';
  let open = true;
  let busy = false;
  let entered = false;
  let worldReady = false;
  let worldError = '';
  let shown = 0;
  let resolveEntry: (entry: HubEntry) => void = () => undefined;
  const entry = new Promise<HubEntry>((resolve) => {
    resolveEntry = resolve;
  });

  document.body.classList.add('gated');

  function setMode(next: Mode): void {
    mode = next;
    root.dataset.mode = next;
    for (const tab of tabs) {
      const on = tab.dataset.mode === next;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    title.textContent = COPY[next].title;
    lede.textContent = COPY[next].lede;
    submit.textContent = COPY[next].submit;
    emailField.hidden = next !== 'signup';
    inputs.email.required = next === 'signup';
    inputs.password.autocomplete = next === 'signup' ? 'new-password' : 'current-password';
    clearErrors();
  }

  function clearErrors(): void {
    error.textContent = '';
    for (const field of Object.keys(inputs) as Field[]) setFieldError(field, '');
  }

  function setFieldError(field: Field, message: string): void {
    const input = inputs[field];
    const hint = hints[field];
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    hint.textContent = message || HINTS[field];
    hint.classList.toggle('is-error', Boolean(message));
  }

  function validate(): Field | null {
    clearErrors();
    let first: Field | null = null;
    const flag = (field: Field, message: string) => {
      setFieldError(field, message);
      first ??= field;
    };
    const username = normalizeUsername(inputs.username.value);
    if (!username) flag('username', 'Pick a username.');
    else if (!USERNAME_RULE.test(username)) flag('username', 'Use 3–20 letters, numbers, _ or -.');
    if (!inputs.password.value) flag('password', 'Enter a password.');
    else if (mode === 'signup' && inputs.password.value.length < PASSWORD_MIN) {
      flag('password', `Use at least ${PASSWORD_MIN} characters.`);
    }
    if (mode === 'signup') {
      const email = inputs.email.value.trim();
      if (!email) flag('email', 'Add a backup email.');
      else if (!EMAIL_RULE.test(email)) flag('email', 'That email does not look right.');
    }
    return first;
  }

  function setBusy(next: boolean): void {
    busy = next;
    root.toggleAttribute('data-busy', next);
    submit.textContent = next ? COPY[mode].busy : COPY[mode].submit;
    submit.disabled = next;
    guestButton.disabled = next;
    for (const tab of tabs) tab.disabled = next;
    for (const input of Object.values(inputs)) input.readOnly = next;
  }

  function showForm(next: Mode, message = ''): void {
    setMode(next);
    root.dataset.view = 'form';
    formView.hidden = false;
    actions.hidden = false;
    loadView.hidden = true;
    foot.hidden = false;
    if (message) error.textContent = message;
    const target = inputs.username.value ? inputs.password : inputs.username;
    window.setTimeout(() => target.focus({ preventScroll: true }), 60);
  }

  function showLoading(heading: string, note = ''): void {
    root.dataset.view = 'loading';
    formView.hidden = true;
    actions.hidden = true;
    loadView.hidden = false;
    foot.hidden = true;
    title.textContent = 'Loading';
    loadTitle.textContent = heading;
    if (note) loadNote.textContent = note;
    paintProgress();
  }

  function enter(next: HubEntry, heading: string): void {
    if (entered) return;
    entered = true;
    resolveEntry(next);
    if (worldReady) {
      leave();
      return;
    }
    showLoading(heading);
  }

  function leave(): void {
    if (!open) return;
    open = false;
    root.dataset.view = 'leaving';
    document.body.classList.remove('gated');
    window.setTimeout(() => {
      root.hidden = true;
    }, LEAVE_MS);
  }

  function paintProgress(): void {
    const pct = Math.round(shown * 100);
    // The bar fills in whole blocks: 20 blocks of 5%.
    bar.style.setProperty('--fill', String(Math.floor(pct / 5) / 20));
    bar.setAttribute('aria-valuenow', String(pct));
    footPct.textContent = `${pct}%`;
    if (worldError) {
      loadNote.textContent = worldError;
      footText.textContent = worldError;
      return;
    }
    if (worldReady) {
      loadNote.textContent = 'Plaza ready';
      footText.textContent = 'Plaza ready';
      foot.dataset.state = 'ready';
      return;
    }
    loadNote.textContent = `Loading the plaza… ${pct}%`;
    footText.textContent = 'Plaza loading in the background';
  }

  async function onSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy || entered) return;
    const invalid = validate();
    if (invalid) {
      inputs[invalid].focus();
      return;
    }
    setBusy(true);
    try {
      const account = mode === 'signup'
        ? await signUp(inputs.username.value, inputs.password.value, inputs.email.value)
        : await logIn(inputs.username.value, inputs.password.value);
      inputs.password.value = '';
      enter(account, mode === 'signup' ? `Welcome, ${account.username}` : `Welcome back, ${account.username}`);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Something went wrong. Try again.';
      if (failure instanceof AuthError && failure.field !== 'form') {
        setFieldError(failure.field, message);
        inputs[failure.field].focus();
      } else {
        error.textContent = message;
      }
    } finally {
      setBusy(false);
    }
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      if (!busy) setMode(tab.dataset.mode === 'login' ? 'login' : 'signup');
    });
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const other = tabs.find((candidate) => candidate !== tab);
      if (!other || busy) return;
      other.focus();
      setMode(other.dataset.mode === 'login' ? 'login' : 'signup');
    });
  }
  inputs.username.addEventListener('input', () => {
    const lower = inputs.username.value.toLowerCase();
    if (lower !== inputs.username.value) inputs.username.value = lower;
  });
  for (const field of Object.keys(inputs) as Field[]) {
    inputs[field].addEventListener('input', () => {
      if (inputs[field].hasAttribute('aria-invalid')) setFieldError(field, '');
    });
  }
  reveal.addEventListener('click', () => {
    const showing = inputs.password.type === 'text';
    inputs.password.type = showing ? 'password' : 'text';
    reveal.textContent = showing ? 'Show' : 'Hide';
    reveal.setAttribute('aria-pressed', String(!showing));
    inputs.password.focus();
  });
  form.addEventListener('submit', (event) => {
    void onSubmit(event);
  });
  guestButton.addEventListener('click', () => {
    if (!busy) enter(chooseGuest(), 'Entering as a guest');
  });
  reload.addEventListener('click', () => {
    window.location.reload();
  });

  async function start(): Promise<void> {
    if (guestThisTab()) {
      enter({ kind: 'guest' }, 'Entering as a guest');
      return;
    }
    const remembered = rememberedUsername();
    if (!remembered) {
      showForm('signup');
      return;
    }
    inputs.username.value = remembered;
    showLoading(`Welcome back, ${remembered}`, 'Signing you in…');
    try {
      const account = await resume();
      if (account) {
        enter(account, `Welcome back, ${account.username}`);
        return;
      }
      showForm('login', 'Your session ended. Log in again.');
    } catch (failure) {
      showForm('login', failure instanceof Error ? failure.message : '');
    }
  }

  paintProgress();
  void start();

  // Controller (docs/controllers.md): the D-pad or the walking stick moves the focus ring and A presses
  // the button under it, so a pad can reach Continue as guest, the tabs and the submit button.
  // Text fields keep focus for a device keyboard. The plaza's own reader latches anything still
  // held when the gate leaves, so this A press does not also jump.
  const moveStick = loadMoveStick();
  const pad = createPadReader(PAD_TUNING, { moveStick: () => moveStick });
  const padFocus = createPadFocus();
  const padLoop = (now: number): void => {
    if (!open) {
      padFocus.clear();
      return;
    }
    const frame = pad.poll(navigator.getGamepads?.() ?? [], now);
    if (frame.connected && !busy) {
      if (frame.nav) padFocus.move(root, frame.nav);
      if (frame.pressed(PAD.A)) padFocus.activate(root);
    }
    window.requestAnimationFrame(padLoop);
  };
  window.requestAnimationFrame(padLoop);
  const dropRing = (): void => padFocus.clear();
  root.addEventListener('pointerdown', dropRing);
  root.addEventListener('keydown', dropRing);

  return {
    entry,
    isOpen: () => open,
    progress(fraction) {
      if (worldReady || !Number.isFinite(fraction)) return;
      const next = Math.min(0.97, Math.max(shown, fraction));
      if (next === shown) return;
      shown = next;
      paintProgress();
    },
    ready() {
      if (worldReady) return;
      worldReady = true;
      shown = 1;
      paintProgress();
      if (entered) window.setTimeout(leave, READY_BEAT_MS);
    },
    failed(message) {
      worldError = message || 'The plaza failed to load.';
      root.dataset.failed = '';
      reload.hidden = false;
      paintProgress();
    },
  };
}

export const gate = createGate();
