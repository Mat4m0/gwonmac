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

/** Windows drive and UNC paths, with the same bounded segment rules. */
const WINDOWS_PATH_SEGMENT =
  String.raw`[^\\\s"',;)}\]]+(?: +(?=[^\s"',;)}\]]*\\)[^\\\s"',;)}\]]+)*`;
const WINDOWS_ABSOLUTE_PATH = new RegExp(
  String.raw`(?<![^\s"'(=:])(?:[A-Za-z]:\\|\\\\${WINDOWS_PATH_SEGMENT}\\)`
    + `${WINDOWS_PATH_SEGMENT}(?:\\\\${WINDOWS_PATH_SEGMENT})*`,
  "g",
);

/**
 * The one sensitive-key vocabulary, and the only one. `redactFields` in
 * `../diagnostic-recorder.ts` drops a field whose *name* contains one of these
 * words; the patterns below scan text for the same words. It used to be
 * spelled out twice, and the two spellings had drifted: `login` was in the
 * scanner and missing from the recorder, so a field named `login` reached
 * `events.jsonl` verbatim while `account` beside it was dropped.
 *
 * The stems are deliberately short. A substring match covers `accountName`,
 * `authToken` and `passphrase`, and over-redacting a benign `author` is the
 * safe direction.
 */
const SENSITIVE_WORDS =
  "pass|auth|cookie|token|secret|credential|username|email|account|login";

const PLAIN_SENSITIVE_KEY =
  String.raw`[\w./-]*(?:${SENSITIVE_WORDS})[\w./-]*`;

const SENSITIVE_KEY_TEST = new RegExp(SENSITIVE_WORDS, "i");

/** Whether a field name is one the recorder drops rather than redacts. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_TEST.test(key);
}

/**
 * `"key": "value"`, the spelling a Chromium trace actually uses. The old rule
 * never matched it at all, because its value class excluded the opening
 * quote. Both quotes are put back so the trace stays parseable — the
 * `attribute-stalls` tool reads chromium-trace.json as JSON.
 *
 * The value class is escape-aware: `\"` is consumed as part of the value
 * rather than ending it. A quote-terminated class ended the match on the
 * escaped quote in `"token":"ab\"cd"`, which put the closing `"` back in the
 * middle of the string — the tail (`cd`) was written out verbatim and the
 * document stopped parsing as JSON, the exact regression the quotes were put
 * back to prevent.
 *
 * A quoted JSON key may contain punctuation, so its spelling cannot be reduced
 * to `\w`. The scanner keeps the key intact and finds the sensitive stem
 * anywhere inside it. The value consumes every valid JSON string character,
 * including commas, escaped quotes and escaped backslashes. `flushBoundary`
 * therefore finds commas outside strings structurally rather than asking this
 * expression to avoid them.
 */
const JSON_STRING_CHARACTER = String.raw`(?:[^"\\]|\\.)`;
const QUOTED_SENSITIVE_KEY =
  String.raw`${JSON_STRING_CHARACTER}*(?:${SENSITIVE_WORDS})${JSON_STRING_CHARACTER}*`;
const QUOTED_SECRET = new RegExp(
  `("${QUOTED_SENSITIVE_KEY}"\\s*:\\s*")${JSON_STRING_CHARACTER}*(")`,
  "gi",
);

/**
 * `key=value` and `key: value` where neither side is quoted. The negative
 * lookahead keeps this off the JSON form: rewriting `"token":5` to
 * `"token":[redacted]` would leave the trace unparseable, and a number is not
 * the free text this is here to catch.
 */
const PLAIN_SECRET = new RegExp(
  `(?<![\\w./-])(${PLAIN_SENSITIVE_KEY})(\\s*[:=]\\s*)(?!")[^,\\s}"']+`,
  "gi",
);

export function redactDiagnosticText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [redacted]")
    .replace(QUOTED_SECRET, "$1[redacted]$2")
    .replace(PLAIN_SECRET, "$1$2[redacted]")
    // A `file:` URL hides its path behind the empty authority: every `/` in
    // `file:///Users/x/…` is either followed or preceded by another, so the
    // absolute-path rule — which deliberately skips `//` so it does not eat
    // the host of an http URL — could never see it.
    .replace(/\bfile:\/\/[^\s"',;)}\]]*/gi, "file://[redacted-path]")
    // The key class excludes the comma as every other rule does. It did not,
    // so `?rt,sid=SECRET` was one match containing a comma; a cut there split
    // it and the streaming scanner emitted verbatim what the whole-document
    // scan redacted (see `flushBoundary`). A comma inside a query *key* is now
    // left alone by both, which is the trade the boundary is worth.
    .replace(/([?&#][^=\s"',&]+)=([^&#\s"',}]+)/g, "$1=[redacted]")
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[redacted-email]",
    )
    .replace(WINDOWS_ABSOLUTE_PATH, "[redacted-path]")
    .replace(ABSOLUTE_PATH, "[redacted-path]")
    // Last, not first. Replacing the home directory before the path rule left
    // the tail of every path under the *exporting user's own* home behind:
    // `[home]/Documents/tax-return.pdf`, because the path rule's lookbehind
    // rejects a `/` preceded by `]`. The same path under any other user was
    // redacted whole. After the path rule this is a backstop for the
    // occurrences that rule cannot see, and it cannot split a streaming chunk
    // either — a home directory contains no comma.
    .replaceAll(homedir(), "[home]");
}

/**
 * A Level 2 trace reaches a quarter of a gigabyte, so it is redacted in
 * chunks — and a chunk boundary is where a streaming redactor leaks. A comma
 * is safe only while it is outside a JSON string. A quoted sensitive value can
 * itself contain commas, so `flushBoundary` walks quotes and escapes and cuts
 * after the last structural comma rather than the last comma-shaped byte.
 *
 * The previous implementation cut at a fixed 64 KiB offset and, worse, carried
 * its own *redacted* tail forward — so a value straddling the cut was
 * half-redacted and its remainder written out verbatim.
 */
const MAX_CARRY_CHARS = 1024 * 1024;

/**
 * Returns the last comma outside a double-quoted JSON string.
 *
 * `redactTraceStream` always starts a carry immediately after such a comma (or
 * at the beginning of the document), so each call starts outside a string.
 * Tracking one escaped character is enough to distinguish `\"` from a closing
 * quote and `\\` from an escape that reaches the following quote.
 */
function lastStructuralComma(buffer: string): number {
  let inString = false;
  let escaped = false;
  let last = -1;
  for (let index = 0; index < buffer.length; index += 1) {
    const character = buffer[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
    } else if (character === '"') {
      inString = true;
    } else if (character === ",") {
      last = index;
    }
  }
  return last;
}

function flushBoundary(buffer: string): number {
  const comma = lastStructuralComma(buffer);
  const cut = comma + 1;
  if (buffer.length - cut > MAX_CARRY_CHARS) {
    // Bounded memory and privacy are both invariants. If the trace supplies no
    // structural boundary within the carry ceiling, splitting is unsafe; the
    // export must fail and let its staging cleanup run rather than write a
    // half-scanned value.
    throw new Error(
      `diagnostic trace has no safe structural comma within ${MAX_CARRY_CHARS} characters`,
    );
  }
  return cut;
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
