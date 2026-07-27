// The Toolbox registry reaches the renderer through gwNative.init. This module
// owns only the two settings surfaces and the words they need; it is not a
// general settings framework.
//
// index.html loads this as a classic script, so the file carries no top-level
// import or export and names the contracts through type-only `import(…)`.

(function () {
  type AppSettings = import('../shared/contracts.js').AppSettings;
  type AppSettingsPatch = import('../shared/contracts.js').AppSettingsPatch;
  type ToolboxTool = import('../shared/contracts.js').ToolboxTool;
  // The options are named once, in the ambient declaration of the global this
  // module defines. Restating them here would be a second source of truth for
  // the shape settings.ts already has to satisfy.
  type ToolSettingsOptions = Parameters<Window['gwToolSettings']['create']>[0];

  const PRESENTATION = Object.freeze({
    nativeCursor: Object.freeze({
      launcherId: 'data-choice-native-cursor',
      noteId: 'data-choice-native-cursor-note',
      noun: 'cursor',
    }),
    targetReadout: Object.freeze({
      launcherId: 'data-choice-target-readout',
      noteId: 'data-choice-target-readout-note',
      noun: 'target readout',
    }),
  });

  function createToolSettings(options: ToolSettingsOptions) {
    // `ToolboxSelection` is `Record<ToolboxTool, boolean>`, so its keys are the
    // registry — but `Object.keys` answers `string[]` for every object. The
    // check below is what makes the assertion honest: it fails unless the keys
    // are exactly the ones PRESENTATION knows.
    const names = Object.keys(options.selection) as ToolboxTool[];
    if (
      names.length !== Object.keys(PRESENTATION).length ||
      names.some((name) => !PRESENTATION[name])
    ) {
      throw new Error('Toolbox settings presentation does not match the registry');
    }

    const controls = names.map((name) => {
      const presentation = PRESENTATION[name];
      const settings = options.form.elements.namedItem(name);
      const launcher = options.byId(presentation.launcherId);
      if (
        !(settings instanceof globalThis.HTMLInputElement) ||
        !(launcher instanceof globalThis.HTMLInputElement)
      ) {
        throw new Error(`missing Toolbox settings control: ${name}`);
      }
      return {
        name,
        noun: presentation.noun,
        settings,
        launcher,
        note: options.byId(presentation.noteId),
      };
    });
    const byName = new Map(controls.map((control) => [control.name, control]));

    function render(settings: AppSettings) {
      for (const control of controls) {
        control.settings.checked = settings[control.name];
        control.launcher.checked = settings[control.name];
      }
    }

    function patchFor(
      control: HTMLInputElement | HTMLSelectElement,
    ): AppSettingsPatch | null {
      const tool = byName.get(control.name as ToolboxTool);
      return tool && control instanceof globalThis.HTMLInputElement
        ? { [tool.name]: control.checked }
        : null;
    }

    function resultFor(
      control: HTMLInputElement | HTMLSelectElement,
      patch: AppSettingsPatch,
      saved: AppSettings,
    ) {
      const tool = byName.get(control.name as ToolboxTool);
      if (!tool) return null;
      const applied = saved[tool.name] === patch[tool.name];
      return {
        applied,
        text: applied
          ? `Saved. Restarting to apply the ${tool.noun}…`
          : `The ${tool.noun} was not changed.`,
      };
    }

    for (const control of controls) {
      control.launcher.addEventListener('change', () => {
        const wanted = control.launcher.checked;
        control.note.hidden = true;
        void options.persist({ [control.name]: wanted })
          .then((saved) => {
            // A successful change is already relaunching. Only a declined
            // restart needs a sentence on the launcher.
            if (saved[control.name] === wanted) return;
            control.note.textContent = `The ${control.noun} was not changed.`;
            control.note.hidden = false;
          })
          .catch(() => {
            const current = options.current();
            if (current) render(current);
            control.note.textContent =
              `The ${control.noun} could not be changed.`;
            control.note.hidden = false;
          });
      });
    }

    return Object.freeze({ patchFor, render, resultFor });
  }

  Object.defineProperty(window, 'gwToolSettings', {
    value: Object.freeze({ create: createToolSettings }),
  });
})();
