/** Fixed expectations for retained offline clients; these values grant no runtime authority. */
import { createHash } from "node:crypto";

export function retainedClientFixture(input: Uint8Array) {
  const october = createHash("sha256").update(input).digest("hex")
    === "266b5a8aa88fe6440b10737d3eda27f4ceae2401d51d263debc0bca5c2075d87";
  const moved: Readonly<Record<number, number>> = {
    13125: 13136, 13162: 13173, 14063: 14076, 14112: 14125,
    14116: 14129, 14126: 14139, 14132: 14145, 14137: 14150,
    14147: 14160, 16125: 16151, 16136: 16162, 16170: 16196,
    16224: 16250, 17640: 17667, 17791: 17818, 17793: 17820,
  };
  return {
    memoryLayout: october ? "october" as const : "relocated" as const,
    graphicsDevice: october ? 2744648 : 2734712,
    modelTypeOffset: october ? 1341088 : 1341168,
    underMouse: october ? 5921036 : 5911100,
    compassOwner: october ? 15775 : 15750,
    worldVisibilityOwner: october ? 15944 : 15919,
    missionDispatcher: october ? 16162 : 16136,
    missionTableSlot: october ? 4020 : 4006,
    worldDispatcher: october ? 16249 : 16223,
    worldTableSlot: october ? 4166 : 4152,
    gameplayContext: october ? 13573 : 13562,
    functionIndex: (index: number) => october ? moved[index] ?? index : index,
  };
}
