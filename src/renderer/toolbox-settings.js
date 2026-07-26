// The Toolbox registry reaches the renderer through gwNative.init. This module
// owns only the two settings surfaces and the words they need; it is not a
// general settings framework.

(function () {
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

  /**
   * @param {{
   *   form: HTMLFormElement,
   *   byId: (id: string) => HTMLElement,
   *   selection: import('../shared/contracts.js').ToolboxSelection,
   *   persist: (
   *     patch: import('../shared/contracts.js').AppSettingsPatch,
   *   ) => Promise<import('../shared/contracts.js').AppSettings>,
   *   current: () => import('../shared/contracts.js').AppSettings | null,
   * }} options
   */
  function createToolSettings(options) {
    const names =
      /** @type {import('../shared/contracts.js').ToolboxTool[]} */ (
        Object.keys(options.selection)
      );
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

    /** @param {import('../shared/contracts.js').AppSettings} settings */
    function render(settings) {
      for (const control of controls) {
        control.settings.checked = settings[control.name];
        control.launcher.checked = settings[control.name];
      }
    }

    /**
     * @param {HTMLInputElement | HTMLSelectElement} control
     * @returns {import('../shared/contracts.js').AppSettingsPatch | null}
     */
    function patchFor(control) {
      const tool = byName.get(
        /** @type {import('../shared/contracts.js').ToolboxTool} */ (
          control.name
        ),
      );
      return tool && control instanceof globalThis.HTMLInputElement
        ? { [tool.name]: control.checked }
        : null;
    }

    /**
     * @param {HTMLInputElement | HTMLSelectElement} control
     * @param {import('../shared/contracts.js').AppSettingsPatch} patch
     * @param {import('../shared/contracts.js').AppSettings} saved
     */
    function resultFor(control, patch, saved) {
      const tool = byName.get(
        /** @type {import('../shared/contracts.js').ToolboxTool} */ (
          control.name
        ),
      );
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
