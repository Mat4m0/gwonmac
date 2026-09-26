/**
 * Returns native text entry from browse controls to their existing search input.
 * Keyboard and semantic Edit commands share the same Chromium-owned editing.
 */
export function resumeSearchInput(event: KeyboardEvent, input: HTMLInputElement): boolean {
  const editingShortcut = (event.metaKey || event.ctrlKey) && !event.altKey
    && ['a', 'c', 'v', 'x', 'z', 'y'].includes(event.key.toLowerCase());
  const text = !(event.metaKey || event.ctrlKey)
    && (event.key.length === 1 || ['Delete', 'Dead', 'Process', 'Unidentified'].includes(event.key) || event.isComposing);
  if (!editingShortcut && !text) return false;
  // Do not synthesize characters: the browser owns paste, composition, selection and undo.
  input.focus({ preventScroll: true });
  event.stopPropagation();
  return true;
}


/** Edit menu commands bypass keydown; restore the field before Chromium edits it. */
export function installSearchEditing(browse: HTMLElement, input: HTMLInputElement): () => void {
  const resume = () => {
    if (browse.contains(input.ownerDocument.activeElement) && !input.disabled && input.getClientRects().length) {
      input.focus({ preventScroll: true });
    }
  };
  window.addEventListener('gw:text-edit', resume, true);
  return () => window.removeEventListener('gw:text-edit', resume, true);
}
