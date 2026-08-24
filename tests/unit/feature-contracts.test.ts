import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS } from "../../src/shared/contracts.ts";
import {
  ENHANCEMENT_CAPABILITY_CONTRACTS,
  ENHANCEMENT_CAPABILITY_FIELDS,
  NO_ENHANCEMENT_CAPABILITIES,
  enhancementHooksFor,
  intersectEnhancementCapabilities,
  validEnhancementCapabilities,
  type EnhancementCapability,
} from "../../src/shared/enhancement-contracts.ts";
import {
  FEATURE_SELECTION_POLICIES,
  featureActivationRequested,
  featureRegionAllowsRequest,
} from "../../src/shared/feature-contracts.ts";

test("the capability registry is the ordered wire vocabulary", () => {
  assert.deepEqual(ENHANCEMENT_CAPABILITY_CONTRACTS, [
    {
      id: "nativeCursor",
      requiresAll: [],
      requiresAny: [],
      configOwners: ["cursor"],
      hooks: ["cursor"],
    },
    {
      id: "targetObservation",
      requiresAll: [],
      requiresAny: [],
      configOwners: ["observation", "target"],
      hooks: [],
    },
    {
      id: "partyObservation",
      requiresAll: [],
      requiresAny: [],
      configOwners: ["observation", "party"],
      hooks: ["ui"],
    },
    {
      id: "teamApply",
      requiresAll: ["partyObservation"],
      requiresAny: [],
      configOwners: [],
      hooks: [],
    },
    {
      id: "travelAction",
      requiresAll: [],
      requiresAny: [],
      configOwners: [],
      hooks: [],
    },
    {
      id: "xunlaiAction",
      requiresAll: [],
      requiresAny: [],
      configOwners: ["observation", "storage"],
      hooks: [],
    },
    {
      id: "chatAliases",
      requiresAll: [],
      requiresAny: ["travelAction", "xunlaiAction"],
      configOwners: [],
      hooks: [],
    },
    {
      id: "skillSlotGeometry",
      requiresAll: ["partyObservation"],
      requiresAny: [],
      configOwners: ["skill-slots"],
      hooks: [],
    },
    {
      id: "skillCooldownObservation",
      requiresAll: ["partyObservation"],
      requiresAny: [],
      configOwners: ["skill-cooldown"],
      hooks: [],
    },
  ]);
  assert.deepEqual(
    ENHANCEMENT_CAPABILITY_CONTRACTS.map(({ id }) => id),
    ENHANCEMENT_CAPABILITY_FIELDS,
  );
  assert.equal(new Set(ENHANCEMENT_CAPABILITY_FIELDS).size, 9);
  for (const contract of ENHANCEMENT_CAPABILITY_CONTRACTS) {
    assert.equal(Object.isFrozen(contract), true, contract.id);
    assert.equal(Object.isFrozen(contract.requiresAll), true, contract.id);
    assert.equal(Object.isFrozen(contract.requiresAny), true, contract.id);
    assert.equal(Object.isFrozen(contract.configOwners), true, contract.id);
    assert.equal(Object.isFrozen(contract.hooks), true, contract.id);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(ENHANCEMENT_CAPABILITY_CONTRACTS.map(
    (contract) => [contract.id, contract],
  ));
  const visit = (id: EnhancementCapability): void => {
    assert.equal(visiting.has(id), false, `capability dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    const contract = byId.get(id);
    assert.ok(contract);
    for (const dependency of [...contract.requiresAll, ...contract.requiresAny]) {
      assert.ok(byId.has(dependency), `${id} names unknown dependency ${dependency}`);
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ENHANCEMENT_CAPABILITY_FIELDS) visit(id);
});

test("dependency pruning is derived from capability contracts", () => {
  for (const contract of ENHANCEMENT_CAPABILITY_CONTRACTS) {
    const isolated = {
      ...NO_ENHANCEMENT_CAPABILITIES,
      [contract.id]: true,
    };
    const hasDependencies = contract.requiresAll.length > 0
      || contract.requiresAny.length > 0;
    assert.equal(validEnhancementCapabilities(isolated), !hasDependencies, contract.id);
    assert.equal(
      intersectEnhancementCapabilities(isolated, isolated)[contract.id],
      !hasDependencies,
      contract.id,
    );
    assert.deepEqual(enhancementHooksFor(isolated), {
      tick: true,
      cursor: contract.id === "nativeCursor",
      ui: contract.id === "partyObservation",
    }, contract.id);
  }
});

test("feature selection policies are deeply immutable", () => {
  assert.equal(Object.isFrozen(FEATURE_SELECTION_POLICIES), true);
  for (const [id, policy] of Object.entries(FEATURE_SELECTION_POLICIES)) {
    assert.equal(Object.isFrozen(policy), true, id);
    assert.equal(Object.isFrozen(policy.activation), true, id);
  }
});

test("shared activation and area policy cover required, setting, and content features", () => {
  assert.equal(featureActivationRequested("tools", DEFAULT_SETTINGS), false);
  assert.equal(featureActivationRequested("skillCooldowns", DEFAULT_SETTINGS), false);
  const enabled = { ...DEFAULT_SETTINGS, gwonmacTools: true };
  assert.equal(featureActivationRequested("tools", enabled), true);
  assert.equal(featureActivationRequested("skillCooldowns", enabled), true);
  assert.equal(featureActivationRequested("skillKeyLabels", enabled), false);
  assert.equal(featureActivationRequested("skillKeyLabels", {
    ...enabled,
    skillKeyBindings: [
      {
        input: { kind: "keyboard", code: "KeyC" },
        modifiers: { control: false, option: false, shift: false, command: false },
      },
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ],
  }), true);
  assert.equal(featureRegionAllowsRequest("travel", "pve"), true);
  assert.equal(featureRegionAllowsRequest("travel", "unknown"), false);
  assert.equal(featureRegionAllowsRequest("tools", "pvp"), true);
  assert.equal(featureRegionAllowsRequest("xunlaiStorage", "unknown"), true);
});
