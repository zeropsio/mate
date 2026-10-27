/**
 * Git browser reads on demand, supervised by the common retry and refusal policy: one HTTP read
 * per key, shared by every holder and released at the last; a file's bytes are held as a `Blob`. An answer pinned to a commit is never
 * read again while held; a moving one (`home`, `refs`) is read again on a new visit or an explicit
 * Again, never on a timer.
 */
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import {
  GIT_BROWSE_READS,
  type GitBrowseBytesRead,
  type GitBrowseParams,
  type GitBrowseRead,
  type GitBrowseValue,
} from "../../zerops/gitBrowse/reads.ts";
import { HqError, type HqApi } from "../../zerops/hq/client.ts";
import {
  gitBrowseId,
  gitBrowseLink,
  gitBrowseScope,
  type GitBrowseKey,
} from "../families/hqGitBrowse.ts";
import type { LinkKey } from "../model.ts";
import { streamOf } from "../reducer.ts";
import type { AccountStore } from "../store.ts";
import type { StreamEvent, StreamFault } from "../streamMachine.ts";
import { superviseLink, type LinkSupervisor } from "../supervisor.ts";

/** What a person is told when HQ already runs as many heavy reads as it takes, by the read. */
const GIT_BROWSE_BUSY: Partial<Record<GitBrowseRead, string>> = {
  grep: "HQ is busy with other searches. Read again in a moment.",
  blame: "HQ is too busy to read this blame now. Read again in a moment.",
  archive: "HQ is too busy to make this archive now. Read again in a moment.",
};

/**
 * HQ's no as definitive, its sign-in or access no as a denial; anything else passes, HQ's busy
 * heavy reads said as busy in the read's own words.
 */
export const gitBrowseFailure =
  (read: GitBrowseRead) =>
  (cause: unknown): StreamFault => {
    const message = cause instanceof Error ? cause.message : "HQ could not read this repository.";
    if (cause instanceof HqError) {
      if (cause.code === "busy")
        return { outcome: "transient", message: GIT_BROWSE_BUSY[read] ?? message };
      if (cause.code === "forbidden" || cause.code === "session_required")
        return { outcome: "authoritative-denial", message, code: cause.code };
      if (cause.kind === "refused")
        return { outcome: "definitive-refusal", message, code: cause.code };
    }
    return { outcome: "transient", message };
  };

interface Held {
  count: number;
  again: boolean;
  wake?: () => void;
  supervisor?: LinkSupervisor;
  fiber?: Fiber.Fiber<never>;
}

/** One read's answer: a file's bytes as a `Blob`, anything else as HQ's JSON. */
const answerOf = (
  api: Pick<HqApi, "gitBrowse" | "gitBrowseBytes">,
  identity: GitBrowseKey,
  signal: AbortSignal,
): Promise<GitBrowseValue> =>
  "bytes" in GIT_BROWSE_READS[identity.read]
    ? api.gitBrowseBytes(
        identity.read as GitBrowseBytesRead,
        identity.appId,
        identity.repo,
        identity.params as GitBrowseParams<GitBrowseBytesRead>,
        signal,
      )
    : api.gitBrowse(identity.read, identity.appId, identity.repo, identity.params, signal);

export function makeGitBrowseReads(
  store: AccountStore,
  api: Pick<HqApi, "gitBrowse" | "gitBrowseBytes">,
) {
  let closed = false;
  const active = new Map<string, Held>();
  const demand = (identity: GitBrowseKey) => {
    if (closed) return () => {};
    const id = gitBrowseId(identity);
    const held = active.get(id);
    if (held !== undefined) held.count++;
    else {
      const scope = gitBrowseScope(identity);
      const key = gitBrowseLink(identity);
      const prior = store.state().facts.get(`hqGitBrowse:${id}`)?.revision;
      let sequence = prior?.kind === "mate-link" ? prior.sequence : 0;
      const signal = (target: LinkKey | typeof scope, event: StreamEvent) =>
        Effect.map(Clock.currentTimeMillis, (now) =>
          store.dispatch({ kind: "stream", key: target, now, event }),
        );
      const made: Held = {
        count: 1,
        again:
          GIT_BROWSE_READS[identity.read].moving || streamOf(store.state(), scope).fault !== null,
      };
      made.fiber = Effect.runFork(
        Effect.scoped(
          Effect.gen(function* () {
            const changes = yield* Queue.unbounded<void>();
            const supervisor = yield* superviseLink({
              store,
              key,
              scopes: [scope],
              repairSession: Effect.fail({
                outcome: "definitive-refusal",
                message: "Sign in to HQ again.",
              } satisfies StreamFault),
              attempt: () =>
                Effect.gen(function* () {
                  yield* Queue.clear(changes);
                  yield* signal(key, { kind: "handshake" });
                  while (true) {
                    yield* signal(scope, { kind: "attempt" });
                    yield* signal(scope, { kind: "handshake" });
                    const generation = streamOf(store.state(), scope).generation;
                    const fact = store.state().facts.get(`hqGitBrowse:${id}`);
                    if (fact?.content.kind !== "value" || made.again) {
                      const answer = yield* Effect.result(
                        Effect.tryPromise({
                          try: (abort) => answerOf(api, identity, abort),
                          catch: gitBrowseFailure(identity.read),
                        }),
                      );
                      if (closed || active.get(id) !== made) return yield* Effect.never;
                      if (streamOf(store.state(), scope).generation !== generation) {
                        yield* Queue.take(changes);
                        continue;
                      }
                      if (Result.isFailure(answer)) {
                        if (answer.failure.outcome === "authoritative-denial")
                          store.dispatch({
                            kind: "access",
                            family: "hqGitBrowse",
                            id,
                            access: "denied",
                          });
                        return yield* Effect.fail(answer.failure);
                      }
                      made.again = false;
                      store.dispatch({ kind: "baseline-begin", scope, generation });
                      store.dispatch({
                        kind: "baseline-commit",
                        scope,
                        generation,
                        via: "hq-stream",
                        partial: false,
                        members: [id],
                        rows: [
                          {
                            family: "hqGitBrowse",
                            id,
                            value: answer.success,
                            revision: { kind: "mate-link", sequence: ++sequence },
                          },
                        ],
                      });
                    }
                    yield* signal(scope, { kind: "baseline-committed" });
                    yield* signal(key, { kind: "baseline-committed" });
                    yield* Queue.take(changes);
                  }
                }),
            });
            made.supervisor = supervisor;
            made.wake = () => {
              const phase = streamOf(store.state(), key).phase;
              if (["refused", "recovering", "paused"].includes(phase))
                Effect.runFork(supervisor.signal("manual-retry"));
              else {
                Effect.runSync(signal(scope, { kind: "attempt" }));
                Queue.offerUnsafe(changes, undefined);
              }
            };
            return yield* supervisor.run;
          }),
        ),
      );
      active.set(id, made);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const entry = active.get(id);
      if (entry === undefined || --entry.count > 0) return;
      active.delete(id);
      stop(entry);
    };
  };
  const stop = (entry: Held) => {
    if (entry.supervisor) Effect.runSync(entry.supervisor.release);
    if (entry.fiber) Effect.runFork(Fiber.interrupt(entry.fiber));
  };
  return {
    demand,
    /** Reads the key's answer again: a moving read's newest, or one that failed. */
    again: (identity: GitBrowseKey) => {
      const entry = active.get(gitBrowseId(identity));
      if (entry === undefined || closed) return;
      entry.again = true;
      entry.wake?.();
    },
    close: () => {
      closed = true;
      for (const entry of active.values()) stop(entry);
      active.clear();
    },
  };
}
