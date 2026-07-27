export type SkillDescriptionSource = Readonly<{
  stringId: number;
  scale0: number;
  scale15: number;
  bonusScale0: number;
  bonusScale15: number;
  duration0: number;
  duration15: number;
}>;

type SkillTextExports = WebAssembly.Exports & {
  memory: WebAssembly.Memory;
  __indirect_function_table: WebAssembly.Table;
  malloc(bytes: number): number;
  free(pointer: number): void;
  skill_text_resolve(encoded: number, callback: number, param: number): void;
};

const MANIFEST_SECTION = "enhancement_manifest";
const CALLBACK_TIMEOUT_MS = 5_000;
const MAX_DESCRIPTION_UNITS = 8_192;

// A WebAssembly table only accepts WebAssembly functions. This tiny module
// adapts the two-i32 client callback ABI to a normal JavaScript function.
const CALLBACK_MODULE = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x06, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x00,
  0x02, 0x10, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x08,
  0x63, 0x61, 0x6c, 0x6c, 0x62, 0x61, 0x63, 0x6b, 0x00, 0x00,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x0c, 0x01, 0x08, 0x63, 0x61, 0x6c, 0x6c, 0x62,
  0x61, 0x63, 0x6b, 0x00, 0x01,
  0x0a, 0x0a, 0x01, 0x08, 0x00, 0x20, 0x00, 0x20, 0x01,
  0x10, 0x00, 0x0b,
]);

export function encodeTextId(value: number): readonly number[] {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error("text id is outside the client encoding");
  }
  if (value < 0x7f00) return [value + 0x100];
  return [0x8000 | (value & 0x7fff), 0x100 + Math.floor(value / 0x8000)];
}

function substitution(value0: number, value15: number, placeholder: number): number {
  return value0 === value15 && value0 >= 0 && value0 < 0x7f00
    ? value0
    : placeholder;
}

/**
 * Encodes the full-description reference exactly as the client expects it.
 * The three arguments let the localized text engine place damage, bonus and
 * duration values; ranges are represented by private sentinels and expanded
 * after decoding.
 */
export function encodeSkillDescription(source: SkillDescriptionSource): Uint16Array {
  const values = [...encodeTextId(source.stringId)];
  for (const [marker, value] of [
    [0x10a, substitution(source.scale0, source.scale15, 991)],
    [0x10b, substitution(source.bonusScale0, source.bonusScale15, 992)],
    [0x10c, substitution(source.duration0, source.duration15, 993)],
  ] as const) {
    values.push(marker, 0x104, 0x101, 0x100 + value, 0x001);
  }
  values.push(0);
  return Uint16Array.from(values);
}

export function finishSkillDescription(
  decoded: string,
  source: SkillDescriptionSource,
): string {
  const replacements = new Map([
    ["991", `${source.scale0}–${source.scale15}`],
    ["992", `${source.bonusScale0}–${source.bonusScale15}`],
    ["993", `${source.duration0}–${source.duration15}`],
  ]);
  const readable = Array.from(decoded, (character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d
      ? ""
      : character;
  }).join("");
  return readable
    .replace(/\b(?:991|992|993)\b/gu, (value) => replacements.get(value) ?? value)
    .replace(/[ \t]+/gu, " ")
    .replace(/\s*\n\s*/gu, "\n")
    .trim();
}

function callbackSlot(module: WebAssembly.Module): number | null {
  const sections = WebAssembly.Module.customSections(module, MANIFEST_SECTION);
  if (sections.length !== 1) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(sections[0])) as
      Record<string, unknown>;
    return Number.isSafeInteger(value.textCallbackTableSlot)
      && Number(value.textCallbackTableSlot) >= 0
      ? Number(value.textCallbackTableSlot)
      : null;
  } catch {
    return null;
  }
}

function runtimeExports(
  instance: WebAssembly.Instance,
  module: WebAssembly.Module,
): { exports: SkillTextExports; slot: number } | null {
  const slot = callbackSlot(module);
  const value = instance.exports as Partial<SkillTextExports>;
  if (
    slot === null
    || !(value.memory instanceof WebAssembly.Memory)
    || !(value.__indirect_function_table instanceof WebAssembly.Table)
    || typeof value.malloc !== "function"
    || typeof value.free !== "function"
    || typeof value.skill_text_resolve !== "function"
  ) {
    return null;
  }
  return { exports: value as SkillTextExports, slot };
}

function readUtf16(memory: WebAssembly.Memory, pointer: number): string {
  if (!Number.isSafeInteger(pointer) || pointer <= 0 || pointer >= memory.buffer.byteLength) {
    throw new Error("client text callback returned an invalid pointer");
  }
  const available = Math.min(
    MAX_DESCRIPTION_UNITS,
    Math.floor((memory.buffer.byteLength - pointer) / Uint16Array.BYTES_PER_ELEMENT),
  );
  const units = new Uint16Array(memory.buffer, pointer, available);
  let length = 0;
  while (length < units.length && units[length] !== 0) length += 1;
  if (length === units.length) throw new Error("client text exceeded its bound");
  let result = "";
  for (let at = 0; at < length; at += 1_024) {
    result += String.fromCharCode(...units.subarray(at, Math.min(length, at + 1_024)));
  }
  return result;
}

export function createSkillTextResolver(
  runtime: () => Readonly<{
    instance: WebAssembly.Instance | null;
    module: WebAssembly.Module | null;
  }>,
): (source: SkillDescriptionSource) => Promise<string | null> {
  const cache = new Map<number, string>();
  let queue = Promise.resolve();

  return async (source) => {
    const hit = cache.get(source.stringId);
    if (hit !== undefined) return hit;
    const work = queue.then(async () => {
      const current = runtime();
      if (!current.instance || !current.module) return null;
      const ready = runtimeExports(current.instance, current.module);
      if (!ready || source.stringId === 0) return null;
      const { exports, slot } = ready;
      const table = exports.__indirect_function_table;
      if (table.get(slot) !== null) {
        throw new Error("client text callback slot is occupied");
      }

      const encoded = encodeSkillDescription(source);
      const pointer = Number(exports.malloc(encoded.byteLength));
      if (!pointer) throw new Error("client text allocation failed");
      new Uint16Array(exports.memory.buffer, pointer, encoded.length).set(encoded);

      let settled = false;
      let timer = 0;
      let resolveResult: (value: string | null) => void = () => {};
      let rejectResult: (reason: unknown) => void = () => {};
      const result = new Promise<string | null>((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
      });
      const callback = new WebAssembly.Instance(
        new WebAssembly.Module(CALLBACK_MODULE),
        {
          env: {
            callback(_param: number, textPointer: number) {
              if (settled) return;
              try {
                const text = finishSkillDescription(
                  readUtf16(exports.memory, textPointer),
                  source,
                );
                settled = true;
                resolveResult(text || null);
              } catch (error) {
                settled = true;
                rejectResult(error);
              }
            },
          },
        },
      ).exports.callback;
      try {
        table.set(slot, callback);
        timer = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          rejectResult(new Error("client text resolution timed out"));
        }, CALLBACK_TIMEOUT_MS);
        exports.skill_text_resolve(pointer, slot, 1);
        const text = await result;
        if (text) cache.set(source.stringId, text);
        return text;
      } finally {
        window.clearTimeout(timer);
        if (table.get(slot) === callback) table.set(slot, null);
        exports.free(pointer);
      }
    });
    queue = work.then(() => undefined, () => undefined);
    return work;
  };
}
