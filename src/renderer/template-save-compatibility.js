(() => {
  'use strict';

  const BRIDGE_SENTINEL = 1;
  const ALLOWED_DIRECTORIES = new Set([
    'Templates/Skills',
    'Templates/Equipment',
  ]);

  /**
   * @param {{ HEAPU8?: Uint8Array }} module
   * @param {number} pointer
   */
  function readWidePath(module, pointer) {
    const bytes = module.HEAPU8;
    if (!bytes || pointer <= 0 || (pointer & 1) !== 0) return null;
    const heap = new Uint16Array(bytes.buffer);
    const start = pointer >>> 1;
    const endLimit = Math.min(heap.length, start + 260);
    let end = start;
    while (end < endLimit && heap[end] !== 0) end += 1;
    if (end === endLimit) return null;
    let value = '';
    for (let index = start; index < end; index += 1) {
      value += String.fromCharCode(heap[index] ?? 0);
    }
    const normalized = value
      .replace(/^[/\\]+/, '')
      .replaceAll('\\', '/');
    return normalized.startsWith('app:/') ? normalized.slice(5) : normalized;
  }

  /**
   * @param {{
   *   env?: Record<string, (...args: any[]) => any>;
   * }} imports
   * @param {{ HEAPU8?: Uint8Array }} module
   */
  window.gwInstallTemplateSaveCompatibility = (imports, module) => {
    const env = imports.env;
    const stat = env?.__syscall_stat64;
    if (!env || typeof stat !== 'function') return;

    env.__syscall_stat64 = function (path, buffer) {
      if (buffer !== BRIDGE_SENTINEL) {
        return stat.call(this, path, buffer);
      }
      const directory = readWidePath(module, path);
      if (!directory || !ALLOWED_DIRECTORIES.has(directory)) return 2;
      try {
        const runtime =
          /** @type {{ FS?: { mkdirTree(path: string): void } }} */ (
            globalThis
          );
        if (!runtime.FS) return 2;
        runtime.FS.mkdirTree(directory);
        return 0;
      } catch (error) {
        return typeof error === 'object'
          && error !== null
          && 'errno' in error
          && typeof error.errno === 'number'
          ? error.errno
          : 5;
      }
    };
  };
})();
