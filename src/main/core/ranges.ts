import { AppError, ValidationError } from "../../shared/errors.js";

const RANGE_RE = /^bytes=(\d*)-(\d*)$/;

export interface ByteRange {
  start: number;
  end: number; // inclusive
}

export type InclusiveRange = ByteRange;

/** Inclusive start/end; null = no usable Range (caller may serve whole file). */
export function parseRangeHeader(
  header: string | null | undefined,
  total: number,
): ByteRange | null | "unsatisfiable" {
  if (!header) return null;
  const m = RANGE_RE.exec(header.trim());
  if (!m) return null;
  const first = m[1]!;
  const last = m[2]!;
  let start: number;
  let end: number;
  if (first) {
    start = Number(first);
    end = last ? Number(last) : total - 1;
  } else {
    if (!last) return null;
    start = Math.max(0, total - Number(last));
    end = total - 1;
  }
  if (start >= total || start > end) return "unsatisfiable";
  return { start, end: Math.min(end, total - 1) };
}

export function contentRangeHeader(start: number, end: number, total: number): string {
  return `bytes ${start}-${end}/${total}`;
}

export function rangeLength(range: ByteRange): number {
  return range.end - range.start + 1;
}

/** Virtual snapshot must never be served as a whole 4.2 GB response. */
export function requireSnapshotRange(
  header: string | null | undefined,
  total: number,
): ByteRange {
  const rng = parseRangeHeader(header, total);
  if (rng === "unsatisfiable" || rng === null) {
    throw new AppError(
      "range_required",
      "Gw.snapshot is served from cached chunks; range requests only",
    );
  }
  return rng;
}

export function assertSafeRead(offset: number, length: number, size: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new ValidationError("offset must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new ValidationError("length must be a positive safe integer");
  }
  if (offset + length > size) {
    throw new ValidationError("read exceeds snapshot size");
  }
}
