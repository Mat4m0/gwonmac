import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { EXTERNAL_URLS } from "../src/shared/contracts.ts";
import {
  loadWebsiteDownload,
  selectWebsiteDownload,
  WEBSITE_RELEASE_CHANNEL,
} from "../apps/website/app/utils/release-download.ts";

// P3.25 — the download button, executed rather than described. The composable's
// channel policy runs here against release payloads shaped like the ones the
// release workflow publishes; the rendered pages below prove what a visitor
// gets before any of that resolves.
const ARM64_ZIP = {
  name: "Guild Wars Reforged-darwin-arm64-0.0.3.zip",
  browser_download_url:
    "https://github.com/Mat4m0/gwonmac/releases/download/v0.0.3/Guild-Wars-Reforged-darwin-arm64-0.0.3.zip",
};
const CHECKSUMS = {
  name: "SHA256SUMS.txt",
  browser_download_url:
    "https://github.com/Mat4m0/gwonmac/releases/download/v0.0.3/SHA256SUMS.txt",
};
const SBOM = {
  name: "Guild-Wars-Reforged-0.0.3-macOS-arm64.spdx.json",
  browser_download_url:
    "https://github.com/Mat4m0/gwonmac/releases/download/v0.0.3/Guild-Wars-Reforged-0.0.3-macOS-arm64.spdx.json",
};
const STABLE = {
  tag_name: "v0.0.3",
  draft: false,
  prerelease: false,
  assets: [CHECKSUMS, SBOM, ARM64_ZIP],
};
const PRERELEASE_ARM64_ZIP = {
  name: "Guild Wars Reforged-darwin-arm64-0.0.4-alpha.1.zip",
  browser_download_url:
    "https://github.com/Mat4m0/gwonmac/releases/download/v0.0.4-alpha.1/Guild-Wars-Reforged-darwin-arm64-0.0.4-alpha.1.zip",
};
const PRERELEASE = {
  tag_name: "v0.0.4-alpha.1",
  draft: false,
  prerelease: true,
  assets: [PRERELEASE_ARM64_ZIP],
};
const DRAFT = { ...STABLE, tag_name: "v0.0.5", draft: true };
const SNAPSHOTS = Array.from({ length: 25 }, (_, index) => ({
  tag_name: `snapshot-${index + 1}-abcdef${index % 10}`,
  draft: false,
  prerelease: true,
  assets: [{
    name: `Guild-Wars-Reforged-abcdef${index % 10}-macOS-arm64.zip`,
    browser_download_url:
      `https://github.com/Mat4m0/gwonmac/releases/download/snapshot-${index + 1}/snapshot.zip`,
  }],
}));

// The resolved download is the arm64 ZIP of the release, not its checksums.
assert.equal(WEBSITE_RELEASE_CHANNEL, "preview");
assert.deepEqual(selectWebsiteDownload([STABLE]), {
  url: ARM64_ZIP.browser_download_url,
  version: "0.0.3",
});

// During the launch phase, a newer prerelease becomes the direct download.
assert.deepEqual(selectWebsiteDownload([PRERELEASE, STABLE]), {
  url: PRERELEASE_ARM64_ZIP.browser_download_url,
  version: "0.0.4-alpha.1",
});

assert.deepEqual(selectWebsiteDownload([PRERELEASE]), {
  url: PRERELEASE_ARM64_ZIP.browser_download_url,
  version: "0.0.4-alpha.1",
});

// Snapshots are public GitHub prereleases but never application versions. A
// failed cleanup can put more than one old API page ahead of the beta without
// changing the website's answer, whichever side of it GitHub returns them on.
assert.deepEqual(selectWebsiteDownload([...SNAPSHOTS, PRERELEASE, STABLE]), {
  url: PRERELEASE_ARM64_ZIP.browser_download_url,
  version: "0.0.4-alpha.1",
});
assert.deepEqual(selectWebsiteDownload([PRERELEASE, STABLE, ...SNAPSHOTS]), {
  url: PRERELEASE_ARM64_ZIP.browser_download_url,
  version: "0.0.4-alpha.1",
});
assert.deepEqual(
  selectWebsiteDownload([
    {
      ...SNAPSHOTS[0],
      tag_name: "snapshot-latest",
    },
    {
      ...SNAPSHOTS[1],
      assets: [CHECKSUMS, SBOM],
    },
    PRERELEASE,
  ]),
  {
    url: PRERELEASE_ARM64_ZIP.browser_download_url,
    version: "0.0.4-alpha.1",
  },
);

// Drafts are invisible to a logged-out visitor and are not offered either.
assert.deepEqual(selectWebsiteDownload([DRAFT, PRERELEASE]), {
  url: PRERELEASE_ARM64_ZIP.browser_download_url,
  version: "0.0.4-alpha.1",
});

// Reverting the one channel constant to stable restores the long-term policy.
assert.deepEqual(selectWebsiteDownload([PRERELEASE, STABLE], "stable"), {
  url: ARM64_ZIP.browser_download_url,
  version: "0.0.3",
});
assert.equal(selectWebsiteDownload([PRERELEASE], "stable"), null);

// Network ordering and network text are not version policy. A malformed stable
// tag is ignored, and the greatest canonical stable version wins even when
// GitHub returns it after an older release.
const NEWER_ARM64_ZIP = {
  name: "Guild Wars Reforged-darwin-arm64-2026.8.0.zip",
  browser_download_url:
    "https://github.com/Mat4m0/gwonmac/releases/download/v2026.8.0/Guild-Wars-Reforged-darwin-arm64-2026.8.0.zip",
};
const NEWER_STABLE = {
  tag_name: "v2026.8.0",
  draft: false,
  prerelease: false,
  assets: [NEWER_ARM64_ZIP],
};
assert.equal(
  selectWebsiteDownload([{ ...STABLE, tag_name: "banana" }]),
  null,
);
assert.deepEqual(
  selectWebsiteDownload([STABLE, NEWER_STABLE]),
  {
    url: NEWER_ARM64_ZIP.browser_download_url,
    version: "2026.8.0",
  },
);

// A stable release whose macOS build has not finished uploading is skipped
// rather than announced with a releases-page link under its version number.
assert.equal(
  selectWebsiteDownload([{ ...STABLE, assets: [CHECKSUMS, SBOM] }]),
  null,
);

// Offline, rate-limited, or unreadable: `fetch` rejecting, a non-OK response
// (`null`), and GitHub's error object all reach the selector as something that
// is not an array of releases.
assert.equal(selectWebsiteDownload(null), null);
assert.equal(selectWebsiteDownload({ message: "API rate limit exceeded" }), null);

// Four buttons are mounted across the two pages (navigation, hero, final CTA,
// install guide) and each one calls this on mount. They share one request.
{
  const realFetch = globalThis.fetch;
  let calls = 0;
  let requested = "";
  globalThis.fetch = async (input) => {
    calls += 1;
    requested = String(input);
    return new globalThis.Response(JSON.stringify([PRERELEASE, STABLE]), {
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const answers = await Promise.all([
      loadWebsiteDownload(),
      loadWebsiteDownload(),
      loadWebsiteDownload(),
      loadWebsiteDownload(),
    ]);
    assert.equal(calls, 1);
    assert.equal(
      requested,
      "https://api.github.com/repos/Mat4m0/gwonmac/releases?per_page=100",
    );
    for (const answer of answers) {
      assert.deepEqual(answer, {
        url: PRERELEASE_ARM64_ZIP.browser_download_url,
        version: "0.0.4-alpha.1",
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
server.stderr.on("data", (chunk: string) => {
  stderr += chunk;
});

async function load(pathname: string): Promise<Response> {
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
  assert.match(html, /<h1[^>]*>Guild Wars Reforged on Apple Silicon<\/h1>/);
  assert.match(
    html,
    /https:\/\/plausible\.io\/js\/pa--X4qMlLVyMnUW4L8emwE_\.js/,
  );
  assert.match(html, /window\.plausible\.init\(\)/);

  // The release lookup is a client-side effect, so the offline fallback is what
  // every visitor is served first and what a visitor without JavaScript keeps.
  // Every rendered download button must already be a working link.
  const downloadLinks = (page: string) => [
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
  const steps = /<ol[^>]*>([\s\S]*?)<\/ol>/.exec(installHtml)?.[1];
  assert(steps);
  const stepCount = [...steps.matchAll(/<li[\s>]/g)].length;
  assert.equal(stepCount, 5);
  assert.match(
    installHtml,
    new RegExp(
      `content="Install Guild Wars Reforged on your Mac in ${stepCount} short steps`,
    ),
  );
} finally {
  if (server.exitCode === null) {
    server.kill();
    await once(server, "exit");
  }
}
