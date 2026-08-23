/**
 * The complete remote-content vocabulary. It is deliberately presentation-only:
 * no member can name code, an update asset, a compatibility decision, or a URL.
 */
export const CONTENT_NOTICE_KINDS = [
  "arenanet-update",
  "known-issue",
  "announcement",
] as const;
export type ContentNoticeKind = (typeof CONTENT_NOTICE_KINDS)[number];

export const CONTENT_NOTICE_SEVERITIES = ["info", "important", "degraded"] as const;
export type ContentNoticeSeverity = (typeof CONTENT_NOTICE_SEVERITIES)[number];

export const CONTENT_ACTIONS = [
  "discord-support",
  "arenanet-news",
  "app-releases",
] as const;
export type ContentAction = (typeof CONTENT_ACTIONS)[number];

export interface ContentNoticeV1 {
  readonly id: string;
  readonly revision: number;
  readonly state: "active" | "resolved";
  readonly kind: ContentNoticeKind;
  readonly severity: ContentNoticeSeverity;
  readonly title: string;
  readonly summary: string;
  readonly details: readonly string[];
  readonly startsAt: string;
  readonly expiresAt: string;
  readonly action?: ContentAction;
}

export interface ContentReleaseV1 {
  readonly version: string;
  readonly track: "stable" | "beta";
  readonly publishedAt: string;
  readonly title: string;
  readonly summary: string;
  readonly highlights: readonly string[];
}

export interface ContentPayloadV1 {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly publishedAt: string;
  readonly notices: readonly ContentNoticeV1[];
  readonly releases: readonly ContentReleaseV1[];
}

export interface SignedContentEnvelopeV1 {
  readonly schemaVersion: 1;
  readonly keyId: string;
  readonly payload: string;
  readonly signature: string;
}

export type ContentFeedPhase =
  | "disabled"
  | "refreshing"
  | "current"
  | "stale"
  | "unavailable";

export interface ContentFeedState {
  readonly phase: ContentFeedPhase;
  readonly lastSuccessfulAt?: string;
  readonly notices: readonly ContentNoticeV1[];
  readonly releases: readonly ContentReleaseV1[];
  readonly unreadCount: number;
}

export interface ContentReadMarker {
  readonly id: string;
  readonly revision: number;
}

export const CONTENT_ENVELOPE_MAX_BYTES = 64 * 1024;
export const CONTENT_PAYLOAD_MAX_BYTES = 48 * 1024;
export const CONTENT_MAX_ENTRIES = 40;
export const CONTENT_MAX_DETAILS = 6;
export const CONTENT_MAX_HIGHLIGHTS = 8;
export const CONTENT_KEY_ID_MAX = 64;

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const VERSION = /^\d{4}\.\d{1,2}\.\d{1,3}(?:-(?:beta|rc)\.\d+)?$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
function hasForbiddenControl(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code !== undefined && (code < 0x20 || code === 0x7f) && code !== 0x0a) {
      return true;
    }
  }
  return false;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], name: string): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new TypeError(`${name} has unknown field ${JSON.stringify(unknown)}`);
}

function text(value: unknown, name: string, maximum: number): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maximum
    || value.trim() !== value
    || hasForbiddenControl(value)
  ) throw new TypeError(`${name} must be bounded plain text`);
  return value;
}

function timestamp(value: unknown, name: string): string {
  const parsed = text(value, name, 32);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(parsed)) {
    throw new TypeError(`${name} must be a UTC timestamp to whole seconds`);
  }
  if (!Number.isFinite(Date.parse(parsed))) throw new TypeError(`${name} is invalid`);
  return parsed;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value as number;
}

function textList(value: unknown, name: string, maximum: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`${name} must be a bounded array`);
  }
  return value.map((entry, index) => text(entry, `${name}[${index}]`, 280));
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  choices: T,
  name: string,
): T[number] {
  if (typeof value !== "string" || !choices.includes(value)) {
    throw new TypeError(`${name} has an unknown value`);
  }
  return value as T[number];
}

function parseNotice(value: unknown, index: number): ContentNoticeV1 {
  const name = `content.notices[${index}]`;
  const src = record(value, name);
  exact(src, [
    "id", "revision", "state", "kind", "severity", "title", "summary",
    "details", "startsAt", "expiresAt", "action",
  ], name);
  const id = text(src.id, `${name}.id`, 80);
  if (!ID.test(id)) throw new TypeError(`${name}.id is invalid`);
  const startsAt = timestamp(src.startsAt, `${name}.startsAt`);
  const expiresAt = timestamp(src.expiresAt, `${name}.expiresAt`);
  if (Date.parse(expiresAt) <= Date.parse(startsAt)) {
    throw new TypeError(`${name}.expiresAt must follow startsAt`);
  }
  return {
    id,
    revision: positiveInteger(src.revision, `${name}.revision`),
    state: oneOf(src.state, ["active", "resolved"] as const, `${name}.state`),
    kind: oneOf(src.kind, CONTENT_NOTICE_KINDS, `${name}.kind`),
    severity: oneOf(src.severity, CONTENT_NOTICE_SEVERITIES, `${name}.severity`),
    title: text(src.title, `${name}.title`, 80),
    summary: text(src.summary, `${name}.summary`, 280),
    details: textList(src.details, `${name}.details`, CONTENT_MAX_DETAILS),
    startsAt,
    expiresAt,
    ...(src.action === undefined
      ? {}
      : { action: oneOf(src.action, CONTENT_ACTIONS, `${name}.action`) }),
  };
}

function parseRelease(value: unknown, index: number): ContentReleaseV1 {
  const name = `content.releases[${index}]`;
  const src = record(value, name);
  exact(src, ["version", "track", "publishedAt", "title", "summary", "highlights"], name);
  const version = text(src.version, `${name}.version`, 40);
  if (!VERSION.test(version)) throw new TypeError(`${name}.version is invalid`);
  return {
    version,
    track: oneOf(src.track, ["stable", "beta"] as const, `${name}.track`),
    publishedAt: timestamp(src.publishedAt, `${name}.publishedAt`),
    title: text(src.title, `${name}.title`, 80),
    summary: text(src.summary, `${name}.summary`, 280),
    highlights: textList(src.highlights, `${name}.highlights`, CONTENT_MAX_HIGHLIGHTS),
  };
}

export function parseContentPayload(value: unknown): ContentPayloadV1 {
  const src = record(value, "content");
  exact(src, ["schemaVersion", "sequence", "publishedAt", "notices", "releases"], "content");
  if (src.schemaVersion !== 1) throw new TypeError("content.schemaVersion must be 1");
  if (!Array.isArray(src.notices) || !Array.isArray(src.releases)) {
    throw new TypeError("content entries must be arrays");
  }
  if (src.notices.length + src.releases.length > CONTENT_MAX_ENTRIES) {
    throw new TypeError("content has too many entries");
  }
  const notices = src.notices.map(parseNotice);
  const releases = src.releases.map(parseRelease);
  const noticeIds = new Set<string>();
  for (const notice of notices) {
    if (noticeIds.has(notice.id)) throw new TypeError(`duplicate notice ${notice.id}`);
    noticeIds.add(notice.id);
  }
  const versions = new Set<string>();
  for (const release of releases) {
    const key = `${release.track}:${release.version}`;
    if (versions.has(key)) throw new TypeError(`duplicate release ${key}`);
    versions.add(key);
  }
  return {
    schemaVersion: 1,
    sequence: positiveInteger(src.sequence, "content.sequence"),
    publishedAt: timestamp(src.publishedAt, "content.publishedAt"),
    notices,
    releases,
  };
}

export function parseSignedContentEnvelope(value: unknown): SignedContentEnvelopeV1 {
  const src = record(value, "content envelope");
  exact(src, ["schemaVersion", "keyId", "payload", "signature"], "content envelope");
  if (src.schemaVersion !== 1) throw new TypeError("content envelope schemaVersion must be 1");
  const keyId = text(src.keyId, "content envelope keyId", CONTENT_KEY_ID_MAX);
  const payload = text(src.payload, "content envelope payload", CONTENT_ENVELOPE_MAX_BYTES);
  const signature = text(src.signature, "content envelope signature", 256);
  if (!ID.test(keyId) || !BASE64URL.test(payload) || !BASE64URL.test(signature)) {
    throw new TypeError("content envelope encoding is invalid");
  }
  return { schemaVersion: 1, keyId, payload, signature };
}

export function currentContentNotices(
  payload: ContentPayloadV1,
  now: number,
): readonly ContentNoticeV1[] {
  return payload.notices.filter((notice) =>
    notice.state === "active"
    && Date.parse(notice.startsAt) <= now
    && now < Date.parse(notice.expiresAt)
  );
}
