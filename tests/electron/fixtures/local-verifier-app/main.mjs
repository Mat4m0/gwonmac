import { app, BrowserWindow } from "electron";

// `pnpm verify` typechecks a clean checkout before it creates build/. Resolve
// the compiled host at runtime so this fixture exercises the shipped entry
// without making generated output a typecheck prerequisite.
const hostUrl = new URL(
  "../../../../build/main/certification/local-client-verifier-host.js",
  import.meta.url,
);
const { verifyClientLocally } = await import(hostUrl.href);

const [officialWasmPath, officialSha256] = process.argv.slice(-2);
if (!officialWasmPath || !officialSha256) {
  throw new Error("local verifier fixture requires wasm and hash");
}

const state = /** @type {{
 *   localVerifierCompleted?: boolean;
 *   localVerifierOutcome?: unknown;
 * }} */ (globalThis);
state.localVerifierCompleted = false;
state.localVerifierOutcome = null;
void app.whenReady().then(async () => {
  state.localVerifierOutcome = await verifyClientLocally({
    officialWasmPath,
    officialSha256,
  });
  state.localVerifierCompleted = true;
  const window = new BrowserWindow({ show: false });
  await window.loadURL("data:text/html,local-verifier-complete");
});
