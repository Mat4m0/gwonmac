import assert from "node:assert/strict";
import { homedir } from "node:os";
import { describe, it } from "node:test";
import {
  redactDiagnosticText,
  redactTraceStream,
} from "../../src/main/diagnostics/text-scan.ts";

/**
 * P2.7 — the adversarial corpus, executed.
 *
 * This covers the Chromium content trace only. Everything this application
 * records itself is closed by the schema and checked by the detector, which
 * shares no code with the scanner under test here; the trace is the document
 * nobody here authored, so it is the one a pattern scanner is right for.
 */

const CORPUS: { what: string; input: string; leaks: string[] }[] = [
  {
    // The lookbehind hole. This value has no delimiter in front of it, and the
    // previous positive lookbehind required one.
    what: "an absolute path that is the entire value",
    input: "/Users/x/secret.txt",
    leaks: ["/Users/x/secret.txt", "secret.txt"],
  },
  {
    what: "a file: URL",
    input: 'source: "file:///Users/x/Documents/account-recovery.txt"',
    leaks: ["/Users/x/Documents", "account-recovery.txt"],
  },
  {
    what: "a multiline stack trace",
    input: [
      "Error: connect ECONNREFUSED",
      "    at TCPConnectWrap.afterConnect (node:net:1611:16)",
      "    at /Users/x/Library/Application Support/gwonmac/main.js:41:9",
    ].join("\n"),
    leaks: ["/Users/x/Library", "gwonmac/main.js"],
  },
  {
    what: "account and username identifiers in free text",
    input: "login failed for account=alice.smith username=alice.smith",
    leaks: ["alice.smith"],
  },
  {
    what: "the JSON spelling a trace actually uses",
    input: '{"args":{"accountName":"alice","token":"eyJhbGciOi"}}',
    leaks: ["alice", "eyJhbGciOi"],
  },
  {
    // A quote-terminated value class ended the match on the *escaped* quote,
    // so the closing quote went back in the middle of the string: the tail was
    // written out verbatim and the document stopped parsing as JSON.
    what: "a sensitive value containing an escaped quote",
    input: '{"args":{"password":"p\\"ublic-leak"}}',
    leaks: ["ublic-leak"],
  },
  {
    what: "a query string carrying credentials",
    input: "GET https://account.arena.net/login?user=alice&password=hunter2&next=/home",
    leaks: ["alice", "hunter2"],
  },
  {
    what: "a bearer token",
    input: "authorization header was Bearer abc.def.ghi",
    leaks: ["abc.def.ghi"],
  },
  {
    what: "an email address",
    input: "contact alice@example.com for the account",
    leaks: ["alice@example.com"],
  },
  {
    what: "unicode and right-to-left text around a path",
    input: '"‮txt.terces/لينا/sresU/" and /Users/лена/секрет.txt',
    leaks: ["/Users/лена", "секрет.txt"],
  },
  {
    what: "the user's home directory",
    input: `cache root is ${homedir()}/Library/Caches`,
    leaks: [homedir(), "Library/Caches"],
  },
  {
    // Replacing the home directory *first* left this whole tail behind:
    // `[home]/Downloads/…`, because the path rule's lookbehind rejects a `/`
    // preceded by `]`. The same path under any other user was redacted whole,
    // and this is the form a trace on the exporting user's own machine takes.
    what: "a path under the exporting user's own home directory",
    input: `${homedir()}/Downloads/my-account-recovery-codes.txt`,
    leaks: [homedir(), "Downloads", "my-account-recovery-codes.txt"],
  },
];

/**
 * Documents that exist to exercise the streaming cut rather than to claim a
 * leak is caught. `flushBoundary` cuts immediately after a comma because no
 * rule can match across one; each of these puts a comma where a rule used to
 * reach past it, so the chunked-versus-whole test below is what proves that
 * premise instead of the comment asserting it.
 */
const BOUNDARY_CORPUS: { what: string; input: string }[] = [
  {
    what: "a comma inside a query-string key",
    input: '{"url":"https://account.arena.net/sso?rt,sid=SECRETSESSION9","x":1}',
  },
  {
    what: "a comma inside a quoted sensitive value",
    input: '{"args":{"accountInfo":"{\\"id\\":\\"alice\\",\\"mail\\":\\"x\\"}"}}',
  },
  {
    what: "a comma inside an unquoted sensitive value",
    input: "login failed for account=alice,smith and username=bob",
  },
];

async function collect(chunks: string[]): Promise<string> {
  let out = "";
  for await (const text of redactTraceStream(chunks)) out += text;
  return out;
}

function slice(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let at = 0; at < text.length; at += size) {
    chunks.push(text.slice(at, at + size));
  }
  return chunks;
}

describe("Chromium trace scanner", () => {
  for (const { what, input, leaks } of CORPUS) {
    it(`redacts ${what}`, () => {
      const output = redactDiagnosticText(input);
      for (const leak of leaks) {
        assert.equal(
          output.includes(leak),
          false,
          `${JSON.stringify(leak)} survived in ${JSON.stringify(output)}`,
        );
      }
    });
  }

  it("keeps the trace parseable as JSON", () => {
    const trace = JSON.stringify({
      traceEvents: [
        {
          name: "Task",
          args: {
            token: "eyJhbGciOi",
            url: "/Users/x/g.js",
            // A numeric value under a sensitive key. Rewriting this to
            // `"tokenCount":[redacted]` would leave the trace unparseable,
            // and `attribute-stalls` reads it as JSON.
            tokenCount: 5,
          },
        },
      ],
    });
    const redacted = redactDiagnosticText(trace);
    assert.equal(redacted.includes("eyJhbGciOi"), false);
    assert.equal(redacted.includes("/Users/x/g.js"), false);
    const parsed = JSON.parse(redacted) as {
      traceEvents: { args: { token: string; tokenCount: number } }[];
    };
    assert.equal(parsed.traceEvents[0]!.args.token, "[redacted]");
    assert.equal(parsed.traceEvents[0]!.args.tokenCount, 5);
  });

  it("keeps a value with an escaped quote in it parseable", () => {
    const trace = JSON.stringify({
      traceEvents: [{ name: "Task", args: { token: 'ab"cd', next: 1 } }],
    });
    const redacted = redactDiagnosticText(trace);
    assert.equal(redacted.includes("cd"), false, redacted);
    const parsed = JSON.parse(redacted) as {
      traceEvents: { args: { token: string; next: number } }[];
    };
    assert.equal(parsed.traceEvents[0]!.args.token, "[redacted]");
    assert.equal(parsed.traceEvents[0]!.args.next, 1);
  });

  it("leaves a sensitive value containing a comma to the other rules", () => {
    // The limit the comma boundary buys, stated rather than implied: a value
    // with a bare comma in it — a serialized JSON blob under a sensitive key —
    // is not matched by the quoted rule, and the rules below do not catch this
    // one either. What the scan does guarantee here is that it leaves the
    // document parseable rather than half-rewriting it.
    const trace = '{"args":{"accountInfo":"{\\"id\\":\\"a\\",\\"m\\":\\"b\\"}"}}';
    const redacted = redactDiagnosticText(trace);
    JSON.parse(redacted);
    assert.equal(redacted, trace);
  });

  it("redacts a value that straddles a streaming chunk boundary", async () => {
    const document = `{"trace":"start","path":"/Users/x/very-secret-file.txt","token":"eyJhbGciOi"}`;
    // Every split point, including the ones that cut the path and the token in
    // half. The old scanner cut at a fixed offset and carried its own redacted
    // output forward, so half a path was written out verbatim.
    for (let size = 1; size <= document.length; size++) {
      const output = await collect(slice(document, size));
      assert.equal(
        output.includes("very-secret-file"),
        false,
        `chunk size ${size} leaked the path: ${output}`,
      );
      assert.equal(
        output.includes("eyJhbGciOi"),
        false,
        `chunk size ${size} leaked the token: ${output}`,
      );
    }
  });

  it("gives the same answer at every split point, for every corpus case", async () => {
    // The invariant `flushBoundary` rests on — no rule can match across the
    // comma it cuts after — stated as behaviour: if any rule could span the
    // cut, some split point would produce a different answer from the whole
    // document. Every split point, not a handful, because the leak this
    // catches showed up only at the sizes that landed inside one match.
    for (const { what, input } of [...CORPUS, ...BOUNDARY_CORPUS]) {
      const whole = redactDiagnosticText(input);
      for (let size = 1; size <= input.length; size++) {
        assert.equal(
          await collect(slice(input, size)),
          whole,
          `${what} differs at chunk size ${size}`,
        );
      }
    }
  });

  it("half-redacts a value straddling the carry ceiling, which is the trade", async () => {
    // A megabyte with no comma in it is not the JSON Chromium writes, so the
    // scanner flushes rather than buffering without bound — and a comma is the
    // only character no rule can match across, so there is nothing safer to
    // cut at. This is the one cut where a value is redacted up to the seam and
    // its remainder written out verbatim. It is asserted rather than avoided
    // so that nobody reads `docs/internals.md` as promising otherwise.
    const seam = "a".repeat(1024 * 1024 + 10) + '"path":"/Users/x/very-sec';
    const output = await collect([seam, 'ret-file.txt"}']);
    assert.equal(output.includes("[redacted-path]ret-file.txt"), true, output.slice(-60));
    assert.equal(
      redactDiagnosticText(seam + 'ret-file.txt"}').includes("ret-file.txt"),
      false,
    );
  });

  it("survives a trace larger than the carry ceiling with no safe cut in it", async () => {
    // The same ceiling, when the flush does not land inside a value: memory is
    // bounded and what follows the seam is still scanned.
    const filler = "a".repeat(2 * 1024 * 1024);
    const output = await collect([filler, "/Users/x/secret.txt"]);
    assert.equal(output.includes("/Users/x/secret.txt"), false);
    assert.equal(output.startsWith("aaaa"), true);
  });
});
