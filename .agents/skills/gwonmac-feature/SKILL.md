---
name: gwonmac-feature
description: Develop gwonmac client features or investigate their native WASM integration.
---

# Work on a gwonmac feature

Use the matching domain in [docs/README.md](../../../docs/README.md) and the
[extension contract](../../../docs/enhancement-development.md#internal-feature-extension-contract)
for the layers the change needs. Host presentation and consumers of accepted
game state do not require another native reader.

For a missing native fact, use [client research](../../../docs/client-research.md)
to find current examples, source revisions, cheap inspection, and retained
findings. Toolbox/GWCA layouts and generated function labels are leads; establish
the behavior in the current WASM. Successful enqueue alone does not prove a
native action completed.

For drawing, distinguish native UI ordering from world-space geometry and read
the relevant [rendering evidence](../../../internal/research/world-rendering.md).
An inline screen-space marker does not prove stable world attachment or depth.

Choose verification through [the existing guide](../../../docs/enhancement-development.md#use-the-cheapest-proof).
For an actual app session, use [development startup](../../../docs/development-workflow.md#start-and-hand-off-a-development-app).
Keep expensive new findings in their domain's evidence owner; do not turn each
experiment into a new skill or copy its transcript into permanent guidance.
