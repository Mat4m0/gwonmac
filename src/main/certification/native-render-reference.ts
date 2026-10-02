/**
 * Owns native graphics guards for host-driven texture publishing. The host can
 * run while the client's frame is suspended. Publishers must neither reenter
 * a graphics queue flush nor change a model the renderer still references.
 */
import { functionBodySha256 } from "./wasm-evidence.js";
import type { ModuleShape } from "./enhancement-evidence-types.js";
import { concat, sleb, uleb } from "../core/wasm-binary.js";

/** Exact owners of the device pointer, queue phase and model reference field. */
export const NATIVE_RENDER_REFERENCE_FUNCTIONS = [
  [2922, "b56cac8d3790761a7949b5d3a626d67522e26635a7d8e8e618186beccab6addd"],
  [2902, "bc88b58d8f433ac8068c56980741e4dd10791b42e915eb077def9812053b9872"],
  [750, "f198025ffa70c6a269469f8464953d303a8e1da314d2b86a27fa2e11931c6bbf"],
  [1532, "f77af25d4e59724cd0ed6103fb9fcbe92b035e09ee24456f00fafdc44bfc286a"],
] as const;

export type NativeRenderFunctionBodies = readonly (readonly [number, string])[];

// These are complete reviewed October owners, including their native calls,
// message cases and guard operands. No numerical shift selects a family.
const OCTOBER_RENDER_FUNCTIONS: Readonly<Record<number, readonly [number, string]>> = Object.freeze({
  264: [264, "49fa58035bc3421d78b015b2a2fa193c666e7c0b78afd87a08e5466640d5bbee"],
  748: [748, "da99a1f1dba71ee7f2c3430c4369fa5d29224b07af1067576498483887c0f4c5"],
  750: [750, "85f06410df74a13d2a16882b80328b82e9c3f902c176ff494f22ba965008cb02"],
  1333: [1333, "c90c8ed81da2c08f44ccbbc4780f27837c1a0f8d4a155fa1ef10a5db6fdb5b54"],
  1334: [1334, "380e12b02164f3bd7e1b10eff4629b9b05a7033746d65cfe652695bce3b1aac3"],
  1357: [1357, "ee4441d6823bbae764852f1962dff7f46463e1be383c08d8cb07837822e9a3d0"],
  1444: [1444, "e818abdb06c6480269dff224f63739095c8a5c53272dbebd7b5fd69e03f85a2f"],
  1445: [1445, "4f068862295d2dda824c833d1bdaebb070cc697f16c293c3e657518537cb70ec"],
  1446: [1446, "abd11553718f61ba717fb37c8106045ba16d261f5bd881fbc2bce13c856a8471"],
  1448: [1448, "a043d1945fa2513ce44d86fb6264a5b7b06dd9ec85edab72ee650ed133ad079d"],
  1449: [1449, "11661d6c7e6ec6e5bb453c0a48f05365f99cf0525363de58a6662df2f4ba29d3"],
  1522: [1522, "e7445c85afee635c5c825145b8990b4d69162f0a2b50480635a47b7639473933"],
  1530: [1530, "c9a566ae7a8de5786aa0ffaed7548b402c0399583d878363f07b0083dd22196a"],
  1532: [1532, "e00ea47f7529e9875b28e703d5c3cea36483df45a526de208ee023975448ed04"],
  1554: [1554, "469a8952e6ae97ebb639335b2c5aae486d4d3d70d4b866d5a2872b4aaf902fdf"],
  1556: [1556, "b9b91814e35737020709e5f46f0d41518ac1f859a65e41dae33dc7b3223dc49b"],
  1559: [1559, "0b769a6aafe3a32d400494a4282b37d8b53da28d49ae5b3f90732066b7328c2d"],
  1563: [1563, "89878e271646d74f19bd36c3a4be4fd9fff44b32494e5136be4c979744f9e494"],
  1564: [1564, "c2e99525f5a4c18a770c39500960570007d213787d427aa5903b5891e0876d9c"],
  1565: [1565, "872ed3066ee39cde646ab515a14b5c95b469ae814d009c3e4cf98273c98781da"],
  1569: [1569, "12522803ed13e7cb2eef8ebe6d9f7818ae0ebdea848e8a8bfee9f6ac70747d65"],
  1572: [1572, "cc2ab24d872edcd8f3d2ea4367053a8a531a6806cb3444c6a0eb932b1551dc49"],
  1579: [1579, "1808fc2f59f718ef98176177ffa94ff1c6ff1f4bb8f2b9308368783cfbf14507"],
  2187: [2187, "9e84fdd8526f059d82ed5c760c978149cf6bc504d84b24b27eb076fcbb81e314"],
  2249: [2249, "e12a9448b5ec6c70639e944637e7975d0a5d676e075863825351e11d5e198f9c"],
  2902: [2902, "c8f0622788ac3de16e86aca82d7b898e4d37b5791cb67758dcc374530b051555"],
  2922: [2922, "16df7a07758e9243fa6ecd2b7db14396210dff9f7bf38a8f8b235c73e18967d6"],
  2956: [2956, "a3f612bed772a033f2abf536c9edca28e868fc46f3f3d042a03a96b4a1115328"],
  3137: [3137, "c12bdc0b59e47d271a359faf5840fc03a0e98bc34dbb97c263498a4aeb3f3b1c"],
  5595: [5595, "7360f098727dd1b104924223849d92074c517ddccbcf03a3ef3f55789622035c"],
  6271: [6271, "0bc2ba7212009c0293a094a4c6c41b6676abeb3eedc82a08aad900c244e78e3c"],
  6284: [6284, "8c649e2d74bbd9592b30124cfa7c7b698da20f59c1b107fb9a1400398f3a6783"],
  6285: [6285, "dd11cc229e0344702d96497b9beee427086fd004317ede292923a36d85d6a3f5"],
  6295: [6295, "084e2cb2b8f154c88fb3a685b3f43d064e1491a6585f0dc0752603f1ed848626"],
  6446: [6446, "aa5cb0cd4908d1ebf18644c9006079d2eaa00d3fde5000f3ae5209fe9e238607"],
  6447: [6447, "276987391bc660d4addc75d9f9915ce63d56bb8d94d2127c8f4f991fb6a8e39e"],
  6450: [6450, "271c5607f21635fd648aed78849282ec5ee0b2fd39cecaeeecd2e33c63b180a8"],
  6488: [6488, "4d07845913433a58c2067e00d328c086a4789415c904d547d6e0ed9f9e2ee17d"],
  6490: [6490, "31b15d23535cfe3959ef4df7f5eccfd7eac406d8418f42ad460b201948e8deba"],
  6492: [6492, "b4696a3d320bb3e175d398f3bc83d18fb6f1283a9a9dc5795a93fb936927c758"],
  6584: [6584, "e5d996ecfbb22d697a122a69478bd1ef0ac2bf5540d040d849d427c8e84e88b0"],
  6585: [6585, "9e27e4f7e9bedac070483f3528bb612706c9e137a552998f6abe568ec1cb3372"],
  6593: [6593, "e9133b3700765951523114f6ed65cbc8bd804aaa5844ce6405e6cf4f70a0da9f"],
  6598: [6598, "91f5cf516b125fd6181e4e003e4b6d7acc841c37052438bf9d213ff71e27bf87"],
  6827: [6827, "1901a02335670f4660005e4bad39f58964ab6168555e5336116aae8ee8238e6b"],
  13125: [13136, "d3a59ae7b47e8aeffa7b531938b9481b9dac5a6b488d598efbeebdbe7baa21c3"],
  13162: [13173, "9073c546fc41604e2ac35cddb34b91529a6cd6f67dfabc49b6e624131df26bde"],
  14063: [14076, "8b94707765c214c8ed2266829949f0cebae5f2d96184191bb5af8eb358954581"],
  14112: [14125, "a8165c24351fc01dc0fad273019f507b76508cd545ff0a266034002e0dd26574"],
  14116: [14129, "d37c1968e320513b65e3461aae96b24063a879f6d95a38be094571fb47efc9f7"],
  14126: [14139, "256397ed0536d44ea656323cddb51bc29fb2b87b6af98a5793ff8ee9292a7c6a"],
  14132: [14145, "60a8463a6bcac6d45e8ae052e4a635b54a09fd2da4560c73e94f82e8d60ec9c3"],
  14137: [14150, "b87c903d314e8a09e67c4ef806857d4e6dc24a6ad9120a47287886d744e649ad"],
  14147: [14160, "b47aa2a9b0df83431a59ccf6754b9435af7f2f4b9e35be532930ce89323854ae"],
  16125: [16151, "59c2c2556eeb11939ddfca127f48e9147c954fda6644dfc100bcacbbbb78561c"],
  16136: [16162, "683d70ac6bca6bd6284cff8fa8f1064874d5a663a6b334de5a53f5d56a1cea0f"],
  16170: [16196, "2e75098575872822f44e012479635bc90b2d7de133587500e17dcf8afb105ce8"],
  16224: [16250, "c1b46860c01b1f20a3eabd6f0e97e016570a9e74c7a4be9e6e669f7eb4f3ece7"],
});
const OCTOBER_NATIVE_INDICES: Readonly<Record<number, number>> = Object.freeze({
  13125: 13136,
  13162: 13173,
  14063: 14076,
  14112: 14125,
  14116: 14129,
  14126: 14139,
  14132: 14145,
  14137: 14150,
  14147: 14160,
  16125: 16151,
  16136: 16162,
  16170: 16196,
  16224: 16250,
});

export function reviewedNativeRenderFunctions(
  checked: NativeRenderFunctionBodies,
  october: boolean,
): NativeRenderFunctionBodies {
  return october ? checked.map(([index]) => {
    const entry = OCTOBER_RENDER_FUNCTIONS[index];
    if (!entry) throw new Error("unreviewed native render owner");
    return entry;
  }) : checked;
}

export function resolveNativeRenderBindings(module: ModuleShape,
  checked: NativeRenderFunctionBodies) {
  const families = [false, true].filter(october =>
    reviewedNativeRenderFunctions(checked, october).every(([index, hash]) =>
      index >= module.functionImportCount && index < module.functionTypeIndices.length
      && functionBodySha256(module, index) === hash));
  if (families.length !== 1) return null;
  const october = families[0]!;
  return Object.freeze({
    functionBodies: reviewedNativeRenderFunctions(checked, october),
    functionIndex: (index: number) => {
      if (!checked.some(([reviewed]) => reviewed === index)) {
        throw new Error("unreviewed native render call");
      }
      return october ? OCTOBER_NATIVE_INDICES[index] ?? index : index;
    },
    modelTypeOffset: october ? 1341088 : 1341168,
    graphicsDevice: october ? 2744648 : 2734712,
    underMouse: october ? 5921036 : 5911100,
  });
}
export type NativeRenderBindings = NonNullable<ReturnType<typeof resolveNativeRenderBindings>>;

// 1569 resolves its handle as 750(handle, *(20 + 1341168)); pinning 1569's
// body pins this address. 1532 asserts on the i32 at model + 152.
const MODEL_TYPE_BASE = 20;
const MODEL_TYPE_OFFSET = 1341168;
const RENDER_REFERENCE_OFFSET = 152;

/**
 * Leaves 1 on the stack when the model behind `handle` is missing or still
 * referenced by the renderer, else 0. `scratch` must be an i32 local.
 */
export function nativeModelBusy(handle: Uint8Array, scratch: number, bindings?: NativeRenderBindings): Uint8Array {
  return concat(
    handle,
    Uint8Array.of(0x41), sleb(MODEL_TYPE_BASE),
    Uint8Array.of(0x28, 2), uleb(bindings?.modelTypeOffset ?? MODEL_TYPE_OFFSET),
    Uint8Array.of(0x10), uleb(bindings?.functionIndex(750) ?? 750),
    Uint8Array.of(0x22), uleb(scratch),
    Uint8Array.of(0x45),
    Uint8Array.of(0x20), uleb(scratch),
    Uint8Array.of(0x28, 2), uleb(RENDER_REFERENCE_OFFSET),
    Uint8Array.of(0x72),
  );
}

/**
 * Leaves 1 when no graphics device exists or its queue is flushing. 2922 reads
 * the current device at 2734712; 2902 asserts device + 460 == GR_QUEUES (3)
 * before a flush, uses 0/1/2 while flushing, then restores 3. Check this even
 * for a first upload: model creation can validate a material and flush too.
 */
export function nativeGraphicsBusy(scratch: number, bindings?: NativeRenderBindings): Uint8Array {
  return concat(
    Uint8Array.of(0x41), sleb(bindings?.graphicsDevice ?? 2734712),
    Uint8Array.of(0x28, 2, 0, 0x22), uleb(scratch),
    Uint8Array.of(0x45, 0x04, 0x7f, 0x41, 1, 0x05, 0x20), uleb(scratch),
    Uint8Array.of(0x28, 2), uleb(460),
    Uint8Array.of(0x41, 3, 0x47, 0x0b),
  );
}
