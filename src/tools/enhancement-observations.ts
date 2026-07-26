export type EnhancementObservationType = "u8" | "u16" | "u32" | "i32" | "f32";

export interface EnhancementObservation {
  type: EnhancementObservationType;
  address: number;
}

export function parseEnhancementObservations(
  value: string | null,
): EnhancementObservation[] {
  if (!value) return [];
  const entries = value.split(",").filter(Boolean);
  if (entries.length > 16) {
    throw new Error("at most 16 typed observations are allowed");
  }
  return entries.map((entry) => {
    const match = /^(u8|u16|u32|i32|f32):(0x[0-9a-f]+|[0-9]+)$/i.exec(entry);
    if (!match) throw new Error(`invalid observation: ${entry}`);
    const address = Number(match[2]);
    if (!Number.isSafeInteger(address) || address < 0 || address > 0xffff_ffff) {
      throw new Error(`observation address is out of range: ${entry}`);
    }
    return {
      type: match[1]!.toLowerCase() as EnhancementObservationType,
      address,
    };
  });
}
