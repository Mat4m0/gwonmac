const EVENT_LIMIT = 128;
const TRACE_PREFIX = '[template-fs-trace]';

type TemplateKind = 'skills' | 'equipment';
type PathSeparator = 'slash' | 'backslash' | 'mixed' | 'none';

type TraceEvent = {
  sequence: number;
  operation: string;
  kind?: TemplateKind;
  fd?: number;
  errno?: number;
  flags?: number;
  access?: number;
  create?: boolean;
  truncate?: boolean;
  exclusive?: boolean;
  append?: boolean;
  mode?: number;
  separator?: PathSeparator;
  txtSuffix?: boolean;
  requested?: number;
  written?: number;
  iovCount?: number;
  whence?: number;
};

// The generated glue publishes only `Module.HEAPU8`, so that one view is all
// anything here may assume the module carries.
type ClientMemory = { HEAPU8?: Uint8Array };

// Every WASM import is a numeric function: the syscalls take i32 pointers, file
// descriptors, and flag words, and answer with an errno or a descriptor. Saying
// so is what lets the wrappers below do arithmetic on their own arguments.
type WasmImports = Record<string, (...args: number[]) => number>;

function classifyTemplatePath(value: string): {
  kind: TemplateKind;
  separator: PathSeparator;
  txtSuffix: boolean;
} | null {
  const hasSlash = value.includes('/');
  const hasBackslash = value.includes('\\');
  const normalized = value.replaceAll('\\', '/');
  const match = /(?:^|\/)Templates\/(Skills|Equipment)(?:\/|$)/i.exec(
    normalized,
  );
  if (!match) return null;
  return {
    kind: match[1]?.toLowerCase() === 'skills' ? 'skills' : 'equipment',
    separator:
      hasSlash && hasBackslash
        ? 'mixed'
        : hasBackslash
          ? 'backslash'
          : hasSlash
            ? 'slash'
            : 'none',
    txtSuffix: normalized.toLowerCase().endsWith('.txt'),
  };
}

/** Read a bounded C string without relying on generated-glue helpers. */
function readCString(module: ClientMemory, pointer: number) {
  const heap = module.HEAPU8;
  if (!heap || !Number.isSafeInteger(pointer) || pointer <= 0) return '';
  const endLimit = Math.min(heap.length, pointer + 2048);
  let end = pointer;
  while (end < endLimit && heap[end] !== 0) end += 1;
  if (end === endLimit) return '';
  return new TextDecoder().decode(heap.subarray(pointer, end));
}

/**
 * The generated glue publishes only `Module.HEAPU8`, so every wider view has
 * to be taken from its buffer. Reading `Module.HEAPU32` yields `undefined`
 * and silently drops every byte count from the trace.
 */
function words(module: ClientMemory) {
  return module.HEAPU8 ? new Uint32Array(module.HEAPU8.buffer) : undefined;
}

function readU32(module: ClientMemory, pointer: number) {
  const heap = words(module);
  const index = pointer >>> 2;
  return heap && pointer >= 0 && index < heap.length ? heap[index] : undefined;
}

function requestedBytes(module: ClientMemory, iov: number, count: number) {
  const heap = words(module);
  if (!heap || !Number.isSafeInteger(count) || count < 0 || count > 1024) {
    return undefined;
  }
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    const lengthIndex = (iov >>> 2) + index * 2 + 1;
    const length = heap[lengthIndex];
    if (length === undefined) return undefined;
    total += length;
    if (!Number.isSafeInteger(total)) return undefined;
  }
  return total;
}

export const installTemplateFilesystemTrace = ({
  imports,
  module,
}: {
  imports: {
    env?: WasmImports;
    wasi_snapshot_preview1?: WasmImports;
  };
  module: ClientMemory;
}) => {
  if (!window.gwNative.init.templateFsTrace) return;

  const env = imports.env;
  const wasi = imports.wasi_snapshot_preview1;
  if (!env || !wasi) {
    console.info(
      TRACE_PREFIX,
      JSON.stringify({ sequence: 1, operation: 'unavailable' }),
    );
    return;
  }

  const events: TraceEvent[] = [];
  const descriptors = new Map<number, TemplateKind>();
  let sequence = 0;

  const record = (value: Omit<TraceEvent, 'sequence'>) => {
    const event = Object.freeze({ sequence: (sequence += 1), ...value });
    events.push(event);
    if (events.length > EVENT_LIMIT) events.shift();
    console.info(TRACE_PREFIX, JSON.stringify(event));
  };

  window.gwTemplateFilesystemTrace = () =>
    Object.freeze(events.map((event) => Object.freeze({ ...event })));

  const openat = env.__syscall_openat;
  if (typeof openat === 'function') {
    env.__syscall_openat = function (dirfd, path, flags, varargs) {
      const classification = classifyTemplatePath(readCString(module, path));
      const result = openat.call(this, dirfd, path, flags, varargs);
      if (classification) {
        const mode =
          (flags & 64) !== 0 && varargs > 0
            ? readU32(module, varargs)
            : undefined;
        if (result >= 0) descriptors.set(result, classification.kind);
        record({
          operation: 'openat',
          kind: classification.kind,
          ...(result >= 0 ? { fd: result } : {}),
          errno: result < 0 ? -result : 0,
          flags,
          access: flags & 3,
          create: (flags & 64) !== 0,
          exclusive: (flags & 128) !== 0,
          truncate: (flags & 512) !== 0,
          append: (flags & 1024) !== 0,
          ...(mode === undefined ? {} : { mode }),
          separator: classification.separator,
          txtSuffix: classification.txtSuffix,
        });
      }
      return result;
    };
  }

  const fdWrite = wasi.fd_write;
  if (typeof fdWrite === 'function') {
    wasi.fd_write = function (fd, iov, iovcnt, pnum) {
      const result = fdWrite.call(this, fd, iov, iovcnt, pnum);
      const kind = descriptors.get(fd);
      if (kind) {
        const requested = requestedBytes(module, iov, iovcnt);
        const written = readU32(module, pnum);
        record({
          operation: 'fd_write',
          kind,
          fd,
          errno: result,
          ...(requested === undefined ? {} : { requested }),
          ...(written === undefined ? {} : { written }),
          iovCount: iovcnt,
        });
      }
      return result;
    };
  }

  const fdRead = wasi.fd_read;
  if (typeof fdRead === 'function') {
    wasi.fd_read = function (fd, iov, iovcnt, pnum) {
      const result = fdRead.call(this, fd, iov, iovcnt, pnum);
      const kind = descriptors.get(fd);
      if (kind) {
        const requested = requestedBytes(module, iov, iovcnt);
        const read = readU32(module, pnum);
        record({
          operation: 'fd_read',
          kind,
          fd,
          errno: result,
          ...(requested === undefined ? {} : { requested }),
          ...(read === undefined ? {} : { written: read }),
          iovCount: iovcnt,
        });
      }
      return result;
    };
  }

  const fdPwrite = wasi.fd_pwrite;
  if (typeof fdPwrite === 'function') {
    wasi.fd_pwrite = function (fd, iov, iovcnt, offset, pnum) {
      const result = fdPwrite.call(this, fd, iov, iovcnt, offset, pnum);
      const kind = descriptors.get(fd);
      if (kind) {
        const requested = requestedBytes(module, iov, iovcnt);
        const written = readU32(module, pnum);
        record({
          operation: 'fd_pwrite',
          kind,
          fd,
          errno: result,
          ...(requested === undefined ? {} : { requested }),
          ...(written === undefined ? {} : { written }),
          iovCount: iovcnt,
        });
      }
      return result;
    };
  }

  const ftruncate = env.__syscall_ftruncate64;
  if (typeof ftruncate === 'function') {
    env.__syscall_ftruncate64 = function (fd, length) {
      const result = ftruncate.call(this, fd, length);
      const kind = descriptors.get(fd);
      if (kind) {
        record({
          operation: 'ftruncate',
          kind,
          fd,
          errno: result < 0 ? -result : 0,
        });
      }
      return result;
    };
  }

  const fdSeek = wasi.fd_seek;
  if (typeof fdSeek === 'function') {
    wasi.fd_seek = function (fd, offset, whence, newOffset) {
      const result = fdSeek.call(this, fd, offset, whence, newOffset);
      const kind = descriptors.get(fd);
      if (kind) {
        record({
          operation: 'fd_seek',
          kind,
          fd,
          errno: result,
          whence,
        });
      }
      return result;
    };
  }

  const fdClose = wasi.fd_close;
  if (typeof fdClose === 'function') {
    wasi.fd_close = function (fd) {
      const kind = descriptors.get(fd);
      const result = fdClose.call(this, fd);
      if (kind) {
        record({
          operation: 'fd_close',
          kind,
          fd,
          errno: result,
        });
        descriptors.delete(fd);
      }
      return result;
    };
  }

  record({ operation: 'enabled' });
};
