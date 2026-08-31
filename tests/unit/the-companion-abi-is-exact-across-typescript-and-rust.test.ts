import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  COMPANION_DISPATCH_KINDS,
  COMPANION_FEATURE_BITS,
} from "../../src/shared/companion-abi.ts";
import {
  ENHANCEMENT_CONFIG_FIELDS,
} from "../../src/shared/enhancement-config.ts";

const rustSource = readFileSync(
  new URL("../../src/companion-kernel/abi.rs", import.meta.url),
  "utf8",
);

const FEATURE_NAMES = Object.freeze({
  nativeCursor: "FEATURE_NATIVE_CURSOR",
  gameSnapshot: "FEATURE_GAME_SNAPSHOT",
  toolboxFoundation: "FEATURE_TOOLBOX_FOUNDATION",
  targetObservation: "FEATURE_TARGET_OBSERVATION",
  skillSlotGeometry: "FEATURE_SKILL_SLOT_GEOMETRY",
  skillCooldownObservation: "FEATURE_SKILL_COOLDOWN_OBSERVATION",
  playRegionObservation: "FEATURE_PLAY_REGION_OBSERVATION",
  characterList: "FEATURE_CHARACTER_LIST",
} as const);

const DISPATCH_NAMES = Object.freeze({
  tick: "DISPATCH_TICK",
  cursor: "DISPATCH_CURSOR",
  ui: "DISPATCH_UI",
  activeFeatures: "DISPATCH_ACTIVE_FEATURES",
} as const);

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/\/\/.*$/gmu, "");
}

function captured(match: RegExpMatchArray | null, label: string): string {
  const value = match?.[1];
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
}

function camelToSnake(value: string): string {
  return value.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
}

function typescriptConfigSlots(): string[] {
  return ENHANCEMENT_CONFIG_FIELDS.map((field) => {
    if (field.source === "party-dirty") {
      return `party_dirty_messages[${field.index}]`;
    }
    return camelToSnake(field.key);
  });
}

function rustConfigSlots(source: string): string[] {
  const clean = withoutComments(source);
  const count = Number(captured(
    clean.match(/const PARTY_DIRTY_MESSAGE_COUNT: usize = (\d+);/u),
    "Rust party dirty-message count",
  ));
  const body = captured(
    clean.match(/pub\(crate\) struct Layout\s*\{([\s\S]*?)\n\}/u),
    "Rust Layout",
  );

  return body.split("\n").map((line) => line.trim()).filter(Boolean)
    .flatMap((line) => {
      const declaration = line.match(
        /^pub\(crate\) ([a-z0-9_]+): (u32|\[u32; PARTY_DIRTY_MESSAGE_COUNT\]),$/u,
      );
      if (declaration === null) {
        throw new Error(`unsupported Rust Layout declaration: ${line}`);
      }
      const [, name, type] = declaration;
      if (name === undefined || type === undefined) {
        throw new Error(`incomplete Rust Layout declaration: ${line}`);
      }
      if (type === "u32") return [name];
      if (name !== "party_dirty_messages") {
        throw new Error(`unexpected Rust config array: ${name}`);
      }
      return Array.from({ length: count }, (_, index) => `${name}[${index}]`);
    });
}

function integerConstant(expression: string): number {
  const value = expression.trim();
  const decimal = value.match(/^(\d+)$/u)?.[1];
  if (decimal !== undefined) return Number(decimal);
  const shift = value.match(/^1\s*<<\s*(\d+)$/u)?.[1];
  if (shift !== undefined) return 2 ** Number(shift);
  throw new Error(`unsupported Rust integer constant: ${value}`);
}

function rustConstants(source: string, prefix: "FEATURE" | "DISPATCH") {
  const constants = new Map<string, number>();
  const pattern = new RegExp(
    `pub\\(crate\\) const (${prefix}_[A-Z_]+): u32 = ([^;]+);`,
    "gu",
  );
  for (const match of withoutComments(source).matchAll(pattern)) {
    const name = match[1];
    const expression = match[2];
    if (name === undefined || expression === undefined) {
      throw new Error(`incomplete Rust ${prefix} constant`);
    }
    constants.set(name, integerConstant(expression));
  }
  return constants;
}

function expectedConstants<T extends Record<string, number>>(
  values: T,
  names: { readonly [K in keyof T]: string },
): Map<string, number> {
  return new Map(
    Object.keys(values).map((key) => {
      const typedKey = key as keyof T;
      return [names[typedKey], values[typedKey]];
    }),
  );
}

function assertExactContract(source: string): void {
  assert.deepEqual(rustConfigSlots(source), typescriptConfigSlots());

  const features = expectedConstants(COMPANION_FEATURE_BITS, FEATURE_NAMES);
  assert.deepEqual(rustConstants(source, "FEATURE"), features);
  assert.deepEqual(
    rustConstants(source, "DISPATCH"),
    expectedConstants(COMPANION_DISPATCH_KINDS, DISPATCH_NAMES),
  );

  const knownFeatures = captured(
    withoutComments(source).match(
      /const KNOWN_FEATURES: u32 =([\s\S]*?);/u,
    ),
    "Rust KNOWN_FEATURES",
  ).match(/FEATURE_[A-Z_]+/gu) ?? [];
  assert.deepEqual(knownFeatures.sort(), [...features.keys()].sort());
}

function replaced(source: string, from: string, to: string): string {
  assert.ok(source.includes(from), `mutation target is present: ${from}`);
  return source.replace(from, to);
}

test("the independent TypeScript and Rust companion contracts match exactly", () => {
  assertExactContract(rustSource);
  assert.equal(typescriptConfigSlots().length, 116);
});

test("same-size field swaps, bit drift, opcode drift, and new names are rejected", () => {
  assert.throws(() => assertExactContract(replaced(
    rustSource,
    "    pub(crate) context_root: u32,\n    pub(crate) agent_array: u32,",
    "    pub(crate) agent_array: u32,\n    pub(crate) context_root: u32,",
  )));
  assert.throws(() => assertExactContract(replaced(
    rustSource,
    "const FEATURE_TARGET_OBSERVATION: u32 = 1 << 3;",
    "const FEATURE_TARGET_OBSERVATION: u32 = 1 << 4;",
  )));
  assert.throws(() => assertExactContract(replaced(
    rustSource,
    "const DISPATCH_ACTIVE_FEATURES: u32 = 3;",
    "const DISPATCH_ACTIVE_FEATURES: u32 = 4;",
  )));
  assert.throws(() => assertExactContract(replaced(
    rustSource,
    "const FEATURE_NATIVE_CURSOR: u32 = 1 << 0;",
    "const FEATURE_FUTURE: u32 = 1 << 4;\nconst FEATURE_NATIVE_CURSOR: u32 = 1 << 0;",
  )));
  assert.throws(() => assertExactContract(replaced(
    rustSource,
    "const PARTY_DIRTY_MESSAGE_COUNT: usize = 10;",
    "const PARTY_DIRTY_MESSAGE_COUNT: usize = 9;",
  )));
});
