# Documentation

Each document owns one thing and the others link to it rather than restating
it. This table exists so a question lands in one document.

| Document                                                     | Owns                                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| [`user-guide.md`](user-guide.md)                             | what the app does from a player's seat                                      |
| [`process-model.md`](process-model.md)                       | processes, sandbox, `gw://app`, rendering and input, sockets, secrets, signing |
| [`content-pipeline.md`](content-pipeline.md)                 | client artifacts, the chunk store, download modes, this app's updater       |
| [`wasm-host.md`](wasm-host.md)                               | the `Module` surface, the game filesystem, and client certification         |
| [`diagnostics.md`](diagnostics.md)                           | the flight recorder, the `.gwdiag` export, and which test proves which claim |
| [`enhancement-development.md`](enhancement-development.md)   | the procedure for extending the Enhancement                                 |
| [`gwonmac-tools-wasm.md`](gwonmac-tools-wasm.md)             | the companion kernel's shape and its developer proof surface                |
| [`performance-electron.md`](performance-electron.md)         | the measurement record and the conclusions drawn from it                    |
| [`release-verification.md`](release-verification.md)         | checksums, attestations, and what a version number means                     |

[`AGENTS.md`](../AGENTS.md) holds the constraints a change must not break,
[`PRODUCT.md`](../PRODUCT.md) who this is for and what will not ship, and
[`CONTRIBUTING.md`](../CONTRIBUTING.md) how to get a change reviewed.
