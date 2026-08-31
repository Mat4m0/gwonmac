/**
 * Serializes atomic Character Switch usage updates. Corrupt convenience data
 * is quarantined and cannot affect the live account list or switching.
 */

import { readFile } from "node:fs/promises";
import {
  EMPTY_CHARACTER_SWITCH_USAGE,
  parseCharacterSwitchUsageDocument,
  recordSuccessfulCharacterSwitch,
  type CharacterSwitchUsageDocument,
} from "../../shared/character-switch-usage.js";
import { writeAtomicJson } from "./atomic-file.js";
import { quarantineCorruptDocument } from "./corrupt-document.js";

async function readDocument(path: string): Promise<CharacterSwitchUsageDocument> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return EMPTY_CHARACTER_SWITCH_USAGE;
    }
    throw error;
  }
  try {
    return parseCharacterSwitchUsageDocument(JSON.parse(text) as unknown);
  } catch {
    await quarantineCorruptDocument(path);
    return EMPTY_CHARACTER_SWITCH_USAGE;
  }
}

export class CharacterSwitchUsageStore {
  readonly #path: string;
  #tail: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation);
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }

  get(): Promise<CharacterSwitchUsageDocument> {
    return this.#enqueue(() => readDocument(this.#path));
  }

  record(characterKey: string): Promise<CharacterSwitchUsageDocument> {
    return this.#enqueue(async () => {
      const next = recordSuccessfulCharacterSwitch(
        await readDocument(this.#path),
        characterKey,
      );
      await writeAtomicJson(this.#path, next);
      return next;
    });
  }
}
