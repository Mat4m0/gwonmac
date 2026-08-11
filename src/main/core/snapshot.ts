/**
 * The resident-chunk bitmap published to the running client.
 *
 * The bitmap is the compact answer to "is chunk N already on disk" for a
 * snapshot with hundreds of thousands of chunks. The one packer owns the bit
 * order and drops an index outside the chunk count rather than growing the map.
 */
export function packResidentBits(
  count: number,
  resident: Iterable<number>,
): Uint8Array {
  const bits = new Uint8Array(Math.ceil(count / 8) || 0);
  for (const i of resident) {
    if (i < 0 || i >= count) continue;
    bits[i >> 3]! |= 1 << (i & 7);
  }
  return bits;
}
