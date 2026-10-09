import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export interface ResumeBinding {
  readonly provider_name: string;
  readonly provider_instance_id: string | null;
  readonly resume_cursor_json: string | null;
}

const claudeCursor = Schema.Struct({
  resume: Schema.String.check(Schema.isUUID()),
  resumeSessionAt: Schema.optionalKey(Schema.String),
  turnCount: Schema.optionalKey(Schema.Number),
  turnStartMessageIds: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
});
const codexCursor = Schema.Struct({ threadId: Schema.NonEmptyString });

const cursorMatches = <A>(schema: Schema.Codec<A>, persisted: string, live: unknown | null) =>
  Effect.gen(function* () {
    const stored = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(persisted);
    if (live === null) return true;
    const current = yield* Schema.decodeUnknownEffect(schema)(live);
    return Schema.toEquivalence(schema)(stored, current);
  }).pipe(Effect.orElseSucceed(() => false));

/**
 * Whether a native session would resume after a restart, read from its binding. `driver` is the
 * provider's own name, as the binding and the engine's agent spell it (`claudeAgent`, `codex`).
 */
export const nativeResumeBlocker = Effect.fnUntraced(function* (input: {
  readonly driver: string | undefined;
  readonly nativeRef: string | null;
  readonly thread?: string;
  readonly liveCursor?: unknown;
  readonly instanceId: string | null | undefined;
  readonly binding: ResumeBinding | undefined;
}) {
  const { driver, nativeRef, instanceId, binding } = input;
  if (driver !== "claudeAgent" && driver !== "codex") return "native resume is unsupported";
  if (
    binding === undefined ||
    binding.resume_cursor_json === null ||
    instanceId == null ||
    binding.provider_name !== driver ||
    binding.provider_instance_id !== instanceId
  )
    return "native resume binding is missing or disagrees";
  if (nativeRef === null || (input.thread !== undefined && nativeRef !== input.thread))
    return "native resume binding belongs to another generation";
  const live = Object.hasOwn(input, "liveCursor") ? input.liveCursor : null;
  const valid = yield* driver === "claudeAgent"
    ? cursorMatches(claudeCursor, binding.resume_cursor_json, live)
    : cursorMatches(codexCursor, binding.resume_cursor_json, live);
  return valid ? undefined : "native resume cursor is missing or disagrees";
});
