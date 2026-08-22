/**
 * Parses one HTTP byte-range request.
 * It returns inclusive bounds clamped to the supplied resource size.
 */

const RANGE_RE = /^bytes=(\d*)-(\d*)$/;

export interface ByteRange {
  start: number;
  end: number; // inclusive
}

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
