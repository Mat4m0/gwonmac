import {
  app,
  protocol,
  net,
} from "electron";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { SnapshotMetadata } from "../shared/contracts.js";
import { CLIENT_ARTIFACTS } from "./core/access-key.js";
import type { ChunkStore } from "./core/chunk-store.js";
import {
  isProxyFetchDestination,
  isProxyRoute,
  type ProxyRoute,
  resolveProxyHost,
  rewriteProxyRedirect,
} from "./core/proxy-routes.js";
import { clientArtifactPath } from "./core/paths.js";
import { parseRangeHeader } from "./core/ranges.js";
import { snapshotMetadataWire } from "./core/snapshot.js";
import { errorCode } from "../shared/errors.js";
import {
  count,
  logEvent,
  startProxyRequestSpan,
  startSnapshotReadSpan,
} from "./diagnostics.js";
import { gamePaths, rendererRoot } from "./paths.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const CSP =
  "default-src 'self' gw:; script-src 'self' gw: 'unsafe-eval' 'wasm-unsafe-eval'; " +
  "style-src 'self' gw: 'unsafe-inline'; img-src 'self' gw: data:; " +
  "font-src 'self' gw:; connect-src 'self' gw:; worker-src 'self' gw: blob:; " +
  "object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'; " +
  "frame-ancestors 'none'";
const MAX_PROXY_BODY_BYTES = 8 * 1024 * 1024;

export interface ProtocolDeps {
  getActiveClient: () => {
    artifactsDir: string;
    store: ChunkStore;
    snapshotMeta: SnapshotMetadata;
    wasmPath: string;
  } | null;
}

let deps: ProtocolDeps = {
  getActiveClient: () => null,
};

export function setProtocolDeps(next: ProtocolDeps): void {
  deps = next;
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

export function gameProtocolHandler(request: Request): Promise<Response> {
  return handleGwRequest(request);
}

function headers(extra: Record<string, string> = {}): Headers {
  return new Headers({
    "Content-Security-Policy": CSP,
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
): Promise<Response> {
  let st;
  try {
    st = await stat(filePath);
  } catch {
    return new Response("not found", { status: 404, headers: headers() });
  }
  if (!st.isFile()) {
    return new Response("not found", { status: 404, headers: headers() });
  }

  const range = parseRangeHeader(request.headers.get("range"), st.size);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: headers({
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
      headers: headers({
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
    headers: headers({
      "Content-Type": mime,
      "Accept-Ranges": "bytes",
      "Content-Length": String(st.size),
    }),
  });
}

async function handleSnapshot(request: Request): Promise<Response> {
  const active = deps.getActiveClient();
  if (!active || active.snapshotMeta.size <= 0) {
    return new Response("snapshot unavailable", {
      status: 503,
      headers: headers({
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      }),
    });
  }
  const { store, snapshotMeta: meta } = active;
  const range = parseRangeHeader(request.headers.get("range"), meta.size);
  if (range === null || range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: headers({
        "Cache-Control": "no-store",
        "Content-Range": `bytes */${meta.size}`,
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
  });
  try {
    const data = await store.readRange(range.start, length, priority);
    requestSpan.end({
      returnedBytes: data.byteLength,
      status: 206,
      code: null,
    });
    count("protocol.snapshotBytes", data.byteLength);
    return new Response(
      Buffer.from(data.buffer, data.byteOffset, data.byteLength),
      {
      status: 206,
      headers: headers({
        "Cache-Control": "no-store",
        "Content-Type": "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${range.start}-${range.end}/${meta.size}`,
        "Content-Length": String(data.byteLength),
      }),
      },
    );
  } catch (err) {
    const code = errorCode(err);
    requestSpan.end({ returnedBytes: 0, code, status: 503 });
    logEvent({
      k: "snapshot.rangeFailed",
      offsetBytes: range.start,
      bytes: length,
      code,
    });
    const message =
      code === "chunk_offline"
        ? "No cached copy of this game data is available while offline."
        : "ArenaNet is unavailable. Guild Wars will retry this download.";
    return new Response(message, {
      status: 503,
      headers: headers({ "Cache-Control": "no-store" }),
    });
  }
}

async function handleProxy(
  request: Request,
  route: ProxyRoute,
  rest: string,
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
  const requestSpan = startProxyRequestSpan({ route, method });
  const fwd = new Headers();
  for (const [k, v] of request.headers) {
    const key = k.toLowerCase();
    if (
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
    let safeLocation = "";
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (loc) {
        try {
          safeLocation = rewriteProxyRedirect(route, loc, upstream);
        } catch {
          logEvent({ k: "proxy.redirectBlocked", route });
          requestSpan.end({
            status: 502,
            reason: "redirectEscape",
            code: null,
          });
          return new Response("redirect blocked", { status: 502, headers: headers() });
        }
      }
    }
    const out = new Headers(headers());
    for (const [k, v] of res.headers) {
      const key = k.toLowerCase();
      if (
        key === "content-security-policy"
        || key === "content-security-policy-report-only"
        || key === "x-content-type-options"
      ) {
        continue;
      }
      out.set(k, key === "location" && safeLocation ? safeLocation : v);
    }
    requestSpan.end({ status: res.status, reason: null, code: null });
    return new Response(res.body, { status: res.status, headers: out });
  } catch (err) {
    const code = errorCode(err);
    requestSpan.end({ status: 502, reason: null, code });
    logEvent({ k: "proxy.requestFailed", route, code });
    return new Response("proxy error", { status: 502, headers: headers() });
  }
}

export async function handleGwRequest(request: Request): Promise<Response> {
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

  if (base === "Gw.snapshot") return handleSnapshot(request);

  if (base === "snapshot-metadata.json") {
    const active = deps.getActiveClient();
    if (!active) {
      return new Response("{}", {
        status: 503,
        headers: headers({ "Content-Type": "application/json" }),
      });
    }
    const meta = active.snapshotMeta;
    const body = JSON.stringify(snapshotMetadataWire(meta));
    return new Response(body, {
      status: 200,
      headers: headers({
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(body)),
      }),
    });
  }

  const artifactName = CLIENT_ARTIFACTS.includes(
    base as (typeof CLIENT_ARTIFACTS)[number],
  )
    ? (base as (typeof CLIENT_ARTIFACTS)[number])
    : null;
  if (artifactName) {
    const active = deps.getActiveClient();
    const file =
      artifactName === "Gw.jspi.wasm"
        ? active?.wasmPath ??
          clientArtifactPath(gamePaths().artifacts, "Gw.jspi.wasm")
        : clientArtifactPath(
            active?.artifactsDir ?? gamePaths().artifacts,
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
      return fileResponse(rendererFile, request, mime);
    } catch {
      /* fall through to proxy */
    }
  }

  if (isProxyRoute(first)) {
    const rest = base.slice(first.length).replace(/^\/+/, "");
    return handleProxy(request, first, rest);
  }

  if (first && !artifactName) {
    // Unknown first-label proxy-style path names itself rather than guessing.
    if (!base.includes(".") || isProxyRoute(first)) {
      return new Response(`unknown proxy route: ${first}`, {
        status: 502,
        headers: headers({ "Content-Type": "text/plain; charset=utf-8" }),
      });
    }
  }

  return new Response("not found", { status: 404, headers: headers() });
}

export function isDevBuild(): boolean {
  return !app.isPackaged;
}
