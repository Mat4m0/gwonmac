// ArenaNet's Emscripten client mounts IDBFS at app:, but it does so from
// main() after preRun. The WASM can open and write files but has no mkdir
// import, and it leaves the process working directory at the ephemeral MEMFS
// root. Own the mount once, before main(), so every relative game file is
// durable and the required template directories already exist.
const MOUNT = 'app:';
const DEPENDENCY = 'gw-persistent-filesystem';
const SYNC_TIMEOUT_MS = 30_000;
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
 *   mknod(path: string, ...args: unknown[]): unknown,
 *   mkdir(path: string): void,
 *   mkdirTree(path: string): void,
 *   rmdir(path: string): void,
 *   symlink(oldPath: string, newPath: string): void,
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
export const installGameFilesystem = ({ module, failed, log }) => {
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
    /**
     * @param {boolean} populate
     * @param {(error?: unknown) => void} callback
     */
    const sync = (populate, callback) => {
      const timer = setTimeout(
        () => callback(new Error('persistent filesystem sync timed out')),
        SYNC_TIMEOUT_MS,
      );
      fs.syncfs(populate, (error) => {
        clearTimeout(timer);
        callback(error);
      });
    };

    try {
      if (fs.analyzePath(MOUNT).error) {
        fs.mkdir(MOUNT);
        fs.mount(idbfs, { autoPersist: true }, MOUNT);
      }
      sync(true, (restoreError) => {
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
          sync(false, (persistError) => {
            if (persistError) stop(persistError);
            else {
              // Normalize at the public operations, not only lookupPath:
              // rename/unlink derive a basename from their original argument
              // after lookup, which otherwise reintroduces the backslashes.
              const lookupPath = fs.lookupPath.bind(fs);
              const open = fs.open.bind(fs);
              const rename = fs.rename.bind(fs);
              const unlink = fs.unlink.bind(fs);
              const mknod = fs.mknod.bind(fs);
              const mkdir = fs.mkdir.bind(fs);
              const mkdirTree = fs.mkdirTree.bind(fs);
              const rmdir = fs.rmdir.bind(fs);
              const symlink = fs.symlink.bind(fs);
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
              fs.mknod = (file, ...args) => mknod(normalize(file), ...args);
              fs.mkdir = (file) => mkdir(normalize(file));
              fs.mkdirTree = (file) => mkdirTree(normalize(file));
              fs.rmdir = (file) => rmdir(normalize(file));
              fs.symlink = (oldPath, newPath) =>
                symlink(normalize(oldPath), normalize(newPath));
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
