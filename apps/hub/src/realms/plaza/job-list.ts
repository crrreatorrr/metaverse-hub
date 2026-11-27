import type { RealmContext } from '../../core/realm';
import { RELIC_JOBS } from './relic-jobs';
import './job-list.css';

export function createJobList(ctx: RealmContext) {
  const dialog = document.createElement('dialog');
  dialog.className = 'bar-jobs';
  dialog.innerHTML = `<header><h2 id="bar-jobs-title">Relic jobs</h2><span class="job-count"></span>
    <button type="button" class="job-close" aria-label="Close relic jobs">×</button></header><div class="job-postings"></div>`;
  dialog.setAttribute('aria-labelledby', 'bar-jobs-title');
  const close = dialog.querySelector<HTMLButtonElement>('.job-close')!;
  close.onclick = () => dialog.close();
  const list = dialog.querySelector<HTMLElement>('.job-postings')!;
  const count = dialog.querySelector<HTMLElement>('.job-count')!;
  const cards = RELIC_JOBS.map(({ game, relic }) => {
    const card = document.createElement('section');
    card.style.setProperty('--job-color', game.color);
    const gameName = document.createElement('h3');
    gameName.textContent = game.label;
    const goal = document.createElement('p');
    goal.textContent = game.goal + '.';
    const status = document.createElement('strong');
    const action = document.createElement('button');
    action.type = 'button';
    action.textContent = 'Play';
    action.setAttribute('aria-label', `Play ${game.label}`);
    action.onclick = () => {
      if (!ctx.pageFor(game.id)) return;
      dialog.close();
      ctx.travel(game);
    };
    card.append(gameName, goal, status, action);
    list.append(card);
    return { relic, game, status, action };
  });
  document.body.append(dialog);

  function setRelics(owned: ReadonlySet<string>) {
    let collected = 0;
    for (const { relic, status } of cards) {
      const done = owned.has(relic.id);
      status.textContent = done ? '✓ Collected' : 'Open job';
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
        action.textContent = available ? 'Play' : 'Coming soon';
      }
      dialog.showModal();
      (cards[0]?.action ?? close).focus();
    },
    handleKey(event: KeyboardEvent) {
      if (!dialog.open) return false;
      // Tab and Shift+Tab use the modal's native focus trap.
      if (event.code === 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return true;
      const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const columns = getComputedStyle(list).gridTemplateColumns.split(' ').length;
      const step: Record<string, number> = { ArrowUp: -columns, ArrowDown: columns, ArrowLeft: -1, ArrowRight: 1 };
      event.preventDefault();
      if (event.code in step) buttons[(index + step[event.code] + buttons.length) % buttons.length]?.focus();
      else if (!event.repeat) {
        if (event.code === 'Escape' || event.code === 'KeyQ') dialog.close();
        else if (['Enter', 'NumpadEnter', 'Space', 'KeyE'].includes(event.code)) buttons[index]?.click();
      }
      return true;
    },
  };
}
