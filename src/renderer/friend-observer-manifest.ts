/**
 * Decodes the input-bound friend observer manifest. The closed manifest is the
 * only route from Main certification to a native friend-table root.
 */
import { FRIEND_OBSERVER_MANIFEST_SECTION, FRIEND_OBSERVER_SEMANTIC_SHA256, FRIEND_OBSERVER_TRANSFORM_ABI } from
  "../shared/friend-observer-contract.js";
import { isDigest } from "../shared/digest.js";

export type FriendObserverManifest = Readonly<{
  root: number;
  inputSha256: string;
  semanticSha256: string;
}>;

export function decodeFriendObserverManifest(
  module: WebAssembly.Module,
): FriendObserverManifest | null {
  const sections = WebAssembly.Module.customSections(module, FRIEND_OBSERVER_MANIFEST_SECTION);
  if (sections.length !== 1) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(sections[0]));
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join() !== "inputSha256,root,semanticSha256,transformAbi"
      || (value as { transformAbi?: unknown }).transformAbi !== FRIEND_OBSERVER_TRANSFORM_ABI
      || !isDigest((value as { inputSha256?: unknown }).inputSha256)
      || (value as { semanticSha256?: unknown }).semanticSha256 !== FRIEND_OBSERVER_SEMANTIC_SHA256
      || !Number.isSafeInteger((value as { root?: unknown }).root)
      || Number((value as { root: number }).root) <= 0
      || Number((value as { root: number }).root) % 4 !== 0) return null;
    const manifest = value as { root: number; inputSha256: string; semanticSha256: string };
    return Object.freeze({ root: manifest.root, inputSha256: manifest.inputSha256,
      semanticSha256: manifest.semanticSha256 });
  } catch { return null; }
}
