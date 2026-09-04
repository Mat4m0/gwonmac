/**
 * Owns selection and byte generation for Enhancement's game-function hooks.
 * A rewritten function can observe its original call, filter it, or do both.
 */
import { COMPANION_DISPATCH_KINDS } from "../../shared/companion-abi.js";
import {
  enhancementHooksFor,
  type EnhancementCapabilities,
} from "../../shared/enhancement-contracts.js";
import {
  concat,
  sleb,
  uleb,
  type FunctionType,
} from "../core/wasm-binary.js";
import type { KnownEnhancementBuild } from "./enhancement-build-model.js";

export const ENHANCEMENT_DISPATCH_PARAMS = 6;

type ResolvedFunction = Readonly<{
  localIndex: number;
  typeIndex: number;
  type: FunctionType;
}>;

export type EnhancementHookRole = "tick" | "cursor" | "ui";

export type ResolvedEnhancementHook = ResolvedFunction & Readonly<{
  role: EnhancementHookRole;
  observerKind: number | null;
}>;

export function resolveEnhancementHooks(
  capabilities: EnhancementCapabilities,
  build: KnownEnhancementBuild,
  resolve: (
    label: string,
    functionIndex: number,
    expectedParams: readonly string[],
    expectedResults: readonly string[],
  ) => ResolvedFunction,
) {
  const hooks = enhancementHooksFor(capabilities);
  const selected: ResolvedEnhancementHook[] = [];
  if (hooks.tick) {
    selected.push({
      ...resolve("tick", build.hookFunction, build.hookParams, build.hookResults),
      role: "tick",
      observerKind: COMPANION_DISPATCH_KINDS.tick,
    });
  }
  if (hooks.cursor) {
    const cursor = build.cursorEvent!;
    selected.push({
      ...resolve("cursor", cursor.functionIndex, cursor.params, cursor.results),
      role: "cursor",
      observerKind: COMPANION_DISPATCH_KINDS.cursor,
    });
  }

  const rewritesUi = hooks.ui || capabilities.chatFiltering;
  const needsUi = rewritesUi
    || capabilities.travelAction
    || capabilities.characterSwitchAction
    || capabilities.quickItemMove;
  const dispatcher = needsUi
    ? resolve(
        "UI dispatcher",
        build.uiDispatcher!.functionIndex,
        build.uiDispatcher!.params,
        build.uiDispatcher!.results,
      )
    : null;
  if (rewritesUi) {
    selected.push({
      ...dispatcher!,
      role: "ui",
      observerKind: hooks.ui ? COMPANION_DISPATCH_KINDS.ui : null,
    });
  }
  return Object.freeze({ hooks, selected, uiDispatcher: dispatcher });
}

export function createEnhancementHookBody(input: Readonly<{
  paramCount: number;
  observerKind: number | null;
  dispatchTypeIndex: number;
  originalIndex: number;
  hookGlobalIndex: number;
  preFilterFunction?: number | null;
  extraArgumentGlobal?: number | null;
  extraArgumentFunction?: number | null;
}>): Uint8Array {
  const args = Array.from({ length: input.paramCount }, (_, index) =>
    concat(Uint8Array.of(0x20), uleb(index)),
  );
  const dispatchArgs = [
    ...args,
    ...(input.extraArgumentGlobal == null
      ? []
      : [concat(Uint8Array.of(0x23), uleb(input.extraArgumentGlobal))]),
    ...(input.extraArgumentFunction == null
      ? []
      : [concat(Uint8Array.of(0x10), uleb(input.extraArgumentFunction))]),
  ];
  return concat(
    uleb(0),
    ...(input.preFilterFunction == null
      ? []
      : [
          ...args.slice(0, 2),
          Uint8Array.of(0x10), uleb(input.preFilterFunction),
          Uint8Array.of(0x04, 0x40, 0x0f, 0x0b),
        ]),
    // Keep the original call inside the game module and on its original stack.
    ...args,
    Uint8Array.of(0x10),
    uleb(input.originalIndex),
    ...(input.observerKind === null ? [] : [
      Uint8Array.of(0x23),
      uleb(input.hookGlobalIndex),
      Uint8Array.of(0x45, 0x04, 0x40, 0x0f, 0x0b, 0x41),
      sleb(input.observerKind),
      ...dispatchArgs,
      ...Array.from({ length: ENHANCEMENT_DISPATCH_PARAMS - 1 - dispatchArgs.length }, () =>
        concat(Uint8Array.of(0x41), sleb(0)),
      ),
      Uint8Array.of(0x23),
      uleb(input.hookGlobalIndex),
      Uint8Array.of(0x41),
      sleb(1),
      Uint8Array.of(0x6b, 0x11),
      uleb(input.dispatchTypeIndex),
      uleb(0),
    ]),
    Uint8Array.of(0x0b),
  );
}
