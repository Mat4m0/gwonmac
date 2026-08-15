/**
 * The one trust-boundary parser for portable Guild Wars template entries.
 * It validates bounded paths and contents before either process may store them.
 */
import {
  TEMPLATE_CEILINGS,
  type TemplateExportEntry,
} from "./contracts.js";
import { ValidationError } from "./errors.js";

const MIN_SEGMENTS = 2;
const MAX_SEGMENTS = 3;

export function parseTemplateEntries(value: unknown): TemplateExportEntry[] {
  if (!Array.isArray(value) || value.length > TEMPLATE_CEILINGS.entries) {
    throw new ValidationError("invalid template export");
  }
  return value.map((entry) => {
    if (
      typeof entry !== "object"
      || entry === null
      || Object.keys(entry).length !== 2
    ) {
      throw new ValidationError("invalid template export entry");
    }
    const { path: relative, contents } = entry as Record<string, unknown>;
    if (
      typeof relative !== "string"
      || typeof contents !== "string"
      || contents.length === 0
      || contents.length > TEMPLATE_CEILINGS.codeLength
    ) {
      throw new ValidationError("invalid template export entry");
    }
    assertRelativePath(relative);
    return { path: relative, contents };
  });
}

function assertRelativePath(relative: string): void {
  const segments = relative.split("/");
  if (
    segments.length < MIN_SEGMENTS
    || segments.length > MAX_SEGMENTS
    || !relative.toLowerCase().endsWith(".txt")
  ) {
    throw new ValidationError("invalid template export path");
  }
  for (const segment of segments) {
    if (
      segment.length === 0
      || segment.length > TEMPLATE_CEILINGS.nameLength + ".txt".length
      || segment === "."
      || segment === ".."
      || segment.includes("\\")
      || segment.includes(":")
      || /\p{Cc}/u.test(segment)
    ) {
      throw new ValidationError("invalid template export path");
    }
  }
}
