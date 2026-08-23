/**
 * Owns the one durable, bounded document of starred offers and players.
 * Feed history remains transient; only explicit player choices reach disk.
 */
import { readFile } from "node:fs/promises";
import {
  EMPTY_TRADE_SAVED_STATE,
  parseTradeSavedState,
  type TradeSavedState,
} from "../../shared/trade-chat.js";
import { writeAtomicJson } from "./atomic-file.js";
import { quarantineCorruptDocument } from "./corrupt-document.js";
import { Mutex } from "./mutex.js";

export class TradeSavedStore {
  private readonly mutex = new Mutex();
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  get(): Promise<TradeSavedState> {
    return this.mutex.run(() => load(this.path));
  }

  set(value: TradeSavedState): Promise<TradeSavedState> {
    return this.mutex.run(async () => {
      const saved = parseTradeSavedState(value);
      await writeAtomicJson(this.path, saved, 0o600);
      return saved;
    });
  }
}

async function load(path: string): Promise<TradeSavedState> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_TRADE_SAVED_STATE;
    throw error;
  }
  try {
    return parseTradeSavedState(JSON.parse(text) as unknown);
  } catch {
    await quarantineCorruptDocument(path);
    return EMPTY_TRADE_SAVED_STATE;
  }
}
