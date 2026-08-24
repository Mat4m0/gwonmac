/**
 * Owns validation of every app-allocated Wasm range before the kernel can see
 * it, including alignment, heap bounds, signed-pointer bounds, and overlap.
 */
export type CompanionOwnedRegion = Readonly<{
  name: string;
  pointer: number;
  size: number;
  align: number;
}>;

export function validateCompanionOwnedRegions(
  regions: readonly CompanionOwnedRegion[],
  heapBytes: number,
): void {
  for (const region of regions) {
    const end = region.pointer + region.size;
    const refusal = !Number.isSafeInteger(region.pointer) || region.pointer <= 0
      ? "not a pointer"
      : region.pointer % region.align !== 0
        ? `not ${region.align}-byte aligned`
        : !Number.isSafeInteger(end)
          ? "end is not a safe integer"
          : end > heapBytes
            ? "ends past the heap"
            : end > 0x7fff_ffff
              ? "ends past the signed 32-bit limit"
              : null;
    if (refusal !== null) {
      throw new Error(
        `Companion ${region.name} allocation is invalid: ${refusal}`
        + ` (pointer ${region.pointer}, size ${region.size}, heap ${heapBytes})`,
      );
    }
  }
  for (let left = 0; left < regions.length; left += 1) {
    const a = regions[left]!;
    for (let right = left + 1; right < regions.length; right += 1) {
      const b = regions[right]!;
      if (a.pointer < b.pointer + b.size && b.pointer < a.pointer + a.size) {
        throw new Error(`Companion ${a.name}/${b.name} allocations overlap`);
      }
    }
  }
}
