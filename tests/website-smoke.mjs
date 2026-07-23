import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const websiteDirectory = fileURLToPath(
  new URL("../apps/website/", import.meta.url),
);

const probe = createServer();
probe.listen(0, host);
await once(probe, "listening");
const address = probe.address();
assert(address && typeof address !== "string");
const port = address.port;
probe.close();
await once(probe, "close");

const server = spawn(process.execPath, [".output/server/index.mjs"], {
  cwd: websiteDirectory,
  env: { ...process.env, HOST: host, PORT: String(port) },
  stdio: ["ignore", "ignore", "pipe"],
});

let stderr = "";
server.stderr.setEncoding("utf8");
server.stderr.on("data", (chunk) => {
  stderr += chunk;
});

async function load(pathname) {
  const url = `http://${host}:${port}${pathname}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`website server exited early:\n${stderr}`);
    }
    try {
      return await globalThis.fetch(url);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`website server did not start:\n${stderr}`);
}

try {
  const home = await load("/");
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /<h1[^>]*>Guild Wars on Apple Silicon<\/h1>/);
  assert.match(
    html,
    /https:\/\/plausible\.io\/js\/pa--X4qMlLVyMnUW4L8emwE_\.js/,
  );
  assert.match(html, /window\.plausible\.init\(\)/);

  const install = await load("/install");
  assert.equal(install.status, 200);
} finally {
  if (server.exitCode === null) {
    server.kill();
    await once(server, "exit");
  }
}
