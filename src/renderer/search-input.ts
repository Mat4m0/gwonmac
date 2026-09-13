/** Returns native text entry from a browsing control to its existing search input. */
export function resumeSearchInput(event: KeyboardEvent, input: HTMLInputElement): boolean {
  const editingShortcut = (event.metaKey || event.ctrlKey) && !event.altKey
    && ['a', 'c', 'v', 'x', 'z', 'y'].includes(event.key.toLowerCase());
  const text = !(event.metaKey || event.ctrlKey)
    && (event.key.length === 1 || ['Dead', 'Process', 'Unidentified'].includes(event.key) || event.isComposing);
  if (!editingShortcut && !text) return false;
  // Do not synthesize characters: the browser owns paste, composition, selection and undo.
  input.focus({ preventScroll: true });
  event.stopPropagation();
  return true;
}
