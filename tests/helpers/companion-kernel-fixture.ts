/**
 * Builds the smallest companion side module that exercises the exact runtime
 * and release contract. Mutations stay explicit so both gates share one
 * adversarial fixture vocabulary.
 */
import {
  COMPANION_KERNEL_DYLINK0,
  COMPANION_KERNEL_EXPORT_VALUES,
} from "../../scripts/companion-kernel-contract.mjs";
import { COMPANION_KERNEL_SIGNATURES } from "../../src/shared/companion-kernel-contract.ts";

export interface CompanionKernelFixtureOptions {
  readonly start?: boolean;
  readonly wrongDylink?: boolean;
  readonly extraImport?: boolean;
  readonly missingImport?: boolean;
  readonly extraExport?: boolean;
  readonly missingExport?: boolean;
  readonly outOfFootprintData?: boolean;
  readonly wrongSignature?: boolean;
  readonly initResult?: number;
  readonly cursorEventCount?: number;
  readonly expectedInitArguments?: readonly number[];
  readonly exportValueOverrides?: Readonly<Partial<
    Record<keyof typeof COMPANION_KERNEL_EXPORT_VALUES, number>
  >>;
}

function uleb(value: number): number[] {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value = Math.floor(value / 0x80);
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return bytes;
}

function sleb(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value;
  for (;;) {
    const byte = remaining & 0x7f;
    remaining >>= 7;
    const sign = (byte & 0x40) !== 0;
    if ((remaining === 0 && !sign) || (remaining === -1 && sign)) {
      bytes.push(byte);
      return bytes;
    }
    bytes.push(byte | 0x80);
  }
}

function name(value: string): number[] {
  const bytes = new TextEncoder().encode(value);
  return [...uleb(bytes.byteLength), ...bytes];
}

function section(id: number, body: readonly number[]): number[] {
  return [id, ...uleb(body.length), ...body];
}

function functionType(params: number, result: boolean): number[] {
  return [
    0x60,
    ...uleb(params),
    ...Array.from({ length: params }, () => 0x7f),
    ...(result ? [1, 0x7f] : [0]),
  ];
}

function importEntry(
  field: string,
  kind: number,
  descriptor: readonly number[],
): number[] {
  return [...name("env"), ...name(field), kind, ...descriptor];
}

export function companionKernelFixture(
  options: CompanionKernelFixtureOptions = {},
): Uint8Array<ArrayBuffer> {
  const signatures = COMPANION_KERNEL_SIGNATURES.map(
    ({ name: exportName, typeIndex }, functionIndex) => ({
      exportName,
      typeIndex,
      functionIndex,
    }),
  );
  const startFunction = signatures.length;
  const types = [
    functionType(22, true),
    functionType(6, false),
    functionType(0, true),
    functionType(0, false),
  ];
  const dylink = [...COMPANION_KERNEL_DYLINK0];
  if (options.wrongDylink) dylink[2] = (dylink[2] ?? 0) ^ 1;
  const canonicalImports = [
    importEntry("__indirect_function_table", 1, [0x70, 0, 0]),
    importEntry("__memory_base", 3, [0x7f, 0]),
    importEntry("__stack_pointer", 3, [0x7f, 1]),
    importEntry("__table_base", 3, [0x7f, 0]),
    importEntry("memory", 2, [0, 1]),
  ];
  const imports = [
    ...(options.missingImport ? canonicalImports.slice(1) : canonicalImports),
    ...(options.extraImport
      ? [importEntry("unexpected", 3, [0x7f, 0])]
      : []),
  ];
  const functionTypes = signatures.map(({ typeIndex }) => typeIndex);
  if (options.wrongSignature) functionTypes[0] = 2;
  if (options.start) functionTypes.push(3);
  const canonicalExports = signatures.map(({ exportName, functionIndex }) => [
    ...name(exportName),
    0,
    ...uleb(functionIndex),
  ]);
  const exports = options.missingExport
    ? canonicalExports.slice(1)
    : canonicalExports;
  if (options.extraExport) {
    exports.push([...name("unexpected"), 0, ...uleb(0)]);
  }
  const bodies = signatures.map(({ exportName, typeIndex }) => {
    if (typeIndex === 1) return [0, 0x0b];
    if (
      exportName === "companion_init"
      && options.expectedInitArguments !== undefined
    ) {
      if (options.expectedInitArguments.length !== 22) {
        throw new Error("companion fixture init expectation must have 19 words");
      }
      const comparisons = options.expectedInitArguments.flatMap(
        (value, index) => [
          0x20, ...uleb(index),
          0x41, ...sleb(value),
          0x46,
          ...(index === 0 ? [] : [0x71]),
        ],
      );
      return [0, ...comparisons, 0x0b];
    }
    const value = exportName === "companion_init"
      ? (options.initResult ?? 1)
      : exportName === "companion_cursor_event_count"
        ? (options.cursorEventCount ?? 23)
        : options.exportValueOverrides?.[
          exportName as keyof typeof COMPANION_KERNEL_EXPORT_VALUES
        ] ?? COMPANION_KERNEL_EXPORT_VALUES[
          exportName as keyof typeof COMPANION_KERNEL_EXPORT_VALUES
        ];
    return [0, 0x41, ...sleb(value), 0x0b];
  });
  if (options.start) bodies.push([0, 0x0b]);
  return Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...section(0, [...name("dylink.0"), ...dylink]),
    ...section(1, [...uleb(types.length), ...types.flat()]),
    ...section(2, [...uleb(imports.length), ...imports.flat()]),
    ...section(3, [...uleb(functionTypes.length), ...functionTypes]),
    ...section(7, [...uleb(exports.length), ...exports.flat()]),
    ...(options.start ? section(8, uleb(startFunction)) : []),
    ...section(10, [
      ...uleb(bodies.length),
      ...bodies.flatMap((body) => [...uleb(body.length), ...body]),
    ]),
    ...(options.outOfFootprintData
      ? section(11, [1, 0, 0x41, 0, 0x0b, 1, 0xa5])
      : []),
  ]);
}
