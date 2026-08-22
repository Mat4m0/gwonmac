/**
 * Combines the closed diagnostic-event fragments and derives their public types.
 * Producers consume this module instead of selecting a fragment themselves.
 */
import type {
  DiagnosticFields,
  DiagnosticLevel,
  DiagnosticScalar,
  DiagnosticSubsystem,
} from "../../shared/diagnostics.js";
import { APP_AND_UPDATE_EVENT_SCHEMA } from "./schema-app-update.js";
import { PROTOCOL_AND_RENDERER_EVENT_SCHEMA } from "./schema-protocol-renderer.js";
import type { EventSpec, FieldGuard } from "./schema-fields.js";

export const DIAGNOSTIC_EVENT_SCHEMA = {
  ...APP_AND_UPDATE_EVENT_SCHEMA,
  ...PROTOCOL_AND_RENDERER_EVENT_SCHEMA,
} as const;

export type DiagnosticEventName = keyof typeof DIAGNOSTIC_EVENT_SCHEMA;

export function diagnosticEventSpec(name: DiagnosticEventName): EventSpec {
  return DIAGNOSTIC_EVENT_SCHEMA[name];
}

type Guarded<G> = G extends FieldGuard<infer T> ? T : never;
type FieldsOf<K extends DiagnosticEventName> = {
  [F in keyof (typeof DIAGNOSTIC_EVENT_SCHEMA)[K]["fields"]]: Guarded<
    (typeof DIAGNOSTIC_EVENT_SCHEMA)[K]["fields"][F]
  >;
};

export type DiagnosticEvent = {
  [K in DiagnosticEventName]: { k: K } & FieldsOf<K>;
}[DiagnosticEventName];

type EventNamesWithScope<Scope extends EventSpec["scope"]> = {
  [K in DiagnosticEventName]:
    (typeof DIAGNOSTIC_EVENT_SCHEMA)[K]["scope"] extends Scope ? K : never;
}[DiagnosticEventName];

export type AppDiagnosticEvent = Extract<
  DiagnosticEvent,
  { k: EventNamesWithScope<"app"> }
>;
export type OwnerDiagnosticEvent = Extract<
  DiagnosticEvent,
  { k: EventNamesWithScope<"owner"> }
>;

export interface DiagnosticEventRecord {
  subsystem: DiagnosticSubsystem;
  level: DiagnosticLevel;
  name: DiagnosticEventName;
  fields: DiagnosticFields;
}

export function diagnosticEventRecord(
  event: DiagnosticEvent,
): DiagnosticEventRecord {
  const spec: EventSpec = DIAGNOSTIC_EVENT_SCHEMA[event.k];
  const fields: DiagnosticFields = {};
  for (const [key, value] of Object.entries(event)) {
    if (key !== "k") fields[key] = value;
  }
  return {
    subsystem: spec.subsystem,
    level: spec.level,
    name: event.k,
    fields,
  };
}

/**
 * Compile-time proof that the public event constructor cannot carry prose or
 * nested structures. Literal unions and branded fixed-format strings survive;
 * a plain `string` field does not.
 */
type FreeTextKeys<T> = T extends unknown
  ? { [K in keyof T]-?: string extends T[K] ? K : never }[keyof T]
  : never;

const _noFreeText: [FreeTextKeys<DiagnosticEvent>] extends [never]
  ? true
  : never = true;
const _scalarsOnly: DiagnosticEvent extends Record<
  string,
  DiagnosticScalar | undefined
>
  ? true
  : never = true;
