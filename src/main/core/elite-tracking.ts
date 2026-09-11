/**
 * Saves character capture plans atomically within the owning account profile.
 * Serialized actions merge current disk state, so two windows cannot lose a plan.
 */
import { readFile } from "node:fs/promises";
import { ELITE_LOCATIONS } from "../../shared/elite-locations.js";
import {
  EMPTY_ELITE_TRACKING, changeEliteTracking, parseEliteTracking,
  type EliteTracking, type EliteUpdate,
} from "../../shared/elite-skills.js";
import { isTravelCharacterKey, type TravelCharacterKey } from "../../shared/travel-history.js";
import { writeAtomicJson } from "./atomic-file.js";
import { quarantineCorruptDocument } from "./corrupt-document.js";
import { Mutex } from "./mutex.js";

type Document = { formatVersion: 1; characters: Record<string, EliteTracking> };
async function read(path: string): Promise<Document> {
  let text: string;
  try { text = await readFile(path, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { formatVersion: 1, characters: {} };
    throw error;
  }
  try {
    const input = JSON.parse(text) as Document;
    if (input?.formatVersion !== 1 || typeof input.characters !== "object" || !input.characters
      || Array.isArray(input.characters) || Object.keys(input).length !== 2
      || Object.keys(input.characters).length > 64) throw new TypeError("Invalid capture plans");
    const characters: Record<string, EliteTracking> = {};
    for (const [key, value] of Object.entries(input.characters)) {
      if (!isTravelCharacterKey(key)) throw new TypeError("Invalid character");
      characters[key] = parseEliteTracking(value, ELITE_LOCATIONS);
    }
    return { formatVersion: 1, characters };
  } catch {
    await quarantineCorruptDocument(path);
    return { formatVersion: 1, characters: {} };
  }
}
export class EliteTrackingStore {
  readonly #locks = new Map<string, Mutex>();
  #lock(path: string): Mutex {
    let lock = this.#locks.get(path);
    if (!lock) { lock = new Mutex(); this.#locks.set(path, lock); }
    return lock;
  }
  get(path: string, characterKey: TravelCharacterKey): Promise<EliteTracking> {
    return this.#lock(path).run(async () => (await read(path)).characters[characterKey] ?? EMPTY_ELITE_TRACKING);
  }
  update(path: string, { characterKey, change }: EliteUpdate): Promise<EliteTracking> {
    return this.#lock(path).run(async () => {
      const document = await read(path);
      if (!(characterKey in document.characters) && Object.keys(document.characters).length >= 64) {
        throw new Error("This profile has reached its character tracking limit");
      }
      const next = changeEliteTracking(document.characters[characterKey] ?? EMPTY_ELITE_TRACKING, change, ELITE_LOCATIONS);
      document.characters[characterKey] = next;
      await writeAtomicJson(path, document);
      return next;
    });
  }
}
