import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { installVirtualGamepad } from "../../src/renderer/virtual-gamepad.js";

const physicalPad = { id: "physical", index: 0 } as Gamepad;

describe("development virtual gamepad", () => {
  it("starts disconnected, preserves physical pads, and restores Navigator", () => {
    const original = () => [physicalPad, null];
    const navigatorTarget = { getGamepads: original } as Pick<Navigator, "getGamepads">;
    const events: Event[] = [];
    const controller = installVirtualGamepad({
      navigatorTarget,
      eventTarget: { dispatchEvent: (event) => { events.push(event); return true; } },
      log: () => undefined,
    });

    assert.deepEqual(navigatorTarget.getGamepads(), [physicalPad, null]);
    controller.connect();
    const pads = navigatorTarget.getGamepads();
    assert.equal(pads[0], physicalPad);
    assert.equal(pads[1]?.id, "GWonMac Development Virtual Controller");
    assert.equal(pads[1]?.mapping, "standard");
    assert.equal(pads[1]?.buttons.length, 17);
    assert.equal(pads[1]?.axes.length, 4);
    assert.equal((events[0] as Event & { gamepad: Gamepad }).gamepad.connected, true);

    controller.disconnect();
    assert.equal((events[1] as Event & { gamepad: Gamepad }).gamepad.connected, false);
    assert.deepEqual(navigatorTarget.getGamepads(), [physicalPad, null]);
    controller.dispose();
    assert.equal(navigatorTarget.getGamepads, original);
  });

  it("supports the standard face buttons and a right-stick activation pulse", () => {
    const navigatorTarget = { getGamepads: () => [] } as Pick<Navigator, "getGamepads">;
    const callbacks: Array<() => void> = [];
    const controller = installVirtualGamepad({
      navigatorTarget,
      eventTarget: { dispatchEvent: () => true },
      now: (() => { let value = 0; return () => ++value; })(),
      schedule: (callback) => {
        callbacks.push(callback);
        return callbacks.length as unknown as ReturnType<typeof setTimeout>;
      },
      cancel: () => undefined,
      log: () => undefined,
    });

    controller.activateUi();
    assert.equal(navigatorTarget.getGamepads()[0]?.axes[2], 0.85);
    callbacks.shift()?.();
    assert.equal(navigatorTarget.getGamepads()[0]?.axes[2], 0);

    controller.press(0);
    assert.equal(navigatorTarget.getGamepads()[0]?.buttons[0]?.pressed, true);
    controller.release(0);
    assert.equal(navigatorTarget.getGamepads()[0]?.buttons[0]?.pressed, false);
    controller.press(-1);
    controller.press(17);
    assert.equal(navigatorTarget.getGamepads()[0]?.buttons.every((button) => !button.pressed), true);

    controller.tap(3);
    assert.equal(navigatorTarget.getGamepads()[0]?.buttons[3]?.pressed, true);
    callbacks.shift()?.();
    assert.equal(navigatorTarget.getGamepads()[0]?.buttons[3]?.pressed, false);
    controller.dispose();
  });
});
