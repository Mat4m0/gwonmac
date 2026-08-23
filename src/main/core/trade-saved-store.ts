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
    return this.mutex.run(async () => {
      console.info("[trade:saved] store read started");
      try {
        const saved = await load(this.path);
        console.info("[trade:saved] store read completed", counts(saved));
        return saved;
      } catch (error) {
        console.error("[trade:saved] store read failed", storeError(error));
        throw error;
      }
    });
  }

  set(value: TradeSavedState): Promise<TradeSavedState> {
    return this.mutex.run(async () => {
      console.info("[trade:saved] store write started", counts(value));
      try {
        const saved = parseTradeSavedState(value);
        console.info("[trade:saved] store write validated", counts(saved));
        await writeAtomicJson(this.path, saved, 0o600);
        console.info("[trade:saved] store write completed", counts(saved));
        return saved;
      } catch (error) {
        console.error("[trade:saved] store write failed", storeError(error));
        throw error;
      }
    });
  }
}

function counts(value: TradeSavedState): Readonly<{ offers: number; players: number }> {
  return { offers: value.offers.length, players: value.players.length };
}

/** Keep paths, player names, and offer text out of logs. */
function storeError(error: unknown): Readonly<{ name: string; code?: string }> {
  if (!(error instanceof Error)) return { name: typeof error };
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  return code ? { name: error.name, code } : { name: error.name };
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
