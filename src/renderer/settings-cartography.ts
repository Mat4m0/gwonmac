/**
 * Owns Settings bindings for map layers and the player-owned preset library.
 * Domain operations validate every edit before this module renders or persists it.
 */
import {
  CARTOGRAPHY_CUSTOM_PRESETS_MAX,
  decodeCartographyPreset, encodeCartographyPreset,
  type CartographyPresetLibrary,
} from "../shared/cartography-overlay.js";
import {
  addCartographyPreset,
  deleteCartographyPreset,
  renameCartographyPreset,
  replaceCartographyPresetStyle,
  resolveCartographyPresetEntry,
  selectCartographyPreset,
  uniqueCartographyPresetName,
} from "../shared/cartography-presets.js";
import type {
  AppSettings,
  RendererSettingsPatch,
} from "../shared/contracts.js";
import {
  parseCartographyPresetRef,
  renderCartographyPresetOptions,
} from "./cartography-preset-select.js";
import { createCartographyPresetEditor } from "./settings-cartography-editor.js";

type FeedbackTone = "neutral" | "progress" | "success" | "warning" | "error";
type PersistedKey = "cartographyPresetLibrary" | "cartographyGridOpacity"
  | "cartographyWalkabilityOpacity" | "cartographyControlIdleOpacity";

function freshPresetId(): string { return `preset-${crypto.randomUUID()}`; }

/** Keeps intermediate global Settings renders from replacing a newer local draft. */
export function createCartographyLibraryWriteGate() {
  let latestRevision = 0;
  const pending = new Set<number>();
  return Object.freeze({
    begin(): number {
      latestRevision += 1;
      pending.add(latestRevision);
      return latestRevision;
    },
    finish(revision: number): void { pending.delete(revision); },
    isLatest(revision: number): boolean { return revision === latestRevision; },
    acceptsCanonicalRender(): boolean { return pending.size === 0; },
  });
}

export function bindCartographySettings(options: Readonly<{
  form: HTMLFormElement;
  persist(patch: RendererSettingsPatch): Promise<AppSettings>;
  recoverAfterPersistFailure(message: string): Promise<AppSettings | null>;
  feedback(message: string, tone: FeedbackTone, resetAfter?: number): void;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  prompt?(message: string, initial: string): string | null;
  confirm?(message: string): boolean;
}>) {
  const query = <T extends Element>(selector: string): T => {
    const value = options.form.querySelector<T>(selector);
    if (value === null) throw new Error(`missing cartography control: ${selector}`);
    return value;
  };
  const byName = <T extends HTMLElement>(name: string): T => {
    const value = options.form.elements.namedItem(name);
    if (!(value instanceof HTMLElement)) throw new Error(`missing cartography control: ${name}`);
    return value as T;
  };
  const select = byName<HTMLSelectElement>("cartographyPresetSelection");
  const status = query<HTMLElement>("[data-cartography-status]");
  const note = query<HTMLElement>("[data-cartography-preset-note]");
  const customizer = query<HTMLElement>("[data-cartography-customizer]");
  const customizerTitle = query<HTMLElement>("#settings-cartography-customizer-title");
  const done = query<HTMLButtonElement>('[data-cartography-editor-action="done"]');
  const manage = query<HTMLDetailsElement>(".settings-cartography-manage");
  const actions = Object.fromEntries(
    [...options.form.querySelectorAll<HTMLButtonElement>("[data-cartography-preset-action]")]
      .map((button) => [button.dataset.cartographyPresetAction!, button]),
  ) as Record<
    "customize" | "rename" | "duplicate" | "delete" | "export" | "import",
    HTMLButtonElement
  >;
  const gridOpacity = byName<HTMLInputElement>("cartographyGridOpacity");
  const gridOpacityValue = byName<HTMLOutputElement>("cartographyGridOpacityValue");
  const walkabilityOpacity = byName<HTMLInputElement>("cartographyWalkabilityOpacity");
  const walkabilityOpacityValue = byName<HTMLOutputElement>("cartographyWalkabilityOpacityValue");
  const idleOpacity = byName<HTMLInputElement>("cartographyControlIdleOpacity");
  const idleOpacityValue = byName<HTMLOutputElement>("cartographyControlIdleOpacityValue");
  const ask = options.prompt ?? ((message, initial) => window.prompt(message, initial));
  const askConfirm = options.confirm ?? ((message) => window.confirm(message));
  let library: CartographyPresetLibrary | null = null;
  let persistRevision = 0;
  let editorOpen = false;
  const libraryWrites = createCartographyLibraryWriteGate();

  const announce = (message: string, tone: FeedbackTone = "neutral"): void => {
    status.textContent = message;
    status.dataset.tone = tone;
    options.feedback(message, tone, tone === "success" ? 2_200 : undefined);
  };
  const persist = async (
    patch: Partial<Pick<AppSettings, PersistedKey>>, failure: string,
  ): Promise<AppSettings | null> => {
    const revision = ++persistRevision;
    try {
      return await options.persist(patch);
    } catch {
      if (revision === persistRevision) await options.recoverAfterPersistFailure(failure);
      return null;
    }
  };
  const renderOptions = (): void => {
    if (library === null) return;
    renderCartographyPresetOptions(select, library);
  };
  const editor = createCartographyPresetEditor({
    form: options.form,
    change(style, commit) {
      if (library?.activePreset.kind !== "custom") return;
      const id = library.activePreset.id;
      const next = replaceCartographyPresetStyle(library, id, style);
      if (next === null) return;
      library = next;
      if (commit) void persistLibrary(
        { cartographyPresetLibrary: library }, "The custom Cartography style was not saved.",
      );
    },
  });
  const renderPreset = (): void => {
    if (library === null) return;
    renderOptions();
    const preset = resolveCartographyPresetEntry(library);
    if (preset === null) {
      announce("This Cartography style is no longer available.", "error");
      return;
    }
    const editable = preset.custom !== null;
    const full = library.customPresets.length >= CARTOGRAPHY_CUSTOM_PRESETS_MAX;
    actions.customize.textContent = editable ? "Edit style…" : "Customize style…";
    actions.customize.disabled = !editable && full;
    actions.rename.hidden = !editable;
    actions.duplicate.disabled = full;
    actions.delete.hidden = !editable;
    actions.import.disabled = full;
    note.textContent = full ? "Your style library is full. Delete a style before adding another."
      : editable
      ? "Your style is ready. Edit it at any time or share it from Manage styles."
      : "Built-in styles are ready to use. Customize one to make it yours.";
    if (!editable) editorOpen = false;
    customizer.hidden = !editable || !editorOpen;
    customizerTitle.textContent = `Edit ${preset.name}`;
    editor.render(preset.style);
  };
  const persistLibrary = async (
    patch: RendererSettingsPatch,
    failure: string,
    success?: string,
  ): Promise<void> => {
    const revision = libraryWrites.begin();
    try {
      const saved = await options.persist(patch);
      if (!libraryWrites.isLatest(revision)) return;
      library = saved.cartographyPresetLibrary;
      renderPreset();
      announce(success ?? "Style saved.", "success");
    } catch {
      if (!libraryWrites.isLatest(revision)) return;
      const recovered = await options.recoverAfterPersistFailure(failure);
      if (recovered !== null) {
        library = recovered.cartographyPresetLibrary;
        renderPreset();
      }
    } finally {
      libraryWrites.finish(revision);
    }
  };
  const replaceLibrary = (
    next: CartographyPresetLibrary | null,
    message?: string,
    patch?: RendererSettingsPatch,
  ): void => {
    if (next === null) {
      announce("That Cartography style change is not valid.", "error");
      return;
    }
    library = next;
    renderPreset();
    status.textContent = "Saving…";
    void persistLibrary(
      patch ?? { cartographyPresetLibrary: next },
      "The Cartography style was not saved.",
      message ?? "Style selected.",
    );
  };

  select.addEventListener("change", () => {
    if (library === null) return;
    const active = parseCartographyPresetRef(select.value, library);
    if (active !== null) {
      editorOpen = false;
      manage.open = false;
      replaceLibrary(
        selectCartographyPreset(library, active),
        "Style selected.",
        { cartographyPresetSelection: active },
      );
    }
  });
  actions.customize.addEventListener("click", () => {
    if (library === null) return;
    const source = resolveCartographyPresetEntry(library);
    if (source === null) return;
    editorOpen = true;
    if (source.custom !== null) {
      renderPreset();
      customizer.scrollIntoView({ block: "nearest" });
      return;
    }
    const name = uniqueCartographyPresetName(`${source.name} custom`, library);
    if (name === null) {
      editorOpen = false;
      announce("Your style library is full. Delete a style before adding another.", "warning");
      return;
    }
    replaceLibrary(addCartographyPreset(library, {
      id: freshPresetId(), name, style: source.style,
    }), "Custom style created.");
    customizer.scrollIntoView({ block: "nearest" });
  });
  done.addEventListener("click", () => {
    editorOpen = false;
    customizer.hidden = true;
    actions.customize.focus();
  });
  actions.duplicate.addEventListener("click", () => {
    if (library === null) return;
    const source = resolveCartographyPresetEntry(library);
    if (source === null) return;
    const name = uniqueCartographyPresetName(`${source.name} copy`, library);
    if (name === null) {
      announce("Your style library is full. Delete a style before adding another.", "warning");
      return;
    }
    replaceLibrary(addCartographyPreset(library, {
      id: freshPresetId(),
      name,
      style: source.style,
    }), "Style duplicated.");
  });
  actions.rename.addEventListener("click", () => {
    if (library?.activePreset.kind !== "custom") return;
    const source = resolveCartographyPresetEntry(library)?.custom ?? null;
    if (source === null) return;
    const entered = ask("Rename style", source.name);
    if (entered === null || entered.trim() === source.name) return;
    replaceLibrary(renameCartographyPreset(library, source.id, entered), "Style renamed.");
  });
  actions.delete.addEventListener("click", () => {
    if (library?.activePreset.kind !== "custom") return;
    const source = resolveCartographyPresetEntry(library)?.custom ?? null;
    if (source === null || !askConfirm(`Delete “${source.name}”? This cannot be undone.`)) return;
    replaceLibrary(
      deleteCartographyPreset(library, source.id),
      "Style deleted. Cartographer is now active.",
    );
  });
  actions.export.addEventListener("click", async () => {
    if (library === null) return;
    const preset = resolveCartographyPresetEntry(library);
    if (preset === null) return;
    try {
      await options.writeClipboard(encodeCartographyPreset(preset));
      announce("Style copied to the clipboard.", "success");
    } catch { announce("The style could not be copied.", "error"); }
  });
  actions.import.addEventListener("click", async () => {
    if (library === null) return;
    try {
      const decoded = decodeCartographyPreset(await options.readClipboard());
      if (decoded === null) {
        announce("The clipboard does not contain a valid GWonMac Cartography style.", "error");
        return;
      }
      if (!askConfirm(`Import “${decoded.name}” as a new Cartography style?`)) {
        announce("Import canceled.");
        return;
      }
      replaceLibrary(addCartographyPreset(library, {
        id: freshPresetId(), name: decoded.name, style: decoded.style,
      }), "Style imported.");
    } catch { announce("The style could not be imported.", "error"); }
  });

  const bindOpacity = (
    input: HTMLInputElement, output: HTMLOutputElement,
    key: "cartographyGridOpacity" | "cartographyWalkabilityOpacity" | "cartographyControlIdleOpacity",
    failure: string,
  ): void => {
    input.addEventListener("input", () => {
      output.value = `${input.value}%`;
    });
    input.addEventListener("change", () => void persist({ [key]: Number(input.value) }, failure));
  };
  bindOpacity(gridOpacity, gridOpacityValue, "cartographyGridOpacity", "The grid opacity was not saved.");
  bindOpacity(walkabilityOpacity, walkabilityOpacityValue, "cartographyWalkabilityOpacity", "The walkability opacity was not saved.");
  bindOpacity(idleOpacity, idleOpacityValue, "cartographyControlIdleOpacity", "The control visibility was not saved.");

  return Object.freeze({
    render(settings: AppSettings) {
      if (libraryWrites.acceptsCanonicalRender()) {
        library = settings.cartographyPresetLibrary;
      }
      gridOpacity.value = String(settings.cartographyGridOpacity);
      gridOpacityValue.value = `${settings.cartographyGridOpacity}%`;
      walkabilityOpacity.value = String(settings.cartographyWalkabilityOpacity);
      walkabilityOpacityValue.value = `${settings.cartographyWalkabilityOpacity}%`;
      idleOpacity.value = String(settings.cartographyControlIdleOpacity);
      idleOpacityValue.value = `${settings.cartographyControlIdleOpacity}%`;
      renderPreset();
    },
  });
}
