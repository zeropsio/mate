/**
 * ZeropsAgentAuthorizers — which Zerops user signed each agent CLI in here.
 *
 * The agent credential itself is never opened (that invariant is
 * `ZeropsAgentAuth`'s and stays intact): this records provenance *beside* it,
 * written only when mate's own server-driven login flow succeeds, from the
 * door's session subject.
 *
 * ## Why it is recorded rather than derived
 *
 * There is nowhere to derive it from. A credential file says nothing about who
 * put it there, and the container has no per-user identity of its own — every
 * project member reaches the same agent. So the one moment the fact exists is
 * the moment a login succeeds on an authenticated session, and if it is not
 * written down then it is gone.
 *
 * ## Absence is normal
 *
 * A credential can predate this file, be copied in by hand, or arrive with the
 * container image. Every read path therefore treats "no record" as ordinary
 * and unremarkable — never as evidence that the credential belongs to somebody
 * else. `agentOwnership.ts` on the client is where that distinction is spelled
 * out for the user.
 *
 * The file is small, plain JSON, and read tolerantly: anything malformed is one
 * missing record, never a broken feed.
 *
 * @module ZeropsAgentAuthorizers
 */
import type { ZeropsAgentId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

import type { ZeropsAgentAuthorizer } from "./ZeropsAgentAuth.ts";

/** Lives beside the rest of the server's own state, never in the agent's home. */
export const ZEROPS_AGENT_AUTHORIZERS_FILE = "zerops-agent-authorizers.json";

export type ZeropsAgentAuthorizers = Readonly<
  Partial<Record<ZeropsAgentId, ZeropsAgentAuthorizer>>
>;

/** On disk: epoch millis, so the file needs no date parsing to be valid. */
interface StoredRecord {
  readonly subject: string;
  readonly atMillis: number;
}

function isStoredRecord(value: unknown): value is StoredRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StoredRecord>;
  return (
    typeof record.subject === "string" &&
    record.subject.length > 0 &&
    typeof record.atMillis === "number" &&
    Number.isFinite(record.atMillis)
  );
}

/**
 * Parses the file's text. Pure and total: a malformed document, a malformed
 * entry, or an unknown agent id each drop out individually rather than failing
 * the read.
 */
export function parseAuthorizers(text: string): ZeropsAgentAuthorizers {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};

  const authorizers: Record<string, ZeropsAgentAuthorizer> = {};
  for (const [agentId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isStoredRecord(value)) continue;
    const at = DateTime.make(value.atMillis);
    if (Option.isNone(at)) continue;
    authorizers[agentId] = { subject: value.subject, at: at.value };
  }
  return authorizers as ZeropsAgentAuthorizers;
}

/** Serializes back to the stored shape. */
export function serializeAuthorizers(authorizers: ZeropsAgentAuthorizers): string {
  const stored: Record<string, StoredRecord> = {};
  for (const [agentId, record] of Object.entries(authorizers)) {
    if (record === undefined) continue;
    stored[agentId] = {
      subject: record.subject,
      atMillis: DateTime.toEpochMillis(record.at),
    };
  }
  return `${JSON.stringify(stored, null, 2)}\n`;
}

/**
 * Reads the file, answering `{}` for anything that is not a usable document.
 *
 * Takes the filesystem rather than requiring it: every caller already holds
 * one, and requiring the service here would push `FileSystem` into the context
 * of `ZeropsAgentAuth`'s already-resolved publish loop.
 */
export const readAuthorizers = (
  fs: FileSystem.FileSystem,
  filePath: string,
): Effect.Effect<ZeropsAgentAuthorizers> =>
  Effect.gen(function* () {
    const text = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""));
    return parseAuthorizers(text);
  });

/**
 * Records one agent's authorizer, preserving the others.
 *
 * Read-modify-write, and deliberately last-writer-wins: two members racing to
 * sign the same agent in is a race whose loser's credential is also being
 * overwritten by the CLI itself, so the file agreeing with whoever finished
 * last is the correct answer, not a lost update.
 */
export const recordAuthorizer = (
  fs: FileSystem.FileSystem,
  filePath: string,
  agentId: ZeropsAgentId,
  subject: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (subject.length === 0) return;
    const current = yield* readAuthorizers(fs, filePath);
    const at = yield* DateTime.now;
    const next: ZeropsAgentAuthorizers = { ...current, [agentId]: { subject, at } };
    // A failure to record provenance must never fail the login that just
    // succeeded — the user is signed in either way.
    yield* fs
      .writeFileString(filePath, serializeAuthorizers(next))
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to record the agent authorizer", { agentId, cause }),
        ),
      );
  });
