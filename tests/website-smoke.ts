import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { RELEASE_REPO } from "../src/shared/project-identity.ts";
import {
  RELEASES_FALLBACK_URL,
  selectLatestRelease,
} from "../apps/website/server/utils/release-select.ts";
import { stopChildProcess } from "./helpers/child-process.ts";

// The download button, executed rather than described. The server
// route's selection policy runs here against release payloads shaped like the
// ones the release workflow publishes; the rendered pages below prove what a
// visitor gets before any of that resolves.
const ARM64_DMG = {
  name: "Guild-Wars-Reforged-0.0.3-macOS-arm64.dmg",
  browser_download_url:
    "https://github.com/Mat4m0/gwonmac/releases/download/v0.0.3/Guild-Wars-Reforged-0.0.3-macOS-arm64.dmg",
};
const RELEASES_URL = `https://github.com/${RELEASE_REPO}/releases`;
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
const ALPHA_ARM64_DMG = {
  name: "Guild-Wars-Reforged-0.0.4-alpha.1-macOS-arm64.dmg",
  browser_download_url:
    "https://github.com/Mat4m0/gwonmac/releases/download/v0.0.4-alpha.1/Guild-Wars-Reforged-0.0.4-alpha.1-macOS-arm64.dmg",
};
const ALPHA = {
  tag_name: "v0.0.4-alpha.1",
  draft: false,
  prerelease: true,
  assets: [ALPHA_ARM64_DMG],
};
const BETA_ARM64_DMG = {
  name: "Guild-Wars-Reforged-0.0.4-beta.1-macOS-arm64.dmg",
  browser_download_url:
    "https://github.com/Mat4m0/gwonmac/releases/download/v0.0.4-beta.1/Guild-Wars-Reforged-0.0.4-beta.1-macOS-arm64.dmg",
};
const BETA = {
  tag_name: "v0.0.4-beta.1",
  draft: false,
  prerelease: true,
  assets: [BETA_ARM64_DMG],
};
const RC_ARM64_DMG = {
  name: "Guild-Wars-Reforged-0.0.4-rc.1-macOS-arm64.dmg",
  browser_download_url:
    "https://github.com/Mat4m0/gwonmac/releases/download/v0.0.4-rc.1/Guild-Wars-Reforged-0.0.4-rc.1-macOS-arm64.dmg",
};
const RC = {
  tag_name: "v0.0.4-rc.1",
  draft: false,
  prerelease: true,
  assets: [RC_ARM64_DMG],
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
const FALLBACK = {
  version: null,
  url: RELEASES_FALLBACK_URL,
};

// The resolved download is the notarized arm64 DMG, not its updater ZIP.
assert.deepEqual(selectLatestRelease([STABLE], "stable"), {
  version: "0.0.3",
  url: ARM64_DMG.browser_download_url,
});
assert.deepEqual(
  selectLatestRelease([{
    ...STABLE,
    assets: [{
      ...ARM64_DMG,
      name: "unrelated-arm64.dmg",
      browser_download_url:
        "https://github.com/Mat4m0/gwonmac/releases/download/v0.0.3/unrelated-arm64.dmg",
    }],
  }], "stable"),
  FALLBACK,
);
assert.deepEqual(
  selectLatestRelease([{
    ...STABLE,
    assets: [{
      ...ARM64_DMG,
      browser_download_url: "https://attacker.invalid/release.dmg",
    }],
  }], "stable"),
  FALLBACK,
);

// Beta is explicit, includes release candidates, and never admits alpha.
const BETA_ANSWER = {
  version: "0.0.4-rc.1",
  url: RC_ARM64_DMG.browser_download_url,
};
assert.deepEqual(
  selectLatestRelease([ALPHA, BETA, RC, STABLE], "beta"),
  BETA_ANSWER,
);
assert.deepEqual(
  selectLatestRelease([ALPHA], "beta"),
  FALLBACK,
);
assert.deepEqual(
  selectLatestRelease([{ ...BETA, prerelease: false }], "beta"),
  FALLBACK,
);

// Snapshots are public GitHub prereleases but never application versions. A
// failed cleanup can put more than one old API page ahead of the beta without
// changing the website's answer, whichever side of it GitHub returns them on.
assert.deepEqual(
  selectLatestRelease([...SNAPSHOTS, RC, STABLE], "beta"),
  BETA_ANSWER,
);
assert.deepEqual(
  selectLatestRelease([RC, STABLE, ...SNAPSHOTS], "beta"),
  BETA_ANSWER,
);
assert.deepEqual(
  selectLatestRelease(
    [
      { ...SNAPSHOTS[0], tag_name: "snapshot-latest" },
      { ...SNAPSHOTS[1], assets: [CHECKSUMS, SBOM] },
      RC,
    ],
    "beta",
  ),
  BETA_ANSWER,
);

// Drafts are invisible to a logged-out visitor and are not offered either.
assert.deepEqual(
  selectLatestRelease([DRAFT, RC], "beta"),
  BETA_ANSWER,
);
for (const draft of [undefined, "false", true]) {
  assert.deepEqual(
    selectLatestRelease([{ ...STABLE, draft }], "stable"),
    FALLBACK,
  );
}

// Stable remains the primary public download even when newer candidates exist.
assert.deepEqual(selectLatestRelease([ALPHA, BETA, RC, STABLE], "stable"), {
  version: "0.0.3",
  url: ARM64_DMG.browser_download_url,
});
assert.deepEqual(selectLatestRelease([BETA, RC], "stable"), FALLBACK);

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
  selectLatestRelease([{ ...STABLE, tag_name: "banana" }], "stable"),
  FALLBACK,
);
assert.deepEqual(selectLatestRelease([STABLE, NEWER_STABLE], "stable"), {
  version: "2026.8.0",
  url: NEWER_ARM64_DMG.browser_download_url,
});

// A stable release whose macOS build has not finished uploading is skipped
// rather than announced with a releases-page link under its version number.
assert.deepEqual(
  selectLatestRelease([{ ...STABLE, assets: [CHECKSUMS, SBOM] }], "stable"),
  FALLBACK,
);

// Offline, rate-limited, or unreadable: `fetch` rejecting (`null`) and
// GitHub's error object both reach the selector as something that is not an
// array of releases.
assert.deepEqual(selectLatestRelease(null, "stable"), FALLBACK);
assert.deepEqual(
  selectLatestRelease({ message: "API rate limit exceeded" }, "stable"),
  FALLBACK,
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

async function assertNoUnsupportedPerformancePromises(
  pathname: string,
): Promise<void> {
  const response = await load(pathname);
  assert.equal(response.status, 200, `${pathname} did not render`);
  const html = await response.text();
  assert.doesNotMatch(
    html,
    /\b\d+(?:[.,]\d+)?(?:\s*(?:–|-|to|bis)\s*\d+(?:[.,]\d+)?)?\s*FPS\b/i,
    `${pathname} publishes an unsupported frame-rate promise`,
  );
  assert.doesNotMatch(
    html,
    /\b(?:4K|5K)\b/i,
    `${pathname} publishes an unsupported display-resolution promise`,
  );
  assert.doesNotMatch(
    html,
    /\b(?:CPU|RAM)\b/i,
    `${pathname} publishes unsupported resource-use marketing`,
  );
  assert.doesNotMatch(
    html,
    /\b(?:about a minute|under a minute)\b|~\s*4\s*GB/i,
    `${pathname} publishes an unsupported fixed time or download-size promise`,
  );
}

// Every rendered download button points at /download, the live redirect, in the
// HTML itself. Resolving the DMG in the browser instead left the buttons on the
// releases page until hydration finished, and a third of clicks arrived first.
const downloadLinks = (page: string) =>
  [
    ...page.matchAll(
      /<a href="([^"]+)"[^>]*>(?:(?!<\/a>)[\s\S])*?(?:Download for Mac|Für Mac herunterladen)/g,
    ),
  ].map((match) => match[1] ?? assert.fail("download link without href"));

try {
  const home = await load("/");
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /<h1[^>]*>Play Guild Wars on your Mac<\/h1>/);
  assert.match(
    html,
    /https:\/\/plausible\.io\/js\/pa--X4qMlLVyMnUW4L8emwE_\.js/,
  );
  assert.match(html, /window\.plausible\.init\(\)/);
  assert.match(html, /Apple Silicon Macs/i);
  assert.match(html, /signed and notarized/i);
  assert.doesNotMatch(html, /(?:60|120)\s*(?:–|-|to)?\s*(?:120\s*)?FPS/i);
  assert.doesNotMatch(html, /(?:4K|5K)/i);

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
  assert.match(germanHtml, /<h1[^>]*>Spiele Guild Wars auf deinem Mac<\/h1>/);
  assert.match(
    germanHtml,
    /https:\/\/plausible\.io\/js\/pa--X4qMlLVyMnUW4L8emwE_\.js/,
  );
  assert.equal(downloadLinks(germanHtml).length, 2);
  for (const href of downloadLinks(germanHtml)) {
    assert.match(href, /^\/(de\/)?download$/);
  }
  // Public performance-sensitive prose stays qualitative. Controlled, dated
  // measurements belong in docs/performance-electron.md, not in marketing
  // pages assembled from individual tester reports.
  await assertNoUnsupportedPerformancePromises("/docs/guides/performance");
  await assertNoUnsupportedPerformancePromises(
    "/docs/guides/play-guild-wars-on-mac",
  );
  await assertNoUnsupportedPerformancePromises(
    "/de/dokumentation/anleitungen/leistung",
  );
  await assertNoUnsupportedPerformancePromises(
    "/de/dokumentation/anleitungen/guild-wars-auf-dem-mac-spielen",
  );
  await assertNoUnsupportedPerformancePromises(
    "/blog/guild-wars-native-on-apple-silicon",
  );

  // The install guide replaced the old /install page and still hands the
  // visitor the releases page.
  const install = await load("/docs/guides/install");
  assert.equal(install.status, 200);
  const installHtml = await install.text();
  assert.match(
    installHtml,
    new RegExp(`href="${RELEASES_URL}/latest"`),
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
    new RegExp(`^${RELEASES_URL}/`),
  );
  const betaDownload = await globalThis.fetch(
    `http://${host}:${port}/download?channel=beta`,
    { redirect: "manual" },
  );
  assert.equal(betaDownload.status, 302);
  assert.match(
    betaDownload.headers.get("location") ?? "",
    new RegExp(`^${RELEASES_URL}/`),
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
  const answer = (await latest.json()) as { url: string };
  assert.match(answer.url, new RegExp(`^${RELEASES_URL}/`));
  const betaLatest = await load("/api/latest?channel=beta");
  assert.equal(betaLatest.status, 200);
  const betaAnswer = (await betaLatest.json()) as { url: string };
  assert.match(betaAnswer.url, new RegExp(`^${RELEASES_URL}/`));
} finally {
  await stopChildProcess(server);
}
