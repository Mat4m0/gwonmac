import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const manifest = readFileSync(
  "packaging/linux/io.github.mat4m0.gwonmac.yml",
  "utf8",
);
const wrapper = readFileSync("packaging/linux/gwonmac", "utf8");

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
});
