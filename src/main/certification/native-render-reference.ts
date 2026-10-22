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
// October 22: the October owners at their renumbered indices. Bodies differ
// only by reviewed callee indices and relocated static operands.
const OCTOBER_22_RENDER_FUNCTIONS: Readonly<Record<number, readonly [number, string]>> = Object.freeze({
  264: [264, "94ec7217d0fb11ead98600b7b8aa2b71ee55fad6b936d2133088b33c9962a37d"],
  748: [748, "f1f53c94b6340f394c360c3af0f5604ad5514488751fb18ce360585ddfeb2fa7"],
  750: [750, "0eebb2bfac9638f17b674c5990802c188a3a98d432d4c4a6737fb7f4551a9e82"],
  1333: [1333, "2a2380fe271d2f3933c1749f73bfffbf6d967b605a59473d0e449053cb937dd5"],
  1334: [1334, "8c2f991e381aec54c79bb3f236652fade8de44da3fa92cfe45556bc4af60f183"],
  1357: [1357, "f03a6885a613d93b5bf27e62afcaffd5bad1ec08f238960baf04d4c3cdf4d5e5"],
  1444: [1444, "e2e5d918d727ef14b7fdaef41f3446c65193f6fbe80446be6566a477681a0904"],
  1445: [1445, "ea7a7ab8c07165ee61b3c8239cc8140771eeee9b8677841632064817b116d1ee"],
  1446: [1446, "875e9edf6a7f4c6837dd661b3e487dc87b8f2be0be416272c54c14dbe116c5dc"],
  1448: [1448, "6580203bcf57308ea063af0cf46b314a2e867c29791a5a5295082a0219c03981"],
  1449: [1449, "1c11192753e67ba74ed7db55945f93c10d72b799061fd31b496fc2cdc0d6d26b"],
  1522: [1522, "b3f4866ffd9ff0fd9f0bbdf9411161a78cb2b23fdc917a73fe33b000fc907d13"],
  1530: [1530, "bac0f3e38dc0b587dacfe3fcfc9a7527124f20cc07d54837da50def04cff29f6"],
  1532: [1532, "f75cc657befc8f51513048bfa7fd7fae85f7b689e47f300a15b0343e924b082e"],
  1554: [1554, "06c86f4e20b8c3713eaed0f50ab36aeedef50a7539649dbdfe2628a3ab5554ff"],
  1556: [1556, "1bcca33c2669e2c14a46c1c325653b3c2e73bdd073b4ac7194d27922b195f531"],
  1559: [1559, "72ab3beab5262b9e3bb92a2695479eadc0ed735e8bf8c4dfb02b25b2232d38be"],
  1563: [1563, "9969e5908a09a60a335a30adeec9da025c7d33fa8bf278eb5f80464e3cf7fb20"],
  1564: [1564, "4c7a70b4c78dc64bead8081fe4faca0e32911c1bc53d58bb5fbc2a9386b5f1ff"],
  1565: [1565, "0185f0d5b13a947c1a5f7219ece1a98d0beb89a43b12a0f3d9bb617d0505d384"],
  1569: [1569, "58eae3c31255da6e2582ded4e0615fadbb5619ecdbff597bba9dcbe166d315c4"],
  1572: [1572, "0d881eec84eb2b448d3369ceb3f3225398bdd4ddfbd4f94f282422f24ed956fe"],
  1579: [1579, "11a75789cdf24acade096cfa060b013d6141704fbbb74af31be80251e4b71b9d"],
  2187: [2187, "06c41429f7f2d794d0c061e23335f11cb06a2e7a02a8a81da39988eb81f569f6"],
  2249: [2249, "51d5de10730b93272866f3917776eaeecb3a68aabaaf8213f0667a315da141d7"],
  2902: [2902, "23f71618e47ebe1e6ce6d50f5290541213e0ecc426374a772a87eb75e4831a2c"],
  2922: [2922, "f4c491012226f9c08387bee278c9e91338ab82de5c71bbfb64ac62017df31777"],
  2956: [2956, "dedf71e8cbad3dc24b3395c14bc1dc9efeba767687dd25232da35d150d39c4cf"],
  3137: [3137, "7b85811f2e1b9f0a13e66b76ccb01795d0f4288e9a3fbf9900530cdfa1fc1339"],
  5595: [5595, "3af2d946882f262b60718623a18d3977acf92194150c65ea4fab8684906ed703"],
  6271: [6271, "be00d4ff939b6259324f83b9d53bc1c3f3019f027c1e2c605189fb90946a6212"],
  6284: [6284, "ee1c414b1434b2bba3f690497cd88a7d0381cd6948643a8c47a0035917175ec5"],
  6285: [6285, "98f46fb22fd105072fb6f5d3ccd8665fd7d4245d493b9f076264f3ebdc5d5191"],
  6295: [6295, "1b0c75eca543e147f8a6ea4965befb9591b03b8b482586bc45b90f47eef77ac0"],
  6446: [6446, "f0d0f6091ea4b8749c00cf2973a0b8911a49993b0afe79182952b7d3cca715f7"],
  6447: [6447, "0d43f0fabac0c7d463f4a6b073a45e16941642f88416841b0d8524e2348b38c8"],
  6450: [6450, "643f6733c8a74d823848b179fe61383cb9706e5f5181d1d016c48e64831648a0"],
  6488: [6488, "04fc81d673ee0a07d8de4e00a57d318c54cb0b68230f6d86fad10ec03d88dc08"],
  6490: [6490, "ad22c95211ae5de444cbee2a37f1a07c2b9fb6e0d6f23caa758fd7ba9ac7d91c"],
  6492: [6492, "d163abd18f36b31e89ed488c1e60435c83b56d065f1936405d89400f2c772a08"],
  6584: [6584, "498a580fe1f2863df8c929ecbff1e8f864ed96ff53f7b18b803ae84dfb2545a7"],
  6585: [6585, "4d9928f3e8c33a8b056fb4788f987afb22e7699cc4dd331fdd95f2e43b7965b9"],
  6593: [6593, "35aa20e5d81ca4dfb8962dd9bcb1ada197af1bb86001f6012fc1bdcfdf1cca92"],
  6598: [6598, "91f5cf516b125fd6181e4e003e4b6d7acc841c37052438bf9d213ff71e27bf87"],
  6827: [6827, "c777401e75f6220143cd3bc2f5573ac8b64b550796f0813ed85350d136af8c2c"],
  13125: [13096, "4551e1ad9a08c2e1e81337ccf3b59c4a2654fbabac9389c317300d9a3f5a6d88"],
  13162: [13133, "78097eeffeda60e8515e4165d071541ec4dbdbe55065a7b243ba4f5d910a58b2"],
  14063: [14036, "0974bc46436ed9ea7c2d7c18f8c0b8a23dba3ff7e8d22c0ad61f21f27acd7948"],
  14112: [14085, "f23d7dab7f956f4afb6a08d9ac733628dbf01d6c50ba70f9d0cb818fce3ac5e0"],
  14116: [14089, "729d1412702fe4623a7163973c7427e3e7d54213f6432824786ad2210ca962de"],
  14126: [14099, "256397ed0536d44ea656323cddb51bc29fb2b87b6af98a5793ff8ee9292a7c6a"],
  14132: [14105, "bac5eee8d292fefb8c69b2b4539f1ad1bc22dffab4e8593ca0beb0821dd30b1c"],
  14137: [14110, "7cd1bc60cf003ca029aa52e133acde34ca8d3f1692636904f852170c9c97740a"],
  14147: [14120, "b47aa2a9b0df83431a59ccf6754b9435af7f2f4b9e35be532930ce89323854ae"],
  16125: [16112, "59c2c2556eeb11939ddfca127f48e9147c954fda6644dfc100bcacbbbb78561c"],
  16136: [16123, "73c890f5440d0ee73e0b71408fc0b04cb728660f8d34e5c5cfbe2a94dd2b1667"],
  16170: [16157, "96ee4aaabf5072bb3a7657d86461ab56d48b7d1be88f07e0ba4662a5f03c5421"],
  16224: [16211, "7d9544f06ff6453d5c0af45b2da1fab79fea540ff077d715c439e603658a13ac"],
});

type NativeRenderFamily = Readonly<{
  /** Reviewed owner per checked reference index; null keeps the reference. */
  functions: Readonly<Record<number, readonly [number, string]>> | null;
  modelTypeOffset: number;
  graphicsDevice: number;
  underMouse: number;
}>;

/** Reviewed client families. Exactly one may match a module. */
const NATIVE_RENDER_FAMILIES: readonly NativeRenderFamily[] = Object.freeze([
  { functions: null, modelTypeOffset: 1341168, graphicsDevice: 2734712, underMouse: 5911100 },
  {
    functions: OCTOBER_RENDER_FUNCTIONS,
    modelTypeOffset: 1341088, graphicsDevice: 2744648, underMouse: 5921036,
  },
  {
    functions: OCTOBER_22_RENDER_FUNCTIONS,
    modelTypeOffset: 1341088, graphicsDevice: 2744952, underMouse: 5921340,
  },
]);
export const NATIVE_RENDER_FAMILY_COUNT = NATIVE_RENDER_FAMILIES.length;

export function reviewedNativeRenderFunctions(
  checked: NativeRenderFunctionBodies,
  family: number,
): NativeRenderFunctionBodies {
  const functions = NATIVE_RENDER_FAMILIES[family]?.functions;
  if (functions === undefined) throw new Error("unknown native render family");
  return functions === null ? checked : checked.map(([index]) => {
    const entry = functions[index];
    if (!entry) throw new Error("unreviewed native render owner");
    return entry;
  });
}

export function resolveNativeRenderBindings(module: ModuleShape,
  checked: NativeRenderFunctionBodies) {
  const families = NATIVE_RENDER_FAMILIES.flatMap((_, family) =>
    reviewedNativeRenderFunctions(checked, family).every(([index, hash]) =>
      index >= module.functionImportCount && index < module.functionTypeIndices.length
      && functionBodySha256(module, index) === hash) ? [family] : []);
  if (families.length !== 1) return null;
  const family = NATIVE_RENDER_FAMILIES[families[0]!]!;
  return Object.freeze({
    functionBodies: reviewedNativeRenderFunctions(checked, families[0]!),
    functionIndex: (index: number) => {
      if (!checked.some(([reviewed]) => reviewed === index)) {
        throw new Error("unreviewed native render call");
      }
      return family.functions?.[index]?.[0] ?? index;
    },
    modelTypeOffset: family.modelTypeOffset,
    graphicsDevice: family.graphicsDevice,
    underMouse: family.underMouse,
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
