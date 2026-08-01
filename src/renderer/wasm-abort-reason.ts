/**
 * The renderer-side collapse of an Emscripten abort: prose in, closed
 * vocabulary plus non-text fingerprint out. This is the only shape allowed to
 * cross IPC — the abort message itself stays in this process.
 */
import type { WasmAbortReasonKind } from '../shared/diagnostics.js';

/**
 * Ordered from most to least specific: an assertion message may also contain
 * the word "memory", and an OOM message mentions enlarging memory, so the
 * narrow shapes must win before the broad ones.
 */
export function classifyWasmAbortReason(reason: unknown): WasmAbortReasonKind {
  if (reason === undefined || reason === null || reason === '') {
    return 'unspecified';
  }
  const text = (
    reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)
  ).toLowerCase();
  if (text.includes('assert')) return 'assertion';
  if (
    text.includes('signature mismatch')
    || text.includes('null function')
    || text.includes('table index')
  ) {
    return 'indirectCall';
  }
  if (text.includes('out of bounds')) return 'memoryBounds';
  if (text.includes('unreachable')) return 'unreachable';
  if (text.includes('stack overflow') || text.includes('call stack')) {
    return 'stackOverflow';
  }
  if (
    text.includes('oom')
    || text.includes('enlarge memory')
    || text.includes('allocation failed')
  ) {
    return 'oom';
  }
  if (text.includes('native code called abort')) return 'nativeAbort';
  return 'other';
}

/**
 * FNV-1a over the abort text, the same non-text fingerprint renderer events
 * carry: identical causes cluster across sessions and machines while the
 * message itself stays on the machine it happened on.
 */
export function wasmAbortFingerprint(reason: unknown): string {
  const input = reason instanceof Error
    ? `${reason.name}:${reason.stack || reason.message}`
    : String(reason);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
