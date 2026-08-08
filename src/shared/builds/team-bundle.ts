/**
 * Encodes, validates, and atomically imports full-fidelity GWonMac team bundles.
 * It owns the exchange schema while the durable library remains canonical state.
 */
import {
  LIBRARY_VERSION,
  buildById,
  buildId,
  mapTeamSlots,
  teamId,
  type Build,
  type BuildLibrary,
  type Team,
  type TeamId,
} from "./library.js";
import { parseBuildLibrary } from "./parse-library.js";

const PREFIX = "gwonmac-team:";
const VERSION = 1;
const MAX_CODE_LENGTH = 256 * 1024;

export type TeamBundle = Readonly<{
  version: typeof VERSION;
  tags: readonly string[];
  team: Team;
  builds: readonly Build[];
}>;

const exact = (value: unknown, fields: readonly string[], label: string) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = [...fields].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new Error(`${label} has fields this version does not understand.`);
  }
  return record;
};

function assertExactShape(raw: unknown): Record<string, unknown> {
  const root = exact(raw, ["version", "tags", "team", "builds"], "Team code");
  if (!Array.isArray(root.builds)) throw new Error("Team code builds must be a list.");
  for (const [index, build] of root.builds.entries()) {
    exact(build, [
      "id", "name", "professions", "skills", "attributes", "tags", "notes",
      "favourite", "lastUsed", "parent", "origin",
    ], `Build ${index + 1}`);
  }
  const team = exact(root.team, [
    "id", "name", "tags", "mode", "favourite", "lastUsed", "notes", "slots",
  ], "Team");
  if (!Array.isArray(team.slots)) throw new Error("Team slots must be a list.");
  for (const [index, slot] of team.slots.entries()) {
    exact(slot, ["build", "hero", "behaviour"], `Team slot ${index + 1}`);
  }
  return root;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("Team code is not base64url data.");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new Error("Team code is not valid base64url data.");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encodeTeamBundle(library: BuildLibrary, selected: TeamId): string {
  const team = library.teams.find(({ id }) => id === selected);
  if (!team) throw new Error("That team is no longer in the library.");
  const ids = new Set(team.slots.flatMap((slot) => slot.build === null ? [] : [slot.build]));
  for (const id of [...ids]) {
    const parent = buildById(library, id)?.parent;
    if (parent !== null && parent !== undefined && buildById(library, parent)) ids.add(parent);
  }
  const builds = library.builds
    .filter((build) => ids.has(build.id))
    .map((build) => ({
      ...build,
      parent: build.parent !== null && ids.has(build.parent) ? build.parent : null,
    }));
  if (ids.size !== builds.length) throw new Error("The team refers to a missing build.");
  const usedTags = new Set([...team.tags, ...builds.flatMap(({ tags }) => tags)]);
  const tags = library.tags.filter((tag) => usedTags.has(tag));
  for (const tag of usedTags) if (!tags.includes(tag)) tags.push(tag);
  const payload: TeamBundle = { version: VERSION, tags, team, builds };
  const code = PREFIX + bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  if (code.length > MAX_CODE_LENGTH) throw new Error("This team is too large to share as one code.");
  return code;
}

export function decodeTeamBundle(code: string): TeamBundle {
  const trimmed = code.trim();
  if (trimmed.length > MAX_CODE_LENGTH) throw new Error("That team code is too large.");
  if (!trimmed.startsWith(PREFIX)) throw new Error("That is not a GWonMac team code.");
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      base64UrlToBytes(trimmed.slice(PREFIX.length)),
    ));
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith("Team code")) throw cause;
    throw new Error("That team code is damaged or incomplete.", { cause });
  }
  const record = assertExactShape(raw);
  if (record.version !== VERSION) throw new Error("That team code needs a newer GWonMac version.");
  const rawBuilds = record.builds as readonly Record<string, unknown>[];
  const rawTeam = record.team as Record<string, unknown>;
  const ids = new Set(rawBuilds.map(({ id }) => id));
  if (ids.size !== rawBuilds.length || [...ids].some((id) => typeof id !== "string")) {
    throw new Error("Team code contains duplicate or invalid build IDs.");
  }
  for (const build of rawBuilds) {
    if (build.parent !== null && !ids.has(build.parent)) {
      throw new Error("Team code is missing a build parent.");
    }
  }
  const slots = rawTeam.slots as readonly Record<string, unknown>[];
  if (slots.some((slot) => slot.build !== null && !ids.has(slot.build))) {
    throw new Error("Team code is missing a referenced build.");
  }
  const parsed = parseBuildLibrary({
    version: LIBRARY_VERSION,
    tags: record.tags,
    builds: rawBuilds,
    teams: [rawTeam],
  });
  const [team] = parsed.teams;
  if (parsed.teams.length !== 1 || !team) {
    throw new Error("Team code must contain exactly one team.");
  }
  return Object.freeze({
    version: VERSION,
    tags: parsed.tags,
    team,
    builds: parsed.builds,
  });
}

export function importTeamBundle(
  library: BuildLibrary,
  bundle: TeamBundle,
  mint: (kind: "build" | "team") => string,
): BuildLibrary {
  if (bundle.version !== VERSION) throw new Error("That team bundle version is unsupported.");
  const sourceIds = new Set(bundle.builds.map(({ id }) => id));
  if (sourceIds.size !== bundle.builds.length) {
    throw new Error("Team bundle contains duplicate build IDs.");
  }
  for (const build of bundle.builds) {
    if (build.parent !== null && !sourceIds.has(build.parent)) {
      throw new Error("Team bundle is missing a build parent.");
    }
  }
  if (bundle.team.slots.some(({ build }) => build !== null && !sourceIds.has(build))) {
    throw new Error("Team bundle is missing a referenced build.");
  }
  const occupiedBuildIds = new Set(library.builds.map(({ id }) => id));
  const remapped = new Map<string, ReturnType<typeof buildId>>();
  for (const build of bundle.builds) {
    const next = buildId(mint("build"));
    if (!next || occupiedBuildIds.has(next) || [...remapped.values()].includes(next)) {
      throw new Error("A fresh imported build ID could not be minted.");
    }
    remapped.set(build.id, next);
  }
  const importedTeamId = teamId(mint("team"));
  if (!importedTeamId || library.teams.some(({ id }) => id === importedTeamId)) {
    throw new Error("A fresh imported team ID could not be minted.");
  }
  const builds = bundle.builds.map((build) => ({
    ...build,
    id: remapped.get(build.id)!,
    parent: build.parent === null ? null : remapped.get(build.parent)!,
  }));
  const team: Team = {
    ...bundle.team,
    id: importedTeamId,
    slots: mapTeamSlots(bundle.team.slots, (slot) => ({
      ...slot,
      build: slot.build === null ? null : remapped.get(slot.build)!,
    })),
  };
  const tags = [...library.tags];
  for (const tag of bundle.tags) {
    if (!tags.some((current) => current.toLocaleLowerCase() === tag.toLocaleLowerCase())) {
      tags.push(tag);
    }
  }
  return { ...library, tags, builds: [...builds, ...library.builds], teams: [team, ...library.teams] };
}
