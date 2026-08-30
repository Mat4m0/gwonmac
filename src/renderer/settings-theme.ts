/**
 * Owns the Settings theme editor: tab navigation, live palette preview,
 * activation, versioned sharing, and validated import.
 */
import type {
  AppSettings,
  RendererSettingsPatch,
} from "../shared/contracts.js";
import {
  decodeCustomUiTheme,
  defaultCustomUiTheme,
  encodeCustomUiTheme,
  normaliseCustomUiTheme,
  normaliseUiThemeColor,
  UI_THEME_COLOR_FIELDS,
  type CustomUiTheme,
  type UiThemeColorField,
} from "../shared/ui-theme.js";
import { applyAppearance } from "./appearance.js";

type FeedbackTone = "neutral" | "progress" | "success" | "warning" | "error";

export interface ThemeSettingsDependencies {
  form: HTMLFormElement;
  settings: () => AppSettings | null;
  persist: (patch: RendererSettingsPatch) => Promise<AppSettings>;
  recoverAfterPersistFailure: (message: string) => Promise<void>;
  feedback: (message: string, tone: FeedbackTone, resetAfter?: number) => void;
  copy: (text: string) => Promise<void>;
}

export function bindThemeSettings(deps: ThemeSettingsDependencies) {
  const tabs = [...deps.form.querySelectorAll<HTMLButtonElement>(".settings-theme-tab")];
  const panels = [...deps.form.querySelectorAll<HTMLElement>(".settings-theme-panel")];
  const useCustom = document.getElementById("settings-theme-use-custom") as HTMLButtonElement;
  const share = document.getElementById("settings-theme-share") as HTMLButtonElement;
  const openImport = document.getElementById("settings-theme-import") as HTMLButtonElement;
  const importDialog = document.getElementById("settings-theme-import-dialog") as HTMLDialogElement;
  const importValue = document.getElementById("settings-theme-import-value") as HTMLTextAreaElement;
  const importError = document.getElementById("settings-theme-import-error") as HTMLElement;
  const importApply = document.getElementById("settings-theme-import-apply") as HTMLButtonElement;
  const gradient = deps.form.elements.namedItem("uiThemeWindowGradient") as HTMLInputElement;
  const material = deps.form.elements.namedItem("uiThemeMaterial") as HTMLSelectElement;
  const reset = document.getElementById("settings-theme-reset") as HTMLButtonElement;
  const settingsDialog = deps.form.closest("dialog");
  let importModal: GwonmacDialogHandle | null = null;
  const themeImportModal = () => importModal ??= window.gwSurfaces.registerDialog({
    root: importDialog,
    priority: 6,
    dismiss: () => importModal?.close(),
    restoreFocus: () => openImport,
  });
  let selectedTab = "settings-theme-tab-builtins";
  let rendered = false;

  settingsDialog?.addEventListener("close", () => {
    importModal?.close();
    const settings = deps.settings();
    if (settings) applyAppearance(settings);
  });

  const colorInput = (key: UiThemeColorField) =>
    deps.form.querySelector<HTMLInputElement>(`[data-theme-color="${key}"]`)!;
  const hexInput = (key: UiThemeColorField) =>
    deps.form.querySelector<HTMLInputElement>(`[data-theme-hex="${key}"]`)!;

  function selectTab(id: string, focus = false): void {
    selectedTab = id;
    for (const tab of tabs) {
      const selected = tab.id === id;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    for (const panel of panels) {
      panel.hidden = panel.getAttribute("aria-labelledby") !== id;
    }
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => selectTab(tab.id));
  }
  tabs[0]?.parentElement?.addEventListener("keydown", (event) => {
    const activeIndex = tabs.findIndex((tab) => tab === document.activeElement);
    if (activeIndex < 0) return;
    let next: number;
    if (event.key === "ArrowRight") next = (activeIndex + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (activeIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    selectTab(tabs[next]!.id, true);
  });

  function draftTheme(): CustomUiTheme | null {
    return normaliseCustomUiTheme({
      material: material.value === "modern" ? "modern" : "classic",
      ...Object.fromEntries(UI_THEME_COLOR_FIELDS.map((key) => [
        key,
        hexInput(key).value,
      ])),
      windowGradient: gradient.checked,
    });
  }

  function preview(theme: CustomUiTheme): void {
    const settings = deps.settings();
    if (settings) applyAppearance({ ...settings, uiStyle: "custom", uiCustomTheme: theme });
  }

  function writeThemeFields(theme: CustomUiTheme): void {
    material.value = theme.material;
    for (const key of UI_THEME_COLOR_FIELDS) {
      colorInput(key).value = theme[key];
      hexInput(key).value = theme[key];
      hexInput(key).removeAttribute("aria-invalid");
    }
    gradient.checked = theme.windowGradient;
    const materialName = theme.material === "modern" ? "Modern flat" : "Classic Guild Wars";
    const label = `Reset custom theme to ${materialName} defaults`;
    reset.setAttribute("aria-label", label);
    reset.title = label;
  }

  async function commit(theme: CustomUiTheme): Promise<void> {
    deps.feedback("Saving…", "progress");
    try {
      await deps.persist({ uiStyle: "custom", uiCustomTheme: theme });
      deps.feedback("Custom theme saved.", "success", 2200);
    } catch {
      await deps.recoverAfterPersistFailure(
        "The custom theme could not be saved. The last confirmed theme is active.",
      );
    }
  }

  for (const key of UI_THEME_COLOR_FIELDS) {
    const picker = colorInput(key);
    const hex = hexInput(key);
    picker.addEventListener("input", () => {
      hex.value = picker.value.toUpperCase();
      hex.removeAttribute("aria-invalid");
      const theme = draftTheme();
      if (theme) preview(theme);
    });
    picker.addEventListener("change", () => {
      const theme = draftTheme();
      if (theme) void commit(theme);
    });
    hex.addEventListener("input", () => {
      const colour = normaliseUiThemeColor(hex.value);
      hex.setAttribute("aria-invalid", String(colour === null));
      if (!colour) return;
      picker.value = colour;
      const theme = draftTheme();
      if (theme) preview(theme);
    });
    hex.addEventListener("change", () => {
      const colour = normaliseUiThemeColor(hex.value);
      if (!colour) {
        hex.focus();
        deps.feedback("Enter a six-digit hex colour such as #E6C882.", "error");
        return;
      }
      hex.value = colour;
      hex.removeAttribute("aria-invalid");
      picker.value = colour;
      const theme = draftTheme();
      if (theme) void commit(theme);
    });
  }

  gradient.addEventListener("change", () => {
    const theme = draftTheme();
    if (theme) {
      preview(theme);
      void commit(theme);
    }
  });
  material.addEventListener("change", () => {
    const theme = draftTheme();
    if (theme) {
      preview(theme);
      void commit(theme);
    }
    const materialName = material.value === "modern" ? "Modern flat" : "Classic Guild Wars";
    const label = `Reset custom theme to ${materialName} defaults`;
    reset.setAttribute("aria-label", label);
    reset.title = label;
  });
  reset.addEventListener("click", () => {
    const theme = defaultCustomUiTheme(material.value === "modern" ? "modern" : "classic");
    writeThemeFields(theme);
    preview(theme);
    void commit(theme);
  });

  useCustom.addEventListener("click", () => {
    deps.feedback("Saving…", "progress");
    void deps.persist({ uiStyle: "custom" })
      .then(() => deps.feedback("Custom theme is active.", "success", 2200))
      .catch(() => deps.recoverAfterPersistFailure(
        "The custom theme could not be activated. The last confirmed theme is active.",
      ));
  });

  share.addEventListener("click", () => {
    const theme = draftTheme();
    if (!theme) {
      deps.feedback("Fix the invalid colour before sharing this theme.", "error");
      return;
    }
    void deps.copy(encodeCustomUiTheme(theme))
      .then(() => deps.feedback("Theme copied.", "success", 2200))
      .catch(() => deps.feedback("The theme could not be copied.", "error"));
  });

  openImport.addEventListener("click", () => {
    importValue.value = "";
    importValue.removeAttribute("aria-invalid");
    importError.textContent = "";
    importError.hidden = true;
    themeImportModal().show();
    importValue.focus();
  });

  importApply.addEventListener("click", () => {
    const theme = decodeCustomUiTheme(importValue.value);
    if (!theme) {
      importError.textContent = "This is not a valid GWonMac v1 theme string.";
      importError.hidden = false;
      importValue.setAttribute("aria-invalid", "true");
      importValue.focus();
      return;
    }
    importError.hidden = true;
    importValue.removeAttribute("aria-invalid");
    deps.feedback("Importing theme…", "progress");
    void deps.persist({ uiStyle: "custom", uiCustomTheme: theme })
      .then(() => {
        importModal?.close();
        selectTab("settings-theme-tab-custom");
        deps.feedback("Theme imported and activated.", "success", 3000);
      })
      .catch(() => deps.recoverAfterPersistFailure(
        "The imported theme could not be saved. The last confirmed theme is active.",
      ));
  });

  return {
    render(settings: AppSettings): void {
      writeThemeFields(settings.uiCustomTheme);
      useCustom.hidden = settings.uiStyle === "custom";
      if (!rendered && settings.uiStyle === "custom") {
        selectedTab = "settings-theme-tab-custom";
      }
      rendered = true;
      selectTab(selectedTab);
    },
  };
}
