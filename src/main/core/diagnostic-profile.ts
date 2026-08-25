/**
 * The restart-required graphics isolation profile, persisted outside ordinary
 * settings so a Stable rollback cannot reinterpret or erase player settings.
 */
import { readFile } from "node:fs/promises";
import {
  DIAGNOSTIC_PROFILES,
  type DiagnosticProfile,
} from "../../shared/contracts.js";
import { writeAtomicJson } from "./atomic-file.js";
import { ValidationError } from "../../shared/errors.js";

export function isDiagnosticProfile(value: unknown): value is DiagnosticProfile {
  return typeof value === "string"
    && DIAGNOSTIC_PROFILES.includes(value as DiagnosticProfile);
}

export function parseDiagnosticProfile(value: unknown): DiagnosticProfile {
  if (!isDiagnosticProfile(value)) {
    throw new ValidationError("invalid diagnostic profile");
  }
  return value;
}

export async function loadDiagnosticProfile(file: string): Promise<DiagnosticProfile> {
  try {
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (Reflect.get(value, "formatVersion") !== 1) return "standard";
      const profile = Reflect.get(value, "profile");
      if (isDiagnosticProfile(profile)) return profile;
    }
  } catch (error) {
    if (
      !(error instanceof SyntaxError)
      && (error as NodeJS.ErrnoException).code !== "ENOENT"
    ) throw error;
  }
  return "standard";
}

export async function saveDiagnosticProfile(
  file: string,
  profile: DiagnosticProfile,
): Promise<DiagnosticProfile> {
  await writeAtomicJson(file, { formatVersion: 1, profile });
  return profile;
}
