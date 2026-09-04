import { app, BrowserWindow } from "electron";

// `pnpm verify` typechecks a clean checkout before it creates build/. Resolve
// the compiled host at runtime so this fixture exercises the shipped entry
// without making generated output a typecheck prerequisite.
const hostUrl = new URL(
  "../../../../build/main/certification/local-client-verifier-host.js",
  import.meta.url,
);
const {
  verifyCartographyLocally,
  verifyClientLocally,
  verifyExtendedMemoryLocally,
  verifyNativeDoubleClickLocally,
} = await import(hostUrl.href);

const extendedArgs = process.argv.slice(-5);
const compactArgs = process.argv.slice(-3);
const mode = extendedArgs[0] === "extended-memory"
  ? extendedArgs[0]
  : compactArgs[0];
const officialWasmPath = compactArgs[1];
const officialSha256 = compactArgs[2];
if (!mode || !officialWasmPath || !officialSha256) {
  throw new Error("local verifier fixture requires wasm and hash");
}

const state = /** @type {{
 *   localVerifierCompleted?: boolean;
 *   localVerifierOutcome?: unknown;
 * }} */ (globalThis);
state.localVerifierCompleted = false;
state.localVerifierOutcome = null;
void app.whenReady().then(async () => {
  state.localVerifierOutcome = mode === "extended-memory"
    ? await verifyExtendedMemoryLocally({
        jsPath: extendedArgs[1],
        jsInputSha256: extendedArgs[2],
        wasmPath: extendedArgs[3],
        wasmInputSha256: extendedArgs[4],
      })
    : mode === "native-double-click"
    ? await verifyNativeDoubleClickLocally({
        wasmPath: officialWasmPath,
        inputSha256: officialSha256,
      })
    : mode === "cartography"
    ? await verifyCartographyLocally({
        wasmPath: officialWasmPath,
        inputSha256: officialSha256,
      })
    : await verifyClientLocally({
        officialWasmPath,
        officialSha256,
        requestedCapabilities: {
          nativeCursor: true,
          targetObservation: true,
          partyObservation: true,
          teamApply: true,
          travelAction: true,
          xunlaiAction: true,
          chatAliases: true,
          skillSlotGeometry: false,
          skillCooldownObservation: false,
          playRegionObservation: true,
          preGameControls: false,
          characterSwitchAction: false,
          quickItemMove: false,
        },
      });
  state.localVerifierCompleted = true;
  const window = new BrowserWindow({ show: false });
  await window.loadURL("data:text/html,local-verifier-complete");
});
