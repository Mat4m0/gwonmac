import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { EXTERNAL_URLS } from "../src/shared/contracts.ts";
import {
  RELEASES_FALLBACK_URL,
  SITE_RELEASE_CHANNEL,
  selectLatestRelease,
} from "../apps/website/server/utils/release-select.ts";
import { stopChildProcess } from "./helpers/child-process.ts";

// P3.25 — the download button, executed rather than described. The server
// route's selection policy runs here against release payloads shaped like the
// ones the release workflow publishes; the rendered pages below prove what a
// visitor gets before any of that resolves.
const ARM64_DMG = {
  name: "Guild-Wars-Reforged-0.0.3-macOS-arm64.dmg",
  browser_download_url:
    "https://github.com/Mat4m0/gwonmac/releases/download/v0.0.3/Guild-Wars-Reforged-0.0.3-macOS-arm64.dmg",
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
  assets: [CHECKSUMS, SBOM, ARM64_DMG],
};
const PRERELEASE_ARM64_DMG = {
  name: "Guild-Wars-Reforged-0.0.4-alpha.1-macOS-arm64.dmg",
  browser_download_url:
    "https://github.com/Mat4m0/gwonmac/releases/download/v0.0.4-alpha.1/Guild-Wars-Reforged-0.0.4-alpha.1-macOS-arm64.dmg",
};
const PRERELEASE = {
  tag_name: "v0.0.4-alpha.1",
  draft: false,
  prerelease: true,
  assets: [PRERELEASE_ARM64_DMG],
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

// Nothing eligible never becomes a broken button: the answer falls back to the
// releases page with no version claim attached.
const FALLBACK = (channel: "stable" | "beta") => ({
  channel,
  version: null,
  prerelease: null,
  url: RELEASES_FALLBACK_URL,
});

// The resolved download is the notarized arm64 DMG, not its updater ZIP.
assert.equal(SITE_RELEASE_CHANNEL, "beta");
assert.deepEqual(selectLatestRelease([STABLE], SITE_RELEASE_CHANNEL), {
  channel: "beta",
  version: "0.0.3",
  prerelease: false,
  url: ARM64_DMG.browser_download_url,
});

// During the launch phase, a newer prerelease becomes the direct download.
const PRERELEASE_ANSWER = {
  channel: "beta",
  version: "0.0.4-alpha.1",
  prerelease: true,
  url: PRERELEASE_ARM64_DMG.browser_download_url,
};
assert.deepEqual(
  selectLatestRelease([PRERELEASE, STABLE], SITE_RELEASE_CHANNEL),
  PRERELEASE_ANSWER,
);
assert.deepEqual(
  selectLatestRelease([PRERELEASE], SITE_RELEASE_CHANNEL),
  PRERELEASE_ANSWER,
);

// Snapshots are public GitHub prereleases but never application versions. A
// failed cleanup can put more than one old API page ahead of the beta without
// changing the website's answer, whichever side of it GitHub returns them on.
assert.deepEqual(
  selectLatestRelease([...SNAPSHOTS, PRERELEASE, STABLE], SITE_RELEASE_CHANNEL),
  PRERELEASE_ANSWER,
);
assert.deepEqual(
  selectLatestRelease([PRERELEASE, STABLE, ...SNAPSHOTS], SITE_RELEASE_CHANNEL),
  PRERELEASE_ANSWER,
);
assert.deepEqual(
  selectLatestRelease(
    [
      { ...SNAPSHOTS[0], tag_name: "snapshot-latest" },
      { ...SNAPSHOTS[1], assets: [CHECKSUMS, SBOM] },
      PRERELEASE,
    ],
    SITE_RELEASE_CHANNEL,
  ),
  PRERELEASE_ANSWER,
);

// Drafts are invisible to a logged-out visitor and are not offered either.
assert.deepEqual(
  selectLatestRelease([DRAFT, PRERELEASE], SITE_RELEASE_CHANNEL),
  PRERELEASE_ANSWER,
);

// Reverting the one channel constant to stable restores the long-term policy.
assert.deepEqual(selectLatestRelease([PRERELEASE, STABLE], "stable"), {
  channel: "stable",
  version: "0.0.3",
  prerelease: false,
  url: ARM64_DMG.browser_download_url,
});
assert.deepEqual(selectLatestRelease([PRERELEASE], "stable"), FALLBACK("stable"));

// Network ordering and network text are not version policy. A malformed stable
// tag is ignored, and the greatest canonical stable version wins even when
// GitHub returns it after an older release.
const NEWER_ARM64_DMG = {
  name: "Guild-Wars-Reforged-2026.8.0-macOS-arm64.dmg",
  browser_download_url:
    "https://github.com/Mat4m0/gwonmac/releases/download/v2026.8.0/Guild-Wars-Reforged-2026.8.0-macOS-arm64.dmg",
};
const NEWER_STABLE = {
  tag_name: "v2026.8.0",
  draft: false,
  prerelease: false,
  assets: [NEWER_ARM64_DMG],
};
assert.deepEqual(
  selectLatestRelease([{ ...STABLE, tag_name: "banana" }], SITE_RELEASE_CHANNEL),
  FALLBACK("beta"),
);
assert.deepEqual(selectLatestRelease([STABLE, NEWER_STABLE], SITE_RELEASE_CHANNEL), {
  channel: "beta",
  version: "2026.8.0",
  prerelease: false,
  url: NEWER_ARM64_DMG.browser_download_url,
});

// A stable release whose macOS build has not finished uploading is skipped
// rather than announced with a releases-page link under its version number.
assert.deepEqual(
  selectLatestRelease([{ ...STABLE, assets: [CHECKSUMS, SBOM] }], SITE_RELEASE_CHANNEL),
  FALLBACK("beta"),
);

// Offline, rate-limited, or unreadable: `fetch` rejecting (`null`) and
// GitHub's error object both reach the selector as something that is not an
// array of releases.
assert.deepEqual(selectLatestRelease(null, SITE_RELEASE_CHANNEL), FALLBACK("beta"));
assert.deepEqual(
  selectLatestRelease({ message: "API rate limit exceeded" }, SITE_RELEASE_CHANNEL),
  FALLBACK("beta"),
);

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

// Every rendered download button points at /download, the live redirect, in the
// HTML itself. Resolving the DMG in the browser instead left the buttons on the
// releases page until hydration finished, and a third of clicks arrived first.
const downloadLinks = (page: string) =>
  [
    ...page.matchAll(
      /<a href="([^"]+)"[^>]*>(?:(?!<\/a>)[\s\S])*?(?:Direct|Direkter) Download/g,
    ),
  ].map((match) => match[1] ?? assert.fail("download link without href"));

try {
  const home = await load("/");
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /<h1[^>]*>Play Guild Wars natively on your Mac<\/h1>/);
  assert.match(
    html,
    /https:\/\/plausible\.io\/js\/pa--X4qMlLVyMnUW4L8emwE_\.js/,
  );
  assert.match(html, /window\.plausible\.init\(\)/);

  // Hero and final CTA.
  assert.equal(downloadLinks(html).length, 2);
  for (const href of downloadLinks(html)) {
    assert.equal(href, "/download");
  }

  // The German landing page carries the same analytics and buttons; a
  // locale-prefixed link would be answered by the /de/download alias below.
  const germanHome = await load("/de");
  assert.equal(germanHome.status, 200);
  const germanHtml = await germanHome.text();
  assert.match(germanHtml, /<h1[^>]*>Spiele Guild Wars nativ auf deinem Mac<\/h1>/);
  assert.match(
    germanHtml,
    /https:\/\/plausible\.io\/js\/pa--X4qMlLVyMnUW4L8emwE_\.js/,
  );
  assert.equal(downloadLinks(germanHtml).length, 2);
  for (const href of downloadLinks(germanHtml)) {
    assert.match(href, /^\/(de\/)?download$/);
  }

  // The install guide replaced the old /install page and still hands the
  // visitor the releases page.
  const install = await load("/docs/guides/install");
  assert.equal(install.status, 200);
  const installHtml = await install.text();
  assert.match(
    installHtml,
    new RegExp(`href="${EXTERNAL_URLS.releases}/latest"`),
  );
  // The guide's direct download link goes through /download, which redirects
  // to the newest DMG (or the releases page when none is eligible) — always
  // inside this repository's releases space.
  assert.match(installHtml, /href="\/download"/);
  const download = await globalThis.fetch(`http://${host}:${port}/download`, {
    redirect: "manual",
  });
  assert.equal(download.status, 302);
  assert.match(
    download.headers.get("location") ?? "",
    new RegExp(`^${EXTERNAL_URLS.releases}/`),
  );
  // The alias the layer's locale-prefixed links land on.
  const germanDownload = await globalThis.fetch(`http://${host}:${port}/de/download`, {
    redirect: "manual",
  });
  assert.equal(germanDownload.status, 302);
  assert.equal(germanDownload.headers.get("location"), "/download");

  // The API route answers with the policy above whatever GitHub does: a direct
  // DMG when one is eligible, the releases page otherwise — always this repo.
  const latest = await load("/api/latest");
  assert.equal(latest.status, 200);
  const answer = (await latest.json()) as { channel: string; url: string };
  assert.equal(answer.channel, SITE_RELEASE_CHANNEL);
  assert.match(answer.url, new RegExp(`^${EXTERNAL_URLS.releases}/`));
} finally {
  await stopChildProcess(server);
}
