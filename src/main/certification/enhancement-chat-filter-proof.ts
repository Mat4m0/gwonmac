/**
 * Owns the semantic proof for the game function that constructs a native
 * write-to-chat-log packet. Other local-action proofs consume only its result.
 */
import type { KnownEnhancementBuild } from "./enhancement-build-model.js";
import type { ModuleShape } from "./enhancement-evidence-types.js";
import {
  functionBody,
  functionBodySha256,
  semanticRole,
  signatureMatches,
  soleValue,
  uniqueRoleFunction,
  unsignedOperand,
  valuesForRole,
} from "./wasm-evidence.js";

export const CHAT_LOG_PRODUCER_ROLE = semanticRole(
  115,
  "0fd33a5d55c00d25e364ff0be0c63c67a1849acc8f0a9fb5525560367eecb41e",
  Object.freeze([
    { start: 25, end: 30, role: "chat.valid-message", addressClass: "function-index" },
    { start: 33, end: 38, role: "chat.assertion-expression", addressClass: "immutable-data" },
    { start: 39, end: 44, role: "chat.assertion-file", addressClass: "immutable-data" },
    { start: 48, end: 53, role: "chat.assertion", addressClass: "function-index" },
    { start: 63, end: 68, role: "chat.encoding-format", addressClass: "immutable-data" },
    { start: 69, end: 74, role: "chat.encode", addressClass: "function-index" },
    { start: 98, end: 103, role: "chat.ui", addressClass: "function-index" },
  ]),
  ["i32", "i32"],
  [],
);

export function deriveChatFiltering(
  module: ModuleShape,
  baseline: KnownEnhancementBuild,
  uiDispatcher: NonNullable<KnownEnhancementBuild["uiDispatcher"]>,
  writeProducer: number,
): KnownEnhancementBuild["chatFiltering"] | null {
  const expected = baseline.chatFiltering;
  if (!expected) return null;
  const functionIndex = uniqueRoleFunction(module, CHAT_LOG_PRODUCER_ROLE);
  if (functionIndex === null || functionIndex !== writeProducer) return null;
  const body = functionBody(module, functionIndex);
  const values = valuesForRole(body, CHAT_LOG_PRODUCER_ROLE);
  const packetBase = unsignedOperand(body, 93);
  const messageStore = unsignedOperand(body, 76);
  const channelStore = unsignedOperand(body, 83);
  const writeToChatLogMessage = unsignedOperand(body, 85);
  if (
    soleValue(values, "chat.ui") !== uiDispatcher.functionIndex
    || !signatureMatches(module, functionIndex, ["i32", "i32"], [])
    || packetBase !== 8
    || channelStore < packetBase
    || messageStore < packetBase
    || channelStore - packetBase !== expected.packetChannelOffset
    || messageStore - packetBase !== expected.packetMessageOffset
    || writeToChatLogMessage !== expected.writeToChatLogMessage
    || expected.currentPlayerNameOffset !== 0x74
  ) return null;
  return Object.freeze({
    ...expected,
    writeToChatLogMessage,
    packetChannelOffset: channelStore - packetBase,
    packetMessageOffset: messageStore - packetBase,
    producer: Object.freeze({
      ...expected.producer,
      functionIndex,
      bodySha256: functionBodySha256(module, functionIndex),
    }),
  });
}
