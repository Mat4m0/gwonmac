import assert from "node:assert/strict";
import { test } from "node:test";
import { credentialProtectionCopy } from "../../src/renderer/credential-copy.js";

test("saved-login copy states each platform boundary without provider text", () => {
  assert.match(
    credentialProtectionCopy("macos"),
    /not Keychain-backed.*weaker same-user protection/u,
  );
  assert.match(
    credentialProtectionCopy("windows"),
    /signed-in Windows account.*outside this guarantee/u,
  );
  assert.match(
    credentialProtectionCopy("linux"),
    /Secret Service or KWallet.*Insecure or unavailable storage is refused/u,
  );
  assert.equal(
    credentialProtectionCopy(null),
    "Remember Password is unavailable until secure storage is ready.",
  );
  for (const platform of ["macos", "windows", "linux"] as const) {
    assert.doesNotMatch(
      credentialProtectionCopy(platform),
      /basic_text|gnome_libsecret|kwallet[0-9]|error|failed/u,
    );
  }
});
