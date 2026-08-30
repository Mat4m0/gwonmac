/** Pin the one taskbar and Squirrel identity for every distribution channel. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  windowsAppUserModelId,
  windowsSquirrelPackageId,
} from "../../src/main/windows-shell.js";

describe("Windows shell identity", () => {
  it("keeps package identifiers space-free and taskbar identifiers exact", () => {
    assert.equal(windowsSquirrelPackageId("release"), "GuildWarsReforged");
    assert.equal(windowsSquirrelPackageId("preview"), "GuildWarsReforgedPreview");
    assert.equal(windowsSquirrelPackageId("development"), "GuildWarsReforgedDev");
    assert.equal(
      windowsAppUserModelId("Guild Wars Reforged"),
      "com.squirrel.GuildWarsReforged.Guild Wars Reforged",
    );
    assert.equal(
      windowsAppUserModelId("Guild Wars Reforged Preview"),
      "com.squirrel.GuildWarsReforgedPreview.Guild Wars Reforged Preview",
    );
  });

  it("refuses an identity the installer cannot create", () => {
    assert.throws(() => windowsAppUserModelId("Guild Wars Reforged Custom"));
  });
});
