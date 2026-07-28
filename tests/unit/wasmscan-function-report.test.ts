import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, it } from "node:test";

const execFileAsync = promisify(execFile);

const fixture = Buffer.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x06, 0x01, 0x60, 0x01, 0x7f, 0x01, 0x7f,
  0x02, 0x0b, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x03, 0x69, 0x6d, 0x70, 0x00, 0x00,
  0x03, 0x03, 0x02, 0x00, 0x00,
  0x0a, 0x0f, 0x02,
  0x06, 0x00, 0x20, 0x00, 0x10, 0x00, 0x0b,
  0x06, 0x00, 0x20, 0x00, 0x10, 0x01, 0x0b,
]);

describe("wasmscan candidate function report", () => {
  it("reports signatures, body identities, and direct call edges", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "gwonmac-wasmscan-"));
    const modulePath = path.join(directory, "fixture.wasm");
    await writeFile(modulePath, fixture);

    const { stdout } = await execFileAsync(
      "python3",
      [
        "tools/wasmscan.py",
        modulePath,
        "--functions",
        "1,2",
        "--property-context-roots",
        "0",
        "--json",
      ],
      { cwd: path.resolve(import.meta.dirname, "../..") },
    );
    const report = JSON.parse(stdout) as {
      functionImports: number;
      definedFunctions: number;
      decodeFailures: unknown[];
      propertyContext: { roots: number[]; boundFunctions: number };
      functions: Array<{
        functionIndex: number;
        signature: { params: string[]; results: string[] };
        body: { size: number; sha256: string };
        directCallers: number[];
        directCallees: number[];
        directCalls: Array<{ bodyOffset: number; functionIndex: number }>;
        propertyContextBound: boolean;
        contextFreeFrontier: number[];
      }>;
    };

    assert.equal(report.functionImports, 1);
    assert.equal(report.definedFunctions, 2);
    assert.deepEqual(report.decodeFailures, []);
    assert.deepEqual(report.propertyContext, {
      roots: [0],
      boundFunctions: 3,
    });
    assert.deepEqual(
      report.functions.map(({ functionIndex, signature, directCallers, directCallees }) => ({
        functionIndex,
        signature,
        directCallers,
        directCallees,
      })),
      [
        {
          functionIndex: 1,
          signature: { typeIndex: 0, params: ["i32"], results: ["i32"] },
          directCallers: [2],
          directCallees: [0],
        },
        {
          functionIndex: 2,
          signature: { typeIndex: 0, params: ["i32"], results: ["i32"] },
          directCallers: [],
          directCallees: [1],
        },
      ],
    );
    for (const candidate of report.functions) {
      assert.equal(candidate.body.size, 6);
      assert.match(candidate.body.sha256, /^[0-9a-f]{64}$/);
      assert.equal(candidate.propertyContextBound, true);
      assert.deepEqual(candidate.contextFreeFrontier, []);
    }
    assert.deepEqual(report.functions[0]?.directCalls, [{
      bodyOffset: 3,
      functionIndex: 0,
    }]);
    assert.deepEqual(report.functions[1]?.directCalls, [{
      bodyOffset: 3,
      functionIndex: 1,
    }]);
  });
});
