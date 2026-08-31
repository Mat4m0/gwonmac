import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  flatpakApplicationId,
  trustedFlatpakIdentity,
} from "../../src/main/linux-flatpak.ts";

const releaseInfo = `[Application]
name=io.github.mat4m0.gwonmac
runtime=runtime/org.freedesktop.Platform/x86_64/24.08
`;

describe("Flatpak identity", () => {
  it("reads the application ID from the mounted metadata", () => {
    assert.equal(
      flatpakApplicationId(releaseInfo),
      "io.github.mat4m0.gwonmac",
    );
  });

  it("requires the mounted and environment identities to agree", () => {
    assert.equal(trustedFlatpakIdentity({
      info: releaseInfo,
      environmentId: "io.github.mat4m0.gwonmac",
      expectedId: "io.github.mat4m0.gwonmac",
    }), true);
    assert.equal(trustedFlatpakIdentity({
      info: releaseInfo,
      environmentId: "io.github.attacker.gwonmac",
      expectedId: "io.github.mat4m0.gwonmac",
    }), false);
  });

  it("refuses duplicate, missing, and malformed IDs", () => {
    assert.equal(flatpakApplicationId(`${releaseInfo}name=io.github.other.app\n`), null);
    assert.equal(flatpakApplicationId("[Instance]\nname=io.github.mat4m0.gwonmac\n"), null);
    assert.equal(flatpakApplicationId("[Application]\nname=../gwonmac\n"), null);
  });
});
