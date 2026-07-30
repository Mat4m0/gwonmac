import { app, BrowserWindow } from "electron";
import {
  verifyClientLocally,
} from "../../../../build/main/local-client-verifier-host.js";

const [officialWasmPath, cachePath, officialSha256] = process.argv.slice(-3);
if (!officialWasmPath || !cachePath || !officialSha256) {
  throw new Error("local verifier fixture requires wasm, cache, and hash");
}

const state = /** @type {{ localVerifierOutcome?: unknown }} */ (globalThis);
state.localVerifierOutcome = null;
void app.whenReady().then(async () => {
  state.localVerifierOutcome = await verifyClientLocally({
    officialWasmPath,
    cachePath,
    officialSha256,
  });
  const window = new BrowserWindow({ show: false });
  await window.loadURL("data:text/html,local-verifier-complete");
});
