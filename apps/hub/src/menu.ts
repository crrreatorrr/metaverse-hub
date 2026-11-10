import { RELICS, ownsFourLights } from './core/relics';
import type { RelicId } from '@metaverse/hub-sdk';
import { CHARACTERS, DEFAULT_STAFF, STAFFS, STAFF_RELICS, holdsStaff, type CharacterId, type StaffId } from './config';
import { cleanName, defaultLook, type AvatarLook } from './look';
import { PERSONAS, QUIET } from './sims/director';
import { MAX_SIMS } from './sims/sims';
import { SIM_SPEEDS, cleanSimName, defaultSimName, newSimId, type SimSettings } from './sims/store';
import type { MoveStick } from './core/gamepad';

export type MenuTab = 'items' | 'avatar' | 'edit' | 'relics' | 'sims' | 'pets';

/** Tab order, for the controller's LB / RB. */
export const MENU_TAB_ORDER: readonly MenuTab[] = ['items', 'avatar', 'edit', 'relics', 'sims', 'pets'];

const TABS: readonly { id: MenuTab; label: string; key: string; icon: PixelIcon }[] = [
  { id: 'items', label: 'Items', key: '1', icon: 'bag' },
  { id: 'avatar', label: 'Avatar', key: '2', icon: 'helmet' },
  { id: 'edit', label: 'Edit', key: '3', icon: 'palette' },
  { id: 'relics', label: 'Relics', key: '4', icon: 'gem' },
  { id: 'sims', label: 'Sims', key: '5', icon: 'star' },
  { id: 'pets', label: 'Pets', key: '6', icon: 'paw' },
];

/** Pixel art made with Higgsfield, in `public/world/ui/`. */
type PixelIcon = 'bag' | 'helmet' | 'palette' | 'gem' | 'coin' | 'pet' | 'lock' | 'star' | 'staff' | 'paw';

function pixelIcon(name: PixelIcon, className = 'px-icon'): HTMLImageElement {
  const img = document.createElement('img');
  img.className = className;
  img.src = `${import.meta.env.BASE_URL}world/ui/icon-${name}.png`;
  img.alt = '';
  img.draggable = false;
  return img;
}

/** Where each Relic comes from. Matches the `reportEvent` table in the README. */
/** `fighter`: the Sproto Fighter character this Relic unlocks (see Sproto Fighter's src/hub/roster.ts). */
const RELIC_INFO: Record<RelicId, { game: string; how: string; pet: string; fighter: string; unlock?: string }> = {
  hpos10i_core: { game: 'HPOS10I', how: 'Clear Retro Rush Hills, act 1.', pet: 'Speed Sproto', fighter: 'Sun God' },
  genesis_shard: { game: "The People's Bitcoin", how: 'Finish the tutorial quest.', pet: '', fighter: 'Captain Green', unlock: 'Genesis Block Shard aura · Moonward Staff (Sproto Duel)' },
  cones_tip: { game: 'NOBU: Saviour Dog', how: 'Defeat Cone.', pet: 'Nobu', fighter: 'Pissing Sproto' },
  tinubu_crown: { game: 'Sproto Duel', how: 'Defeat Tinubu.', pet: 'Duelist Sproto', fighter: 'Captain Sproto', unlock: "Tinubu's Crown aura · Fighter Staff (Sproto Duel)" },
  tidebreaker_belt: {
    game: 'Sproto Fighter (Bar arcade)',
    how: 'Win Story World 1, Tidebreaker Marina.',
    pet: '',
    fighter: '',
    unlock: "Tidebreaker Belt aura · Fighter's Might (Sproto Duel) · Champion's Crown (NOBU) · Champion Sproto (People's Bitcoin) · Tidebreaker skin (HPOS10I)",
  },
  breakwater_coin: {
    game: 'Sproto Arcade (Bar arcade)',
    how: 'Beat Fat Head Dave at Tidebreak Marina, the first story boss. God mode counts.',
    pet: '',
    fighter: 'Pissing Sproto',
    unlock: "Alien Ray Staff (Sproto Duel) · Nobu skin (HPOS10I) · Nobu summon (People's Bitcoin) · Pissing Sproto (Sproto Fighter) · plus Wizard Hat II (NOBU)",
  },
  marina_anchor: {
    game: 'Sproto Coop Battle (Bar arcade)',
    how: 'Clear stage 1, Tidebreak Marina, alone or online. God mode counts.',
    pet: '',
    fighter: '',
    unlock: 'Marina Anchor aura · no items in other games yet',
  },
  dragon_scale: {
    game: 'Sproto Shooter (The Range)',
    how: 'Clear wave 1 of Wave Mode. God mode counts.',
    pet: '',
    fighter: '',
    unlock: 'Dragon Scale aura · Shooter Staff (Sproto Duel)',
  },
};

interface PetInfo {
  id: string;
  name: string;
  from: string;
  /** Owned whenever this Relic is claimed. */
  relic?: RelicId;
}

/** Hub pet catalog, mirrored from `server/modules/src/pets.ts` and docs/m6-server-prep.md. */
const PETS: readonly PetInfo[] = [
  { id: 'pet_starter', name: 'Spark', from: 'Free starter companion' },
  { id: 'pet_speed_sproto', name: 'Speed Sproto', from: 'Relic: HPOS10I Core', relic: 'hpos10i_core' },
  { id: 'pet_nobu', name: 'Nobu', from: "Relic: Cone's Tip", relic: 'cones_tip' },
  { id: 'pet_duelist_sproto', name: 'Duelist Sproto', from: "Relic: Tinubu's Crown", relic: 'tinubu_crown' },
  { id: 'pet_four_lights_sproto', name: 'Four Lights Sproto', from: 'Own all four Relics' },
  { id: 'pet_baby_sproto', name: 'Baby Sproto', from: 'Your first Ticket exchange' },
  { id: 'pet_honk_sproto', name: 'Honk Sproto', from: 'HPOS10I: Retro Rush Hills, act 2' },
  { id: 'pet_spiral_sproto', name: 'Spiral Sproto', from: 'HPOS10I: Wizard Academy, act 2' },
  { id: 'pet_mecha_sproto', name: 'Mecha Sproto', from: 'NOBU: defeat the Bird' },
  { id: 'pet_conehead_sproto', name: 'Conehead Sproto', from: 'NOBU: defeat the Cat' },
  { id: 'pet_presidential_sproto', name: 'Presidential Sproto', from: 'Sproto Duel: defeat Obama' },
  { id: 'pet_moon_sproto', name: 'Moon Sproto', from: "People's Bitcoin: Moonward quest" },
  { id: 'pet_sproto_pup', name: 'Sproto Pup', from: "People's Bitcoin: Hatchery quest" },
  { id: 'pet_hopium_sproto', name: 'Hopium Sproto', from: 'Store: 400 Verse' },
  { id: 'pet_coom_sproto', name: 'Coom Sproto', from: 'Store: 600 Verse' },
];

export interface MenuOptions {
  look: () => AvatarLook;
  /** Apply and store a new look. */
  setLook: (look: AvatarLook) => void;
  onOpen: () => void;
  onClose: () => void;
  /** Drag on the empty side of the menu to turn the preview. Radians. */
  onSpin: (delta: number) => void;
  /** Relics switched off (their gems do not orbit the avatar). */
  hiddenRelics: () => readonly string[];
  /** Store and apply a new switched-off list. */
  setHiddenRelics: (ids: readonly string[]) => void;
  /** Which controller stick walks; the other turns the camera. */
  moveStick: () => MoveStick;
  setMoveStick: (stick: MoveStick) => void;
  /** Catalog ids that have a hub model (`EQUIPPABLE_PET_IDS`), so they can be deployed. */
  deployablePets: readonly string[];
  otherPetsHidden(): boolean;
  setOtherPetsHidden(hidden: boolean): void;
  /** The pet following the avatar, or null. */
  activePet: () => string | null;
  /** Deploy a pet (it follows the avatar) or recall it (null). */
  setActivePet: (id: string | null) => void;
  /** Sims (this screen only): the list and story speed. */
  sims: () => SimSettings;
  setSims: (settings: SimSettings) => void;
  /** Start the sims' story over from the first act. */
  restartSims: () => void;
  /** The act the sims' story is in, for the Sims page. */
  simAct: () => string;
}

export interface Menu {
  readonly open: boolean;
  readonly tab: MenuTab;
  /** Right edge of the menu window in CSS pixels, for the camera's preview offset. */
  readonly panelWidth: number;
  show(tab?: MenuTab): void;
  hide(): void;
  setRelics(ids: readonly string[]): void;
  /** `owned` from `profile.get` once the server sends `pets`; null until then. */
  setPets(owned: readonly string[] | null): void;
  /** Repaint the Pets page after the following pet changed outside the menu. */
  refreshPets(): void;
  setVerse(balance: number): void;
  setGuest(label: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createMenu(options: MenuOptions): Menu {
  const app = document.querySelector('#app');
  if (!(app instanceof HTMLElement)) throw new Error('Hub markup is missing');

  const root = el('div', 'menu');
  root.id = 'menu';
  root.hidden = true;
  const panel = el('section', 'menu-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Menu');
  const stage = el('div', 'menu-stage');
  const stageHint = el('p', 'menu-stage-hint', 'Drag to turn · Esc to close');
  stage.append(stageHint);
  root.append(panel, stage);
  app.append(root);

  const head = el('header', 'menu-head');
  const title = el('h2', 'menu-title', 'Menu');
  const guest = el('span', 'menu-guest', 'Guest');
  head.append(title, guest);
  const foot = el('footer', 'menu-foot');
  const close = el('button', 'menu-close', 'Resume');
  close.type = 'button';
  foot.append(close);

  const tabBar = el('nav', 'menu-tabs');
  tabBar.setAttribute('role', 'tablist');
  const tabButtons = new Map<MenuTab, HTMLButtonElement>();
  const bodies = new Map<MenuTab, HTMLElement>();
  const content = el('div', 'menu-body');
  for (const tab of TABS) {
    const button = el('button', 'menu-tab');
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.dataset.tab = tab.id;
    button.append(pixelIcon(tab.icon, 'menu-tab-icon'), el('span', 'menu-tab-label', tab.label), el('span', 'menu-tab-key', tab.key));
    tabButtons.set(tab.id, button);
    tabBar.append(button);
    const body = el('div', 'menu-page');
    body.setAttribute('role', 'tabpanel');
    body.hidden = true;
    bodies.set(tab.id, body);
    content.append(body);
  }
  panel.append(head, tabBar, content, foot);

  let open = false;
  let tab: MenuTab = 'avatar';
  let relics = new Set<string>();
  let serverPets: Set<string> | null = null;
  let verse = 0;

  // ---------- Items
  const itemsPage = bodies.get('items') as HTMLElement;
  const wallet = el('div', 'menu-wallet');
  const verseLine = el('strong', 'menu-verse', 'Verse 0');
  const relicCount = el('span', 'menu-sub', `0 of ${RELICS.length} Relics`);
  const walletText = el('div', 'menu-wallet-text');
  walletText.append(verseLine, relicCount);
  wallet.append(pixelIcon('coin', 'menu-wallet-coin'), walletText);
  itemsPage.append(wallet);

  // ---------- Controller (lives on Items so it is one LB press from the menu's first tab)
  const padNote = el('p', 'menu-note small', '');
  const stickRow = el('div', 'chip-row');
  const stickButtons = new Map<MoveStick, HTMLButtonElement>();
  for (const [stick, label] of [['right', 'Right stick moves'], ['left', 'Left stick moves']] as const) {
    const chip = el('button', 'chip', label);
    chip.type = 'button';
    chip.dataset.stick = stick;
    chip.addEventListener('click', () => {
      options.setMoveStick(stick);
      paintController();
    });
    stickButtons.set(stick, chip);
    stickRow.append(chip);
  }
  itemsPage.append(el('h3', 'menu-h', 'Controller'), stickRow, padNote);

  function paintController(): void {
    const stick = options.moveStick();
    for (const [id, chip] of stickButtons) {
      chip.classList.toggle('on', id === stick);
      chip.setAttribute('aria-pressed', String(id === stick));
    }
    const camera = stick === 'right' ? 'left' : 'right';
    padNote.textContent = `The ${camera} stick turns the camera. A uses the arcade cabinet and Sprotel and jumps everywhere else; B runs.`;
  }

  // ---------- Pets
  const petsPage = bodies.get('pets') as HTMLElement;
  const petNote = el('p', 'menu-note', 'Deploy a pet you own and it follows you through every realm. Relic pets are yours once the Relic is.');
  const hidePetsLabel = el('label', 'menu-note');
  const hidePets = document.createElement('input');
  hidePets.type = 'checkbox';
  hidePets.checked = options.otherPetsHidden();
  hidePets.addEventListener('change', () => options.setOtherPetsHidden(hidePets.checked));
  hidePetsLabel.append(hidePets, ' Hide other players’ pets');
  const following = el('div', 'pet-following');
  const followingText = el('span', 'pet-following-text');
  const recall = el('button', 'pet-deploy', 'Recall');
  recall.type = 'button';
  recall.addEventListener('click', () => {
    options.setActivePet(null);
    paintPets();
  });
  following.append(pixelIcon('paw', 'pet-following-icon'), followingText, recall);
  const petGrid = el('ul', 'menu-grid pets');
  petsPage.append(el('h3', 'menu-h', 'Pets'), petNote, hidePetsLabel, following, petGrid);

  // ---------- Avatar
  const avatarPage = bodies.get('avatar') as HTMLElement;
  avatarPage.append(
    el('h3', 'menu-h', 'Choose avatar'),
    el('p', 'menu-note', 'Sproto Duel and Sproto Shooter. Each one is fitted to stand with the plaza regulars.'),
  );
  const charGrid = el('ul', 'menu-grid chars');
  const charButtons = new Map<CharacterId, HTMLButtonElement>();
  for (const character of CHARACTERS) {
    const item = el('li');
    const button = el('button', 'char-card');
    button.type = 'button';
    button.dataset.character = character.id;
    const portrait = el('span', 'char-portrait');
    const picture: string | null = character.portrait;
    if (picture) {
      const img = el('img');
      img.src = `${import.meta.env.BASE_URL}${picture}`;
      img.alt = '';
      img.loading = 'lazy';
      portrait.append(img);
    } else {
      portrait.classList.add('char-glyph');
      portrait.textContent = character.label.slice(0, 1);
    }
    button.append(portrait, el('span', 'char-name', character.label), el('span', 'char-blurb', character.blurb));
    button.addEventListener('click', () => {
      update({ ...options.look(), character: character.id });
    });
    charButtons.set(character.id, button);
    item.append(button);
    charGrid.append(item);
  }
  avatarPage.append(charGrid);

  // ---------- Edit avatar
  const editPage = bodies.get('edit') as HTMLElement;
  const nameField = el('input', 'menu-input');
  nameField.type = 'text';
  nameField.maxLength = 12;
  nameField.autocomplete = 'off';
  nameField.spellcheck = false;
  nameField.placeholder = 'Guest';
  nameField.addEventListener('input', () => {
    const clean = cleanName(nameField.value);
    if (clean !== nameField.value) nameField.value = clean;
    update({ ...options.look(), name: clean.trim() }, false);
  });
  const nameRow = labelled('Display name', nameField, 'Shown in front of your chat lines.');

  const auraRow = el('div', 'chip-row');
  const auraButtons = new Map<string, HTMLButtonElement>();
  const auraNone = el('button', 'chip', 'None');
  auraNone.type = 'button';
  auraNone.addEventListener('click', () => update({ ...options.look(), aura: 'none' }));
  auraButtons.set('none', auraNone);
  auraRow.append(auraNone);
  for (const socket of RELICS) {
    const chip = el('button', 'chip aura');
    chip.type = 'button';
    chip.style.setProperty('--relic', socket.color);
    chip.append(el('span', 'chip-dot'), el('span', '', socket.name));
    chip.addEventListener('click', () => {
      if (!relics.has(socket.id)) return;
      update({ ...options.look(), aura: socket.id });
    });
    auraButtons.set(socket.id, chip);
    auraRow.append(chip);
  }

  const reset = el('button', 'menu-reset', 'Reset look');
  reset.type = 'button';
  reset.addEventListener('click', () => {
    const current = options.look();
    update({ ...defaultLook(), character: current.character, name: current.name });
  });

  editPage.append(
    nameRow,
    section('Relic aura', auraRow, 'Each aura needs its Relic.'),
    reset,
  );

  // ---------- Staff (Edit avatar)
  const staffGrid = el('ul', 'menu-grid staffs');
  const staffButtons = new Map<StaffId, HTMLButtonElement>();
  for (const staff of STAFFS) {
    const item = el('li');
    const button = el('button', 'staff-card');
    button.type = 'button';
    button.dataset.staff = staff.id;
    button.style.setProperty('--accent', staff.accent);
    const icon = el('span', 'staff-icon');
    const art: string | null = staff.icon;
    if (art) {
      const img = el('img');
      img.src = `${import.meta.env.BASE_URL}${art}`;
      img.alt = '';
      img.loading = 'lazy';
      icon.append(img);
    } else {
      icon.textContent = '∅';
    }
    button.append(icon, el('span', 'staff-name', staff.label), el('span', 'staff-line', staff.line));
    button.addEventListener('click', () => update({ ...options.look(), staff: staff.id }));
    staffButtons.set(staff.id, button);
    item.append(button);
    staffGrid.append(item);
  }
  const staffNote = el('span', 'menu-note small');
  const staffSection = section('Staff', staffGrid);
  staffSection.append(staffNote);
  editPage.insertBefore(staffSection, editPage.children[1] ?? null);

  function paintStaffs(look: AvatarLook): void {
    const character = CHARACTERS.find((entry) => entry.id === look.character);
    const own = Boolean(character?.ownStaff);
    for (const [id, button] of staffButtons) {
      const on = id === look.staff;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
      const relic = STAFF_RELICS[id];
      button.disabled = relic !== undefined && !relics.has(relic);
    }
    const empty = Boolean(character && !own && !holdsStaff(character));
    staffGrid.classList.toggle('muted', own || empty);
    staffNote.textContent = own
      ? `${character?.label ?? 'This character'} carries his own staff. Your pick returns on other avatars.`
      : empty
        ? `${character?.label ?? 'This character'} can't wield a staff. Your pick returns on other avatars.`
        : 'Staffs from Sproto Duel. Held in the right hand.';
  }

  // ---------- Relics
  const relicsPage = bodies.get('relics') as HTMLElement;
  relicsPage.append(el('p', 'menu-note', 'Each Relic is earned once, in its own game. It orbits you as a gem and unlocks an aura in Edit avatar. The four Four Lights Relics each unlock a Sproto Fighter character, and all four unlock Error 333. Switch a Relic off to stop its gem orbiting you; you keep it either way.'));
  const relicGrid = el('ul', 'menu-grid relics');
  const relicCards = new Map<string, HTMLElement>();
  for (const socket of RELICS) {
    const info = RELIC_INFO[socket.id];
    const card = el('li', 'relic-card');
    card.style.setProperty('--relic', socket.color);
    const gem = el('span', 'relic-gem');
    const text = el('div', 'relic-text');
    text.append(
      el('strong', '', socket.name),
      el('span', 'relic-game', info.game),
      el('span', 'relic-how', info.how),
      el('span', 'relic-unlock', `Unlocks: ${info.unlock ?? `${socket.name} aura`}${info.pet ? ` · ${info.pet}` : ''}${info.fighter ? ` · Fighter: ${info.fighter}` : ''}`),
    );
    const state = el('span', 'relic-badge', 'Locked');
    const toggle = el('button', 'relic-toggle');
    toggle.type = 'button';
    toggle.hidden = true;
    toggle.addEventListener('click', () => {
      const hidden = new Set(options.hiddenRelics());
      if (hidden.has(socket.id)) hidden.delete(socket.id);
      else hidden.add(socket.id);
      options.setHiddenRelics([...hidden]);
      paintRelics();
    });
    const side = el('div', 'relic-side');
    side.append(state, toggle);
    card.append(gem, text, side);
    relicCards.set(socket.id, card);
    relicGrid.append(card);
  }
  relicsPage.append(relicGrid);

  // ---------- Behaviour
  tabBar.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button');
    if (button?.dataset.tab) setTab(button.dataset.tab as MenuTab);
  });
  close.addEventListener('click', () => hide());
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') return;
    if (event.target instanceof HTMLInputElement && event.target.type === 'text') return;
    const match = TABS.find((entry) => entry.key === event.key);
    if (match) {
      event.preventDefault();
      setTab(match.id);
    }
  });

  let dragging = false;
  stage.addEventListener('pointerdown', (event) => {
    dragging = true;
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', (event) => {
    if (dragging) options.onSpin(event.movementX * 0.012);
  });
  const stopDrag = () => {
    dragging = false;
  };
  stage.addEventListener('pointerup', stopDrag);
  stage.addEventListener('pointercancel', stopDrag);

  /** `repaint` false while typing the name, so the field keeps its caret. */
  function update(next: AvatarLook, repaint = true): void {
    options.setLook(next);
    if (repaint) paintLook();
  }

  function paintLook(): void {
    const look = options.look();
    for (const [id, button] of charButtons) {
      const on = id === look.character;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    }
    if (document.activeElement !== nameField) nameField.value = look.name;
    for (const [id, button] of auraButtons) {
      const owned = id === 'none' || relics.has(id);
      button.classList.toggle('on', id === look.aura);
      button.classList.toggle('locked', !owned);
      button.disabled = !owned;
      button.title = owned ? '' : 'Earn this Relic to unlock its aura';
    }
    paintStaffs(look);
  }

  function paintItems(): void {
    verseLine.textContent = `Verse ${verse.toLocaleString('en-US')}`;
    relicCount.textContent = `${RELICS.filter((socket) => relics.has(socket.id)).length} of ${RELICS.length} Relics`;
  }

  function paintPets(): void {
    const active = options.activePet();
    const activeInfo = PETS.find((pet) => pet.id === active);
    followingText.textContent = active ? `${activeInfo?.name ?? 'Your pet'} is following you` : 'No pet is following you';
    recall.hidden = !active;
    following.classList.toggle('on', Boolean(active));
    petGrid.replaceChildren();
    const all = ownsFourLights(relics);
    const owned = (pet: PetInfo) =>
      Boolean(serverPets?.has(pet.id)) ||
      (!serverPets && pet.relic ? relics.has(pet.relic) : false) ||
      (!serverPets && pet.id === 'pet_four_lights_sproto' && all);
    const deployable = (pet: PetInfo) => owned(pet) && options.deployablePets.includes(pet.id);
    const rank = (pet: PetInfo) => (pet.id === active ? 3 : deployable(pet) ? 2 : owned(pet) ? 1 : 0);
    const sorted = [...PETS].sort((a, b) => rank(b) - rank(a));
    for (const pet of sorted) {
      const has = owned(pet);
      const on = pet.id === active;
      const card = el('li', `pet-card${has ? ' owned' : ''}${on ? ' active' : ''}`);
      card.dataset.pet = pet.id;
      const icon = el('span', 'pet-icon');
      icon.append(pixelIcon(has ? 'pet' : 'lock'));
      const text = el('div', 'pet-text');
      text.append(el('strong', '', pet.name), el('span', 'pet-from', pet.from));
      card.append(icon, text);
      if (deployable(pet)) {
        const deploy = el('button', 'pet-deploy', on ? 'Following' : 'Deploy');
        deploy.type = 'button';
        deploy.setAttribute('aria-pressed', String(on));
        deploy.setAttribute('aria-label', on ? `Recall ${pet.name}` : `Deploy ${pet.name}`);
        deploy.addEventListener('click', () => {
          options.setActivePet(on ? null : pet.id);
          paintPets();
        });
        card.append(deploy);
      } else {
        card.append(el('span', 'pet-state', has ? 'Model soon' : 'Locked'));
      }
      petGrid.append(card);
    }
  }

  function paintRelics(): void {
    const hidden = new Set(options.hiddenRelics());
    for (const [id, card] of relicCards) {
      const on = relics.has(id);
      card.classList.toggle('owned', on);
      const badge = card.querySelector('.relic-badge');
      if (badge) badge.textContent = on ? 'Owned' : 'Locked';
      // Only an owned Relic has a gem to switch off.
      const toggle = card.querySelector<HTMLButtonElement>('.relic-toggle');
      if (toggle) {
        const shown = on && !hidden.has(id);
        toggle.hidden = !on;
        toggle.textContent = shown ? 'Orbit: on' : 'Orbit: off';
        toggle.setAttribute('aria-pressed', String(shown));
        toggle.setAttribute('aria-label', `${shown ? 'Hide' : 'Show'} the ${card.querySelector('strong')?.textContent ?? 'Relic'} gem around you`);
        card.classList.toggle('relic-hidden', on && !shown);
      }
    }
  }

  function setTab(next: MenuTab): void {
    // Each page starts at its top; the body is shared between tabs.
    if (next !== tab) content.scrollTop = 0;
    tab = next;
    for (const [id, button] of tabButtons) {
      const on = id === next;
      button.classList.toggle('on', on);
      button.setAttribute('aria-selected', String(on));
    }
    for (const [id, body] of bodies) body.hidden = id !== next;
    // Keep keyboard focus on the selected tab so the focus ring and the selection agree.
    if (tabBar.contains(document.activeElement)) tabButtons.get(next)?.focus({ preventScroll: true });
  }

  function show(next: MenuTab = tab): void {
    setTab(next);
    paintLook();
    paintItems();
    paintController();
    paintPets();
    paintRelics();
    paintSims();
    if (open) return;
    open = true;
    root.hidden = false;
    options.onOpen();
    (tabButtons.get(tab) ?? close).focus({ preventScroll: true });
  }

  function hide(): void {
    if (!open) return;
    open = false;
    root.hidden = true;
    dragging = false;
    if (document.activeElement instanceof HTMLElement && root.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    options.onClose();
  }

  // ---------- Sims
  const simsPage = bodies.get('sims') as HTMLElement;
  let simCharacter: CharacterId = CHARACTERS[0].id;
  let simPersona: string = PERSONAS[0]?.id ?? QUIET;
  simsPage.append(
    el('h3', 'menu-h', 'Sims'),
    el('p', 'menu-note', 'Characters that walk the plaza and talk. Only you can see them; they never post to chat.'),
  );
  const simCharGrid = el('ul', 'menu-grid chars sims-chars');
  const simCharButtons = new Map<CharacterId, HTMLButtonElement>();
  for (const character of CHARACTERS) {
    const item = el('li');
    const button = el('button', 'char-card');
    button.type = 'button';
    const portrait = el('span', 'char-portrait');
    const img = el('img');
    img.src = `${import.meta.env.BASE_URL}${character.portrait}`;
    img.alt = '';
    img.loading = 'lazy';
    portrait.append(img);
    button.append(portrait, el('span', 'char-name', character.label));
    button.addEventListener('click', () => {
      simCharacter = character.id;
      paintSims();
    });
    simCharButtons.set(character.id, button);
    item.append(button);
    simCharGrid.append(item);
  }
  const personaRow = el('div', 'chip-row');
  const personaButtons = new Map<string, HTMLButtonElement>();
  for (const persona of [...PERSONAS, { id: QUIET, name: 'Quiet', blurb: 'Walks around, never talks.' }]) {
    const chip = el('button', 'chip', persona.name);
    chip.type = 'button';
    chip.title = persona.blurb;
    chip.addEventListener('click', () => {
      simPersona = persona.id;
      paintSims();
    });
    personaButtons.set(persona.id, chip);
    personaRow.append(chip);
  }
  const personaNote = el('span', 'menu-note small');
  const simName = el('input', 'menu-input');
  simName.type = 'text';
  simName.maxLength = 12;
  simName.autocomplete = 'off';
  simName.spellcheck = false;
  simName.addEventListener('input', () => {
    const clean = simName.value.replace(/[^A-Za-z0-9 _-]/g, '');
    if (clean !== simName.value) simName.value = clean;
  });
  const addSim = el('button', 'menu-reset', 'Add sim');
  addSim.type = 'button';
  addSim.addEventListener('click', () => {
    const current = options.sims();
    if (current.list.length >= MAX_SIMS) return;
    const name = cleanSimName(simName.value) || defaultSimName(simPersona, simCharacter);
    options.setSims({ ...current, list: [...current.list, { id: newSimId(), name, character: simCharacter, persona: simPersona }] });
    simName.value = '';
    paintSims();
  });
  const addCast = el('button', 'menu-reset', 'Add the whole cast');
  addCast.type = 'button';
  addCast.title = 'One sim per dialogue, each with the next character.';
  addCast.addEventListener('click', () => {
    const current = options.sims();
    const room = MAX_SIMS - current.list.length;
    const cast = PERSONAS.slice(0, Math.max(0, room)).map((persona, i) => ({
      id: newSimId(),
      name: persona.name,
      character: CHARACTERS[i % CHARACTERS.length]!.id,
      persona: persona.id,
    }));
    options.setSims({ ...current, list: [...current.list, ...cast] });
    paintSims();
  });
  const addRow = el('div', 'menu-pair');
  addRow.append(addSim, addCast);

  const simList = el('ul', 'sim-list');
  const simCount = el('span', 'menu-value');
  const speedRow = el('div', 'chip-row');
  const speedButtons = new Map<number, HTMLButtonElement>();
  for (const speed of SIM_SPEEDS) {
    const chip = el('button', 'chip', speed === 1 ? 'Normal (10 min)' : `${speed}× faster`);
    chip.type = 'button';
    chip.addEventListener('click', () => {
      options.setSims({ ...options.sims(), speed });
      paintSims();
    });
    speedButtons.set(speed, chip);
    speedRow.append(chip);
  }
  const actLine = el('span', 'menu-note small');
  const restartStory = el('button', 'chip', 'Restart story');
  restartStory.type = 'button';
  restartStory.addEventListener('click', () => {
    options.restartSims();
    paintSims();
  });
  speedRow.append(restartStory);
  const clearSims = el('button', 'menu-reset', 'Remove all sims');
  clearSims.type = 'button';
  clearSims.addEventListener('click', () => {
    options.setSims({ ...options.sims(), list: [] });
    paintSims();
  });
  const listLabel = section('Your sims', simList);
  listLabel.querySelector('.menu-label')?.append(simCount);

  simsPage.append(
    section('Character', simCharGrid),
    section('Dialogue', personaRow),
    personaNote,
    labelled('Name', simName, 'Blank uses the dialogue\'s name.'),
    addRow,
    listLabel,
    section('Story speed', speedRow),
    actLine,
    clearSims,
  );

  function paintSims(): void {
    const settings = options.sims();
    for (const [id, button] of simCharButtons) {
      const on = id === simCharacter;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    }
    for (const [id, chip] of personaButtons) {
      chip.classList.toggle('on', id === simPersona);
      chip.setAttribute('aria-pressed', String(id === simPersona));
    }
    personaNote.textContent = personaButtons.get(simPersona)?.title ?? '';
    simName.placeholder = defaultSimName(simPersona, simCharacter);
    for (const [speed, chip] of speedButtons) chip.classList.toggle('on', speed === settings.speed);
    const full = settings.list.length >= MAX_SIMS;
    addSim.disabled = full;
    addCast.disabled = full;
    clearSims.disabled = settings.list.length === 0;
    simCount.textContent = `${settings.list.length}/${MAX_SIMS}`;
    actLine.textContent = settings.list.length ? `Story act: ${options.simAct()}.` : 'Add a sim to start the story.';
    simList.replaceChildren();
    if (settings.list.length === 0) simList.append(el('li', 'menu-note small', 'None yet.'));
    for (const sim of settings.list) {
      const row = el('li', 'sim-row');
      const character = CHARACTERS.find((c) => c.id === sim.character);
      const persona = PERSONAS.find((p) => p.id === sim.persona);
      const text = el('div', 'sim-text');
      text.append(el('strong', '', sim.name), el('span', 'menu-note small', `${character?.label ?? sim.character} · ${persona?.name ?? 'Quiet'}`));
      const remove = el('button', 'chip', 'Remove');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${sim.name}`);
      remove.addEventListener('click', () => {
        const current = options.sims();
        options.setSims({ ...current, list: current.list.filter((s) => s.id !== sim.id) });
        paintSims();
      });
      row.append(text, remove);
      simList.append(row);
    }
  }

  setTab(tab);

  return {
    get open() { return open; },
    get tab() { return tab; },
    // The window floats off the left edge, so the preview centres on what is right of it.
    get panelWidth() { return open ? panel.getBoundingClientRect().right : 0; },
    show,
    hide,
    setRelics(ids) {
      relics = new Set(ids);
      // Drop cosmetics that require a Relic this profile no longer owns.
      const look = options.look();
      const aura = look.aura === 'none' || relics.has(look.aura) ? look.aura : 'none';
      const staffRelic = STAFF_RELICS[look.staff];
      const staff = staffRelic && !relics.has(staffRelic) ? DEFAULT_STAFF : look.staff;
      if (aura !== look.aura || staff !== look.staff) options.setLook({ ...look, aura, staff });
      if (open) {
        paintLook();
        paintItems();
        paintPets();
        paintRelics();
      }
    },
    setPets(owned) {
      serverPets = owned ? new Set(owned) : null;
      if (open) paintPets();
    },
    refreshPets() {
      if (open) paintPets();
    },
    setVerse(balance) {
      verse = balance;
      if (open) paintItems();
    },
    setGuest(label) {
      guest.textContent = label;
      nameField.placeholder = label;
    },
  };
}

function labelled(text: string, control: HTMLElement, note?: string): HTMLLabelElement {
  const label = el('label', 'menu-field');
  const caption = el('span', 'menu-label', text);
  label.append(caption, control);
  if (note) label.append(el('span', 'menu-note small', note));
  return label;
}

function section(text: string, body: HTMLElement, note?: string): HTMLElement {
  const wrap = el('div', 'menu-field');
  wrap.append(el('span', 'menu-label', text), body);
  if (note) wrap.append(el('span', 'menu-note small', note));
  return wrap;
}

