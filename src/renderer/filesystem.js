// ArenaNet's Emscripten client mounts IDBFS at app:, but it does so from
// main() after preRun. The WASM can open and write files but has no mkdir
// import, and it leaves the process working directory at the ephemeral MEMFS
// root. Own the mount once, before main(), so every relative game file is
// durable and the required template directories already exist.
(function () {
  'use strict';

  const MOUNT = 'app:';
  const DEPENDENCY = 'gw-persistent-filesystem';
  const REQUIRED_DIRECTORIES = [
    `${MOUNT}/Templates/Skills`,
    `${MOUNT}/Templates/Equipment`,
  ];

  /**
   * @typedef {{
   *   analyzePath(path: string): { error: number },
   *   chdir(path: string): void,
   *   lookupPath(path: string, options?: unknown): unknown,
   *   open(path: unknown, ...args: unknown[]): unknown,
   *   rename(oldPath: string, newPath: string): void,
   *   unlink(path: string): void,
   *   mkdir(path: string): void,
   *   mkdirTree(path: string): void,
   *   mount(type: unknown, options: { autoPersist: boolean }, path: string): void,
   *   syncfs(populate: boolean, callback: (error?: unknown) => void): void,
   * }} EmscriptenFileSystem
   */

  /**
   * @typedef {{
   *   addRunDependency(name: string): void,
   *   removeRunDependency(name: string): void,
   *   preRun?: () => void,
   * }} EmscriptenModule
   */

  /**
   * @param {{
   *   module: EmscriptenModule,
   *   failed(error: unknown): void,
   *   log(...values: unknown[]): void,
   * }} options
   */
  window.gwInstallGameFilesystem = ({ module, failed, log }) => {
    module.preRun = () => {
      module.addRunDependency(DEPENDENCY);
      const runtime = /** @type {any} ArenaNet's generated runtime boundary. */ (
        globalThis
      );
      const fs = /** @type {EmscriptenFileSystem} */ (runtime.FS);
      const idbfs = runtime.IDBFS;
      let finished = false;

      /** @param {unknown} error */
      const stop = (error) => {
        if (finished) return;
        finished = true;
        failed(error);
      };
      const ready = () => {
        if (finished) return;
        finished = true;
        log('persistent filesystem ready');
        module.removeRunDependency(DEPENDENCY);
      };

      try {
        if (fs.analyzePath(MOUNT).error) {
          fs.mkdir(MOUNT);
          fs.mount(idbfs, { autoPersist: true }, MOUNT);
        }
        fs.syncfs(true, (restoreError) => {
          if (restoreError) {
            stop(restoreError);
            return;
          }
          try {
            for (const directory of REQUIRED_DIRECTORIES) {
              fs.mkdirTree(directory);
            }
            fs.chdir(MOUNT);
            // Persist the directory invariant before the game can create a
            // template, screenshot, chat log, or diagnostic file beneath it.
            fs.syncfs(false, (persistError) => {
              if (persistError) stop(persistError);
              else {
                // Normalize at the public operations, not only lookupPath:
                // rename/unlink derive a basename from their original argument
                // after lookup, which otherwise reintroduces the backslashes.
                const lookupPath = fs.lookupPath.bind(fs);
                const open = fs.open.bind(fs);
                const rename = fs.rename.bind(fs);
                const unlink = fs.unlink.bind(fs);
                /** @param {string} file */
                const normalize = (file) =>
                  file.includes('\\')
                    ? file.replace(/^\\+/, '').replaceAll('\\', '/')
                    : file;
                fs.lookupPath = (file, options) => {
                  return lookupPath(normalize(file), options);
                };
                fs.open = (file, ...args) =>
                  open(
                    typeof file === 'string' ? normalize(file) : file,
                    ...args,
                  );
                fs.rename = (oldPath, newPath) =>
                  rename(normalize(oldPath), normalize(newPath));
                fs.unlink = (file) => unlink(normalize(file));
                ready();
              }
            });
          } catch (error) {
            stop(error);
          }
        });
      } catch (error) {
        stop(error);
      }
    };
  };
})();
