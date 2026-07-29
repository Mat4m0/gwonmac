import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NATIVE_CAPABILITY_UNAVAILABLE,
  nativePowerCapabilities,
  readNativeCapability,
} from "../../src/main/core/power-capabilities.js";

describe("native power capability states", () => {
  it("maps only APIs Electron documents for each desktop platform", () => {
    assert.deepEqual(nativePowerCapabilities("darwin"), {
      batteryState: true,
      batteryEvents: true,
      thermalState: true,
      cpuSpeedLimitEvents: true,
    });
    assert.deepEqual(nativePowerCapabilities("win32"), {
      batteryState: true,
      batteryEvents: true,
      thermalState: false,
      cpuSpeedLimitEvents: true,
    });
    assert.deepEqual(nativePowerCapabilities("linux"), {
      batteryState: true,
      batteryEvents: false,
      thermalState: false,
      cpuSpeedLimitEvents: false,
    });
  });

  it("reports unavailable instead of guessing or throwing", () => {
    assert.equal(
      readNativeCapability(false, () => {
        throw new Error("must not run");
      }),
      NATIVE_CAPABILITY_UNAVAILABLE,
    );
    assert.equal(
      readNativeCapability(true, () => {
        throw new Error("native API unavailable");
      }),
      NATIVE_CAPABILITY_UNAVAILABLE,
    );
    assert.equal(readNativeCapability(true, () => 42), 42);
  });
});
