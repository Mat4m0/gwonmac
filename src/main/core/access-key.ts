export const ACCESS_KEY = "2043FE79-F32D-4FD7-8C27-0D47231C4F03";
export const PATCH_ROOT = "https://patching.1.arenanetworks.com";
export const UA = "gw-electron/0.1 (interop research)";
export const PREFETCH_JOBS = 8;
export const PATCH_REQUEST_TIMEOUT_MS = 30_000;
export const SNAPSHOT = "Gw.snapshot";
export const FATAL_HTTP = new Set([401, 403, 404]);
export const HASH_ALGOS: Record<number, "md5" | "sha1" | "sha256"> = {
  32: "md5",
  40: "sha1",
  64: "sha256",
};
export const JSPI_ARTIFACTS = ["Gw.jspi.js", "Gw.jspi.wasm"] as const;
export const COMMON_ARTIFACTS = ["version.json"] as const;
