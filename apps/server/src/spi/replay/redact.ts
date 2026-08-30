/**
 * Redaction for SPI replay goldens.
 *
 * A golden file must be stable across replays and across machines. Two
 * kinds of noise stand between a raw `ProviderRuntimeEvent[]` and a stable
 * golden:
 *
 * - Non-determinism the driver itself introduces: `eventId` is a freshly
 *   generated UUID per event, `createdAt` is wall-clock time, and driver-
 *   assigned ids (turnId, itemId, requestId) are fresh per replay.
 *
 * Deliberately NOT here: rewriting absolute paths by the paths of the
 * machine running the comparison. A golden's content comes from a
 * recording made somewhere else, so masking it with the comparing host's
 * cwd/home/tmpdir makes the result depend on where the test runs — it
 * turned all four Claude goldens red on every Linux machine while staying
 * green on one macOS laptop, and masked nothing in any golden. If a
 * recording ever needs a path masked, mask it when recording.
 *
 * `redact` is a pure function over already-produced events — it never talks
 * to the driver or the filesystem — so its rules are exhaustively testable
 * in isolation (see redact.test.ts).
 */

export const REDACTED_CREATED_AT = "1970-01-01T00:00:00.000Z";

/**
 * A kind of driver-generated identifier (turnId, itemId, requestId, ...) to
 * rewrite by VALUE rather than by key: every occurrence of a given raw
 * value — under any of `fields`' key names, at any depth, including nested
 * inside `payload`/`raw` — is rewritten to the same `<prefix>-<n>`
 * placeholder, where `n` is the order in which that value was first seen.
 * This keeps identity relationships intact (two events that share a real
 * turnId still share their redacted placeholder) without requiring the
 * value's every occurrence to sit under one of `fields`.
 */
export interface RedactIdRule {
  readonly fields: ReadonlyArray<string>;
  readonly prefix: string;
}

export interface RedactOptions {
  readonly ids?: ReadonlyArray<RedactIdRule>;
}

function collectIdRenames(
  events: ReadonlyArray<Record<string, unknown>>,
  idRules: ReadonlyArray<RedactIdRule>,
): ReadonlyMap<string, string> {
  const renames = new Map<string, string>();
  const countByPrefix = new Map<string, number>();
  const fieldToPrefix = new Map<string, string>();
  for (const rule of idRules) {
    for (const field of rule.fields) {
      fieldToPrefix.set(field, rule.prefix);
    }
  }

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        const prefix = fieldToPrefix.get(key);
        if (prefix && typeof entry === "string" && entry.length > 0 && !renames.has(entry)) {
          const n = countByPrefix.get(prefix) ?? 0;
          renames.set(entry, `${prefix}-${n}`);
          countByPrefix.set(prefix, n + 1);
        }
        visit(entry);
      }
    }
  };

  for (const event of events) visit(event);
  return renames;
}

function redactString(value: string, idRenames: ReadonlyMap<string, string>): string {
  return idRenames.get(value) ?? value;
}

function redactValue(value: unknown, idRenames: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") {
    return redactString(value, idRenames);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, idRenames));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = redactValue(entry, idRenames);
    }
    return out;
  }
  return value;
}

/**
 * Redacts a list of already-produced normalized events. Rewrites `eventId`
 * to a stable per-array sequence id (`evt-<index>`) when the field is
 * present, `createdAt` to a fixed placeholder when present, every value of
 * an `ids`-configured field (wherever that exact value occurs, by value —
 * see `RedactIdRule`) to a stable `<prefix>-<n>` placeholder. Never
 * mutates its input, and never reads the environment.
 */
export function redact(
  events: ReadonlyArray<Record<string, unknown>>,
  options?: RedactOptions,
): ReadonlyArray<Record<string, unknown>> {
  const idRenames = collectIdRenames(events, options?.ids ?? []);

  return events.map((event, index) => {
    const redacted = redactValue(event, idRenames) as Record<string, unknown>;
    return {
      ...redacted,
      ...("eventId" in event ? { eventId: `evt-${index}` } : {}),
      ...("createdAt" in event ? { createdAt: REDACTED_CREATED_AT } : {}),
    };
  });
}
