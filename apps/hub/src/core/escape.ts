export type EscAction = 'close-help' | 'close-menu' | 'open-menu' | 'none';

/**
 * What Esc does in the plaza. An open menu closes first (it covers the HUD), then the "?" card,
 * and only with neither open does Esc open the menu. Esc typed into a text field outside the menu
 * does nothing.
 */
export function escAction(state: { menuOpen: boolean; helpOpen: boolean; typing: boolean }): EscAction {
  if (state.menuOpen) return 'close-menu';
  if (state.helpOpen) return 'close-help';
  return state.typing ? 'none' : 'open-menu';
}
