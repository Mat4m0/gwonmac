import assert from "node:assert/strict";
import test from "node:test";
import { BUNDLED_FUNDING, FUNDING_URL, fetchLauncherFunding, parseLauncherFunding } from "../../src/main/core/launcher-funding.ts";

test("the checked-in fallback is valid and overfunding is allowed", () => {
  assert.deepEqual(parseLauncherFunding(BUNDLED_FUNDING), BUNDLED_FUNDING);
  assert.deepEqual(parseLauncherFunding({ raisedEuros: 150, goalEuros: 120 }), { raisedEuros: 150, goalEuros: 120 });
});

test("remote funding accepts only the two bounded numeric fields", () => {
  for (const invalid of [
    null, [], {}, { raisedEuros: 86 }, { raisedEuros: "86", goalEuros: 120 },
    { raisedEuros: -1, goalEuros: 120 }, { raisedEuros: 1.5, goalEuros: 120 },
    { raisedEuros: 86, goalEuros: 0 }, { raisedEuros: 86, goalEuros: Infinity },
    { raisedEuros: Number.MAX_SAFE_INTEGER + 1, goalEuros: 120 },
    { raisedEuros: 86, goalEuros: 120, url: "https://example.com" },
  ]) assert.throws(() => parseLauncherFunding(invalid));
});

test("fetches only the fixed GitHub file without credentials or redirects", async () => {
  const updated = { raisedEuros: 95, goalEuros: 150 };
  const result = await fetchLauncherFunding(async (url, init) => {
    assert.equal(url, FUNDING_URL);
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    assert.equal(init.cache, "no-cache");
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json(updated);
  });
  assert.deepEqual(result, updated);
});

test("failed, invalid, and oversized responses leave the caller's figures unchanged", async () => {
  for (const response of [
    new Response(null, { status: 404 }), new Response("not JSON"),
    Response.json({ raisedEuros: 99, goalEuros: 0 }),
    new Response(" ".repeat(1025)),
    new Response("{}", { headers: { "content-length": "1025" } }),
  ]) assert.equal(await fetchLauncherFunding(async () => response), null);
  assert.equal(await fetchLauncherFunding(async () => { throw new Error("offline"); }), null);
});
