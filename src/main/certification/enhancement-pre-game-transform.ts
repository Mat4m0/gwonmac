/**
 * Owns the closed WASM transform for certified pre-game frame observation.
 * It mirrors GWCA's GetFrameByLabel boundary inside the game module and exports
 * only a closed state enum plus a privacy-safe diagnostic mask.
 */
import { concat, sleb, uleb, type FunctionType } from "../core/wasm-binary.js";
import { ENHANCEMENT_TRANSFORM_ABI } from "../../shared/enhancement-contracts.js";
import type { KnownEnhancementBuild } from "./enhancement-builds.js";

type Certificate = NonNullable<KnownEnhancementBuild["preGameControls"]>;

export const ENHANCEMENT_PRE_GAME_STATE_EXPORT = "enhancement_pre_game_state";
export const ENHANCEMENT_PRE_GAME_DIAGNOSTIC_EXPORT = "enhancement_pre_game_diagnostic";

export type ResolvedPreGameFunction = Readonly<{
  localIndex: number;
  typeIndex: number;
  type: FunctionType;
}>;

export type EnhancementPreGameResolution = Readonly<{
  certificate: Certificate;
  hashFunction: ResolvedPreGameFunction;
}> | null;

type ResolveFunction = (
  label: string,
  functionIndex: number,
  expectedParams: readonly string[],
  expectedResults: readonly string[],
) => ResolvedPreGameFunction;

export function resolveEnhancementPreGameTransform(options: Readonly<{
  build: KnownEnhancementBuild;
  enabled: boolean;
  resolveFunction: ResolveFunction;
  bodyHash: (functionIndex: number) => string;
  fail: (message: string) => never;
}>): EnhancementPreGameResolution {
  if (!options.enabled) return null;
  const certificate = options.build.preGameControls
    ?? options.fail("pre-game controls are not certified");
  const hashFunction = options.resolveFunction(
    "pre-game label hash",
    certificate.hashFunction.functionIndex,
    certificate.hashFunction.params,
    certificate.hashFunction.results,
  );
  if (options.bodyHash(certificate.hashFunction.functionIndex)
    !== certificate.hashFunction.bodySha256) {
    options.fail("pre-game frame body does not match its certificate");
  }
  return { certificate, hashFunction };
}

export function verifyCharacterSwitchActionCertificate(options: Readonly<{
  resolution: EnhancementPreGameResolution;
  resolveFunction: ResolveFunction;
  bodyHash: (functionIndex: number) => string;
  fail: (message: string) => never;
}>): void {
  const certificate = options.resolution?.certificate
    ?? options.fail("character switch action requires pre-game controls");
  const action = certificate.characterSwitchAction;
  for (const [label, proof] of Object.entries({
    "character frame child": action.frameChild,
    "character frame parent": action.frameParent,
    "character frame resolver": action.frameResolver,
    "character frame dispatch": action.frameDispatch,
    "character logout producer": action.logoutProducer,
  })) {
    options.resolveFunction(label, proof.functionIndex, proof.params, proof.results);
    if (options.bodyHash(proof.functionIndex) !== proof.bodySha256) {
      options.fail(`${label} body does not match its semantic fingerprint`);
    }
  }
}

function rejectWithMaskIf(condition: Uint8Array): Uint8Array {
  return concat(
    condition, Uint8Array.of(0x04, 0x40),
    Uint8Array.of(0x20), uleb(0), Uint8Array.of(0x0f, 0x0b),
  );
}

function addBooleanBit(condition: Uint8Array, bit: number): Uint8Array {
  return concat(
    Uint8Array.of(0x20), uleb(0), condition,
    Uint8Array.of(0x41), sleb(1 << bit), Uint8Array.of(0x6c, 0x72, 0x21), uleb(0),
  );
}

function visibleFrame(frameLocal: number, frameState: number): Uint8Array {
  return concat(
    Uint8Array.of(0x20), uleb(frameLocal), Uint8Array.of(0x28), uleb(2),
    uleb(frameState), Uint8Array.of(0x22), uleb(10),
    Uint8Array.of(0x41), sleb(4), Uint8Array.of(0x71, 0x45, 0x45),
    Uint8Array.of(0x20), uleb(10), Uint8Array.of(0x41), sleb(0x200),
    Uint8Array.of(0x71, 0x45, 0x71),
  );
}

const PRE_GAME_LOCALS = Object.freeze({
  mask: 0,
  firstHash: 1,
  count: 6,
  array: 7,
  index: 8,
  frame: 9,
  liveHash: 10,
  frameState: 11,
  memoryBytes: 12,
});

/** True when `pointer + bytes` would exceed a non-4-GiB memory. */
function outsideMemory(pointerLocal: number, bytes: Uint8Array): Uint8Array {
  return concat(
    Uint8Array.of(0x20), uleb(PRE_GAME_LOCALS.memoryBytes),
    Uint8Array.of(0x45, 0x45),
    Uint8Array.of(0x20), uleb(pointerLocal), Uint8Array.of(0x20),
    uleb(PRE_GAME_LOCALS.memoryBytes),
    bytes, Uint8Array.of(0x6b, 0x4b, 0x71),
  );
}

/**
 * Returns a privacy-safe probe mask while resolving labels exactly as GWCA's
 * GetFrameByLabel does: hash each UTF-16 label with the game's own function,
 * then compare it with FrameRelation::frame_hash_id in the live frame table.
 *
 * bits 0..3:  the Play, Selector, Yes, and No label hashes are nonzero
 * bits 4..7:  a valid live frame has the corresponding frame_hash_id
 * bits 8..11: that exact frame is currently visible
 * bit 12:     Yes and No are both visible
 * bit 13:     Play and Selector are both visible
 * bits 14..18: valid count, array, frame pointer, frame id, and live hash seen
 * bits 19..21: DlgReconnect hash, live match, and visibility
 * bit 22:     DlgReconnect, Yes, and No are all visible
 * bits 24..30: the Enhancement transform ABI that produced this reader
 */
export function preGameDiagnosticReader(
  certificate: Certificate,
): Uint8Array {
  const { layout } = certificate;
  const hashes = [
    certificate.labelHashes.play,
    certificate.labelHashes.selector,
    certificate.labelHashes.yes,
    certificate.labelHashes.no,
    certificate.labelHashes.reconnectDialog,
  ] as const;
  const matchOne = (
    hashLocal: number,
    matchedBit: number,
    visibleBit: number,
  ): Uint8Array => concat(
    Uint8Array.of(0x20), uleb(PRE_GAME_LOCALS.liveHash),
    Uint8Array.of(0x20), uleb(hashLocal),
    Uint8Array.of(0x46, 0x04, 0x40),
    Uint8Array.of(0x20), uleb(PRE_GAME_LOCALS.mask), Uint8Array.of(0x41),
    sleb(1 << matchedBit), Uint8Array.of(0x72, 0x21),
    uleb(PRE_GAME_LOCALS.mask),
    addBooleanBit(
      visibleFrame(PRE_GAME_LOCALS.frame, layout.frameState),
      visibleBit,
    ),
    Uint8Array.of(0x0b),
  );
  return concat(
    // mask, five hashes, count, array, index, frame, hash, state, memory bytes.
    uleb(1), uleb(13), Uint8Array.of(0x7f),
    Uint8Array.of(0x41), sleb(ENHANCEMENT_TRANSFORM_ABI << 24),
    Uint8Array.of(0x21), uleb(PRE_GAME_LOCALS.mask),
    Uint8Array.of(0x3f, 0x00, 0x41), sleb(65_536),
    Uint8Array.of(0x6c, 0x21), uleb(PRE_GAME_LOCALS.memoryBytes),
    ...hashes.map((hash, index) => concat(
      Uint8Array.of(0x41), sleb(hash), Uint8Array.of(0x21),
      uleb(PRE_GAME_LOCALS.firstHash + index),
      addBooleanBit(concat(
        Uint8Array.of(0x20), uleb(PRE_GAME_LOCALS.firstHash + index),
        Uint8Array.of(0x45, 0x45),
      ), index < 4 ? index : 19),
    )),
    Uint8Array.of(0x41), sleb(layout.frameCount),
    Uint8Array.of(0x28), uleb(2), uleb(0), Uint8Array.of(0x22),
    uleb(PRE_GAME_LOCALS.count),
    rejectWithMaskIf(Uint8Array.of(0x45)),
    rejectWithMaskIf(concat(
      Uint8Array.of(0x20), uleb(PRE_GAME_LOCALS.count),
      Uint8Array.of(0x41), sleb(16_384),
      Uint8Array.of(0x4b),
    )),
    addBooleanBit(Uint8Array.of(0x41, 0x01), 14),
    Uint8Array.of(0x41), sleb(layout.frameArray),
    Uint8Array.of(0x28), uleb(2), uleb(0), Uint8Array.of(0x22),
    uleb(PRE_GAME_LOCALS.array),
    rejectWithMaskIf(Uint8Array.of(0x45)),
    rejectWithMaskIf(outsideMemory(PRE_GAME_LOCALS.array, concat(
      Uint8Array.of(0x20), uleb(PRE_GAME_LOCALS.count),
      Uint8Array.of(0x41), sleb(4),
      Uint8Array.of(0x6c),
    ))),
    addBooleanBit(Uint8Array.of(0x41, 0x01), 15),
    Uint8Array.of(0x41), sleb(0), Uint8Array.of(0x21),
    uleb(PRE_GAME_LOCALS.index),
    Uint8Array.of(0x02, 0x40, 0x03, 0x40),
      Uint8Array.of(0x20), uleb(PRE_GAME_LOCALS.index), Uint8Array.of(0x20),
      uleb(PRE_GAME_LOCALS.count),
      Uint8Array.of(0x4f, 0x0d), uleb(1),
      Uint8Array.of(0x20), uleb(PRE_GAME_LOCALS.array), Uint8Array.of(0x20),
      uleb(PRE_GAME_LOCALS.index),
      Uint8Array.of(0x41), sleb(4), Uint8Array.of(0x6c, 0x6a),
      Uint8Array.of(0x28), uleb(2), uleb(0), Uint8Array.of(0x22),
      uleb(PRE_GAME_LOCALS.frame),
      Uint8Array.of(0x04, 0x40),
        outsideMemory(PRE_GAME_LOCALS.frame, concat(
          Uint8Array.of(0x41), sleb(layout.frameBytes),
        )),
        Uint8Array.of(0x45, 0x04, 0x40),
          addBooleanBit(Uint8Array.of(0x41, 0x01), 16),
          Uint8Array.of(0x20), uleb(PRE_GAME_LOCALS.frame),
          Uint8Array.of(0x28), uleb(2), uleb(layout.frameId),
          Uint8Array.of(0x20), uleb(PRE_GAME_LOCALS.index),
          Uint8Array.of(0x46, 0x04, 0x40),
            addBooleanBit(Uint8Array.of(0x41, 0x01), 17),
            Uint8Array.of(0x20), uleb(PRE_GAME_LOCALS.frame),
            Uint8Array.of(0x28), uleb(2), uleb(layout.frameHashId),
            Uint8Array.of(0x21), uleb(PRE_GAME_LOCALS.liveHash),
            addBooleanBit(concat(
              Uint8Array.of(0x20), uleb(PRE_GAME_LOCALS.liveHash),
              Uint8Array.of(0x45, 0x45),
            ), 18),
            matchOne(1, 4, 8), matchOne(2, 5, 9),
            matchOne(3, 6, 10), matchOne(4, 7, 11),
            matchOne(5, 20, 21),
          Uint8Array.of(0x0b),
        Uint8Array.of(0x0b),
      Uint8Array.of(0x0b),
      Uint8Array.of(0x20), uleb(PRE_GAME_LOCALS.index),
      Uint8Array.of(0x41), sleb(1), Uint8Array.of(0x6a, 0x21),
      uleb(PRE_GAME_LOCALS.index), Uint8Array.of(0x0c), uleb(0),
    Uint8Array.of(0x0b, 0x0b),
    addBooleanBit(concat(
      Uint8Array.of(0x20), uleb(0), Uint8Array.of(0x41), sleb(0x0c00),
      Uint8Array.of(0x71, 0x41), sleb(0x0c00), Uint8Array.of(0x46),
    ), 12),
    addBooleanBit(concat(
      Uint8Array.of(0x20), uleb(0), Uint8Array.of(0x41), sleb(0x0300),
      Uint8Array.of(0x71, 0x41), sleb(0x0300), Uint8Array.of(0x46),
    ), 13),
    addBooleanBit(concat(
      Uint8Array.of(0x20), uleb(PRE_GAME_LOCALS.mask),
      Uint8Array.of(0x41), sleb(0x20_0c00), Uint8Array.of(0x71, 0x41),
      sleb(0x20_0c00), Uint8Array.of(0x46),
    ), 22),
    Uint8Array.of(0x20), uleb(0), Uint8Array.of(0x0b),
  );
}

/** Returns 0 unknown, 1 character select ready, 2 reconnect, or 3 loading. */
export function preGameStateReader(
  certificate: Certificate,
  diagnosticReaderIndex: number,
): Uint8Array {
  return concat(
    // local 0 = diagnostic mask; local 1 = context traversal scratch.
    uleb(1), uleb(2), Uint8Array.of(0x7f),
    Uint8Array.of(0x10), uleb(diagnosticReaderIndex), Uint8Array.of(0x21), uleb(0),
    Uint8Array.of(0x20), uleb(0), Uint8Array.of(0x41), sleb(1 << 22),
    Uint8Array.of(0x71, 0x04, 0x40, 0x41), sleb(2), Uint8Array.of(0x0f, 0x0b),
    Uint8Array.of(0x20), uleb(0), Uint8Array.of(0x41), sleb(1 << 13),
    Uint8Array.of(0x71, 0x04, 0x40, 0x41), sleb(1), Uint8Array.of(0x0f, 0x0b),
    Uint8Array.of(0x41), sleb(certificate.layout.contextRoot),
    Uint8Array.of(0x28), uleb(2), uleb(0), Uint8Array.of(0x22), uleb(1),
    Uint8Array.of(0x04, 0x40),
      Uint8Array.of(0x20), uleb(1), Uint8Array.of(0x28), uleb(2),
      uleb(certificate.layout.gameContextSlot * 4), Uint8Array.of(0x22), uleb(1),
      Uint8Array.of(0x04, 0x40),
        Uint8Array.of(0x20), uleb(1), Uint8Array.of(0x28), uleb(2),
        uleb(certificate.layout.characterContext), Uint8Array.of(0x22), uleb(1),
        Uint8Array.of(0x04, 0x40),
          Uint8Array.of(0x20), uleb(1), Uint8Array.of(0x28), uleb(2),
          uleb(certificate.layout.currentInstanceType),
          Uint8Array.of(0x41), sleb(2), Uint8Array.of(0x46, 0x04, 0x40, 0x41),
          sleb(3), Uint8Array.of(0x0f, 0x0b),
        Uint8Array.of(0x0b),
      Uint8Array.of(0x0b),
    Uint8Array.of(0x0b),
    Uint8Array.of(0x41), sleb(0), Uint8Array.of(0x0b),
  );
}

export function appendPreGameReaders(options: Readonly<{
  resolution: NonNullable<EnhancementPreGameResolution>;
  typeIndex: number;
  appendFunction: (typeIndex: number, body: Uint8Array) => number;
}>): readonly Readonly<{ name: string; index: number }>[] {
  const diagnosticIndex = options.appendFunction(
    options.typeIndex,
    preGameDiagnosticReader(options.resolution.certificate),
  );
  const stateIndex = options.appendFunction(
    options.typeIndex,
    preGameStateReader(options.resolution.certificate, diagnosticIndex),
  );
  return Object.freeze([
    Object.freeze({ name: ENHANCEMENT_PRE_GAME_STATE_EXPORT, index: stateIndex }),
    Object.freeze({ name: ENHANCEMENT_PRE_GAME_DIAGNOSTIC_EXPORT, index: diagnosticIndex }),
  ]);
}
