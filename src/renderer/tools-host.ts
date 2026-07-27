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
      onVisibilityChange?: (visible: boolean) => void;
    },
  ): ToolsAppHandle;
}>;

/**
 * Mounts the independently-built Vue application behind one renderer boundary.
 * The UI bundle knows nothing about Module, the canvas, Electron, or the
 * preload bridge. This host knows only how to load it and protect game input.
 */
export function installToolsHost({
  releaseHeldKeys,
}: {
  releaseHeldKeys: () => void;
}) {
  const root = document.createElement("div");
  root.id = "gwonmac-tools-root";
  document.body.append(root);

  let handle: ToolsAppHandle | null = null;
  let loading: Promise<ToolsAppHandle> | null = null;
  let visible = false;
  const canvas = () => document.getElementById("canvas") as HTMLElement | null;

  const ownsFocus = () =>
    document.activeElement instanceof Element
    && root.contains(document.activeElement);

  const protectGameInput = (event: Event) => {
    if (!visible || (!ownsFocus() && !root.contains(event.target as Node))) return;
    event.stopImmediatePropagation();
  };
  window.addEventListener("keydown", protectGameInput, true);
  window.addEventListener("keyup", protectGameInput, true);
  window.addEventListener("keypress", protectGameInput, true);
  root.addEventListener("focusin", releaseHeldKeys);
  root.addEventListener("pointerdown", releaseHeldKeys, true);

  const load = () => {
    if (handle) return Promise.resolve(handle);
    if (loading) return loading;
    const bundleUrl = "./tools/tools-app.js";
    loading = import(bundleUrl)
      .then((module: ToolsBundle) => {
        handle = module.mountToolsApp(root, {
          initiallyVisible: false,
          onVisibilityChange(next) {
            visible = next;
            if (!next) {
              canvas()?.focus();
            }
          },
        });
        return handle;
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  };

  const toggle = () => {
    releaseHeldKeys();
    void load().then((app) => app.toggle());
  };
  window.addEventListener("gw:tools-toggle", toggle);

  return () => {
    window.removeEventListener("gw:tools-toggle", toggle);
    window.removeEventListener("keydown", protectGameInput, true);
    window.removeEventListener("keyup", protectGameInput, true);
    window.removeEventListener("keypress", protectGameInput, true);
    handle?.dispose();
    root.remove();
  };
}
