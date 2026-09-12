import { app, BrowserWindow } from "electron";

// `pnpm verify` typechecks a clean checkout before it creates build/. Resolve
// the compiled host at runtime so this fixture exercises the shipped entry
// without making generated output a typecheck prerequisite.
const hostUrl = new URL(
  "../../../../build/main/certification/local-client-verifier-host.js",
  import.meta.url,
);
/** @type {typeof import("../../../../src/main/certification/local-client-verifier-host.ts")} */
const verifier = await import(hostUrl.href);
/** @type {typeof import("../../../../src/shared/enhancement-contracts.ts")} */
const contracts = await import(new URL(
  "../../../../build/shared/enhancement-contracts.js", import.meta.url,
).href);
const {
  verifyCartographyLocally,
  verifyClientLocally,
  verifyExtendedMemoryLocally,
  verifyNativeDoubleClickLocally,
} = verifier;

const extendedArgs = process.argv.slice(-5);
const compactArgs = process.argv.slice(-3);
/** @param {number} index */
function extendedArgument(index) {
  const value = extendedArgs[index];
  if (!value) throw new Error("extended-memory fixture requires paths and hashes");
  return value;
}
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
        jsPath: extendedArgument(1),
        jsInputSha256: extendedArgument(2),
        wasmPath: extendedArgument(3),
        wasmInputSha256: extendedArgument(4),
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
          ...contracts.NO_ENHANCEMENT_CAPABILITIES,
          nativeCursor: true,
          targetObservation: true,
          partyObservation: true,
          teamApply: true,
          travelAction: true,
          xunlaiAction: true,
          chatAliases: true,
          playRegionObservation: true,
        },
      });
  state.localVerifierCompleted = true;
  const window = new BrowserWindow({ show: false });
  await window.loadURL("data:text/html,local-verifier-complete");
});
