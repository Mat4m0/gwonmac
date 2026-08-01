/**
 * The Enhancement registry reaches the renderer through gwNative.init. This module
 * owns only the Settings-pane surface and the words it needs; it is not a
 * general settings framework. The first-run gate deliberately carries no tool
 * checkboxes: the defaults are right for a first launch, and Settings is where
 * a player who has formed an opinion changes them.
 *
 * index.html loads this as a classic script, so the file carries no top-level
 * import or export and names the contracts through type-only `import(…)`.
 */

(function () {
  type AppSettings = import('../shared/contracts.js').AppSettings;
  type AppSettingsPatch = import('../shared/contracts.js').AppSettingsPatch;
  type Enhancement = import('../shared/contracts.js').Enhancement;
  // The options are named once, in the ambient declaration of the global this
  // module defines. Restating them here would be a second source of truth for
  // the shape settings.ts already has to satisfy.
  type ToolSettingsOptions = Parameters<Window['gwEnhancementSettings']['create']>[0];

  const PRESENTATION = Object.freeze({
    nativeCursor: Object.freeze({ noun: 'cursor' }),
  });

  function createEnhancementSettings(options: ToolSettingsOptions) {
    // `EnhancementSelection` is `Record<Enhancement, boolean>`, so its keys are the
    // registry — but `Object.keys` answers `string[]` for every object. The
    // check below is what makes the assertion honest: it fails unless the keys
    // are exactly the ones PRESENTATION knows.
    const names = Object.keys(options.selection) as Enhancement[];
    if (
      names.length !== Object.keys(PRESENTATION).length ||
      names.some((name) => !PRESENTATION[name])
    ) {
      throw new Error('Enhancement settings presentation does not match the registry');
    }

    const controls = names.map((name) => {
      const presentation = PRESENTATION[name];
      const settings = options.form.elements.namedItem(name);
      if (!(settings instanceof globalThis.HTMLInputElement)) {
        throw new Error(`missing Enhancement settings control: ${name}`);
      }
      return {
        name,
        noun: presentation.noun,
        settings,
      };
    });
    const byName = new Map(controls.map((control) => [control.name, control]));

    function render(settings: AppSettings) {
      for (const control of controls) {
        control.settings.checked = settings[control.name];
      }
    }

    function patchFor(
      control: HTMLInputElement | HTMLSelectElement,
    ): AppSettingsPatch | null {
      const tool = byName.get(control.name as Enhancement);
      return tool && control instanceof globalThis.HTMLInputElement
        ? { [tool.name]: control.checked }
        : null;
    }

    function resultFor(
      control: HTMLInputElement | HTMLSelectElement,
      patch: AppSettingsPatch,
      saved: AppSettings,
    ) {
      const tool = byName.get(control.name as Enhancement);
      if (!tool) return null;
      const applied = saved[tool.name] === patch[tool.name];
      return {
        applied,
        text: applied
          ? `Saved. Restarting to apply the ${tool.noun}…`
          : `The ${tool.noun} was not changed.`,
      };
    }

    return Object.freeze({ patchFor, render, resultFor });
  }

  Object.defineProperty(window, 'gwEnhancementSettings', {
    value: Object.freeze({ create: createEnhancementSettings }),
  });
})();
