/**
 * The `gw://app` scheme: the renderer's own documents, the virtual
 * `Gw.snapshot` assembled from cached chunks, and the fail-closed proxy to the
 * allowlisted web services.
 *
 * Every filesystem path is resolved and then proved to still be under its root,
 * so a traversal, an encoded separator or an embedded NUL cannot reach a file
 * outside it. The snapshot is served from ranges only. Renderer runtime
 * dependencies are emitted inside the renderer tree, and a route the proxy
 * does not recognise is refused rather than forwarded.
 *
 * The response headers, including the CSP, are attached here for everything
 * this scheme serves, so no individual handler can serve a document without
 * them.
 */
import { app, protocol, net, type Session } from "electron";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import {
  SKILL_CATALOGUE_ROUTE,
  SKILL_ICON_PATTERN,
} from "../shared/contracts.js";
import { CLIENT_ARTIFACTS } from "./core/access-key.js";
import type { ChunkStore } from "./core/chunk-store.js";
import {
  isProxyCookieHeader,
  isProxyFetchDestination,
  isProxyRoute,
  proxyResponseHeaders,
  type ProxyRoute,
  resolveProxyHost,
} from "./core/proxy-routes.js";
import { clientArtifactPath } from "./core/paths.js";
import { GameFontAssets } from "./core/game-font-assets.js";
import { SkillAssets } from "./core/skill-catalogue.js";
import { parseRangeHeader } from "./core/ranges.js";
import { errorCode } from "../shared/errors.js";
import {
  count,
  logEvent,
  startProxyRequestSpan,
  startSnapshotReadSpan,
} from "./diagnostics.js";
import { gamePaths, gwDatDecoderPath, rendererRoot } from "./paths.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const CSP =
  "default-src 'self' gw:; script-src 'self' gw: 'unsafe-eval' 'wasm-unsafe-eval'; " +
  "style-src 'self' gw: 'unsafe-inline'; img-src 'self' gw: data:; " +
  "font-src 'self' gw:; connect-src 'self' gw:; worker-src 'self' gw: blob:; " +
  "object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'; " +
  "frame-ancestors 'none'";
const LAUNCHER_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; " +
  "base-uri 'none'; frame-src 'none'; form-action 'none'; frame-ancestors 'none'; " +
  "worker-src 'none'";
const MAX_PROXY_BODY_BYTES = 8 * 1024 * 1024;
/**
 * `Response` accepts a plain `ArrayBuffer`, while Node buffers may be views
 * into a larger pooled backing store. Reuse an already exact buffer; otherwise
 * copy only the logical bytes so a small protocol response cannot retain or
 * expose unrelated backing memory.
 */
function compactResponseBody(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer
    && bytes.byteOffset === 0
    && bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer;
  }
  const compact = new Uint8Array(bytes.byteLength);
  compact.set(bytes);
  return compact.buffer;
}

export interface ProtocolDeps {
  getActiveClient: () => {
    artifactsDir: string;
    store: ChunkStore;
    wasmPath: string;
    jsPath: string;
  } | null;
  diagnosticOwnerId?: () => number;
}

/**
 * One `SkillAssets` per active client. It owns its own memoisation and its own
 * on-disk cache, so this only has to notice when the client underneath changes.
 */
let skillAssets: {
  readonly store: ChunkStore;
  readonly wasmPath: string;
  readonly value: SkillAssets;
} | null = null;

let gameFontAssets: {
  readonly store: ChunkStore;
  readonly value: GameFontAssets;
} | null = null;
const reportedGameFontRefusals = new WeakSet<GameFontAssets>();

function assetsFor(
  active: NonNullable<ReturnType<ProtocolDeps["getActiveClient"]>>,
): SkillAssets {
  if (
    skillAssets?.store === active.store
    && skillAssets.wasmPath === active.wasmPath
  ) {
    return skillAssets.value;
  }
  const value = new SkillAssets({
    store: active.store,
    wasmPath: active.wasmPath,
    decoderPath: gwDatDecoderPath(),
    cacheRoot: gamePaths().skillAssets,
  });
  skillAssets = { store: active.store, wasmPath: active.wasmPath, value };
  return value;
}

function fontFor(
  active: NonNullable<ReturnType<ProtocolDeps["getActiveClient"]>>,
): GameFontAssets {
  if (gameFontAssets?.store === active.store) return gameFontAssets.value;
  const value = new GameFontAssets({
    store: active.store,
    decoderPath: gwDatDecoderPath(),
  });
  gameFontAssets = { store: active.store, value };
  return value;
}

/** Must run before app ready. */
export function registerGwScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "gw",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        codeCache: true,
        corsEnabled: false,
        bypassCSP: false,
      },
    },
  ]);
}

export function installGwProtocolHandler(deps: ProtocolDeps): void {
  protocol.handle("gw", (request) => handleGwRequest(request, deps));
}

/** A custom partition owns its own protocol registry. */
export function installGwProtocolHandlerForSession(
  owner: Session,
  deps: ProtocolDeps,
): void {
  owner.protocol.handle("gw", (request) => handleGwRequest(request, deps));
}

/** The launcher partition can serve only its compiled offline Vue subtree. */
export function installLauncherProtocolHandlerForSession(owner: Session): void {
  owner.protocol.handle("gw", async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", { status: 405 });
    }
    const url = new URL(request.url);
    if (url.hostname !== "app" || !url.pathname.startsWith("/launcher/")) {
      return new Response("not found", { status: 404, headers: launcherHeaders() });
    }
    const root = path.join(rendererRoot(), "launcher");
    const filePath = safeUnder(root, url.pathname.slice("/launcher".length));
    if (!filePath) return new Response("not found", { status: 404, headers: launcherHeaders() });
    return fileResponse(
      filePath,
      request,
      MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
      undefined,
      launcherHeaders,
    );
  });
}

function headers(extra: Record<string, string> = {}): Headers {
  return new Headers({
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    ...extra,
  });
}

function launcherHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    "Content-Security-Policy": LAUNCHER_CSP,
    "X-Content-Type-Options": "nosniff",
    ...extra,
  });
}

function safeUnder(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0] ?? "");
  } catch {
    return null;
  }
  const rel = decoded.replace(/^\/+/, "");
  if (!rel || rel.includes("\0")) return null;
  const resolved = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    return null;
  }
  return resolved;
}

async function fileResponse(
  filePath: string,
  request: Request,
  mime: string,
  cacheControl?: "no-store",
  makeHeaders: (extra?: Record<string, string>) => Headers = headers,
): Promise<Response> {
  const fileHeaders = (extra: Record<string, string> = {}) => makeHeaders({
    ...(cacheControl ? { "Cache-Control": cacheControl } : {}),
    ...extra,
  });
  let st;
  try {
    st = await stat(filePath);
  } catch {
    return new Response("not found", { status: 404, headers: fileHeaders() });
  }
  if (!st.isFile()) {
    return new Response("not found", { status: 404, headers: fileHeaders() });
  }

  const range = parseRangeHeader(request.headers.get("range"), st.size);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: fileHeaders({
        "Content-Range": `bytes */${st.size}`,
        "Accept-Ranges": "bytes",
      }),
    });
  }
  if (range) {
    const length = range.end - range.start + 1;
    const nodeStream = createReadStream(filePath, {
      start: range.start,
      end: range.end,
    });
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    return new Response(webStream, {
      status: 206,
      headers: fileHeaders({
        "Content-Type": mime,
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${range.start}-${range.end}/${st.size}`,
        "Content-Length": String(length),
      }),
    });
  }

  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;
  return new Response(webStream, {
    status: 200,
    headers: fileHeaders({
      "Content-Type": mime,
      "Accept-Ranges": "bytes",
      "Content-Length": String(st.size),
    }),
  });
}

async function handleSnapshot(
  request: Request,
  deps: ProtocolDeps,
): Promise<Response> {
  const ownerId = deps.diagnosticOwnerId?.();
  const active = deps.getActiveClient();
  if (!active || active.store.size <= 0) {
    return new Response("snapshot unavailable", {
      status: 503,
      headers: headers({
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      }),
    });
  }
  const { store } = active;
  const range = parseRangeHeader(request.headers.get("range"), store.size);
  if (range === null || range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: headers({
        "Cache-Control": "no-store",
        "Content-Range": `bytes */${store.size}`,
        "Accept-Ranges": "bytes",
      }),
    });
  }
  const length = range.end - range.start + 1;
  // Official calls stay well under this; larger would block the main process.
  if (length > 8 * 1024 * 1024) {
    return new Response("range too large", {
      status: 416,
      headers: headers({ "Cache-Control": "no-store" }),
    });
  }
  // Resolved before the span is opened: the raw header is renderer-supplied
  // text, and it used to be recorded verbatim as the span's `priority` field.
  const priority =
    request.headers.get("x-gw-priority") === "prefetch"
      ? "prefetch"
      : "demand";
  const requestSpan = startSnapshotReadSpan({
    offsetBytes: range.start,
    requestedBytes: length,
    priority,
  }, ownerId);
  try {
    const data = await store.readRange(range.start, length, priority);
    requestSpan.end({
      returnedBytes: data.byteLength,
      status: 206,
      code: null,
    });
    count("protocol.snapshotBytes", data.byteLength, ownerId);
    return new Response(compactResponseBody(data), {
      status: 206,
      headers: headers({
        "Cache-Control": "no-store",
        "Content-Type": "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${range.start}-${range.end}/${store.size}`,
        "Content-Length": String(data.byteLength),
      }),
    });
  } catch (err) {
    const code = errorCode(err);
    requestSpan.end({ returnedBytes: 0, code, status: 503 });
    if (ownerId !== undefined) {
      logEvent({
        k: "snapshot.rangeFailed",
        offsetBytes: range.start,
        bytes: length,
        code,
      }, ownerId);
    }
    const message =
      code === "chunk_offline"
        ? "No cached copy of this game data is available while offline."
        : "ArenaNet is unavailable. Guild Wars will retry this download.";
    // The body prose is for the WASM client's own log; the header carries the
    // code so the renderer can choose a reviewed sentence instead of showing
    // whatever this handler happened to write.
    return new Response(message, {
      status: 503,
      headers: headers({ "Cache-Control": "no-store", "X-GW-Error": code }),
    });
  }
}

async function handleProxy(
  request: Request,
  route: ProxyRoute,
  rest: string,
  ownerId?: number,
): Promise<Response> {
  const destination =
    request.destination || request.headers.get("sec-fetch-dest") || "";
  if (!isProxyFetchDestination(destination)) {
    return new Response("proxy route is fetch-only", {
      status: 403,
      headers: headers({ "Content-Type": "text/plain; charset=utf-8" }),
    });
  }
  let host: string;
  try {
    host = resolveProxyHost(route);
  } catch {
    return new Response(`unknown proxy route: ${route}`, {
      status: 502,
      headers: headers({ "Content-Type": "text/plain; charset=utf-8" }),
    });
  }
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "POST" && method !== "PUT") {
    return new Response("method not allowed", { status: 405, headers: headers() });
  }
  const url = new URL(request.url);
  const upstream = `https://${host}/${rest}${url.search}`;
  const requestSpan = startProxyRequestSpan({ route, method }, ownerId);
  const fwd = new Headers();
  for (const [k, v] of request.headers) {
    const key = k.toLowerCase();
    if (
      isProxyCookieHeader(key) ||
      key === "host" ||
      key === "connection" ||
      key === "keep-alive" ||
      key === "transfer-encoding" ||
      key === "origin" ||
      key === "referer" ||
      key === "x-gw-trace-id"
    ) {
      continue;
    }
    fwd.set(k, v);
  }
  try {
    const init: RequestInit & { bypassCustomProtocolHandlers?: boolean } = {
      method,
      headers: fwd,
      redirect: "manual",
      // Header filtering protects this individual request. `omit` also tells
      // Chromium not to attach HTTP auth/session credentials of its own and
      // not to accept an upstream Set-Cookie into the default session. The
      // proxy is stateless by construction rather than by startup cleanup.
      credentials: "omit",
    };
    if (method !== "GET") {
      const declared = Number(request.headers.get("content-length") ?? 0);
      if (Number.isFinite(declared) && declared > MAX_PROXY_BODY_BYTES) {
        requestSpan.end({
          status: 413,
          reason: "bodyTooLarge",
          code: null,
        });
        return new Response("request body too large", { status: 413, headers: headers() });
      }
      const body = await request.arrayBuffer();
      if (body.byteLength > MAX_PROXY_BODY_BYTES) {
        requestSpan.end({
          status: 413,
          reason: "bodyTooLarge",
          code: null,
        });
        return new Response("request body too large", { status: 413, headers: headers() });
      }
      init.body = Buffer.from(body);
    }
    const res = await net.fetch(upstream, init);
    const safeHeaders = proxyResponseHeaders(
      route,
      upstream,
      res.status,
      res.headers,
    );
    if (safeHeaders === null) {
      if (ownerId !== undefined) {
        logEvent({ k: "proxy.redirectBlocked", route }, ownerId);
      }
      requestSpan.end({
        status: 502,
        reason: "redirectEscape",
        code: null,
      });
      return new Response("redirect blocked", { status: 502, headers: headers() });
    }
    const out = new Headers(headers());
    for (const [name, value] of safeHeaders) out.set(name, value);
    requestSpan.end({ status: res.status, reason: null, code: null });
    return new Response(res.body, { status: res.status, headers: out });
  } catch (err) {
    const code = errorCode(err);
    requestSpan.end({ status: 502, reason: null, code });
    if (ownerId !== undefined) {
      logEvent({ k: "proxy.requestFailed", route, code }, ownerId);
    }
    return new Response("proxy error", { status: 502, headers: headers() });
  }
}

async function handleGwRequest(
  request: Request,
  deps: ProtocolDeps,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname !== "app") {
    return new Response("forbidden", { status: 403, headers: headers() });
  }
  let pathname = url.pathname;
  if (pathname === "/") pathname = "/index.html";

  const base = pathname.replace(/^\/+/, "");
  // Lower-cased here so `isProxyRoute` can narrow to `ProxyRoute` honestly.
  // `resolveProxyHost` folded case anyway, so the routing is unchanged; the
  // rewritten redirect now names the route in its canonical spelling.
  const first = (base.split("/")[0] ?? "").toLowerCase();

  if (base === "Gw.snapshot") return handleSnapshot(request, deps);

  const gameFontRole = base === "game-font.ttf"
    ? "body"
    : base === "game-font-display.ttf" ? "display" : null;
  if (gameFontRole) {
    const missing = () =>
      new Response("not found", {
        status: 404,
        headers: headers({ "Cache-Control": "no-store" }),
      });
    const active = deps.getActiveClient();
    if (!active || request.method !== "GET") return missing();
    const assets = fontFor(active);
    const font = await assets.font(gameFontRole);
    const ownerId = deps.diagnosticOwnerId?.();
    if (
      !font
      && ownerId !== undefined
      && !reportedGameFontRefusals.has(assets)
    ) {
      reportedGameFontRefusals.add(assets);
      logEvent({
        k: "protocol.gameFontRefused",
        reason: assets.refusal() ?? "unsupported",
      }, ownerId);
    }
    return font
      ? new Response(compactResponseBody(font), {
          status: 200,
          headers: headers({
            "Content-Type": "font/ttf",
            "Content-Length": String(font.byteLength),
            "Cache-Control": "no-store",
          }),
        })
      : missing();
  }

  if (base === SKILL_CATALOGUE_ROUTE) {
    const empty = () =>
      new Response("[]", {
        status: 503,
        headers: headers({
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        }),
      });
    const active = deps.getActiveClient();
    if (!active || request.method !== "GET") return empty();
    const read = await assetsFor(active).catalogue();
    if (!read.ok) {
      const ownerId = deps.diagnosticOwnerId?.();
      if (ownerId !== undefined) {
        logEvent(
          { k: "protocol.skillCatalogueRefused", reason: read.reason },
          ownerId,
        );
      }
      return empty();
    }
    const body = JSON.stringify(read.skills);
    return new Response(body, {
      status: 200,
      headers: headers({
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(body)),
        "Cache-Control": "no-store",
      }),
    });
  }

  // Bounded by the pattern, not by a check afterwards: only decimal digits
  // reach `icon`, so no request can name a path.
  const iconMatch = SKILL_ICON_PATTERN.exec(base);
  if (iconMatch) {
    const active = deps.getActiveClient();
    const missing = () =>
      new Response("not found", {
        status: 404,
        headers: headers({ "Cache-Control": "no-store" }),
      });
    if (!active || request.method !== "GET") return missing();
    const icon = await assetsFor(active).icon(Number(iconMatch[1]));
    return icon
      ? new Response(compactResponseBody(icon), {
          status: 200,
          headers: headers({
            "Content-Type": "image/bmp",
            "Content-Length": String(icon.byteLength),
            "Cache-Control": "no-store",
          }),
        })
      : missing();
  }

  const artifactName = CLIENT_ARTIFACTS.includes(
    base as (typeof CLIENT_ARTIFACTS)[number],
  )
    ? (base as (typeof CLIENT_ARTIFACTS)[number])
    : null;
  if (artifactName) {
    const active = deps.getActiveClient();
    if (!active) {
      return new Response("client unavailable", {
        status: 503,
        headers: headers({
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
        }),
      });
    }
    const file =
      artifactName === "Gw.jspi.wasm"
        ? active.wasmPath
        : artifactName === "Gw.jspi.js"
          ? active.jsPath
          : clientArtifactPath(
            active.artifactsDir,
            artifactName,
          );
    const mime = MIME[path.extname(artifactName)] ?? "application/octet-stream";
    return fileResponse(file, request, mime);
  }

  const rendererFile = safeUnder(rendererRoot(), pathname);
  if (rendererFile) {
    try {
      await stat(rendererFile);
      const mime = MIME[path.extname(rendererFile)] ?? "application/octet-stream";
      // Renderer code and the companion are local build artifacts. Reusing an
      // old response across a development rebuild or app replacement can pair
      // a new transformed game module with an old callback ABI, so these tiny
      // local files deliberately bypass Chromium's HTTP cache.
      return fileResponse(rendererFile, request, mime, "no-store");
    } catch {
      /* fall through to proxy */
    }
  }

  if (isProxyRoute(first)) {
    const rest = base.slice(first.length).replace(/^\/+/, "");
    return handleProxy(request, first, rest, deps.diagnosticOwnerId?.());
  }

  if (first && !base.includes(".")) {
    // Unknown first-label proxy-style path names itself rather than guessing.
    return new Response(`unknown proxy route: ${first}`, {
      status: 502,
      headers: headers({ "Content-Type": "text/plain; charset=utf-8" }),
    });
  }

  return new Response("not found", { status: 404, headers: headers() });
}

export function isDevBuild(): boolean {
  return !app.isPackaged;
}
