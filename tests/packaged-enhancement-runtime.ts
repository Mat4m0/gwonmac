import {
  assertPackagedHostOnlyToolsAfterSoftRefusal,
  assertPackagedHostOnlyToolsSession,
  assertPackagedOffSession,
} from "./helpers/packaged-enhancement-fixture.ts";
import {
  assertCleanupSafetyGates,
  assertRollbackAfterTablePublication,
  assertTargetReadoutLifecycle,
  assertToolboxFoundationLifecycle,
} from "./helpers/packaged-enhancement-scenarios.ts";

await assertPackagedOffSession();
await assertPackagedHostOnlyToolsSession();
await assertPackagedHostOnlyToolsAfterSoftRefusal();
await assertTargetReadoutLifecycle();
await assertCleanupSafetyGates();
await assertToolboxFoundationLifecycle();
await assertRollbackAfterTablePublication();
console.log(
  "packaged Enhancement runtime proved isolation, host-only continuity, target and Toolbox lifecycles, and post-table rollback",
);
