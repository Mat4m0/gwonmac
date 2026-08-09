import { shallowRef, type Ref, type ShallowRef } from "vue";
import { buildId, teamId } from "../../../src/shared/builds/library";
import type { ToolsHost } from "./host";
import { cloneLibrary, type BuildLibrary, type LibraryItem } from "./model";

type StoreContext = Readonly<{
  host: ToolsHost;
  library: ShallowRef<BuildLibrary | null>;
  saving: Ref<boolean>;
  kind: Ref<LibraryItem["kind"]>;
  selectedId: Ref<string>;
  notice(message: string, tone?: "success" | "warning" | "error"): void;
}>;

type UndoEntry = Readonly<{
  label: string;
  library: BuildLibrary;
  selection: LibraryItem;
}>;

/** The only renderer-side transaction boundary for durable library changes. */
export function createLibraryStore(context: StoreContext) {
  const undoStack = shallowRef<readonly UndoEntry[]>([]);

  const commit = async (
    label: string,
    change: (current: BuildLibrary) => BuildLibrary,
  ): Promise<boolean> => {
    if (!context.library.value || context.saving.value) return false;
    const previous = cloneLibrary(context.library.value);
    const previousSelection: LibraryItem = context.kind.value === "build"
      ? { kind: "build", id: buildId(context.selectedId.value) }
      : { kind: "team", id: teamId(context.selectedId.value) };
    const candidate = change(previous);
    if (candidate === previous) return false;

    context.saving.value = true;
    try {
      const stored = await context.host.saveLibrary(candidate);
      context.library.value = stored;
      undoStack.value = [
        ...undoStack.value,
        { label, library: previous, selection: previousSelection },
      ].slice(-40);
      context.notice(label);
      return true;
    } catch (cause) {
      console.error("[tools] the library transaction could not be saved", cause);
      context.notice("Nothing changed—the save failed.", "error");
      return false;
    } finally {
      context.saving.value = false;
    }
  };

  const undo = async (): Promise<boolean> => {
    if (context.saving.value) return false;
    const previous = undoStack.value.at(-1);
    if (!previous) return false;
    context.saving.value = true;
    try {
      const stored = await context.host.saveLibrary(previous.library);
      context.library.value = stored;
      context.kind.value = previous.selection.kind;
      context.selectedId.value = previous.selection.id;
      undoStack.value = undoStack.value.slice(0, -1);
      context.notice(`Undid “${previous.label}”.`);
      return true;
    } catch {
      context.notice("Undo failed. Nothing changed.", "error");
      return false;
    } finally {
      context.saving.value = false;
    }
  };

  return { commit, undo, undoStack } as const;
}
