export const ACCESS_KEY = "2043FE79-F32D-4FD7-8C27-0D47231C4F03";
export const PATCH_ROOT = "https://patching.1.arenanetworks.com";
export const UA = "gwonmac (Guild Wars interoperability client)";
export const PATCH_REQUEST_HEADERS: Readonly<Record<string, string>> = {
  "X-Access-Key": ACCESS_KEY,
  "User-Agent": UA,
  "Accept-Encoding": "identity",
};
export const PREFETCH_JOBS = 8;
export const PATCH_REQUEST_TIMEOUT_MS = 30_000;
export const MAX_PATCH_MANIFEST_BYTES = 16 * 1024 * 1024;
export const SNAPSHOT = "Gw.snapshot";
export const FATAL_HTTP = new Set([401, 403, 404]);
export const HASH_ALGOS: Record<number, "md5" | "sha1" | "sha256"> = {
  32: "md5",
  40: "sha1",
  64: "sha256",
};
export const JSPI_ARTIFACTS = ["Gw.jspi.js", "Gw.jspi.wasm"] as const;
export const COMMON_ARTIFACTS = ["version.json"] as const;
export const CLIENT_ARTIFACTS = [
  ...JSPI_ARTIFACTS,
  ...COMMON_ARTIFACTS,
] as const;
export const REQUIRED_PATCH_FILES = [...CLIENT_ARTIFACTS, SNAPSHOT] as const;
