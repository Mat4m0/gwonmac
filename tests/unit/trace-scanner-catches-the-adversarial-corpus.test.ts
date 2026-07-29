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
    what: "punctuation in a sensitive key and commas and escapes in its value",
    input: JSON.stringify({
      args: {
        "x-auth.token/v2": 'comma-secret, quote-secret" slash-secret\\tail',
      },
    }),
    leaks: ["comma-secret", "quote-secret", "slash-secret", "tail"],
  },
  {
    what: "a query string carrying credentials",
    input: "GET https://account.arena.net/login?user=alice&password=hunter2&next=/home",
    leaks: ["alice", "hunter2"],
  },
  {
    what: "an OAuth token in a redirect fragment",
    input:
      '{"url":"https://www.guildwars.test/app/live/auth' +
      '#access_token=FRAGMENTSECRET123&state=nonce"}',
    leaks: ["FRAGMENTSECRET123", "nonce"],
  },
  {
    what: "an OAuth token in a redirect query",
    input:
      '{"url":"https://www.guildwars.test/app/live/auth' +
      '?access_token=QUERYSECRET456&state=nonce"}',
    leaks: ["QUERYSECRET456", "nonce"],
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
 * leak is caught. `flushBoundary` cuts immediately after a comma outside a JSON
 * string; each of these puts a comma where a byte search would cut a redaction
 * in half, so the chunked-versus-whole test below proves the structural rule.
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

  it("fully redacts a sensitive quoted value containing commas and escapes", () => {
    const secret = '{"id":"comma,value","quote":"a\\"b","slash":"c\\\\d"}';
    const trace = JSON.stringify({
      args: { "account.info/v2": secret },
      next: 1,
    });
    const redacted = redactDiagnosticText(trace);
    for (const leak of ["comma,value", 'a\\"b', "c\\\\d"]) {
      assert.equal(redacted.includes(leak), false, redacted);
    }
    const parsed = JSON.parse(redacted) as {
      args: { "account.info/v2": string };
      next: number;
    };
    assert.equal(parsed.args["account.info/v2"], "[redacted]");
    assert.equal(parsed.next, 1);
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

  it("fails closed when commas inside a JSON string cannot bound the carry", async () => {
    // A byte search sees thousands of commas here; structurally there is no
    // safe cut because every one is inside the still-open string.
    const noBoundary = `{"account.info":"${"secret,".repeat(160_000)}`;
    await assert.rejects(
      collect(slice(noBoundary, 64 * 1024)),
      /no safe structural comma/u,
    );
  });

  it("streams a large trace when structural commas keep the carry bounded", async () => {
    const trace = JSON.stringify([
      "a".repeat(600_000),
      "b".repeat(600_000),
      { path: "/Users/x/secret.txt" },
    ]);
    const output = await collect(slice(trace, 64 * 1024));
    assert.equal(output, redactDiagnosticText(trace));
    assert.equal(output.includes("/Users/x/secret.txt"), false);
  });
});
