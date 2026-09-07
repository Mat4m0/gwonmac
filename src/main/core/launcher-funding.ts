/**
 * Reads the two project funding figures from one fixed GitHub file. This
 * optional request never blocks play or grants remote control of the app.
 */
import bundledFunding from "../../shared/funding.json" with { type: "json" };
import type { LauncherSnapshot } from "../../shared/launcher-contracts.js";
import { readBoundedResponse } from "./bounded-response.js";

export const FUNDING_URL = "https://raw.githubusercontent.com/Mat4m0/gwonmac/main/src/shared/funding.json";

export function parseLauncherFunding(value: unknown): LauncherSnapshot["funding"] {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 2
    || !("raisedEuros" in value) || !("goalEuros" in value)
    || typeof value.raisedEuros !== "number" || typeof value.goalEuros !== "number"
    || !Number.isSafeInteger(value.raisedEuros) || value.raisedEuros < 0
    || !Number.isSafeInteger(value.goalEuros) || value.goalEuros <= 0) {
    throw new Error("Funding must contain a non-negative raised amount and a positive goal in whole euros.");
  }
  return Object.freeze({ raisedEuros: value.raisedEuros, goalEuros: value.goalEuros });
}

export const BUNDLED_FUNDING = parseLauncherFunding(bundledFunding);

export async function fetchLauncherFunding(
  fetch: (url: string, init: RequestInit) => Promise<Response>,
): Promise<LauncherSnapshot["funding"] | null> {
  try {
    const response = await fetch(FUNDING_URL, {
      signal: AbortSignal.timeout(8_000),
      redirect: "error",
      credentials: "omit",
      cache: "no-cache",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const bytes = await readBoundedResponse(response, 1024);
    return parseLauncherFunding(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
  } catch {
    return null;
  }
}
