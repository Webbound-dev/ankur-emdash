// Edit mode is EmDash's: an editor switches it on with the "Edit" toggle in
// the EmDash toolbar, which reloads the page with the toolbar marked
// `data-edit-mode="true"`. Components use this to make placeholders and other
// normally inert text clickable, and to pause behaviour that gets in the way
// of editing (auto-advancing counters, closing menus). The inline editor
// itself lives in inlineEditor.ts.

export function isEditModeActive(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector('#emdash-toolbar[data-edit-mode="true"]') !== null;
}

/**
 * Edit mode only changes with a page reload, so there is nothing to observe;
 * kept so components can subscribe the same way as before.
 */
export function onEditModeChange(_cb: (active: boolean) => void): () => void {
  return () => {};
}
