import { app, protocol, net } from "electron";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { SnapshotMetadata } from "../shared/contracts.js";
import type { ChunkStore } from "./core/chunk-store.js";
import {
  isProxyRoute,
  resolveProxyHost,
  rewriteProxyRedirect,
} from "./core/proxy-routes.js";
import { parseRangeHeader } from "./core/ranges.js";
import { snapshotMetadataWire } from "./core/snapshot.js";
import { count, log, span } from "./diagnostics.js";
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
  "object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const MAX_PROXY_BODY_BYTES = 8 * 1024 * 1024;

export interface ProtocolDeps {
  getChunkStore: () => ChunkStore | null;
  getSnapshotMeta: () => SnapshotMetadata | null;
}

let deps: ProtocolDeps = {
  getChunkStore: () => null,
  getSnapshotMeta: () => null,
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

export function installGwProtocolHandler(): void {
  protocol.handle("gw", (request) => handleGwRequest(request));
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

  const body = await readFile(filePath);
  return new Response(body, {
    status: 200,
    headers: headers({
      "Content-Type": mime,
      "Accept-Ranges": "bytes",
      "Content-Length": String(body.byteLength),
    }),
  });
}

async function handleSnapshot(request: Request): Promise<Response> {
  const store = deps.getChunkStore();
  const meta = deps.getSnapshotMeta();
  if (!store || !meta || meta.size <= 0) {
    return new Response("snapshot unavailable", {
      status: 503,
      headers: headers({ "Content-Type": "text/plain; charset=utf-8" }),
    });
  }
  const range = parseRangeHeader(request.headers.get("range"), meta.size);
  if (range === null || range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: headers({
        "Content-Range": `bytes */${meta.size}`,
        "Accept-Ranges": "bytes",
      }),
    });
  }
  const length = range.end - range.start + 1;
  // Official calls stay well under this; larger would block the main process.
  if (length > 8 * 1024 * 1024) {
    return new Response("range too large", { status: 416, headers: headers() });
  }
  const requestSpan = span("snapshot", "read", {
    offsetBytes: range.start,
    bytes: length,
    priority: request.headers.get("x-gw-priority") ?? "demand",
  }, undefined, request.headers.get("x-gw-trace-id") ?? undefined);
  try {
    const priority =
      request.headers.get("x-gw-priority") === "prefetch"
        ? "prefetch"
        : "demand";
    const data = await store.readRange(range.start, length, priority);
    requestSpan.end({ bytes: data.byteLength, status: 206 });
    count("protocol.snapshotBytes", data.byteLength);
    return new Response(
      Buffer.from(data.buffer, data.byteOffset, data.byteLength),
      {
      status: 206,
      headers: headers({
        "Content-Type": "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${range.start}-${range.end}/${meta.size}`,
        "Content-Length": String(data.byteLength),
      }),
      },
    );
  } catch (err) {
    requestSpan.end(
      { message: err instanceof Error ? err.message : String(err), status: 503 },
      "error",
    );
    log("snapshot", "error", "snapshot.rangeFailed", {
      message: err instanceof Error ? err.message : String(err),
    });
    const message =
      err instanceof Error &&
      "code" in err &&
      err.code === "chunk_offline"
        ? "No cached copy of this game data is available while offline."
        : "ArenaNet is unavailable. Guild Wars will retry this download.";
    return new Response(message, {
      status: 503,
      headers: headers(),
    });
  }
}

async function handleProxy(request: Request, route: string, rest: string): Promise<Response> {
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
  const requestSpan = span("proxy", "request", { route, method });
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
        requestSpan.end({ status: 413, reason: "bodyTooLarge" }, "warn");
        return new Response("request body too large", { status: 413, headers: headers() });
      }
      const body = await request.arrayBuffer();
      if (body.byteLength > MAX_PROXY_BODY_BYTES) {
        requestSpan.end({ status: 413, reason: "bodyTooLarge" }, "warn");
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
          log("proxy", "warn", "proxy.redirectBlocked", { route });
          requestSpan.end({ status: 502, reason: "redirectEscape" }, "warn");
          return new Response("redirect blocked", { status: 502, headers: headers() });
        }
      }
    }
    const out = new Headers(headers());
    for (const [k, v] of res.headers) {
      const key = k.toLowerCase();
      if (key === "content-security-policy") continue;
      out.set(k, key === "location" && safeLocation ? safeLocation : v);
    }
    requestSpan.end({ status: res.status });
    return new Response(res.body, { status: res.status, headers: out });
  } catch (err) {
    requestSpan.end(
      { status: 502, message: err instanceof Error ? err.message : String(err) },
      "error",
    );
    log("proxy", "error", "proxy.requestFailed", {
      route,
      message: err instanceof Error ? err.message : String(err),
    });
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
  const first = base.split("/")[0] ?? "";

  if (base === "Gw.snapshot") return handleSnapshot(request);

  if (base === "snapshot-metadata.json") {
    const meta = deps.getSnapshotMeta();
    if (!meta) {
      return new Response("{}", {
        status: 503,
        headers: headers({ "Content-Type": "application/json" }),
      });
    }
    const body = JSON.stringify(snapshotMetadataWire(meta));
    return new Response(body, {
      status: 200,
      headers: headers({
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(body)),
      }),
    });
  }

  const artifactName = ["Gw.jspi.js", "Gw.jspi.wasm", "version.json"].includes(base)
    ? base
    : null;
  if (artifactName) {
    const file = path.join(gamePaths().artifacts, artifactName);
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
