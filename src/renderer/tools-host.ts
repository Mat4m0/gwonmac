/**
 * Loads the independently-built Tools application and mounts it inside the
 * Toolbox overlay.
 *
 * This module is deliberately thin. The overlay already owns the boundary —
 * the toggle chord, the event stops, pointer-lock release, the cursor mirror,
 * drag, focus transfer and teardown — so a tool needs none of that again. An
 * earlier version of this file created its own root element beside the canvas
 * and re-implemented the input protection; two boundaries around one panel is
 * how a held movement key ends up stuck when only one of them is torn down.
 *
 * What is left is the two things the Vue bundle genuinely cannot know: where a
 * build is written so Guild Wars can load it, and whether a team may be applied
 * to the running game.
 */
import type {
  TeamApplyPlan,
  TeamApplyResult,
} from "../shared/builds/team-apply.js";
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
  dispose(): void;
}>;

type ToolsBundle = Readonly<{
  mountToolsApp(
    target: HTMLElement,
    options: {
      initiallyVisible?: boolean;
      publishTemplate(template: PublishableTemplate): Promise<PublishedTemplate>;
      applyTeam(plan: TeamApplyPlan): Promise<TeamApplyResult>;
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
 * Applying a team means commanding the running game, and no command gateway is
 * certified for this client. Saying so as a refusal, here, is deliberate: the
 * alternative an earlier version shipped was a resolved promise reporting zero
 * completed changes, which is indistinguishable in the interface from a team
 * that applied and did nothing.
 */
function applyTeam(): Promise<TeamApplyResult> {
  return Promise.reject(
    new Error(
      "Applying a team to the running game is not available yet. Publish the "
      + "builds as templates and load them in Guild Wars.",
    ),
  );
}

/**
 * The stylesheets the panel needs, loaded with it rather than with the page.
 *
 * They used to be linked from index.html, which meant every launch parsed
 * 1,300 lines of design system whether or not Tools was ever opened -- and put
 * them in the document of a player who had not asked for the panel at all. The
 * bundle's own CSS is emitted by vite in library mode, which does not inject
 * it, so it is listed here beside the two it depends on.
 */
const STYLESHEETS = [
  "ui/tokens.css",
  "ui/components.css",
  "tools/tools-app.css",
];

let stylesheetsLinked = false;

function linkStylesheets(document: Document): void {
  if (stylesheetsLinked) return;
  stylesheetsLinked = true;
  for (const href of STYLESHEETS) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.append(link);
  }
}

/**
 * Mounts the bundle into the overlay's content region. Called on the overlay's
 * first open, so a player who never opens Tools never loads it.
 */
export function mountToolsInto(content: HTMLElement): void {
  linkStylesheets(content.ownerDocument);
  // A build artifact, not a source module: vite writes it beside this emit at
  // package time. The specifier goes through a variable so the compiler does
  // not try to resolve a file that only exists after the build step.
  const specifier = "./tools/tools-app.js";
  void import(specifier)
    .then((bundle: ToolsBundle) => {
      bundle.mountToolsApp(content, {
        initiallyVisible: true,
        publishTemplate,
        applyTeam,
      });
    })
    .catch(() => {
      content.textContent = "Tools could not be loaded.";
    });
}
