/**
 * Serializes the global Cartography map-knowledge ledger. The records contain
 * reusable revealable-cell masks, never character progress or display counts.
 */
import { readFile } from "node:fs/promises";
import { isDigest } from "../../shared/digest.js";
import {
  CARTOGRAPHY_MAP_KNOWLEDGE_LIMIT,
  parseCartographyMapKnowledge,
  type CartographyMapKnowledge,
} from "../../shared/cartography-map-knowledge.js";
import { writeAtomicJson } from "./atomic-file.js";
import { quarantineCorruptDocument } from "./corrupt-document.js";

const FORMAT_VERSION = 1;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

type StoredRecord = Omit<CartographyMapKnowledge, "kernelSha256" | "words">
  & Readonly<{ wordsBase64: string }>;
type StoredDocument = Readonly<{
  formatVersion: typeof FORMAT_VERSION;
  clientFingerprint: string;
  kernelSha256: string;
  records: readonly StoredRecord[];
}>;

function encodeWords(words: readonly number[]): string {
  const bytes = Buffer.allocUnsafe(words.length * 4);
  words.forEach((word, index) => bytes.writeUInt32LE(word, index * 4));
  return bytes.toString("base64");
}

function decodeRecord(value: unknown, kernelSha256: string): CartographyMapKnowledge {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("cartography map knowledge record must be an object");
  }
  const source = value as Record<string, unknown>;
  if (typeof source.wordsBase64 !== "string" || !BASE64.test(source.wordsBase64)) {
    throw new Error("cartography map knowledge record has invalid encoding");
  }
  const unknown = Object.keys(source).filter((key) => ![
    "mapId", "continent", "width", "height", "revealRadius", "wordsBase64",
  ].includes(key));
  if (unknown.length > 0) {
    throw new Error(`cartography map knowledge record has unknown fields: ${unknown.join(", ")}`);
  }
  const bytes = Buffer.from(source.wordsBase64, "base64");
  if (bytes.byteLength % 4 !== 0) {
    throw new Error("cartography map knowledge record has partial words");
  }
  const words = Array.from(
    { length: bytes.byteLength / 4 },
    (_, index) => bytes.readUInt32LE(index * 4),
  );
  return parseCartographyMapKnowledge({
    kernelSha256,
    mapId: source.mapId,
    continent: source.continent,
    width: source.width,
    height: source.height,
    revealRadius: source.revealRadius,
    words,
  });
}

function parseDocument(value: unknown): StoredDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("cartography map knowledge document must be an object");
  }
  const source = value as Record<string, unknown>;
  const kernelSha256 = source.kernelSha256;
  if (
    source.formatVersion !== FORMAT_VERSION
    || !isDigest(source.clientFingerprint)
    || !isDigest(kernelSha256)
  ) {
    throw new Error("cartography map knowledge document has invalid identity");
  }
  if (!Array.isArray(source.records) || source.records.length > CARTOGRAPHY_MAP_KNOWLEDGE_LIMIT) {
    throw new Error("cartography map knowledge document has invalid records");
  }
  const records = source.records.map((record) => store(decodeRecord(record, kernelSha256)));
  const keys = records.map((record) => `${record.mapId}:${record.revealRadius}`);
  if (new Set(keys).size !== keys.length) {
    throw new Error("cartography map knowledge document has duplicate records");
  }
  const unknown = Object.keys(source).filter(
    (key) => !["formatVersion", "clientFingerprint", "kernelSha256", "records"].includes(key),
  );
  if (unknown.length > 0) {
    throw new Error(`cartography map knowledge document has unknown fields: ${unknown.join(", ")}`);
  }
  return Object.freeze({
    formatVersion: FORMAT_VERSION,
    clientFingerprint: source.clientFingerprint,
    kernelSha256,
    records: Object.freeze(records),
  });
}

async function readDocument(path: string): Promise<StoredDocument | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    return parseDocument(JSON.parse(text) as unknown);
  } catch {
    await quarantineCorruptDocument(path);
    return null;
  }
}

function decode(
  records: readonly StoredRecord[],
  kernelSha256: string,
): readonly CartographyMapKnowledge[] {
  return Object.freeze(records.map((record) => decodeRecord(record, kernelSha256)));
}

function store(record: CartographyMapKnowledge): StoredRecord {
  return Object.freeze({
    mapId: record.mapId,
    continent: record.continent,
    width: record.width,
    height: record.height,
    revealRadius: record.revealRadius,
    wordsBase64: encodeWords(record.words),
  });
}

export class CartographyMapKnowledgeStore {
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

  get(
    clientFingerprint: string,
    kernelSha256: string,
  ): Promise<readonly CartographyMapKnowledge[]> {
    return this.#enqueue(async () => {
      const document = await readDocument(this.#path);
      return document?.clientFingerprint === clientFingerprint
        && document.kernelSha256 === kernelSha256
        ? decode(document.records, kernelSha256)
        : [];
    });
  }

  record(
    clientFingerprint: string,
    value: CartographyMapKnowledge,
  ): Promise<readonly CartographyMapKnowledge[]> {
    return this.#enqueue(async () => {
      const document = await readDocument(this.#path);
      const records = document?.clientFingerprint === clientFingerprint
        && document.kernelSha256 === value.kernelSha256
        ? [...document.records]
        : [];
      const index = records.findIndex(
        (record) => record.mapId === value.mapId && record.revealRadius === value.revealRadius,
      );
      const previous = index < 0 ? null : decodeRecord(records[index], value.kernelSha256);
      const compatible = previous !== null
        && previous.continent === value.continent
        && previous.width === value.width
        && previous.height === value.height;
      const words = compatible
        ? value.words.map((word, wordIndex) => (word | previous.words[wordIndex]!) >>> 0)
        : value.words;
      const next = parseCartographyMapKnowledge({ ...value, words });
      const unchanged = compatible && next.words.every(
        (word, wordIndex) => word === previous.words[wordIndex],
      );
      if (unchanged && document !== null) {
        return decode(document.records, value.kernelSha256);
      }
      if (index >= 0) records.splice(index, 1);
      records.push(store(next));
      const bounded = records.slice(-CARTOGRAPHY_MAP_KNOWLEDGE_LIMIT);
      const saved: StoredDocument = Object.freeze({
        formatVersion: FORMAT_VERSION,
        clientFingerprint,
        kernelSha256: value.kernelSha256,
        records: Object.freeze(bounded),
      });
      await writeAtomicJson(this.#path, saved, 0o600);
      return decode(saved.records, value.kernelSha256);
    });
  }
}
