/**
 * Owns the privacy-safe view of one account's reload events.
 * It accepts recorder records internally but never returns raw JSONL.
 */
import { CLIPBOARD_TEXT_CEILING } from "../../shared/contracts.js";
import type { LogRecord } from "./flight-recorder.js";

const RELOG_EVENTS = new Set([
  "commandQ.shortcut",
  "quitReloadDialog.lifecycle",
  "gameReload.requested",
  "gameReload.syncIncomplete",
  "gameReload.loaded",
  "relog.intentClaimed",
  "relog.savedCredentialsLoaded",
  "relog.loginSubmitted",
  "relog.tokenRequested",
  "relog.tokenAccepted",
  "relog.characterSubmitted",
  "relog.preGameProbe",
  "relog.inputSettled",
  "relog.finished",
  "relog.timedOut",
]);

const TERMINAL_EVENTS = new Set(["relog.finished", "relog.timedOut"]);

function scalar(fields: LogRecord["fields"], key: string): string | null {
  const value = fields[key];
  return typeof value === "string" || typeof value === "number"
    || typeof value === "boolean" ? String(value) : null;
}

function details(
  record: LogRecord,
): string {
  const fields = record.fields;
  switch (record.name) {
    case "commandQ.shortcut":
      return [scalar(fields, "phase"), scalar(fields, "reason")]
        .filter(Boolean).join(" ");
    case "quitReloadDialog.lifecycle":
      return [scalar(fields, "phase"), scalar(fields, "action"),
        scalar(fields, "autoRelog") === null
          ? null
          : `auto=${scalar(fields, "autoRelog")}`]
        .filter(Boolean).join(" ");
    case "gameReload.requested":
    case "gameReload.loaded":
      return `cause=${scalar(fields, "cause") ?? "unknown"}`;
    case "gameReload.syncIncomplete":
      return `outcome=${scalar(fields, "outcome") ?? "unknown"}`;
    case "relog.inputSettled":
      return `stage=${scalar(fields, "stage") ?? "unknown"} `
        + `outcome=${scalar(fields, "outcome") ?? "unknown"}`;
    case "relog.preGameProbe": {
      const mask = Number(scalar(fields, "mask") ?? 0) >>> 0;
      return `state=${scalar(fields, "state") ?? "unknown"} `
        + `abi=${(mask >>> 24) & 0x7f} `
        + `trap=${Boolean(mask & 0x8000_0000)} `
        + `hashed=0x${(mask & 0x0f).toString(16)} `
        + `matched=0x${((mask >>> 4) & 0x0f).toString(16)} `
        + `visible=0x${((mask >>> 8) & 0x0f).toString(16)} `
        + `characterPair=${Boolean(mask & 0x2000)} `
        + `reconnectPair=${Boolean(mask & 0x1000)} `
        + `table=${Boolean(mask & 0x4000)}/${Boolean(mask & 0x8000)} `
        + `frames=${Boolean(mask & 0x10000)}/${Boolean(mask & 0x20000)} `
        + `liveHash=${Boolean(mask & 0x40000)}`;
    }
    case "relog.finished":
      return `outcome=${scalar(fields, "outcome") ?? "unknown"}`;
    default:
      return "";
  }
}

function traceStart(records: readonly LogRecord[]): number {
  let reload = -1;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (records[index]!.name === "gameReload.requested") {
      reload = index;
      break;
    }
  }
  if (reload >= 0) {
    for (let index = reload; index >= 0; index -= 1) {
      const record = records[index]!;
      if (
        record.name === "commandQ.shortcut"
        && record.fields.phase === "claimed"
      ) return index;
    }
    return reload;
  }
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]!;
    if (record.name === "commandQ.shortcut" && record.fields.phase === "claimed") {
      return index;
    }
  }
  return -1;
}

export function formatRelogTranscript(input: Readonly<{
  records: readonly LogRecord[];
  ownerId: number;
  completeFromStart: boolean;
  ceiling?: number;
}>): string {
  const matching = input.records
    .filter((record) => record.ownerId === input.ownerId && RELOG_EVENTS.has(record.name))
    .sort((left, right) => left.seq - right.seq);
  const start = traceStart(matching);
  const candidate = start < 0 ? [] : matching.slice(start);
  const terminal = candidate.findIndex((record) => TERMINAL_EVENTS.has(record.name));
  const selected = terminal < 0 ? candidate : candidate.slice(0, terminal + 1);
  const complete = start >= 0 && terminal >= 0;
  const outsideCurrent = matching.length - selected.length;
  const source = (record: LogRecord) => record.subsystem === "renderer"
    ? "renderer" : "main";
  let previousUs: number | null = null;
  const rows = selected.map((record, index) => {
    const gap = previousUs === null ? "—" : `${Math.max(0, record.tsUs - previousUs) / 1_000}`;
    previousUs = record.tsUs;
    const detail = details(record);
    return {
      text: `${String(index + 1).padStart(4, "0")}  ${gap.padStart(7)}ms  `
        + `${source(record).padEnd(8)} ${record.name}${detail ? ` ${detail}` : ""}`,
    };
  });
  let omitted = 0;
  const ceiling = Math.min(
    input.ceiling ?? CLIPBOARD_TEXT_CEILING,
    CLIPBOARD_TEXT_CEILING,
  );
  const render = () => [
    `gwonmac reload trace — ${selected.length} events, ${rows.length} rows`,
    "privacy: no text, credentials, account identifiers, paths, coordinates, pointers, packets, or UI parameter values",
    `status: ${complete ? "complete" : "incomplete"}; recorder-start=${input.completeFromStart ? "complete" : "truncated"}; outside-current=${outsideCurrent}; omitted=${omitted}`,
    "columns: sequence  gap  source  event  closed fields",
    "",
    ...(rows.length > 0 ? rows.map((row) => row.text) : ["(no reload boundary is available)"]),
  ].join("\n");
  let transcript = render();
  while (transcript.length > ceiling && rows.length > 0) {
    rows.shift();
    omitted += 1;
    transcript = render();
  }
  return transcript.slice(0, ceiling);
}
