/** The login status must give its newest message sole dismissal authority. */
import assert from "node:assert/strict";
import test from "node:test";
import { installLoginStatus } from "../../src/renderer/login-status.js";

test("an older timer cannot hide a newer login status", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const element = { hidden: true, textContent: "" };
  const status = installLoginStatus(element as unknown as HTMLElement);

  try {
    status.show("Steam sign-in stopped", 12_000);
    context.mock.timers.tick(5_000);
    status.show("Automatic return stopped", 8_000);

    context.mock.timers.tick(7_000);
    assert.equal(element.hidden, false);
    assert.equal(element.textContent, "Automatic return stopped");

    context.mock.timers.tick(1_000);
    assert.equal(element.hidden, true);
  } finally {
    status.dispose();
    context.mock.timers.reset();
  }
});

test("disposing the owner clears its current status", () => {
  const element = { hidden: true, textContent: "" };
  const status = installLoginStatus(element as unknown as HTMLElement);

  status.show("Signing in");
  status.dispose();

  assert.equal(element.hidden, true);
});
