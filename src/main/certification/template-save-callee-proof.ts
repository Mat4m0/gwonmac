/**
 * Binds Template-saving helper calls to their reviewed signatures and complete
 * bodies. Call positions may move only with the independently identified callee.
 */
import { createHash } from "node:crypto";
import type { TemplateSaveModuleView } from "./template-save-module-view.js";

interface CalleeWitness {
  readonly offset: number;
  readonly signature: string;
  readonly bodyHashes: readonly string[];
}

// These are feature-local helper bodies, never whole-client launch authority.
// Both retained August and October bodies preserve the caller's argument and
// control-flow contract. A new helper body must refuse until it is reviewed.
const CALL_WITNESSES: Readonly<Record<string, readonly CalleeWitness[]>> = {
  "screenshot-initializer": [
    { offset: 39, signature: "()->()", bodyHashes: [
      "f61e0d977f1062cdc9eb1604f23685581db8f5f9f86a6d22b7fb2f8add381777",
      "2fccbd179a983ccd28c27502d6d17d53989d02b1ccb0b40e4b139bf55935018f",
    ] },
    { offset: 145, signature: "(i32)->(i32)", bodyHashes: [
      "d4ee1c0b9e04c0a9c2ba20c2db8cb27a4374196429d731cea023f0c92d6438a0",
      "47db5be8d94d4d1c66e1fc602e14588b6de79dd55e50830f518dd88d7a9a5ce7",
    ] },
    { offset: 235, signature: "(i32,i32)->()", bodyHashes: [
      "4ab967be169dbe74a1e5f2c4f477ebcaed66b101c8887b812104058de42e0e45",
      "658aaf6e5f8a2b0b5d86ffab032a37ab98b63f2967c18fde2db7afa041086882",
    ] },
  ],
  "writer": [
    { offset: 50, signature: "(i32,i32)->()", bodyHashes: [
      "42e5f136409ef9876e49fac965280f5fdd9be6b8d042b2de0ef4a2faca7f91da",
      "94b7a29936f37b71100e1805725eaaf59df65ec763fc964667fb9166bef6acd7",
    ] },
  ],
  "directory-sink": [
    { offset: 776, signature: "(i32,i32)->()", bodyHashes: [
      "27de9130f902e343143030751962177d77853da9e841eb7afbfd3c6c494e556d",
      "af39ac84af3f910dea532421a1d27a77621d13caf6894de83b62ccf9c56841b7",
    ] },
    { offset: 1104, signature: "(i32,i32)->()", bodyHashes: [
      "27de9130f902e343143030751962177d77853da9e841eb7afbfd3c6c494e556d",
      "af39ac84af3f910dea532421a1d27a77621d13caf6894de83b62ccf9c56841b7",
    ] },
  ],
  "screenshot-sink": [
    { offset: 198, signature: "()->(i32)", bodyHashes: [
      "f63235d97028ffe7bfab880ac8a0f85c88a3b3323fe2e9893ba06d0ea1a3b891",
      "975f8ebc96587696f02406d334da68a2762f9e54393782e07cd8bd694dc3532a",
    ] },
    { offset: 211, signature: "(i32)->(i32)", bodyHashes: [
      "5c8e5494dc3001b6f9e3110466ebada686954f264d7759e782b19246e2e2faa4",
      "2ec8d3270f621a09393cdd241baa010971550cb10d69206de4da883f7bb65524",
    ] },
    { offset: 228, signature: "(i32,i32)->()", bodyHashes: [
      "178b6da0fc63cdec62cb7e2813ec45270d8508f6da86af1194ae2adb074aaf1b",
      "301c3af464b30961e0bb24276782d7176f314baf7391ff280b26d68978604d5e",
    ] },
    { offset: 952, signature: "(i32)->(i32)", bodyHashes: [
      "df3092089ab2fe5a657b174ee6d40c21e06ab1791d3fbfc7a2c017844ad44f87",
      "65d0ad5584cb83ea51954f0f2c11f9de9e92a814fc9c01be299dd0f31224efeb",
    ] },
    { offset: 1215, signature: "(i32,i32)->()", bodyHashes: [
      "27de9130f902e343143030751962177d77853da9e841eb7afbfd3c6c494e556d",
      "af39ac84af3f910dea532421a1d27a77621d13caf6894de83b62ccf9c56841b7",
    ] },
    { offset: 1235, signature: "(i32,i32)->()", bodyHashes: [
      "27de9130f902e343143030751962177d77853da9e841eb7afbfd3c6c494e556d",
      "af39ac84af3f910dea532421a1d27a77621d13caf6894de83b62ccf9c56841b7",
    ] },
    { offset: 1275, signature: "()->()", bodyHashes: [
      "c80071ce142d86c2fe30af2e5559a706c2fae7ff85070d0fd1c22514a54aa12e",
      "97cd70b9233c07a24510bffa9b1bcd44846a2620713e091291203644f652ea68",
    ] },
    { offset: 1412, signature: "(i32,i32)->()", bodyHashes: [
      "4ab967be169dbe74a1e5f2c4f477ebcaed66b101c8887b812104058de42e0e45",
      "658aaf6e5f8a2b0b5d86ffab032a37ab98b63f2967c18fde2db7afa041086882",
    ] },
  ],
  "skill-scan": [
    { offset: 585, signature: "(i32,i32)->(i32)", bodyHashes: [
      "d674b5ca59ca7108de5892ebeb26ddbc640eb58ce88db2cb2155262f78e70e21",
      "c40c500091fd2b07b07eb17db068fad70814fe8e1fe52ec336bc3838e0e68892",
    ] },
    { offset: 898, signature: "(i32,i32,i32)->()", bodyHashes: [
      "2d9c21a01d2ea73b47cba5da45fd09648fc01c49d0bd3e7957a2b8f4952a778a",
      "7360f098727dd1b104924223849d92074c517ddccbcf03a3ef3f55789622035c",
    ] },
    { offset: 1013, signature: "(i32,i32,i32)->()", bodyHashes: [
      "bfd9130ffc32c0866207bacd52684127f19affc9c4a29d14d9862de924bd0113",
      "10c0e2dd4cbe0782b9c9d92126eadc01bff409612ad3e03e104dcde520515311",
    ] },
  ],
  "equipment-scan": [
    { offset: 613, signature: "(i32,i32)->(i32)", bodyHashes: [
      "90de93d9c38a832d11cb22e6e59b69bad31732f462942edf3b3114a9106dc500",
      "bcbe21869c2763fa664de3bc9d9c21d7964ed62814f41223c1734e8f48848f04",
    ] },
    { offset: 1055, signature: "(i32,i32,i32)->()", bodyHashes: [
      "2d9c21a01d2ea73b47cba5da45fd09648fc01c49d0bd3e7957a2b8f4952a778a",
      "7360f098727dd1b104924223849d92074c517ddccbcf03a3ef3f55789622035c",
    ] },
    { offset: 1211, signature: "(i32,i32,i32)->()", bodyHashes: [
      "3ec70d19cc641ee9483ee336bfc421dac0768902bb0a2666b669633ca195b7b3",
      "66a258793ca455cfa84e66cfe57cec1561149520bf43ec6bcbce8c0f02fdb7c5",
    ] },
  ],
};

export function normalizeTemplateCalleeCalls(
  view: TemplateSaveModuleView,
  local: number,
  role: string,
  normalized: Uint8Array,
): void {
  const witnesses = CALL_WITNESSES[role] ?? [];
  // Small synthetic locator fixtures have no production helper sites.
  if (witnesses.some(({ offset }) => offset + 6 > normalized.byteLength)) return;
  const calls = view.instructions(local).callSites;
  for (const [index, witness] of witnesses.entries()) {
    const site = [...calls].flatMap(([target, sites]) => sites
      .filter(({ offset }) => offset === witness.offset)
      .map((value) => ({ target, ...value })));
    if (site.length !== 1 || site[0]!.operandEnd !== witness.offset + 6) {
      throw new Error(`template-save recertify: ${role} helper call changed`);
    }
    const callee = site[0]!.target - view.importCount;
    const body = view.bodies[callee];
    if (!body || view.signatures[callee] !== witness.signature
      || !witness.bodyHashes.includes(createHash("sha256").update(body).digest("hex"))) {
      throw new Error(`template-save recertify: ${role} helper identity changed`);
    }
    normalized.fill(0, witness.offset + 1, witness.offset + 6);
    normalized[witness.offset + 1] = 64 + index;
  }
}
