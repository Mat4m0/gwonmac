/**
 * Declares the immutable and zero-initialized storage anchors used by the
 * Template-saving verifier. The verifier owns their semantic validation.
 */
export type TemplateCallerRole =
  | "delete"
  | "skill-scan"
  | "equipment-scan"
  | "writer"
  | "directory-sink"
  | "screenshot-sink";

export type TemplateStaticStorage =
  | "delete-state"
  | "template-types"
  | "template-hash"
  | "directory-types"
  | "screenshot-state"
  | "screenshot-types"
  | "screenshot-directory";

export type StaticOperand = Readonly<{
  start: number;
  end: number;
  encoding: "i32-const" | "memory-offset";
  baseline: number;
}>;

export type StaticRelocation = Readonly<StaticOperand & (
  | { storage: TemplateStaticStorage; immutableString?: never }
  | { immutableString: string; storage?: never }
)>;

type TemplateStaticAnchor = Readonly<
  | { kind: "initialized-data"; baseline: number; bytes: Uint8Array }
  | { kind: "zero-initialized"; baseline: number }
>;

function utf16Le(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length * 2);
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    bytes[index * 2] = codeUnit & 0xff;
    bytes[index * 2 + 1] = codeUnit >>> 8;
  }
  return bytes;
}

function bytesFromHex(value: string): Uint8Array {
  if (value.length % 2 !== 0 || !/^[0-9a-f]+$/.test(value)) {
    throw new Error("template-save recertify: invalid static anchor bytes");
  }
  return Uint8Array.from(
    Array.from({ length: value.length / 2 }, (_, index) =>
      Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)),
  );
}

/** Independent ownership for every address erased by caller normalization. */
export const TEMPLATE_STATIC_ANCHORS: Readonly<
  Record<TemplateStaticStorage, TemplateStaticAnchor>
> = Object.freeze({
  "delete-state": Object.freeze({ kind: "zero-initialized" as const, baseline: 2_673_696 }),
  "template-types": Object.freeze({
    kind: "initialized-data" as const,
    baseline: 1_447_548,
    bytes: utf16Le(".*:/<>|\"?\0Templates/Skills\0Templates/Equipment\0"),
  }),
  "template-hash": Object.freeze({
    kind: "initialized-data" as const,
    baseline: 1_250_688,
    bytes: bytesFromHex(
      "1dc2b32e82d4f1a68f6224be309e6935"
      + "24e27ec89700ba04af0e1f7966d462a1",
    ),
  }),
  "directory-types": Object.freeze({
    kind: "initialized-data" as const,
    baseline: 1_520_736,
    bytes: utf16Le("ChatDumps\0gw???.txt\0gw%03u.txt\0"),
  }),
  "screenshot-state": Object.freeze({ kind: "zero-initialized" as const, baseline: 2_673_696 }),
  "screenshot-types": Object.freeze({
    kind: "initialized-data" as const,
    baseline: 1_556_320,
    bytes: utf16Le("Screens\0%i_%i.jpg\0NO_POSITION.jpg\0gw???.???\0gw%03u.jpg\0"),
  }),
  "screenshot-directory": Object.freeze({
    kind: "initialized-data" as const,
    baseline: 2_635_884,
    bytes: bytesFromHex(
      "0100000001000000ffffffff00000000"
      + "00000000070000000200000000000000",
    ),
  }),
});
