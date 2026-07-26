import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { EXTERNAL_URLS } from "../src/shared/contracts.ts";
import {
  loadStableDownload,
  selectStableDownload,
} from "../apps/website/app/composables/useLatestRelease.ts";

// P3.25 — the download button, executed rather than described. The composable's
// channel policy runs here against release payloads shaped like the ones the
// release workflow publishes; the rendered pages below prove what a visitor
// gets before any of that resolves.
const ARM64_ZIP = {
  name: "Guild Wars-darwin-arm64-0.0.3.zip",
  browser_download_url:
    "https://github.com/Mat4m0/gwonmac/releases/download/v0.0.3/Guild-Wars-darwin-arm64-0.0.3.zip",
};
const CHECKSUMS = {
  name: "SHA256SUMS.txt",
  browser_download_url:
    "https://github.com/Mat4m0/gwonmac/releases/download/v0.0.3/SHA256SUMS.txt",
};
const SBOM = {
  name: "Guild-Wars-0.0.3-macOS-arm64.spdx.json",
  browser_download_url:
    "https://github.com/Mat4m0/gwonmac/releases/download/v0.0.3/Guild-Wars-0.0.3-macOS-arm64.spdx.json",
};
const STABLE = {
  tag_name: "v0.0.3",
  draft: false,
  prerelease: false,
  assets: [CHECKSUMS, SBOM, ARM64_ZIP],
};
const PRERELEASE = {
  tag_name: "v0.0.4-alpha.1",
  draft: false,
  prerelease: true,
  assets: [
    {
      name: "Guild Wars-darwin-arm64-0.0.4-alpha.1.zip",
      browser_download_url:
        "https://github.com/Mat4m0/gwonmac/releases/download/v0.0.4-alpha.1/Guild-Wars-darwin-arm64-0.0.4-alpha.1.zip",
    },
  ],
};
const DRAFT = { ...STABLE, tag_name: "v0.0.5", draft: true };

// The resolved download is the arm64 ZIP of the release, not its checksums.
assert.deepEqual(selectStableDownload([STABLE]), {
  url: ARM64_ZIP.browser_download_url,
  version: "0.0.3",
});

// A prerelease published on top of a stable release does not become the
// download; the stable one behind it does.
assert.deepEqual(selectStableDownload([PRERELEASE, STABLE]), {
  url: ARM64_ZIP.browser_download_url,
  version: "0.0.3",
});

// Prerelease-only — the repository's state today. Nothing stable exists, so the
// button must keep the releases page rather than hand over an alpha build.
assert.equal(selectStableDownload([PRERELEASE]), null);

// Drafts are invisible to a logged-out visitor and are not offered either.
assert.equal(selectStableDownload([DRAFT, PRERELEASE]), null);

// Network ordering and network text are not version policy. A malformed stable
// tag is ignored, and the greatest canonical stable version wins even when
// GitHub returns it after an older release.
const NEWER_ARM64_ZIP = {
  name: "Guild Wars-darwin-arm64-2026.8.0.zip",
  browser_download_url:
    "https://github.com/Mat4m0/gwonmac/releases/download/v2026.8.0/Guild-Wars-darwin-arm64-2026.8.0.zip",
};
const NEWER_STABLE = {
  tag_name: "v2026.8.0",
  draft: false,
  prerelease: false,
  assets: [NEWER_ARM64_ZIP],
};
assert.equal(
  selectStableDownload([{ ...STABLE, tag_name: "banana" }]),
  null,
);
assert.deepEqual(
  selectStableDownload([STABLE, NEWER_STABLE]),
  {
    url: NEWER_ARM64_ZIP.browser_download_url,
    version: "2026.8.0",
  },
);

// A stable release whose macOS build has not finished uploading is skipped
// rather than announced with a releases-page link under its version number.
assert.equal(
  selectStableDownload([{ ...STABLE, assets: [CHECKSUMS, SBOM] }]),
  null,
);

// Offline, rate-limited, or unreadable: `fetch` rejecting, a non-OK response
// (`null`), and GitHub's error object all reach the selector as something that
// is not an array of releases.
assert.equal(selectStableDownload(null), null);
assert.equal(selectStableDownload({ message: "API rate limit exceeded" }), null);

// Four buttons are mounted across the two pages (navigation, hero, final CTA,
// install guide) and each one calls this on mount. They share one request.
{
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new globalThis.Response(JSON.stringify([PRERELEASE, STABLE]), {
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const answers = await Promise.all([
      loadStableDownload(),
      loadStableDownload(),
      loadStableDownload(),
      loadStableDownload(),
    ]);
    assert.equal(calls, 1);
    for (const answer of answers) {
      assert.deepEqual(answer, {
        url: ARM64_ZIP.browser_download_url,
        version: "0.0.3",
      });
    }
  } finally {
    globalThis.fetch = realFetch;
  }
}

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

  // The release lookup is a client-side effect, so the offline fallback is what
  // every visitor is served first and what a visitor without JavaScript keeps.
  // Every rendered download button must already be a working link.
  const downloadLinks = (page) => [
    ...page.matchAll(/<a href="([^"]+)"[^>]*>\s*Download for macOS\s*<\/a>/g),
  ].map((match) => match[1]);
  // Navigation, hero, final CTA.
  assert.equal(downloadLinks(html).length, 3);
  for (const href of downloadLinks(html)) {
    assert.equal(href, EXTERNAL_URLS.releases);
  }

  // P3.22 — the narrowed capability claim. The client may offer only `None` for
  // antialiasing, so the page must not promise every in-game quality option.
  assert.match(html, /selectable render scale/);
  assert.doesNotMatch(html, /every in-game quality option/i);

  const install = await load("/install");
  assert.equal(install.status, 200);
  const installHtml = await install.text();
  // Navigation, install guide.
  assert.equal(downloadLinks(installHtml).length, 2);
  for (const href of downloadLinks(installHtml)) {
    assert.equal(href, EXTERNAL_URLS.releases);
  }

  // P3.23 — the promised step count is the rendered step count.
  const steps = /<ol[^>]*>([\s\S]*?)<\/ol>/.exec(installHtml);
  assert(steps);
  const stepCount = [...steps[1].matchAll(/<li[\s>]/g)].length;
  assert.equal(stepCount, 5);
  assert.match(
    installHtml,
    new RegExp(`content="Install Guild Wars on your Mac in ${stepCount} short steps`),
  );
} finally {
  if (server.exitCode === null) {
    server.kill();
    await once(server, "exit");
  }
}
