/**
 * Host half of the derived-client bridge in src/main/core/template-save-compat.ts.
 *
 * Four `Base/Os` file routines ship unimplemented in ArenaNet's Emscripten
 * build: creating a directory always fails, enumerating one does nothing,
 * deriving a name from an entry writes nothing, and deleting a file aborts the
 * client. A fifth is implemented but wrong — opening a file to test whether it
 * exists creates it. The derived module forwards all five to
 * `__syscall_newfstatat` behind dirfd markers that no real call produces, and
 * they are answered here against the mounted IDBFS.
 * Not a mirror any more: the canonical values reach this sandboxed renderer
 * module through the generated preload, so the transform that writes the
 * markers into the module and the code that answers them cannot disagree.
 */
const {
  ensureDirectory: ENSURE_DIRECTORY,
  findFiles: FIND_FILES,
  fileBaseName: FILE_BASE_NAME,
  deleteFile: DELETE_FILE,
  fileExists: FILE_EXISTS,
} = window.gwNative.wasmBridgeMarkers;

// The client's directory-entry record: a 24-byte header it never reads,
// then WCHAR name[260]. Callers stride by the whole record and free the
// block, so it has to come from the client's own allocator.
const RECORD_BYTES = 544;
const RECORD_NAME_OFFSET = 24;
const NAME_LIMIT = 260;

const PATH_LIMIT = 260;
const ERROR_NOT_FOUND = 2;

const TRACE_PREFIX = '[template-fs-bridge]';

// The generated glue publishes only `Module.HEAPU8`, so that one view is all
// anything here may assume the module carries.
type ClientMemory = { HEAPU8?: Uint8Array };

type Trace = {
  (event: Record<string, unknown>): void;
  enabled: boolean;
};

function silent(): Trace {
  const off = () => {};
  off.enabled = false;
  return off;
}

/**
 * Counts and outcomes only, under the same opt-in flag as the syscall trace.
 * No filename, path, or file content is recorded, and nothing is exported or
 * leaves the renderer.
 */
function tracer(): Trace {
  if (!window.gwNative.init.templateFsTrace) return silent();
  let sequence = 0;
  const on = (event: Record<string, unknown>) => {
    sequence += 1;
    console.info(TRACE_PREFIX, JSON.stringify({ sequence, ...event }));
  };
  on.enabled = true;
  return on;
}

function readWide(module: ClientMemory, pointer: number) {
  const bytes = module.HEAPU8;
  if (!bytes || pointer <= 0 || (pointer & 1) !== 0) return null;
  const heap = new Uint16Array(bytes.buffer);
  const start = pointer >>> 1;
  const endLimit = Math.min(heap.length, start + PATH_LIMIT);
  let end = start;
  while (end < endLimit && heap[end] !== 0) end += 1;
  if (end === endLimit) return null;
  let value = '';
  for (let index = start; index < end; index += 1) {
    value += String.fromCharCode(heap[index] ?? 0);
  }
  return value;
}

/**
 * Everything the client passes is relative to the mount. `_wsplitpath` and
 * `_wmakepath` both keep the separator that ends a directory component, so a
 * directory always arrives as `Templates/Skills/`.
 *
 * Runs of separators collapse the way `PATH.normalize` collapses them. The
 * client joins its type directory with `/` onto a record name that already
 * begins with `\`, so every file operation on a listed template arrives as
 * `Templates/Skills/\Test.txt` — a redundant separator, not a traversal.
 */
function normalize(value: string) {
  const trimmed = value
    .replaceAll('\\', '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  const relative = trimmed.startsWith('app:/') ? trimmed.slice(5) : trimmed;
  if (!relative) return null;
  // Keep the client inside its own mount: no absolute paths, no traversal.
  const parts = relative.split('/');
  return parts.every((part) => part && part !== '.' && part !== '..')
    ? relative
    : null;
}

function globToRegExp(glob: string) {
  const source = glob.replaceAll(/[.+^${}()|[\]\\]/g, String.raw`\$&`)
    .replaceAll('*', '[^/]*')
    .replaceAll('?', '[^/]');
  return new RegExp(`^${source}$`, 'i');
}

// Entry kinds the client asks for. `Templates/Skills/*.txt` is requested with
// FILES and `Templates/Skills/*` with DIRECTORIES, so answering both with
// files fills the subdirectory list with phantom folders.
const FIND_FILES_FLAG = 1;
const FIND_DIRECTORIES_FLAG = 2;

/**
 * The client keys a template on its path below the type directory, in Windows
 * form with a leading separator: `\Test`, or `\Sub\Test` one level down. Its
 * own save path builds exactly that, and the list filter matches records
 * against the current subdirectory prefix — so a bare `Test` never matches.
 *
 * The extension comes off here rather than being left to the client's
 * `Path::RemoveExtension`, which is off by one in this build and takes the
 * last character of the name with it: `\Test.txt` becomes `\Tes`. Handing it
 * a name with no extension leaves it nothing to trim.
 */
function internalPath(name: string) {
  const relative = name.replaceAll('/', '\\').replace(/^\\+/, '');
  const separator = relative.lastIndexOf('\\');
  const dot = relative.lastIndexOf('.');
  const bare = dot > separator + 1 ? relative.slice(0, dot) : relative;
  return `\\${bare}`;
}

/** `limit` is a buffer size in characters, including the terminator. */
function writeWide(
  module: ClientMemory,
  pointer: number,
  value: string,
  limit: number,
) {
  const bytes = module.HEAPU8;
  if (!bytes || pointer <= 0 || (pointer & 1) !== 0 || limit < 1) return false;
  const heap = new Uint16Array(bytes.buffer);
  const start = pointer >>> 1;
  const count = Math.min(value.length, limit - 1);
  if (start + count >= heap.length) return false;
  for (let index = 0; index < count; index += 1) {
    heap[start + index] = value.charCodeAt(index);
  }
  heap[start + count] = 0;
  return true;
}

type EmscriptenFileSystem = {
  readdir(path: string): string[];
  unlink(path: string): void;
  analyzePath(path: string): { exists: boolean };
  stat(path: string): { mode: number };
  isFile(mode: number): boolean;
  isDir(mode: number): boolean;
  mkdirTree(path: string): void;
};

// The generated glue publishes FS on the global object once it has mounted, so
// the boundary is named as the global object plus the one property the runtime
// adds rather than widened to `any`.
function filesystem(): EmscriptenFileSystem | null {
  const runtime = globalThis as typeof globalThis & {
    FS?: EmscriptenFileSystem;
  };
  return runtime.FS ?? null;
}

function matchingEntries(
  fs: EmscriptenFileSystem,
  directory: string,
  pattern: RegExp,
  flags: number,
) {
  const wantFiles = (flags & FIND_FILES_FLAG) !== 0;
  const wantDirectories = (flags & FIND_DIRECTORIES_FLAG) !== 0;
  const found: string[] = [];
  for (const entry of fs.readdir(directory)) {
    if (entry === '.' || entry === '..') continue;
    if (!pattern.test(entry) || entry.length >= NAME_LIMIT) continue;
    try {
      const { mode } = fs.stat(`${directory}/${entry}`);
      const wanted = fs.isDir(mode) ? wantDirectories : wantFiles;
      if (wanted) found.push(entry);
    } catch {
      // An entry the mount cannot describe is left out of the listing, the
      // way a directory read degrades. The client has no way to report it.
    }
  }
  return found.sort();
}

export const installTemplateSaveCompatibility = ({
  imports,
  module,
  exports,
}: {
  // The carrier is an ordinary WASM import: an i32 dirfd and three more i32
  // words in, an errno out.
  imports: { env?: Record<string, (...args: number[]) => number> };
  module: ClientMemory;
  exports: () => { malloc?: (bytes: number) => number } | null | undefined;
}) => {
  const env = imports.env;
  const carrier = env?.__syscall_newfstatat;
  const trace = tracer();
  if (!env || typeof carrier !== 'function') {
    trace({ operation: 'unavailable' });
    return;
  }

  const ensureDirectory = (path: number) => {
    const raw = readWide(module, path);
    const directory = raw === null ? null : normalize(raw);
    const fs = filesystem();
    if (!directory || !fs) {
      trace({ operation: 'ensureDirectory', decoded: raw !== null, fs: !!fs });
      return ERROR_NOT_FOUND;
    }
    try {
      fs.mkdirTree(directory);
      trace({ operation: 'ensureDirectory', depth: directory.split('/').length, result: 0 });
      return 0;
    } catch (error) {
      const errno = typeof error === 'object'
        && error !== null
        && 'errno' in error
        && typeof error.errno === 'number'
        ? error.errno
        : ERROR_NOT_FOUND;
      trace({ operation: 'ensureDirectory', result: errno });
      return errno;
    }
  };

  /**
   * `path` is a wildcard such as `Templates/Skills/*`, `out` a zeroed list
   * header — entries at +0, count at +8 — and `flags` says which entry kinds
   * the caller wants.
   */
  const findFiles = (path: number, out: number, flags: number) => {
    const bytes = module.HEAPU8;
    const raw = readWide(module, path);
    const pattern = raw === null ? null : normalize(raw);
    const fs = filesystem();
    if (!bytes || !pattern || !fs || out <= 0 || (out & 3) !== 0) {
      trace({
        operation: 'findFiles',
        heap: !!bytes,
        decoded: raw !== null,
        accepted: pattern !== null,
        fs: !!fs,
        aligned: out > 0 && (out & 3) === 0,
      });
      return 0;
    }

    const cut = pattern.lastIndexOf('/');
    const directory = cut < 0 ? '.' : pattern.slice(0, cut);
    const glob = cut < 0 ? pattern : pattern.slice(cut + 1);
    let names: string[];
    let listed = -1;
    try {
      listed = fs.readdir(directory).length;
      names = matchingEntries(fs, directory, globToRegExp(glob), flags);
    } catch (error) {
      trace({
        operation: 'findFiles',
        depth: directory.split('/').length,
        listed,
        failed: error instanceof Error ? error.name : 'unknown',
      });
      return 0;
    }
    if (names.length === 0) {
      trace({ operation: 'findFiles', flags, listed, matched: 0 });
      return 0;
    }

    const malloc = exports()?.malloc;
    if (typeof malloc !== 'function') {
      trace({ operation: 'findFiles', flags, listed, matched: names.length, malloc: false });
      return 0;
    }
    const entries = malloc(names.length * RECORD_BYTES);
    if (!entries) {
      trace({ operation: 'findFiles', flags, listed, matched: names.length, allocated: false });
      return 0;
    }

    // malloc can grow memory, so every view is taken after it returns.
    const heap = module.HEAPU8;
    if (!heap) return 0;
    heap.fill(0, entries, entries + names.length * RECORD_BYTES);
    names.forEach((name, index) => {
      writeWide(
        module,
        entries + index * RECORD_BYTES + RECORD_NAME_OFFSET,
        name,
        NAME_LIMIT,
      );
    });
    const words = new Uint32Array(heap.buffer);
    words[out >>> 2] = entries;
    words[(out >>> 2) + 2] = names.length;
    trace({
      operation: 'findFiles',
      flags,
      listed,
      matched: names.length,
      published: true,
    });
    return 0;
  };

  /** `path` is a directory entry name from findFiles. */
  const fileBaseName = (path: number, destination: number, limit: number) => {
    const raw = readWide(module, path);
    if (raw === null) return 0;
    const name = internalPath(raw);
    const written = writeWide(
      module,
      destination,
      name,
      Math.min(limit, PATH_LIMIT),
    );
    trace({ operation: 'fileBaseName', length: name.length, written });
    return written ? 1 : 0;
  };

  /**
   * The client's own delete is `assert("not implemented")` followed by
   * `unreachable`, so this is the difference between deleting a build and
   * aborting the client. Its caller treats a non-zero result as success.
   */
  const deleteFile = (path: number) => {
    const raw = readWide(module, path);
    const file = raw === null ? null : normalize(raw);
    const fs = filesystem();
    if (!file || !fs) {
      trace({ operation: 'deleteFile', decoded: raw !== null, fs: !!fs });
      return 0;
    }
    try {
      fs.unlink(file);
      trace({ operation: 'deleteFile', deleted: true });
      return 1;
    } catch (error) {
      trace({
        operation: 'deleteFile',
        deleted: false,
        failed: error instanceof Error ? error.name : 'unknown',
      });
      return 0;
    }
  };

  /**
   * `File::Open` mode 1 is meant to open an existing file, but in this build
   * it opens `O_RDWR | O_CREAT` like the write mode — so the client's own
   * "is this name taken?" probe creates the file it is testing for and every
   * rename is refused. Answer the question without touching the file.
   *
   * An undecidable path answers "taken", which refuses a rename rather than
   * silently overwriting a template.
   */
  const fileExists = (path: number) => {
    const raw = readWide(module, path);
    const file = raw === null ? null : normalize(raw);
    const fs = filesystem();
    if (!file || !fs) {
      trace({ operation: 'fileExists', decoded: raw !== null, fs: !!fs });
      return 1;
    }
    const exists = fs.analyzePath(file).exists;
    trace({ operation: 'fileExists', exists });
    return exists ? 1 : 0;
  };

  trace({ operation: 'installed' });

  env.__syscall_newfstatat = function (dirfd, path, buffer, flags) {
    if (dirfd === ENSURE_DIRECTORY) return ensureDirectory(path);
    if (dirfd === FIND_FILES) return findFiles(path, buffer, flags);
    if (dirfd === FILE_BASE_NAME) return fileBaseName(path, buffer, flags);
    if (dirfd === DELETE_FILE) return deleteFile(path);
    if (dirfd === FILE_EXISTS) return fileExists(path);
    return carrier.call(this, dirfd, path, buffer, flags);
  };
};
