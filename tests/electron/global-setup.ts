import { existsSync } from "node:fs";
import { electronBin, main } from "./fixtures.mjs";

export default function verifyElectronPrerequisites(): void {
  const missing = [main, electronBin].filter((file) => !existsSync(file));
  if (missing.length > 0) {
    throw new Error(
      `Electron test prerequisites are missing:\n${missing.join("\n")}\n`
      + "Run pnpm install and pnpm build before pnpm test:electron.",
    );
  }
}
