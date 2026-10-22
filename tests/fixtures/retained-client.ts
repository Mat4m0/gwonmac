/** Fixed expectations for retained offline clients; these values grant no runtime authority. */
import { createHash } from "node:crypto";
import type { CartographyMemoryLayoutId } from "../../src/main/certification/pathing-spike-transform.js";

type RetainedClient = Readonly<{
  memoryLayout: CartographyMemoryLayoutId;
  graphicsDevice: number;
  modelTypeOffset: number;
  underMouse: number;
  compassOwner: number;
  worldVisibilityOwner: number;
  missionDispatcher: number;
  missionTableSlot: number;
  worldDispatcher: number;
  worldTableSlot: number;
  gameplayContext: number;
  /** August function index -> this client's index, where it moved. */
  moved: Readonly<Record<number, number>>;
  /** August static address -> this client's address, where it moved. */
  addresses: Readonly<Record<number, number>>;
}>;

const AUGUST: RetainedClient = {
  memoryLayout: "relocated",
  graphicsDevice: 2734712, modelTypeOffset: 1341168, underMouse: 5911100,
  compassOwner: 15750, worldVisibilityOwner: 15919,
  missionDispatcher: 16136, missionTableSlot: 4006,
  worldDispatcher: 16223, worldTableSlot: 4152,
  gameplayContext: 13562,
  moved: {}, addresses: {},
};

const CLIENTS: Readonly<Record<string, RetainedClient>> = {
  "266b5a8aa88fe6440b10737d3eda27f4ceae2401d51d263debc0bca5c2075d87": {
    memoryLayout: "october",
    graphicsDevice: 2744648, modelTypeOffset: 1341088, underMouse: 5921036,
    compassOwner: 15775, worldVisibilityOwner: 15944,
    missionDispatcher: 16162, missionTableSlot: 4020,
    worldDispatcher: 16249, worldTableSlot: 4166,
    gameplayContext: 13573,
    moved: {
      13125: 13136, 13162: 13173, 14063: 14076, 14112: 14125,
      14116: 14129, 14126: 14139, 14132: 14145, 14137: 14150,
      14147: 14160, 16125: 16151, 16136: 16162, 16170: 16196,
      16224: 16250, 17640: 17667, 17791: 17818, 17793: 17820,
    },
    addresses: {
      5913696: 5923632, 5913576: 5923512, 5913568: 5923504,
      5910124: 5920060, 5910128: 5920064, 5913680: 5923616,
      5913684: 5923620, 5913688: 5923624, 1420256: 1420176,
    },
  },
  "f4e529f9c9b6b6a1dfd3e0e7c8d8c518a48c45d8a9a526d89512b5e9c37c075e": {
    memoryLayout: "october22",
    graphicsDevice: 2744952, modelTypeOffset: 1341088, underMouse: 5921340,
    compassOwner: 15736, worldVisibilityOwner: 15905,
    missionDispatcher: 16123, missionTableSlot: 4004,
    worldDispatcher: 16210, worldTableSlot: 4150,
    gameplayContext: 13533,
    moved: {
      13125: 13096, 13162: 13133, 14063: 14036, 14112: 14085,
      14116: 14089, 14126: 14099, 14132: 14105, 14137: 14110,
      14147: 14120, 16125: 16112, 16136: 16123, 16170: 16157,
      16224: 16211, 17640: 17628, 17791: 17779, 17793: 17781,
    },
    addresses: {
      5913696: 5923952, 5913576: 5923832, 5913568: 5923824,
      5910124: 5920364, 5910128: 5920368, 5913680: 5923936,
      5913684: 5923940, 5913688: 5923944, 1420256: 1420176,
    },
  },
};

export function retainedClientFixture(input: Uint8Array) {
  const client = CLIENTS[createHash("sha256").update(input).digest("hex")] ?? AUGUST;
  return {
    ...client,
    functionIndex: (index: number) => client.moved[index] ?? index,
    address: (august: number) => client.addresses[august] ?? august,
  };
}
