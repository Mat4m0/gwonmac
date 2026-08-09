import { describe, expect, it, vi } from "vitest";
import { installResizeGrip } from "../../../src/shared/ui/resize";

describe("shared window resize grip", () => {
  it("resizes by keyboard inside the owner-provided bounds", () => {
    const handle = document.createElement("button");
    let size = { width: 500, height: 400 };
    const resize = vi.fn((width: number, height: number) => { size = { width, height }; });
    const dispose = installResizeGrip(handle, {
      size: () => size,
      limits: () => ({ minWidth: 320, minHeight: 360, maxWidth: 520, maxHeight: 600 }),
      resize,
    });

    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(resize).toHaveBeenLastCalledWith(516, 400);
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true }));
    expect(resize).toHaveBeenLastCalledWith(520, 400);
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", shiftKey: true }));
    expect(resize).toHaveBeenLastCalledWith(520, 360);

    dispose();
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(resize).toHaveBeenCalledTimes(3);
  });
});
