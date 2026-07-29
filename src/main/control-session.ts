import type { Session } from "electron";
import { isCanonicalControlRendererUrl } from "./core/renderer-trust.js";

const installedSessions = new WeakSet<Session>();

export function installControlSession(
  target: Session,
  handleRequest: (request: Request) => Response | Promise<Response>,
): void {
  if (installedSessions.has(target)) {
    throw new Error("control session already installed");
  }
  installedSessions.add(target);
  target.protocol.handle("gw", handleRequest);
  target.webRequest.onBeforeRequest((details, callback) => {
    callback({
      cancel:
        details.resourceType === "mainFrame"
        && !isCanonicalControlRendererUrl(details.url),
    });
  });
  target.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  target.setPermissionCheckHandler(() => false);
  target.on("will-download", (event) => event.preventDefault());
}
