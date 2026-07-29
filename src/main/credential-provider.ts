import type { SafeStorage } from "electron";
import type {
  CredentialProtection,
  CredentialProvider,
} from "./core/credentials.js";

const SECURE_LINUX_BACKENDS = new Set([
  "gnome_libsecret",
  "kwallet",
  "kwallet5",
  "kwallet6",
]);

function synchronousProvider(
  storage: SafeStorage,
  protection: CredentialProtection,
  acceptsLegacyRawCiphertext: boolean,
  available: () => boolean,
): CredentialProvider {
  return {
    protection,
    acceptsLegacyRawCiphertext,
    available: async () => available(),
    encrypt: async (plaintext) => storage.encryptString(plaintext),
    decrypt: async (ciphertext) => ({
      plaintext: storage.decryptString(ciphertext),
      shouldReEncrypt: false,
    }),
  };
}

function asynchronousProvider(
  storage: SafeStorage,
  protection: CredentialProtection,
  acceptsLegacyRawCiphertext: boolean,
): CredentialProvider {
  return {
    protection,
    acceptsLegacyRawCiphertext,
    available: () => storage.isAsyncEncryptionAvailable(),
    encrypt: (plaintext) => storage.encryptStringAsync(plaintext),
    decrypt: async (ciphertext) => {
      const result = await storage.decryptStringAsync(ciphertext);
      return {
        plaintext: result.result,
        shouldReEncrypt: result.shouldReEncrypt,
      };
    },
  };
}

export function createCredentialProvider(
  platform: string,
  storage: SafeStorage,
): CredentialProvider {
  if (platform === "linux") {
    return synchronousProvider(
      storage,
      "linux-keyring-v1",
      false,
      () =>
        SECURE_LINUX_BACKENDS.has(storage.getSelectedStorageBackend())
        && storage.isEncryptionAvailable(),
    );
  }
  if (platform === "darwin") {
    return asynchronousProvider(
      storage,
      "mac-preview-mock-v1",
      true,
    );
  }
  if (platform === "win32") {
    return asynchronousProvider(storage, "os-safe-storage-v1", false);
  }
  throw new Error(`unsupported credential platform: ${platform}`);
}
