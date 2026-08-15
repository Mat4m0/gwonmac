/**
 * Loads the independently-built Tools application and mounts it inside the
 * Toolbox overlay.
 *
 * This module is deliberately thin. The overlay already owns the boundary —
 * the toggle chord, the event stops, pointer-lock release, the cursor mirror,
 * focus transfer and teardown — so a tool needs none of that again. An earlier
 * version of this file created its own root element beside the canvas and
 * re-implemented the input protection; two boundaries around one panel is how
 * a held movement key ends up stuck when only one of them is torn down.
 *
 * The window furniture is the tool's own: it draws and drags its own window,
 * and reports back when it closes itself so the overlay does not go on
 * believing it is open.
 *
 * What is left is what the Vue bundle genuinely cannot reach on its
 * own: where a build is written so Guild Wars can load it, whether a team may be
 * applied to the running game, the named storage action, and the companion's
 * observation of that game — which passes straight through, unread. The bundle
 * owns what a party means.
 */
import type { ToolboxObservation } from "../shared/builds/live-party.js";
import type { TeamApplyCommands } from "../shared/builds/team-apply-runner.js";
import type { StorageCommand } from "../shared/storage-command.js";
import {
  createToolboxLifecycle,
  type MountedTool,
} from "./toolbox-foundation.js";
import {
  applyImport,
  planImport,
  templateFilesystem,
} from "./template-store.js";
import { sanitiseTemplateName } from "./template-format.js";

type PublishedTemplate = Readonly<{ fileName: string; location: string }>;

/** A build the bundle has already encoded. See apps/tools/src/host.ts. */
type PublishableTemplate = Readonly<{ name: string; code: string }>;

type ToolsAppHandle = Readonly<{
  show(): void;
  hide(): void;
  toggle(): void;
  requestClose(): void;
  update(observation: ToolboxObservation): void;
  dispose(): void;
}>;

type ToolsBundle = Readonly<{
  mountToolsApp(
    target: HTMLElement,
    options: {
      initiallyVisible?: boolean;
      onVisibilityChange?(visible: boolean): void;
      publishTemplate:
        | ((template: PublishableTemplate) => Promise<PublishedTemplate>)
        | null;
      commands: TeamApplyCommands | null;
      storage: StorageCommand | null;
      applyUnavailable: string | null;
      observationUnavailable: string | null;
      development: boolean;
    },
  ): ToolsAppHandle;
}>;

/**
 * Writes one build where the game's own template dialog will find it.
 *
 * The store decides everything before it writes, so a name already holding
 * this exact code is not a write and re-publishing is idempotent. The client
 * caches its template scan, which is why the returned location is worded for a
 * player who will have to press Refresh List before the build appears.
 */
async function publishTemplate(
  { name: raw, code }: PublishableTemplate,
): Promise<PublishedTemplate> {
  const fs = templateFilesystem();
  if (fs === null) {
    throw new Error("Guild Wars template storage is not available yet.");
  }
  const name = sanitiseTemplateName(raw);
  // The type root, never a subfolder: the client's scan does not descend, so a
  // template one level down is saved, exported, and listed by nothing in game.
  const candidate = { kind: "skills" as const, folder: null, name, code };
  const plan = planImport(fs, [candidate], "replace");
  if (plan.unsafe > 0) {
    throw new Error("That build name cannot be used as a file name.");
  }
  if (plan.full > 0) {
    throw new Error(
      "The Skills template folder is at the limit Guild Wars can list.",
    );
  }
  if (plan.writes.length > 0) await applyImport(fs, plan);
  return Object.freeze({
    fileName: `${name}.txt`,
    location: "Skills — press Refresh List in Guild Wars to see it",
  });
}

/**
 * Why applying a team cannot reach the running game, or `null` once it can.
 *
 * Applying means commanding the running game. A Core-only or developer module
 * has no command queue at all, so the panel must present that absence as a
 * refusal rather than as a successful Apply that made zero changes.
 *
 * It is a value rather than only a thrown message because the interface has to
 * say it *before* the click, not after. A button that looks ready and then
 * refuses has already cost the player the decision to press it — and it reads
 * as a bug in the panel rather than as a capability that does not exist yet.
 * One constant, so the disabled reason and the refusal cannot drift apart.
 */
const APPLY_UNAVAILABLE =
  "Apply team is unavailable after this Guild Wars update. Your saved team is unchanged.";

/**
 * Loads the Tools bundle and hands the overlay a handle to it.
 *
 * The application draws its own window against the viewport, so all it needs
 * from here is somewhere inside the overlay to attach — the overlay's root is
 * where the event stops and the cursor mirror already are.
 *
 * A failure is reported rather than swallowed. An empty panel that explains
 * nothing costs a debugging session; this one says what went wrong and leaves
 * the reason in the console.
 */
export function mountToolsInto(
  host: HTMLElement,
  onVisibilityChange: (visible: boolean) => void,
  /**
   * The certified commands, or `null` for a module derived without them.
   * Only the complete Tools profile carries a call to a packet builder, so
   * `null` is an absence in the bytes rather than a disabled JavaScript switch.
   *
   * Handed straight through. This module is a courier and does not learn what
   * a hero is — the sequence that turns a plan into commands lives beside the
   * domain it reasons about, in `src/shared/builds`, which this bundle cannot
   * import at run time and the Tools bundle compiles in.
   */
  commands: TeamApplyCommands | null,
  storage: StorageCommand | null,
  /** Whether this session's client can discover templates written to IDBFS. */
  templatePublishingAvailable: boolean,
): Promise<MountedTool | null> {
  // A build artifact, not a source module: vite writes it beside this emit at
  // package time. The specifier goes through a variable so the compiler does
  // not try to resolve a file that only exists after the build step.
  const specifier = "./tools/tools-app.js";
  return Promise.all([import(specifier), window.gwNative.client.session()])
    .then(([bundle, session]: [ToolsBundle, Awaited<ReturnType<typeof window.gwNative.client.session>>]) => {
      const applyStatus = session.compatibility?.features.teamApply;
      const applyUnavailable = commands === null
        ? applyStatus?.status === 'unavailable'
          ? applyStatus.reason === 'preparation-failed'
            ? 'Apply team didn’t start. Your saved team is unchanged. Restart GWonMac to try again.'
            : APPLY_UNAVAILABLE
          : 'Apply team is off. Your saved team is unchanged.'
        : null;
      const observationStatus = session.compatibility?.features.partyObservation;
      const observationUnavailable = observationStatus?.status === 'unavailable'
        ? observationStatus.reason === 'preparation-failed'
          ? 'Live game information didn’t start. Saved builds and teams still work. Restart GWonMac to try again.'
          : 'Live game information is temporarily unavailable. Saved builds and teams still work.'
        : null;
      const app = bundle.mountToolsApp(host, {
        initiallyVisible: false,
        onVisibilityChange,
        publishTemplate: templatePublishingAvailable ? publishTemplate : null,
        commands,
        storage,
        applyUnavailable,
        observationUnavailable,
        development: window.gwNative.init.development,
      });
      return {
        setVisible: (visible: boolean) => {
          if (visible) app.show();
          else app.hide();
        },
        requestClose: app.requestClose,
        update: app.update,
        dispose: app.dispose,
      };
    })
    .catch((cause: unknown) => {
      console.error("[tools] the Tools application failed to load", cause);
      host.textContent = "Tools could not be loaded — see the console.";
      return null;
    });
}

/**
 * Mounts the saved-library-only Tools experience for an official client that
 * has no usable companion. This module already owns the Tools bundle boundary,
 * so it also owns the matching settings listener and teardown; the Emscripten
 * bootstrap only decides when this fallback is needed.
 */
export function mountHostOnlyTools(
  parent: HTMLElement,
  templatePublishingAvailable: boolean,
): () => void {
  const lifecycle = createToolboxLifecycle(parent, {
    mountTool: (host, onVisibilityChange) =>
      mountToolsInto(
        host,
        onVisibilityChange,
        null,
        null,
        templatePublishingAvailable,
      ),
  });
  const syncEnabled = () => {
    const settings = window.gwToolsSettings();
    // The saved Build/Team library is the Tools surface. Apply team is only
    // one live-game action inside it, so turning Apply off must not remove the
    // library or its keyboard shortcut.
    lifecycle.setEnabled(settings.enabled);
  };
  window.addEventListener("gw:tools-settings", syncEnabled);
  syncEnabled();
  return () => {
    window.removeEventListener("gw:tools-settings", syncEnabled);
    lifecycle.dispose();
  };
}
