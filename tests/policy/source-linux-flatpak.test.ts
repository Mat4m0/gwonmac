import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const manifest = readFileSync(
  "packaging/linux/io.github.mat4m0.gwonmac.yml",
  "utf8",
);
const wrapper = readFileSync("packaging/linux/gwonmac", "utf8");
const buildWorkflow = readFileSync(
  ".github/workflows/linux-flatpak-build.yml",
  "utf8",
);
const signedWorkflow = readFileSync(
  ".github/workflows/linux-signed-qualification.yml",
  "utf8",
);

describe("Linux Flatpak package", () => {
  it("uses the exact release identity and Electron sandbox wrapper", () => {
    assert.match(manifest, /^app-id: io\.github\.mat4m0\.gwonmac$/mu);
    assert.match(manifest, /^base: org\.electronjs\.Electron2\.BaseApp$/mu);
    assert.match(wrapper, /exec zypak-wrapper/u);
    assert.doesNotMatch(wrapper, /--no-sandbox/u);
  });

  it("starts Xwayland-first with bounded device and portal access", () => {
    assert.match(manifest, /--socket=x11/u);
    assert.doesNotMatch(manifest, /--socket=wayland/u);
    assert.match(manifest, /--device=dri/u);
    assert.doesNotMatch(manifest, /--device=input/u);
    assert.doesNotMatch(manifest, /--device=all/u);
    assert.doesNotMatch(manifest, /--talk-name=org\.freedesktop\.secrets/u);
  });

  it("does not grant broad host filesystem access", () => {
    assert.doesNotMatch(manifest, /--filesystem=(?:host|home)(?::|\s|$)/u);
    assert.doesNotMatch(manifest, /--persist=/u);
  });

  it("installs only GPG-verified repository output in qualification", () => {
    for (const workflow of [buildWorkflow, signedWorkflow]) {
      assert.match(workflow, /--gpg-sign=/u);
      assert.match(workflow, /build-update-repo --gpg-sign=/u);
      assert.match(workflow, /remote-add --user --gpg-import=/u);
      assert.doesNotMatch(workflow, /--no-gpg-verify/u);
      assert.doesNotMatch(workflow, /publish|pages/u);
    }
  });

  it("keeps native Wayland out of the default package gate", () => {
    const defaultGate = buildWorkflow.split("\n  native-wayland:", 1)[0] ?? "";
    assert.match(defaultGate, /installed-xwayland/u);
    assert.doesNotMatch(defaultGate, /GW_LINUX_NATIVE_WAYLAND/u);
    assert.match(buildWorkflow, /native-wayland:[\s\S]*GW_LINUX_NATIVE_WAYLAND=1/u);
  });

  it("starts desktop session buses inside their X display", () => {
    for (const workflow of [buildWorkflow, signedWorkflow]) {
      assert.match(workflow, /xvfb-run -a dbus-run-session --/u);
      assert.doesNotMatch(workflow, /dbus-run-session -- xvfb-run/u);
    }
  });
});
