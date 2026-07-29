import type { Session } from "electron";
import { isCanonicalRendererUrl } from "./core/renderer-trust.js";
import type { WindowRegistry } from "./window-registry.js";

const installedSessions = new WeakSet<Session>();

export function installGameSession(
  target: Session,
  windows: WindowRegistry,
  handleRequest: (request: Request) => Response | Promise<Response>,
): void {
  if (installedSessions.has(target)) {
    throw new Error("game session already installed");
  }
  installedSessions.add(target);
  target.protocol.handle("gw", handleRequest);

  const mayLockPointer = (
    webContents: Electron.WebContents | null,
    permission: string,
    isMainFrame: boolean,
  ): boolean => {
    if (!webContents || permission !== "pointerLock" || !isMainFrame) {
      return false;
    }
    const context = windows.contextFor(webContents);
    return (
      context?.kind === "game"
      && context.window.webContents === webContents
      && isCanonicalRendererUrl(webContents.getURL())
    );
  };
  target.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(mayLockPointer(webContents, permission, details.isMainFrame));
    },
  );
  target.setPermissionCheckHandler(
    (webContents, permission, _origin, details) =>
      mayLockPointer(webContents, permission, details.isMainFrame),
  );
  target.on("will-download", (event) => {
    event.preventDefault();
  });
}
