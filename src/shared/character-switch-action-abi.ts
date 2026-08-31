/**
 * One fixed private ABI between the certified Character Switch transform and
 * its renderer controller. No generic memory or frame command crosses it.
 */
export const CHARACTER_SWITCH_ACTION_ABI = Object.freeze({
  bytes: 40,
  fields: Object.freeze({
    result: 20,
    selectedIndex: 32,
    proofMask: 36,
  }),
  action: Object.freeze({
    logout: 1,
    select: 2,
    play: 3,
  }),
  result: Object.freeze({
    sent: 1,
    refused: 2,
    invalid: 3,
    selectorFrame: 4,
    selectorChild: 5,
    selectorIndex: 6,
    selectionUnconfirmed: 7,
    playFrame: 8,
    selectorParent: 9,
    playParent: 10,
    selectorContext: 11,
    selectorTarget: 12,
    selectorArray: 13,
  }),
  proof: Object.freeze({
    frameRegistryCount: 0,
    frameRegistryArray: 1,
    framePointer: 2,
    frameIdentity: 3,
    frameHash: 4,
    frameVisible: 5,
    selectorChild: 6,
    selectorChildIdentity: 7,
    selectedIndexRead: 8,
    selectedIndexValid: 9,
    clickSent: 10,
    selectionConfirmed: 11,
    parentResolved: 12,
    parentPointer: 13,
    parentIdentity: 14,
    parentValidated: 16,
    contextRows: 17,
    contextFound: 18,
    contextIdentity: 19,
    characterArray: 20,
    targetResolved: 21,
    targetPointer: 22,
  }),
});

export type CharacterSwitchActionKind = keyof typeof CHARACTER_SWITCH_ACTION_ABI.action;
