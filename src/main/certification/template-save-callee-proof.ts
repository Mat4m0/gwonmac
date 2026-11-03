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

const reviewed = (signature: string, bodyHashes: readonly string[]) =>
  Object.freeze({ signature, bodyHashes });

// These are feature-local helper bodies, never whole-client launch authority.
// The retained August, October 1, October 22 and November 3 bodies preserve
// the caller's argument and control-flow contract. October 22 changed only
// relocated string pointers and one assertion line number; November 3 changed
// only callee indices and static addresses. A new helper body must refuse
// until it is reviewed.
const CALL_WITNESSES: Readonly<Record<string, readonly CalleeWitness[]>> = {
  "screenshot-initializer": [
    { offset: 39, signature: "()->()", bodyHashes: [
      "f61e0d977f1062cdc9eb1604f23685581db8f5f9f86a6d22b7fb2f8add381777",
      "2fccbd179a983ccd28c27502d6d17d53989d02b1ccb0b40e4b139bf55935018f",
      "97cd70b9233c07a24510bffa9b1bcd44846a2620713e091291203644f652ea68",
    ] },
    { offset: 145, signature: "(i32)->(i32)", bodyHashes: [
      "d4ee1c0b9e04c0a9c2ba20c2db8cb27a4374196429d731cea023f0c92d6438a0",
      "47db5be8d94d4d1c66e1fc602e14588b6de79dd55e50830f518dd88d7a9a5ce7",
      "39588467c28056e405de7c7ccfae6406a55c2fdd6fe5c098e2463f515e150d4c",
      "5159471d5e3cdc6e58760539a17aa6c3f7098606c94408a9e6c6d0e3f77d109c",
    ] },
    { offset: 235, signature: "(i32,i32)->()", bodyHashes: [
      "4ab967be169dbe74a1e5f2c4f477ebcaed66b101c8887b812104058de42e0e45",
      "658aaf6e5f8a2b0b5d86ffab032a37ab98b63f2967c18fde2db7afa041086882",
      "41f2ad0db5a53500e1f5dc2997ecc088474aef40f50fc859e602d9608d511285",
      "6c5e2d0c8d13981affaa6716de4c60ee7727c0f62cb93097d4720c386b6eba58",
    ] },
  ],
  "writer": [
    { offset: 50, signature: "(i32,i32)->()", bodyHashes: [
      "42e5f136409ef9876e49fac965280f5fdd9be6b8d042b2de0ef4a2faca7f91da",
      "94b7a29936f37b71100e1805725eaaf59df65ec763fc964667fb9166bef6acd7",
      "2a00651cc3b1ceb8b4bb40c516eacd1ac39a5d66cf564bfd5f1846541a5dec7a",
    ] },
  ],
  "directory-sink": [
    { offset: 776, signature: "(i32,i32)->()", bodyHashes: [
      "27de9130f902e343143030751962177d77853da9e841eb7afbfd3c6c494e556d",
      "af39ac84af3f910dea532421a1d27a77621d13caf6894de83b62ccf9c56841b7",
      "3317e78afc6f79ebe49e205870dd7776c79856917cd6865a6e0ff1a87a5195e2",
      "d091ac01f1deb79f9b8b4960fb8445fd307b97a54fccfe6f69428790cde88ab2",
    ] },
    { offset: 1104, signature: "(i32,i32)->()", bodyHashes: [
      "27de9130f902e343143030751962177d77853da9e841eb7afbfd3c6c494e556d",
      "af39ac84af3f910dea532421a1d27a77621d13caf6894de83b62ccf9c56841b7",
      "3317e78afc6f79ebe49e205870dd7776c79856917cd6865a6e0ff1a87a5195e2",
      "d091ac01f1deb79f9b8b4960fb8445fd307b97a54fccfe6f69428790cde88ab2",
    ] },
  ],
  "screenshot-sink": [
    { offset: 198, signature: "()->(i32)", bodyHashes: [
      "f63235d97028ffe7bfab880ac8a0f85c88a3b3323fe2e9893ba06d0ea1a3b891",
      "975f8ebc96587696f02406d334da68a2762f9e54393782e07cd8bd694dc3532a",
      "d3c8de8698eb4834683143c64091bbe341fd38e3686e47cf5b49751b972dd8c8",
    ] },
    { offset: 211, signature: "(i32)->(i32)", bodyHashes: [
      "5c8e5494dc3001b6f9e3110466ebada686954f264d7759e782b19246e2e2faa4",
      "2ec8d3270f621a09393cdd241baa010971550cb10d69206de4da883f7bb65524",
      "f62f6a8fbb2226db81ae69603a9f41aceee2f43235f477ab6e6b9b41d83292c1",
    ] },
    { offset: 228, signature: "(i32,i32)->()", bodyHashes: [
      "178b6da0fc63cdec62cb7e2813ec45270d8508f6da86af1194ae2adb074aaf1b",
      "301c3af464b30961e0bb24276782d7176f314baf7391ff280b26d68978604d5e",
      "ee1a49f2a81244b7bc055fd861e81d5a2dc5d3b6ec82ce6044be2b35dc83ec1f",
      "0b1f318202d7b9d0aaea15c92556b407d8548de120d3a6bc8e39a372f4db1414",
    ] },
    { offset: 952, signature: "(i32)->(i32)", bodyHashes: [
      "df3092089ab2fe5a657b174ee6d40c21e06ab1791d3fbfc7a2c017844ad44f87",
      "65d0ad5584cb83ea51954f0f2c11f9de9e92a814fc9c01be299dd0f31224efeb",
      "df3cea5724a9ba0e5f08965c82bfb5a6d703f991c718dd6e72e5a867f5ac1a62",
      "d41ab640346d26d922f7e722120672e3abbe6b2f10826596cbb17e58626e9c80",
    ] },
    { offset: 1215, signature: "(i32,i32)->()", bodyHashes: [
      "27de9130f902e343143030751962177d77853da9e841eb7afbfd3c6c494e556d",
      "af39ac84af3f910dea532421a1d27a77621d13caf6894de83b62ccf9c56841b7",
      "3317e78afc6f79ebe49e205870dd7776c79856917cd6865a6e0ff1a87a5195e2",
      "d091ac01f1deb79f9b8b4960fb8445fd307b97a54fccfe6f69428790cde88ab2",
    ] },
    { offset: 1235, signature: "(i32,i32)->()", bodyHashes: [
      "27de9130f902e343143030751962177d77853da9e841eb7afbfd3c6c494e556d",
      "af39ac84af3f910dea532421a1d27a77621d13caf6894de83b62ccf9c56841b7",
      "3317e78afc6f79ebe49e205870dd7776c79856917cd6865a6e0ff1a87a5195e2",
      "d091ac01f1deb79f9b8b4960fb8445fd307b97a54fccfe6f69428790cde88ab2",
    ] },
    { offset: 1275, signature: "()->()", bodyHashes: [
      "c80071ce142d86c2fe30af2e5559a706c2fae7ff85070d0fd1c22514a54aa12e",
      "97cd70b9233c07a24510bffa9b1bcd44846a2620713e091291203644f652ea68",
      // November 3 shifted both one-call wrappers by one index, so the
      // initializer wrapper above now has this sink wrapper's October bytes.
      "8ca8b1b35119a4bb1347209a6301e451b0657ae71b8dbc48e2f3925bdb3cbfbe",
    ] },
    { offset: 1412, signature: "(i32,i32)->()", bodyHashes: [
      "4ab967be169dbe74a1e5f2c4f477ebcaed66b101c8887b812104058de42e0e45",
      "658aaf6e5f8a2b0b5d86ffab032a37ab98b63f2967c18fde2db7afa041086882",
      "41f2ad0db5a53500e1f5dc2997ecc088474aef40f50fc859e602d9608d511285",
      "6c5e2d0c8d13981affaa6716de4c60ee7727c0f62cb93097d4720c386b6eba58",
    ] },
  ],
  "skill-scan": [
    { offset: 585, signature: "(i32,i32)->(i32)", bodyHashes: [
      "d674b5ca59ca7108de5892ebeb26ddbc640eb58ce88db2cb2155262f78e70e21",
      "c40c500091fd2b07b07eb17db068fad70814fe8e1fe52ec336bc3838e0e68892",
      "dea6fb367ceaed35d245132686f1968cacdfc91d5074967ac1cd16477fc3d908",
      "aeb5c07eaf0badcda93e75ae853f589126126378e09f8dae1bfdc2ba7cf4ac7c",
    ] },
    { offset: 898, signature: "(i32,i32,i32)->()", bodyHashes: [
      "2d9c21a01d2ea73b47cba5da45fd09648fc01c49d0bd3e7957a2b8f4952a778a",
      "7360f098727dd1b104924223849d92074c517ddccbcf03a3ef3f55789622035c",
      "3af2d946882f262b60718623a18d3977acf92194150c65ea4fab8684906ed703",
      "75ce03879fcbcaee3e0f225ceeb4d56ee2cb6462716ccf73c22abdac9a8254b5",
    ] },
    { offset: 1013, signature: "(i32,i32,i32)->()", bodyHashes: [
      "bfd9130ffc32c0866207bacd52684127f19affc9c4a29d14d9862de924bd0113",
      "10c0e2dd4cbe0782b9c9d92126eadc01bff409612ad3e03e104dcde520515311",
      "7412f7e8c717d242295a3bcff19ecbb6ab94087026ca81204b208203a968d1b5",
      "71c605cea02dd6e37e5efc6b89c2b6cc516ebd3d254fcc171c1f080da96ae21c",
    ] },
  ],
  "equipment-scan": [
    { offset: 613, signature: "(i32,i32)->(i32)", bodyHashes: [
      "90de93d9c38a832d11cb22e6e59b69bad31732f462942edf3b3114a9106dc500",
      "bcbe21869c2763fa664de3bc9d9c21d7964ed62814f41223c1734e8f48848f04",
      "64df59a14dea52ba83e26c9a485a03b4eab19cff407feda34eb0b2c3f12ae30e",
      "c4ef3067cb688a2915540f73a966b46648780529194d86e5fa1874f2eff7471a",
    ] },
    { offset: 1055, signature: "(i32,i32,i32)->()", bodyHashes: [
      "2d9c21a01d2ea73b47cba5da45fd09648fc01c49d0bd3e7957a2b8f4952a778a",
      "7360f098727dd1b104924223849d92074c517ddccbcf03a3ef3f55789622035c",
      "3af2d946882f262b60718623a18d3977acf92194150c65ea4fab8684906ed703",
      "75ce03879fcbcaee3e0f225ceeb4d56ee2cb6462716ccf73c22abdac9a8254b5",
    ] },
    { offset: 1211, signature: "(i32,i32,i32)->()", bodyHashes: [
      "3ec70d19cc641ee9483ee336bfc421dac0768902bb0a2666b669633ca195b7b3",
      "66a258793ca455cfa84e66cfe57cec1561149520bf43ec6bcbce8c0f02fdb7c5",
      "9d15fca77c779c94d8525c7d3b9a555d233f8f41027088ea2d3da59cb7d8326f",
      "58b12dca936f4ed322e0da12db3abf1d037e998828174da6578a8aa98a8eb3bb",
    ] },
  ],
};

// Helper calls that first moved in the November 3 client, when ArenaNet
// inserted functions below them. Each callee is identified by its signature
// and its complete reviewed October 22 and November 3 bodies; those bodies
// differ only in their own callee indices and static addresses. Clients before
// October 22 are never served again, so their bodies are not listed.
const MOVED_CALLEES = {
  callee01: reviewed("(i32,i32)->()", [
    "fab95ac17337f47eb40041e800b82b5e5eab7f5c19a7cebf59955a3db9e136c4",
  ]),
  callee02: reviewed("(i32,i32,i32,i32)->()", [
    "139139b77f2ae9ac179610919f9ce2bbe41a3ff5b4e76abf73bc5bc4bb3ef83b",
    "4fb10096593746351a4752f5ca5ddaf20a5ed0a0bc9d1fde393bbe62aad21c70",
  ]),
  callee03: reviewed("(i32,i32,i32,i32)->()", [
    "3db3429fc0c9517f7e70987bfa0b93e02607317cfa478349b3ceba089e4f1757",
    "cf96e6d03a5e9af8fbd3b6eec31e1105f9c1bbf2667f97f01c70282f63ee40d8",
  ]),
  callee04: reviewed("(i32,i32,i32)->()", [
    "1c87ab4b0831420341935898d106c902d85897a116b4beb7492bf4ab3b1ea9c7",
  ]),
  callee05: reviewed("(i32,i32,i32)->()", [
    "30484bc0e8064e33a1857aee6f826be04522e41b64027516a2fb792976c7712f",
    "ee8bc8447aef5962b8c838eb998073f1e7ce1dfadd0579b0118c0114da3d3415",
  ]),
  callee06: reviewed("(i32,i32,i32)->(i32)", [
    "6b212ed9b073a98a778eb517317f9859cdbf464cf452697860b87a0e5e8d92ff",
  ]),
  callee07: reviewed("(i32,i32,i32,i32)->(i32)", [
    "dbcadc02907cff650426b68bbf3e4b23db4a569dd407ae6088d8b42bda5ff2ee",
    "ff44a54b27f459bf21e00e4b50069c7d4eb49d982d7a7d9a75f3d10fd017dd18",
  ]),
  callee08: reviewed("(i32)->(i32)", [
    "483e9a39a81c93a2b4744034d338355bd6a8647998676d4384e134e8347ae88e",
  ]),
  callee09: reviewed("(i32,i32,i32,i32,i32)->(i32)", [
    "85c9209ec6ab5816fd03a3199399f6e4d5df13027889f143c27a7f0180f78a9e",
    "24a067e84534b17d6b632c9289d655da5f67d0ebee849895d466bf4cc76b38c0",
  ]),
  callee10: reviewed("(i32)->()", [
    "7d97b71f5d156c1f05cd7e6634df55bce242cc3f26231c63665a4f90686ad057",
    "e79aa348340e9f968f7dcf1bb8ba3a0b934d32dca3b9e1240e5f4e32d844cd50",
  ]),
  callee11: reviewed("(i32,i32,i32)->()", [
    "b7438c827d6311ba9717adbaae7f4354ad6cf200e85b6a053d7e821c14eb53ff",
    "7f170d8ce39fff20ef94af030078a9f7608c10360f0985e480627afa37597cb5",
  ]),
  callee12: reviewed("(i32,i32)->(i32)", [
    "b8ede3a030d6dbe916834d24b05d2a1d1e90c77bbf992e38ecfef314f36a328c",
  ]),
  callee13: reviewed("(i32,i32,i32)->()", [
    "152773bfd5a8ce9f2c57da2cce836665ccdb9e4a1dd91848a7f2a6769ac091a2",
    "2048ac11eafe69c01375f7f5cfe47185d7f9197c595a3206fb415575ece11752",
  ]),
  callee14: reviewed("(i32,i32,i32)->()", [
    "3af2d946882f262b60718623a18d3977acf92194150c65ea4fab8684906ed703",
    "75ce03879fcbcaee3e0f225ceeb4d56ee2cb6462716ccf73c22abdac9a8254b5",
  ]),
  callee15: reviewed("(i32)->(i32)", [
    "e283934ec12bc0c0dc23d2afd90ea0443fc75b7168da5a4c9ec5a55021180771",
  ]),
  callee16: reviewed("(i32)->(i32)", [
    "b2b4bd7f836a436542ece35d84651d7f1fc403f19363707a30fe5a7730895ba6",
  ]),
  callee17: reviewed("(i32,i32,i32)->(i32)", [
    "c7da1da4f3c1d8f53d3bf6463b088fe12557de59888dc4e47130120529b275ea",
    "249fdb6f229cb16a86200f525333d68f2430e18def1b3952f79bf0624ec1b4dd",
  ]),
  callee18: reviewed("(i32,i32,i32)->(i32)", [
    "9a25d91557bf40566ba9ece25b3fbdba513dbe39cdb01d8437136c3b7e4a3b56",
    "bd13cf5fa90d61e4de119cc21e9868c77f840ef5d0d118ae9c674363b08e60fe",
  ]),
  callee19: reviewed("(i32,i32,i32,i32)->(i32)", [
    "52da1316c9b34cbe105e61f8fb57299fae34b578b9374a90cb99b5b62125abd1",
    "8327155bb47e8b513798c95b45bb068ce5107b8209f32d6353e699de33ccc6fb",
  ]),
  callee20: reviewed("(i32,i32,i32)->(i32)", [
    "f7a2017ce827175b1c593cc6f62f34bcc06c43593157a8f267305eec062e9a0a",
    "013beb33a62a8148261e2a67f657f9b2e02bb618136dc62621831f68f6f3bce0",
  ]),
  callee21: reviewed("(i32,i32,i32)->()", [
    "045a6ee62e8d1f734569522014a858a6758b2c3a539a900f28d203acc5669d04",
    "de0cd733b1bc9819ac2533a2d726feb436274cafe353380d9b335769cc45d37b",
  ]),
  callee22: reviewed("(i32,i32,i32)->(i32)", [
    "0ee5da3f9ac0784d90d4929af0c95fb4f30a6031131d2bb6448ab5d65347ef2d",
    "bae4a6fa60ff08dc21bfd54c4c42081f697b1eb96591a84bc0d7791787377894",
  ]),
  callee23: reviewed("(i32,i32,i32)->()", [
    "f6211064a9095c95a0e3c5985cc7be8ac1a60f2f4d2ee4f71f4f17ffada7730d",
    "5c7cc5d9a23c568383cd9cde7d37b9fff5fa4746785f9dd7b820846e98afeb60",
  ]),
  callee24: reviewed("(i32)->()", [
    "f1f53c94b6340f394c360c3af0f5604ad5514488751fb18ce360585ddfeb2fa7",
    "ea76feee7b569ef8efb821578b9daa35596f90a8ed002acc77b93df62440d0fe",
  ]),
  callee25: reviewed("(i32,i32)->()", [
    "e0367d789b61fd5925ce7e5bf91edf877c4da34ecb35aec0e05b891d8a05a123",
    "0841510c2a249360664c9a6cc7f840edd2a48bba2f6d7246bdb04924911bc8c1",
  ]),
  callee26: reviewed("(i32,i32)->(i32)", [
    "03844b0c6a4d337ba3fe8d0ff5c2a49d2e0b0361139cf5304f7ad96d8c45077c",
    "d43c27c1caec20500c6fc95ddd99bbf12e359c791a7b01681065ca342284b30b",
  ]),
  callee27: reviewed("(i32,i32,i32,i32)->(i32)", [
    "4d08a3cde5c979729cf97e90ae3873d3633da52793334638395efafd0dd29622",
    "ccea0669dfe0d6e2f11e93405b217ae2d8e086fde9993ca4f7d4a0af83238c78",
  ]),
  callee28: reviewed("(i32,i32,i32,i32)->()", [
    "8ecb0d6602cdaba02ae722c0c63d16dda2ac17c24cff9632be9b004f2b87e162",
    "fc79c690eeb792520bbe74d4dba3b0902a5a0bf2e399696e9b2678788efa94a5",
  ]),
  callee29: reviewed("(i32,i32,i32,i32,i32,i32)->(i32)", [
    "904295e566954f26871fa81daaceb0bd909895d6130b48b84d8cb5aaa4a11488",
    "1e7158984315f2dcbfd833dc357d7d9b20735bdf0b4bdff5bb5c18684ed7731c",
  ]),
  callee30: reviewed("(i32)->()", [
    "d30f207317d2f41fb835151734edb4f8a942a81d5c54052ed90a2197aede80fa",
    "b54f8037418aa53f19ced10cfadc09f45fcdfa2e571c6c7515aef05d18d5ac4b",
  ]),
  callee31: reviewed("(i32,i32,i32,i32)->()", [
    "7a9d15aca8e00a91fe5d9ea16eb882c3d42b7fc7566f89be0a09f66c7576d19f",
    "721e75068dc1c9ca6cca02b11b8a00cc5652b70361066f50fe7e1a1c10922306",
  ]),
  callee32: reviewed("(i32,i32,i32,i32,i32,i32,i32,i32,i32)->()", [
    "e0805ec3c8e1395354738f31e9e9939cc1008cf480843ddfdb4b8a17fcce779d",
    "d9bea9018a9dd072e6d7275c2e5a99b42807cf4b14121714fec0d7ce1516492f",
  ]),
  callee33: reviewed("(i32)->(i32)", [
    "4c7c4590e83e2eb3e9014a2dabd7ad2556f00f93a37a425121347e12e65aad37",
    "974c24212afa4b4caf4647659971b55c0b6f990e6fb4a69bab8a2b5c94876a8e",
  ]),
  callee34: reviewed("(i32)->()", [
    "c6136e2323c751086990dc6ded74644906739a4ec2d148aa1881224aad3fc202",
    "748d38f6ad7c7f93f44a2e3f5e07301961fcfb50b95a66022ed46bf5cb8c96e4",
  ]),
  callee35: reviewed("(i32)->()", [
    "9c753eb67c287ac128bbdd725290aaa3079e7711e787b2c9c337cafa5ac7bc26",
    "26d2811bb2acf07374badef5533eb82e8b0d59de98b6c60b9338c3da1517d570",
  ]),
  callee36: reviewed("(i32)->()", [
    "bc12b3ab4d27eff749e60b03ff18c292e285f6237409d97b1331f816938cd771",
    "5aca681e755fc66b94bd5bdee94c5ba5cbeaebcab5aa148a544bcce501138025",
  ]),
  callee37: reviewed("(i32,i32)->()", [
    "7f02d1cc20202f00c260b788d76771103bbf7fd7f0ee0d668452ad4e985aa22d",
    "58ec96ba8aeb96dd1c7dd2e128fac22d0d3994aa56093e82602e9206c2d645a2",
  ]),
  callee38: reviewed("(i32,i32,i32,i32)->()", [
    "a559309977e2046c42b074002eddea657b260075a9ff88c35c33218d885e7534",
    "6e4e89f20d50b93102ee999f9fb2fd68e3d0bf107f7ad00ae3eb672650e76dc8",
  ]),
  callee39: reviewed("()->()", [
    "8476683033ad31f0b011834d9caad51f0a23c8e1ba88e10ac0c583146eb4c156",
    "bb4d0702472af679643fa646cd20a828aafd8b3aa2136d2447ff543f7851040a",
  ]),
  callee40: reviewed("(i32,i32,i32)->(i32)", [
    "4635f44aaacc946ac089da8203845c02e5c3b5a190ccf70fa35b1769f86686a0",
  ]),
  callee41: reviewed("(i32,i32,i32,i32,i32)->(i32)", [
    "5e6a5f7de8ba304c3cef666164ad58cd9a98f3ca2fc4f0936b84697d15b38cbb",
    "cf0d136d7d98bf7704e357f3b4d4dbb12881a43f99454e8054460018a459b3ec",
  ]),
  callee42: reviewed("(i32,i32,i32)->(i32)", [
    "e9cde57ea98b6cc14857a2c959d18bea23e541e6a5dfdbf253d19fe47743c82d",
    "ad0948b547a96455138343e161b7ad813bad8018eed9535596b7cba011919e95",
  ]),
  callee43: reviewed("(i32,i32,i32)->(i32)", [
    "4fa038d51707e69ff165e87c54b46fb668f35782d5231bc437609ed4dbaacd5d",
    "414bacb4600c1906e2194241ffa96c658acfb3d6de1ab3a7191eec27b7b031f5",
  ]),
  callee44: reviewed("(i32,i32,i32,i32,i32)->(i32)", [
    "d2cbabb903aaf2e40ab483446c8e4f76f30226be812839d03e7ea9674d191286",
    "19cefd51cf7aa77a004a95a54fe3978ebd907cdf745137333973433bf7f1e0bb",
  ]),
  callee45: reviewed("(i32)->(i32)", [
    "28d6b4daa55ba4af3b714af8d168812cbe9142517924bb38111a15d5f25ecab1",
    "2cfe6979711f6cf621e17f10e6eb759785a87336edfa6f6b24d8833d54bdd159",
  ]),
} as const;

const MOVED_CALL_SITES: Readonly<Record<string, readonly (readonly [number, keyof typeof MOVED_CALLEES])[]>> = {
  "skill-scan": [
    [30, "callee01"], [63, "callee02"], [90, "callee02"], [117, "callee03"],
    [178, "callee04"], [199, "callee05"], [411, "callee06"], [606, "callee07"],
    [675, "callee08"], [724, "callee09"], [750, "callee10"], [858, "callee11"],
    [997, "callee08"], [1006, "callee12"], [1052, "callee10"],
  ],
  "equipment-scan": [
    [30, "callee01"], [63, "callee02"], [90, "callee02"], [117, "callee03"],
    [178, "callee04"], [199, "callee05"], [298, "callee13"], [432, "callee06"],
    [651, "callee07"], [733, "callee11"], [755, "callee07"], [825, "callee08"],
    [874, "callee09"], [900, "callee10"], [1015, "callee11"], [1195, "callee08"],
    [1204, "callee12"], [1250, "callee10"],
  ],
  "directory-sink": [
    [42, "callee11"], [102, "callee01"], [127, "callee02"], [170, "callee02"],
    [247, "callee14"], [273, "callee14"], [387, "callee15"], [402, "callee16"],
    [423, "callee17"], [479, "callee14"], [611, "callee18"], [653, "callee19"],
    [679, "callee02"], [705, "callee10"], [727, "callee10"], [770, "callee20"],
    [817, "callee21"], [853, "callee21"], [935, "callee21"], [1029, "callee22"],
    [1057, "callee23"], [1065, "callee24"], [1098, "callee20"], [1124, "callee10"],
  ],
  "screenshot-sink": [
    [53, "callee25"], [80, "callee01"], [107, "callee02"], [292, "callee19"],
    [317, "callee04"], [345, "callee02"], [375, "callee02"], [481, "callee15"],
    [496, "callee16"], [519, "callee17"], [681, "callee10"], [705, "callee11"],
    [740, "callee19"], [768, "callee02"], [787, "callee10"], [798, "callee26"],
    [812, "callee26"], [856, "callee27"], [881, "callee11"], [914, "callee11"],
    [940, "callee28"], [980, "callee29"], [991, "callee30"], [1021, "callee31"],
    [1041, "callee27"], [1066, "callee11"], [1097, "callee11"], [1126, "callee32"],
    [1152, "callee29"], [1162, "callee30"], [1170, "callee30"], [1209, "callee20"],
    [1229, "callee33"], [1269, "callee34"], [1319, "callee35"], [1343, "callee11"],
    [1353, "callee35"], [1361, "callee36"], [1378, "callee37"], [1395, "callee37"],
    [1433, "callee38"], [1454, "callee38"], [1460, "callee39"],
  ],
  "writer": [
    [65, "callee01"], [88, "callee02"], [111, "callee02"], [138, "callee03"],
    [155, "callee05"], [226, "callee22"], [251, "callee23"], [264, "callee24"],
    [286, "callee10"],
  ],
  "delete": [
    [9, "callee12"], [56, "callee11"], [149, "callee40"],
  ],
  "file-exists": [
    [44, "callee11"], [166, "callee41"], [186, "callee42"], [221, "callee43"],
    [251, "callee07"], [328, "callee44"],
  ],
  "screenshot-initializer": [
    [33, "callee34"], [76, "callee35"], [100, "callee11"], [110, "callee35"],
    [118, "callee36"], [128, "callee45"], [164, "callee26"], [181, "callee45"],
    [198, "callee37"], [208, "callee37"], [249, "callee38"], [263, "callee38"],
    [269, "callee39"], [298, "callee25"],
  ],
};

export function normalizeTemplateCalleeCalls(
  view: TemplateSaveModuleView,
  local: number,
  role: string,
  normalized: Uint8Array,
): void {
  const witnesses: readonly CalleeWitness[] = [
    ...CALL_WITNESSES[role] ?? [],
    ...(MOVED_CALL_SITES[role] ?? []).map(([offset, name]) => ({ offset, ...MOVED_CALLEES[name] })),
  ];
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
