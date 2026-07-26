// P2.8. Killing the app between `write` and the newline leaves one incomplete
// final JSONL record. That is normal, and the export must survive it: the
// export path used to `JSON.parse` every line unguarded and throw, while the
// previous-session path tolerated it. There is now one reader, and these tests
// execute it with the shapes a killed process actually leaves behind.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLogRecords } from "../../src/main/diagnostic-report.ts";

function line(seq: number, name = "app.event"): string {
  return JSON.stringify({
    seq,
    tsUs: seq * 1_000,
    wallTime: new Date(seq).toISOString(),
    level: "info",
    subsystem: "app",
    name,
  });
}

describe("the JSONL reader", () => {
  it("keeps every complete record when the last one is torn", () => {
    const records = parseLogRecords(
      [line(1), line(2), line(3), '{"seq":4,"tsUs":4000,"lev'].join("\n"),
    );
    assert.deepEqual(
      records.map((record) => record.seq),
      [1, 2, 3],
    );
  });

  it("survives a tear at the only record, and at no record at all", () => {
    assert.deepEqual(parseLogRecords('{"seq":1,"ts'), []);
    assert.deepEqual(parseLogRecords(""), []);
    assert.deepEqual(parseLogRecords("\n\n"), []);
  });

  it("survives a torn record that is still valid JSON", () => {
    // A partial write can land on a complete-looking prefix: `{"seq":1}` is
    // parseable and is not a record. Parsing alone is not the whole guard.
    assert.deepEqual(parseLogRecords([line(1), '{"seq":2}'].join("\n")), [
      JSON.parse(line(1)),
    ]);
    assert.deepEqual(parseLogRecords([line(1), "null", "7"].join("\n")).length, 1);
  });

  it("orders by sequence number, so rolled files may arrive in any order", () => {
    assert.deepEqual(
      parseLogRecords([line(3), line(1), line(2)].join("\n")).map(
        (record) => record.seq,
      ),
      [1, 2, 3],
    );
  });

  it("preserves the fields the export and the report both read", () => {
    const [record] = parseLogRecords(line(9, "app.uncaughtException"));
    assert.equal(record?.seq, 9);
    assert.equal(record?.tsUs, 9_000);
    assert.equal(record?.name, "app.uncaughtException");
    assert.equal(record?.subsystem, "app");
  });
});
