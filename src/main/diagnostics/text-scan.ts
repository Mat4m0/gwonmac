import { homedir } from "node:os";

/**
 * The pattern scanner for text this application did **not** author.
 *
 * Everything this process records itself is closed by `./schema.js` and
 * checked by `./detector.js`, which shares no code with this file on purpose.
 * What is left is text we cannot schema: the Chromium content trace, and the
 * environment/summary/settings documents whose leaves come from OS and
 * Chromium APIs. A pattern scanner is the weakest tool here, and it is the
 * only one that applies — so it lives on its own, says so, and is testable
 * without Electron. It used to sit inside `diagnostic-recorder.ts`, where no
 * unit test could reach it because that module resolves Electron paths at
 * import time.
 */

/**
 * An absolute path. The lookbehind is **negative** so that a path at index 0
 * matches: the previous positive form `(?<=[\s"'(=:])` required a delimiter to
 * exist, which made `/Users/x/secret.txt` invisible whenever it was the whole
 * value — the exact case the adversarial corpus starts with. "Not preceded by
 * a non-delimiter" is the same rule everywhere else and also true at the start
 * of the string.
 *
 * A space belongs to the path only when the run it starts still reaches a `/`
 * before the next whitespace. Stopping at the first space left
 * `[redacted-path] Support/gwonmac/main.js` behind for every macOS path under
 * `Application Support`, and prose after a path (`/tmp/x and then more`) is
 * still not swallowed, because `and` has no `/` after it.
 */
const ABSOLUTE_PATH =
  /(?<![^\s"'(=:])\/(?!\/)[^/\s"',;)}\]]+(?: +(?=[^\s"',;)}\]]*\/)[^/\s"',;)}\]]+)*(?:\/[^/\s"',;)}\]]+(?: +(?=[^\s"',;)}\]]*\/)[^/\s"',;)}\]]+)*)*/g;

/**
 * The keys the recorder already drops by name (`SENSITIVE_KEY` in
 * `../diagnostic-recorder.ts`), spelled the same way: a substring match, so
 * `accountName` and `authToken` are covered too. The vocabulary used to be
 * five words and did not include the identifier keys, so `account=alice` in
 * free text survived while a *field* named `account` was dropped outright.
 */
const SENSITIVE_KEY = String.raw`\w*(?:password|passphrase|authorization|cookie|token|secret|credential|username|email|account|login)\w*`;

/**
 * `"key": "value"`, the spelling a Chromium trace actually uses. The old rule
 * never matched it at all, because its value class excluded the opening
 * quote. Both quotes are put back so the trace stays parseable — the
 * `attribute-stalls` tool reads chromium-trace.json as JSON — and the value
 * class stops at a comma so no match can contain one (see `flushBoundary`).
 * A value that really does contain a comma is left to the rules below.
 */
const QUOTED_SECRET = new RegExp(`("${SENSITIVE_KEY}"\\s*:\\s*")[^",]*(")`, "gi");

/**
 * `key=value` and `key: value` where neither side is quoted. The negative
 * lookahead keeps this off the JSON form: rewriting `"token":5` to
 * `"token":[redacted]` would leave the trace unparseable, and a number is not
 * the free text this is here to catch.
 */
const PLAIN_SECRET = new RegExp(
  `\\b(${SENSITIVE_KEY})(\\s*[:=]\\s*)(?!")[^,\\s}"']+`,
  "gi",
);

export function redactDiagnosticText(value: string): string {
  return value
    .replaceAll(homedir(), "[home]")
    .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [redacted]")
    .replace(QUOTED_SECRET, "$1[redacted]$2")
    .replace(PLAIN_SECRET, "$1$2[redacted]")
    // A `file:` URL hides its path behind the empty authority: every `/` in
    // `file:///Users/x/…` is either followed or preceded by another, so the
    // absolute-path rule — which deliberately skips `//` so it does not eat
    // the host of an http URL — could never see it.
    .replace(/\bfile:\/\/[^\s"',;)}\]]*/gi, "file://[redacted-path]")
    .replace(/([?&][^=\s"'&]+)=([^&#\s"',}]+)/g, "$1=[redacted]")
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[redacted-email]",
    )
    .replace(ABSOLUTE_PATH, "[redacted-path]");
}

/**
 * A Level 2 trace reaches a quarter of a gigabyte, so it is redacted in
 * chunks — and a chunk boundary is where a streaming redactor leaks. No match
 * above can contain a comma: every value class excludes it and no key or
 * separator admits it. Cutting immediately after one therefore cannot split a
 * match in half, and a comma is never far away in the JSON Chromium writes.
 * (A quote is not safe: `"token":"abc"` is one match, quotes included.)
 *
 * The previous implementation cut at a fixed 64 KiB offset and, worse, carried
 * its own *redacted* tail forward — so a value straddling the cut was
 * half-redacted and its remainder written out verbatim.
 */
const MAX_CARRY_CHARS = 1024 * 1024;

function flushBoundary(buffer: string): number {
  const cut = buffer.lastIndexOf(",");
  if (cut >= 0) return cut + 1;
  // A megabyte of trace with no comma in it is not the JSON Chromium writes.
  // Bounding the carry costs the boundary guarantee for that one cut and keeps
  // memory bounded, which is the safer trade at this size.
  return buffer.length > MAX_CARRY_CHARS ? buffer.length : 0;
}

/**
 * Redacts a stream of text, yielding only what is safe to write. The carry is
 * raw, never redacted output, so nothing is scanned twice and nothing is
 * scanned in half.
 */
export async function* redactTraceStream(
  chunks: AsyncIterable<string> | Iterable<string>,
): AsyncGenerator<string> {
  let carry = "";
  for await (const chunk of chunks) {
    const buffer = carry + chunk;
    const cut = flushBoundary(buffer);
    carry = buffer.slice(cut);
    if (cut > 0) yield redactDiagnosticText(buffer.slice(0, cut));
  }
  if (carry) yield redactDiagnosticText(carry);
}
