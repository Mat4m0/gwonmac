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
    leaks: [homedir()],
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

  it("gives the same answer chunked as whole, for every corpus case", async () => {
    for (const { what, input } of CORPUS) {
      const whole = redactDiagnosticText(input);
      for (const size of [1, 3, 7, 64]) {
        assert.equal(
          await collect(slice(input, size)),
          whole,
          `${what} differs at chunk size ${size}`,
        );
      }
    }
  });

  it("survives a trace larger than the carry ceiling with no safe cut in it", async () => {
    // A megabyte with neither a comma nor a quote is not the JSON Chromium
    // writes, and the scanner must bound its memory rather than buffer it all.
    const filler = "a".repeat(2 * 1024 * 1024);
    const output = await collect([filler, "/Users/x/secret.txt"]);
    assert.equal(output.includes("/Users/x/secret.txt"), false);
    assert.equal(output.startsWith("aaaa"), true);
  });
});
