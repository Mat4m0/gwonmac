import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LauncherNativeApi } from "@shared/launcher-contracts";
import type { TexturePackSnapshot } from "@shared/texture-packs";
import TexturePacksSettings from "./TexturePacksSettings.vue";

const pack = {
  id: "0123456789abcdef0123456789abcdef",
  name: "Minimalus UI",
  sourceBytes: 6_291_456,
  compiledBytes: 12_582_912,
  mappings: 181,
  importedAt: "2026-09-02T10:00:00.000Z",
  sourceSha256: "a".repeat(64),
  status: "ready" as const,
};

const snapshot: TexturePackSnapshot = { selectedPackId: null, packs: [pack] };

function installTexturePackNative(texturePacks: LauncherNativeApi["texturePacks"]): void {
  Object.defineProperty(window, "launcherNative", {
    configurable: true,
    value: { texturePacks } as LauncherNativeApi,
  });
}

afterEach(() => {
  Object.defineProperty(window, "launcherNative", { configurable: true, value: undefined });
});

describe("texture pack settings", () => {
  it("imports without activating and focuses an exact duplicate", async () => {
    const select = vi.fn(async () => undefined);
    installTexturePackNative({
      import: vi.fn(async () => ({ status: "duplicate", packId: pack.id } as const)),
      select,
      remove: vi.fn(async () => undefined),
    });
    const wrapper = mount(TexturePacksSettings, { props: { texturePacks: snapshot }, attachTo: document.body });

    await wrapper.get(".settings-heading-row button").trigger("click");
    await flushPromises();

    expect(wrapper.get('[role="status"]').text()).toBe("This texture pack is already in your list.");
    expect(document.activeElement?.id).toBe(`texture-pack-${pack.id}`);
    expect(select).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("explains the flow without developer terminology", () => {
    installTexturePackNative({
      import: vi.fn(async () => ({ status: "cancelled" } as const)),
      select: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    });
    const wrapper = mount(TexturePacksSettings, { props: { texturePacks: snapshot } });

    expect(wrapper.get(".settings-heading-row").text()).toContain("Add a .tpf file you downloaded");
    expect(wrapper.get(".settings-heading-row button").text()).toBe("Add .tpf file");
    expect(wrapper.text()).not.toContain("SHA-256");
    expect(wrapper.text()).not.toContain("mapping file");
  });

  it("selects a pack and removes it through the narrow launcher bridge", async () => {
    const select = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    installTexturePackNative({
      import: vi.fn(async () => ({ status: "cancelled" } as const)),
      select,
      remove,
    });
    const wrapper = mount(TexturePacksSettings, { props: { texturePacks: snapshot } });

    await wrapper.findAll('input[type="radio"]')[1]!.trigger("change");
    await flushPromises();
    expect(select).toHaveBeenCalledWith(pack.id);

    await wrapper.get(`button[aria-label="Remove ${pack.name}"]`).trigger("click");
    await flushPromises();
    expect(remove).toHaveBeenCalledWith(pack.id);
  });
});
