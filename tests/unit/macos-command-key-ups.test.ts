import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { installMacosCommandKeyUps } from "../../src/main/macos-command-key-ups.js";

describe("macOS Command-held key releases", () => {
  it("consumes only mapped releases routed to the focused game", () => {
    let nativeHandler: ((keyCode: number) => boolean) | null = null;
    let focused: { id: number } | null = { id: 7 };
    const releases: Array<{ target: { id: number }; code: string }> = [];
    const nativeHost = {
      monitorCommandKeyUps(handler: (keyCode: number) => boolean) {
        nativeHandler = handler;
        return () => undefined;
      },
    };

    installMacosCommandKeyUps(nativeHost, {
      focusedGameTarget: () => focused,
      release: (target, code) => releases.push({ target, code }),
    });
    assert.ok(nativeHandler);
    const handle = nativeHandler as (keyCode: number) => boolean;
    assert.equal(handle(0x00), true);
    assert.deepEqual(releases, [{ target: { id: 7 }, code: "KeyA" }]);

    assert.equal(handle(0xff), false);
    focused = null;
    assert.equal(handle(0x02), false);
    assert.equal(releases.length, 1);
  });
});
