/**
 * The exact companion-kernel surface shared by the build sealer and renderer.
 * Each boundary validates independently, but neither restates the ABI.
 */
export const COMPANION_KERNEL_IMPORTS = Object.freeze([
  "env.__indirect_function_table:table",
  "env.__memory_base:global",
  "env.__stack_pointer:global",
  "env.__table_base:global",
  "env.memory:memory",
]);

export const COMPANION_KERNEL_SIGNATURES: readonly Readonly<{
  name: string;
  typeIndex: number;
}>[] = Object.freeze([
  { name: "companion_init", typeIndex: 0 },
  { name: "companion_dispatch", typeIndex: 1 },
  { name: "companion_cursor_event_count", typeIndex: 2 },
  { name: "companion_abi", typeIndex: 2 },
  { name: "companion_config_bytes", typeIndex: 2 },
  { name: "companion_snapshot_bytes", typeIndex: 2 },
  { name: "companion_cursor_bytes", typeIndex: 2 },
  { name: "companion_toolbox_bytes", typeIndex: 2 },
  { name: "companion_party_bytes", typeIndex: 2 },
]);

export const COMPANION_KERNEL_EXPORTS = Object.freeze(
  COMPANION_KERNEL_SIGNATURES
    .map(({ name }) => `${name}:function`)
    .sort(),
);

function encodeUleb(value: number): number[] {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value = Math.floor(value / 0x80);
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return bytes;
}

function encodeName(value: string): number[] {
  const bytes = new TextEncoder().encode(value);
  return [...encodeUleb(bytes.byteLength), ...bytes];
}

function i32FunctionType(parameterCount: number, returnsI32: boolean): number[] {
  return [
    0x60,
    ...encodeUleb(parameterCount),
    ...Array.from({ length: parameterCount }, () => 0x7f),
    ...(returnsI32 ? [0x01, 0x7f] : [0x00]),
  ];
}

function encodeSection(id: number, payload: number[]): number[] {
  return [id, ...encodeUleb(payload.length), ...payload];
}

/**
 * A tiny Wasm module importing the canonical functions at their exact types.
 * Browser and Node each compile these bytes themselves, so both trust
 * boundaries execute the type check without this shared module needing DOM
 * WebAssembly types.
 */
export function companionKernelSignatureBytes(): Uint8Array<ArrayBuffer> {
  const types = [
    // Five region pointer/size pairs and the feature word.
    i32FunctionType(11, true),
    i32FunctionType(6, false),
    i32FunctionType(0, true),
  ];
  const typeSection = [...encodeUleb(types.length), ...types.flat()];
  const importSection = [
    ...encodeUleb(COMPANION_KERNEL_SIGNATURES.length),
    ...COMPANION_KERNEL_SIGNATURES.flatMap(({ name, typeIndex }) => [
      ...encodeName("kernel"),
      ...encodeName(name),
      0x00,
      ...encodeUleb(typeIndex),
    ]),
  ];
  return Uint8Array.of(
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...encodeSection(1, typeSection),
    ...encodeSection(2, importSection),
  );
}
