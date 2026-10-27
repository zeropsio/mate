/**
 * An HQ wire the test drives: each `open` is one segment whose messages the test sends, and every
 * request the client sends on it is recorded, decoded.
 */
import { HqStreamMessage, type HqStreamRequest } from "@t3tools/shared/hqStream";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import type * as Cause from "effect/Cause";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { HqWire } from "../adapters/hq.ts";
import type { StreamFault } from "../streamMachine.ts";

const encodeMessage = Schema.encodeSync(Schema.fromJsonString(HqStreamMessage));

/** Credential-free source facts shared by the Git wire/consumer witnesses. */
export const gitRemote = {
  url: "https://github.com/example/shop.git",
  repositoryId: "123",
  keptAt: "2026-10-13T10:00:00Z",
  keptBy: "zerops-custodian",
  expiresAt: null,
  invalidSince: null,
} as const;
export const gitPreflight = {
  repo: "web",
  remote: gitRemote,
  ref: "refs/heads/main",
  before: "a".repeat(40),
  sha: "b".repeat(40),
  verdict: "ready",
  reason: null,
  checkedAt: "2026-10-13T10:01:00Z",
} as const;
export const gitAdoption = {
  repo: "web",
  remote: { url: gitRemote.url, repositoryId: gitRemote.repositoryId },
  branch: "main",
  mainHead: gitPreflight.sha,
  remoteHead: gitPreflight.before,
  changedFiles: 2,
  seed: false,
} as const;
export const gitEnvironment = {
  id: "git-production",
  // A legacy address must never override the Git identity or invent project demand.
  projectId: "unrelated-project",
  target: { kind: "git", branch: "main", delivery: "direct" },
  tier: "production",
  name: "Production",
  sources: ["release"],
  order: 2,
  keyHeld: true,
  keyInvalid: false,
  can: {},
  jobs: [
    {
      id: "push-v2",
      kind: "push",
      service: "web",
      sha: gitPreflight.sha,
      state: "pushed",
      cause: "release",
      ref: "v2.0.0",
      reason: null,
      appVersionId: null,
      processId: null,
      requestedBy: "releaser",
      at: "2026-10-13T10:02:00Z",
      endedAt: "2026-10-13T10:03:00Z",
      supersededBy: null,
      evidence: {
        attempt: {
          remote: gitAdoption.remote,
          ref: gitPreflight.ref,
          sha: gitPreflight.sha,
          credentialKeptAt: gitRemote.keptAt,
          before: gitPreflight.before,
          phase: "submitting",
        },
        confirmed: {
          remote: gitAdoption.remote,
          ref: gitPreflight.ref,
          before: gitPreflight.before,
          after: gitPreflight.sha,
          at: "2026-10-13T10:03:00Z",
          via: "answer",
        },
        nextActor: "none",
        nextAction: "Handed over",
      },
    },
  ],
  release: null,
  birth: null,
} as const;

export interface HqFixtureWire {
  readonly wire: HqWire;
  /** Every request sent, by segment (1-based) in the order sent. */
  readonly sent: Array<{ readonly segment: number; readonly request: HqStreamRequest }>;
  /** Sends one message on the open segment. */
  readonly send: (message: HqStreamMessage) => Effect.Effect<void>;
  /** Ends the open segment as HQ plans it (`4410`). */
  readonly endSegment: Effect.Effect<void>;
  /** Breaks the open segment with a classified fault. */
  readonly drop: (fault: StreamFault) => Effect.Effect<void>;
  readonly opens: () => number;
  /** The open segment's reader has terminated, including its message handler. */
  readonly closed: Effect.Effect<void>;
}

export function hqFixtureWire(
  options: {
    /** Runs while the segment's socket opens; `socketCreated` says the socket exists. */
    readonly open?: (socketCreated: Effect.Effect<void>) => Effect.Effect<void, StreamFault>;
  } = {},
): HqFixtureWire {
  const sent: Array<{ readonly segment: number; readonly request: HqStreamRequest }> = [];
  let messages: Queue.Queue<string, StreamFault | Cause.Done> | null = null;
  let opens = 0;
  let closed = Deferred.makeUnsafe<void>();
  return {
    closed: Effect.suspend(() => Deferred.await(closed)).pipe(
      Effect.timeout("5 seconds"),
      Effect.orDie,
    ),
    sent,
    opens: () => opens,
    send: (message) =>
      Effect.suspend(() =>
        messages === null
          ? Effect.die("No segment is open.")
          : Effect.asVoid(Queue.offer(messages, encodeMessage(message))),
      ),
    endSegment: Effect.suspend(() =>
      messages === null ? Effect.void : Effect.asVoid(Queue.end(messages)),
    ),
    drop: (fault) =>
      Effect.suspend(() =>
        messages === null ? Effect.void : Effect.asVoid(Queue.fail(messages, fault)),
      ),
    wire: {
      open: (socketCreated) =>
        Effect.gen(function* () {
          if (options.open !== undefined) yield* options.open(socketCreated);
          opens += 1;
          const segment = opens;
          const queue = yield* Queue.unbounded<string, StreamFault | Cause.Done>();
          messages = queue;
          const finished = Deferred.makeUnsafe<void>();
          closed = finished;
          return {
            messages: Stream.fromQueue(queue).pipe(
              Stream.ensuring(Deferred.succeed(finished, undefined)),
            ),
            send: (request) => Effect.sync(() => void sent.push({ segment, request })),
          };
        }),
    },
  };
}
