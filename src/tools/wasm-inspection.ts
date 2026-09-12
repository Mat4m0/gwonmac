/**
 * Deterministic, read-only projection of a valid WebAssembly module's public
 * boundary. The shared codec remains the section authority; this module only
 * gives the certification CLI a JSON-safe inventory.
 */
import {
  readUleb,
  splitSections,
  type Cursor,
} from "../main/core/wasm-binary.js";

type WasmLimits = Readonly<{
  minimum: number;
  maximum: number | null;
  shared: boolean;
}>;

type WasmTableShape = WasmLimits & Readonly<{
  index: number;
  source: "import" | "module";
  module?: string;
  name?: string;
  element: "funcref" | "externref";
}>;

type WasmMemoryShape = WasmLimits & Readonly<{
  index: number;
  source: "import" | "module";
  module?: string;
  name?: string;
}>;

type NodeWasmModule = object;
interface NodeWasmModuleConstructor {
  new(bytes: Uint8Array): NodeWasmModule;
  imports(module: NodeWasmModule): Array<{ module: string; name: string; kind: string }>;
  exports(module: NodeWasmModule): Array<{ name: string; kind: string }>;
}
type NodeWasmBinding = Readonly<{
  validate(bytes: Uint8Array): boolean;
  Module: NodeWasmModuleConstructor;
}>;

// Node exposes WebAssembly at runtime; this tool is checked without DOM types.
declare const WebAssembly: NodeWasmBinding;

class InventoryCursor implements Cursor {
  offset = 0;
  readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  byte(): number {
    const value = this.bytes[this.offset];
    if (value === undefined) throw new Error("unsupported-module-shape");
    this.offset += 1;
    return value;
  }

  u32(): number {
    return readUleb(this.bytes, this);
  }

  name(): string {
    const length = this.u32();
    const end = this.offset + length;
    if (end > this.bytes.byteLength) throw new Error("unsupported-module-shape");
    const value = new TextDecoder("utf-8", { fatal: true }).decode(
      this.bytes.subarray(this.offset, end),
    );
    this.offset = end;
    return value;
  }
}

function limits(cursor: InventoryCursor): WasmLimits {
  const flags = cursor.u32();
  if ((flags & ~0x3) !== 0 || (flags & 0x2) !== 0 && (flags & 0x1) === 0) {
    throw new Error("unsupported-module-shape");
  }
  const minimum = cursor.u32();
  const maximum = (flags & 0x1) === 0 ? null : cursor.u32();
  if (maximum !== null && maximum < minimum) {
    throw new Error("unsupported-module-shape");
  }
  return { minimum, maximum, shared: (flags & 0x2) !== 0 };
}

function tableShape(
  cursor: InventoryCursor,
  base: Omit<WasmTableShape, keyof WasmLimits | "element">,
): WasmTableShape {
  const reference = cursor.byte();
  const element = reference === 0x70
    ? "funcref" as const
    : reference === 0x6f
      ? "externref" as const
      : null;
  if (element === null) throw new Error("unsupported-module-shape");
  return { ...base, element, ...limits(cursor) };
}

function sectionBodies(bytes: Uint8Array): Map<number, Uint8Array> {
  const sections = new Map<number, Uint8Array>();
  for (const section of splitSections(bytes)) {
    if (section.id !== 0 && sections.has(section.id)) {
      throw new Error("unsupported-module-shape");
    }
    if (section.id !== 0) sections.set(section.id, section.body);
  }
  return sections;
}

function shapes(bytes: Uint8Array): Readonly<{
  memories: readonly WasmMemoryShape[];
  tables: readonly WasmTableShape[];
}> {
  const sections = sectionBodies(bytes);
  const memories: WasmMemoryShape[] = [];
  const tables: WasmTableShape[] = [];
  const imports = sections.get(2);
  if (imports) {
    const cursor = new InventoryCursor(imports);
    const count = cursor.u32();
    for (let index = 0; index < count; index += 1) {
      const module = cursor.name();
      const name = cursor.name();
      const kind = cursor.byte();
      if (kind === 0) cursor.u32();
      else if (kind === 1) {
        tables.push(tableShape(cursor, {
          index: tables.length,
          source: "import",
          module,
          name,
        }));
      } else if (kind === 2) {
        memories.push({
          index: memories.length,
          source: "import",
          module,
          name,
          ...limits(cursor),
        });
      } else if (kind === 3) {
        cursor.byte();
        cursor.byte();
      } else if (kind === 4) {
        cursor.u32();
        cursor.u32();
      } else throw new Error("unsupported-module-shape");
    }
    if (cursor.offset !== imports.byteLength) {
      throw new Error("unsupported-module-shape");
    }
  }
  const tableSection = sections.get(4);
  if (tableSection) {
    const cursor = new InventoryCursor(tableSection);
    const count = cursor.u32();
    for (let index = 0; index < count; index += 1) {
      tables.push(tableShape(cursor, { index: tables.length, source: "module" }));
    }
    if (cursor.offset !== tableSection.byteLength) {
      throw new Error("unsupported-module-shape");
    }
  }
  const memorySection = sections.get(5);
  if (memorySection) {
    const cursor = new InventoryCursor(memorySection);
    const count = cursor.u32();
    for (let index = 0; index < count; index += 1) {
      memories.push({
        index: memories.length,
        source: "module",
        ...limits(cursor),
      });
    }
    if (cursor.offset !== memorySection.byteLength) {
      throw new Error("unsupported-module-shape");
    }
  }
  return { memories, tables };
}

export function inspectWasmBytes(bytes: Uint8Array): Readonly<{
  imports: readonly { module: string; name: string; kind: string }[];
  exports: readonly { name: string; kind: string }[];
  memories: readonly WasmMemoryShape[];
  tables: readonly WasmTableShape[];
}> | null {
  if (!WebAssembly.validate(bytes)) return null;
  const module = new WebAssembly.Module(bytes);
  const shape = shapes(bytes);
  const imports = WebAssembly.Module.imports(module).sort((left, right) =>
    `${left.module}\u0000${left.name}\u0000${left.kind}`
      .localeCompare(`${right.module}\u0000${right.name}\u0000${right.kind}`)
  );
  const exports = WebAssembly.Module.exports(module).sort((left, right) =>
    `${left.name}\u0000${left.kind}`.localeCompare(`${right.name}\u0000${right.kind}`)
  );
  return { imports, exports, ...shape };
}
