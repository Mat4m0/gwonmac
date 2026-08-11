# Client certification detector record

`certified-client.json` records the ArenaNet JSPI code generation that this
repository reviewed. The scheduled detector uses this record to decide if it
must start recertification work.

> [!IMPORTANT]
> This record does not authorize a client transform. Runtime authority comes
> only from compiled certification tables or the isolated local structural
> proof. There is no remote certification feed or remote authority.

The digest covers these code artifacts:

- `Gw.jspi.js`
- `Gw.jspi.wasm`

It does not cover `Gw.snapshot` or `version.json`. ArenaNet can publish game
content without changing executable client code.

The file has this closed format:

```json
{ "formatVersion": 1, "codeGeneration": "<64 lowercase hexadecimal characters>" }
```

Run `pnpm client:official` to compare the published generation with the
recorded generation. Run `pnpm client:official --record <digest>` only after you
review the certification change for that exact digest.

Record the reviewed digest directly. Do not fetch it again during the write.
ArenaNet can publish another generation between the review and the write.

An incorrect record can start unnecessary work or delay recertification. It
cannot enable a transform. See the [WASM host](../docs/wasm-host.md) and the
[Enhancement runbook](../docs/enhancement-development.md).
