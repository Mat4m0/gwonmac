# Documentation

Use this page to find the document that owns your question. Each current
document owns one subject. Other documents must link to it instead of copying
its rules.

| Question | Current document |
| --- | --- |
| How does a player use or recover the app? | [User guide](user-guide.md) |
| Which process owns this work? | [Process model](process-model.md) |
| How do Single and Multiple Accounts mode isolate player data? | [Multiple Accounts](multiple-accounts.md) |
| How do ArenaNet client files and game data update? | [Content pipeline](content-pipeline.md) |
| How are project news and service-status messages trusted and published? | [Project content feed](project-content-feed.md) |
| How does the official client host and certification work? | [WASM host](wasm-host.md) |
| How do client features remain safe across ArenaNet updates? | [ArenaNet compatibility](arenanet-compatibility.md) |
| What can diagnostics record and export? | [Diagnostics](diagnostics.md) |
| How do I change or recertify an Enhancement? | [Enhancement development](enhancement-development.md) |
| How do application releases, Stable, and Beta work? | [Release verification](release-verification.md) |
| Which UI tokens and components must Tools use? | [Tools design](../apps/tools/DESIGN.md) |

Start with these repository documents when their subject applies:

- [`AGENTS.md`](../AGENTS.md) gives instructions and safety rules to coding agents.
- [`PRODUCT.md`](../PRODUCT.md) defines the product, its users, and its non-goals.
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) explains how to propose a change.

Some directories have a short local README. It explains only the files and
hazards in that directory. The current technical document remains the owner of
the wider behavior.

Files under `internal/` are investigation evidence. They can include failed
hypotheses and old build facts. Use them to understand past decisions. Do not
use them as the current product or architecture specification.
