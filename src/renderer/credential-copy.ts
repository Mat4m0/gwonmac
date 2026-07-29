import type { DesktopPlatform } from "../shared/contracts.js";

export function credentialProtectionCopy(
  platform: DesktopPlatform | null,
): string {
  if (platform === "macos") {
    return "Remember Password uses local encryption in this preview. It is not Keychain-backed and has weaker same-user protection.";
  }
  if (platform === "windows") {
    return "Remember Password is protected by the signed-in Windows account. Other software running as that user is outside this guarantee.";
  }
  if (platform === "linux") {
    return "Remember Password is available only when Secret Service or KWallet is unlocked. Insecure or unavailable storage is refused.";
  }
  return "Remember Password is unavailable until secure storage is ready.";
}
