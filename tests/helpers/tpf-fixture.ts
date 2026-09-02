/** Builds a deterministic, tiny legacy TPF without third-party game assets. */

const PASSWORD = Uint8Array.from([
  0x73, 0x2a, 0x63, 0x7d, 0x5f, 0x0a, 0xa6, 0xbd, 0x7d, 0x65, 0x7e, 0x67,
  0x61, 0x2a, 0x7f, 0x7f, 0x74, 0x61, 0x67, 0x5b, 0x60, 0x70, 0x45, 0x74,
  0x5c, 0x22, 0x74, 0x5d, 0x6e, 0x6a, 0x73, 0x41, 0x77, 0x6e, 0x46, 0x47,
  0x77, 0x49, 0x0c, 0x4b, 0x46, 0x6f,
]);
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});
const update = (crc: number, byte: number) => (CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0;
const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = update(crc, byte);
  return (crc ^ 0xffffffff) >>> 0;
};

class Keys {
  first = 0x12345678;
  second = 0x23456789;
  third = 0x34567890;
  constructor() { for (const byte of PASSWORD) this.update(byte); }
  update(byte: number) {
    this.first = update(this.first, byte);
    this.second = (Math.imul((this.second + (this.first & 0xff)) >>> 0, 134775813) + 1) >>> 0;
    this.third = update(this.third, this.second >>> 24);
  }
  encrypt(byte: number) {
    const temporary = (this.third | 2) >>> 0;
    const encrypted = byte ^ ((Math.imul(temporary, temporary ^ 1) >>> 8) & 0xff);
    this.update(byte);
    return encrypted;
  }
}

function encrypted(bytes: Uint8Array, crc: number): Uint8Array {
  const plain = new Uint8Array(12 + bytes.byteLength);
  plain[11] = crc >>> 24;
  plain.set(bytes, 12);
  const keys = new Keys();
  return plain.map((byte) => keys.encrypt(byte));
}

function dds(): Uint8Array {
  const bytes = new Uint8Array(132);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x20534444, true);
  view.setUint32(4, 124, true);
  view.setUint32(8, 0x100f, true);
  view.setUint32(12, 1, true);
  view.setUint32(16, 1, true);
  view.setUint32(20, 4, true);
  view.setUint32(76, 32, true);
  view.setUint32(80, 0x41, true);
  view.setUint32(88, 32, true);
  view.setUint32(92, 0x00ff0000, true);
  view.setUint32(96, 0x0000ff00, true);
  view.setUint32(100, 0x000000ff, true);
  view.setUint32(104, 0xff000000, true);
  view.setUint32(108, 0x1000, true);
  bytes.set([3, 2, 1, 255], 128);
  return bytes;
}

export function tinyTpfMappings(targets: readonly number[]): Uint8Array {
  const files = [
    { name: "texture.dds", bytes: dds() },
    {
      name: "texmod.def",
      bytes: new TextEncoder().encode(`${targets.map((target) =>
        `0x${target.toString(16).padStart(8, "0").toUpperCase()}|texture.dds`
      ).join("\r\n")}\r\n\0`),
    },
  ];
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let localOffset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const crc = crc32(file.bytes);
    const payload = encrypted(file.bytes, crc);
    const local = new Uint8Array(30 + name.byteLength + payload.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 1, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, payload.byteLength, true);
    localView.setUint32(22, file.bytes.byteLength, true);
    localView.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    local.set(payload, 30 + name.byteLength);
    locals.push(local);
    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 1, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, payload.byteLength, true);
    centralView.setUint32(24, file.bytes.byteLength, true);
    centralView.setUint16(28, name.byteLength, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    centrals.push(central);
    localOffset += local.byteLength;
  }
  const centralBytes = centrals.reduce((sum, value) => sum + value.byteLength, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralBytes, true);
  endView.setUint32(16, localOffset, true);
  const zip = new Uint8Array(localOffset + centralBytes + end.byteLength);
  let cursor = 0;
  for (const part of [...locals, ...centrals, end]) { zip.set(part, cursor); cursor += part.byteLength; }
  for (let index = 0; index < zip.byteLength; index += 1) zip[index] = zip[index]! ^ [0xa4, 0x3f, 0xa4, 0x3f][index & 3]!;
  return zip;
}

export function tinyTpf(target = 0x12345678): Uint8Array {
  return tinyTpfMappings([target]);
}
