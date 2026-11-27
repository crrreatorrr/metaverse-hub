import type { RealmContext } from '../../core/realm';
import { RELIC_JOBS } from './relic-jobs';
import './job-list.css';

export function createJobList(ctx: RealmContext) {
  const dialog = document.createElement('dialog');
  dialog.className = 'bar-jobs';
  dialog.innerHTML = `<header><h2 id="bar-jobs-title">Relic bounties</h2><span class="job-count"></span>
    <button type="button" class="job-close" aria-label="Close relic jobs">×</button></header><div class="job-postings"></div>`;
  dialog.setAttribute('aria-labelledby', 'bar-jobs-title');
  const close = dialog.querySelector<HTMLButtonElement>('.job-close')!;
  close.onclick = () => dialog.close();
  const list = dialog.querySelector<HTMLElement>('.job-postings')!;
  const count = dialog.querySelector<HTMLElement>('.job-count')!;
  const cards = RELIC_JOBS.map(({ game, relic, cut, how }) => {
    const card = document.createElement('section');
    const seal = document.createElement('span');
    seal.className = 'job-woodcut';
    seal.ariaHidden = 'true';
    seal.style.backgroundPositionX = `${cut / 7 * 100}%`;
    const name = document.createElement('h4');
    name.textContent = relic.name;
    const gameName = document.createElement('h3');
    gameName.textContent = game.label;
    const goal = document.createElement('p');
    goal.textContent = how;
    const status = document.createElement('strong');
    const action = document.createElement('button');
    action.type = 'button';
    action.setAttribute('aria-label', `Play ${game.label}`);
    action.onclick = () => {
      if (!ctx.pageFor(game.id)) return;
      dialog.close();
      ctx.travel(game);
    };
    card.append(seal, gameName, name, goal, status, action);
    list.append(card);
    return { relic, game, status, action };
  });
  document.body.append(dialog);

  function setRelics(owned: ReadonlySet<string>) {
    let collected = 0;
    for (const { relic, status } of cards) {
      const done = owned.has(relic.id);
      status.textContent = done ? 'Collected' : 'Open job';
      status.classList.toggle('collected', done);
      if (done) collected++;
    }
    count.textContent = `${collected} of ${cards.length} collected`;
  }
  return {
    get open() { return dialog.open; },
    setRelics,
    show() {
      if (dialog.open || ctx.isBlocked()) return;
      ctx.releasePointer();
      for (const { game, action } of cards) {
        const available = Boolean(ctx.pageFor(game.id));
        action.setAttribute('aria-disabled', String(!available));
        action.textContent = available ? 'Play game' : 'Coming soon';
      }
      dialog.showModal();
      (cards[0]?.action ?? close).focus();
    },
    handleKey(event: KeyboardEvent) {
      if (!dialog.open) return false;
      // Tab and Shift+Tab use the modal's native focus trap.
      if (event.code === 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return true;
      const focused = document.activeElement;
      const index = cards.findIndex(card => card.action === focused);
      if (event.code.startsWith('Arrow')) {
        event.preventDefault();
        const columns = getComputedStyle(list).gridTemplateColumns.split(' ').length;
        const step: Record<string, number> = { ArrowUp: -columns, ArrowDown: columns, ArrowLeft: -1, ArrowRight: 1 };
        cards[(index < 0 ? 0 : index + step[event.code] + cards.length) % cards.length]?.action.focus();
      } else if (['Escape', 'KeyQ', 'Enter', 'NumpadEnter', 'Space', 'KeyE'].includes(event.code)) {
        event.preventDefault();
        if (!event.repeat) {
          if (event.code === 'Escape' || event.code === 'KeyQ') dialog.close();
          else if (focused instanceof HTMLButtonElement) focused.click();
        }
      }
      return true;
    },
  };
}
