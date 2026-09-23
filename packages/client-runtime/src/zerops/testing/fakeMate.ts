/**
 * One Mate as the account harness serves it (DESIGN §11.1): its descriptor (with
 * `zerops.identity`, `update` and the environment a redeploy replaces), `/healthz`, the door's
 * answers, and the socket's verdict on each credential the door issued — including the
 * old-server mode a 0.11.0 Mate answers in.
 *
 * The door and the descriptor answer the way the connection layer reports them
 * (`ConnectionBlockedError`, `ConnectionTransientError`), so code under test classifies the
 * same values it meets in a browser.
 */
import type { EnvironmentId, ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";

import {
  ConnectionBlockedError,
  type ConnectionBlockedReason,
  ConnectionTransientError,
} from "../../connection/model.ts";
import type { AtomCommandResult } from "../../state/runtime.ts";

/** What the door answers one exchange with. */
export type FakeDoorAnswer =
  | "ok"
  /** The Mate's server failed (`EnvironmentInternalError`, reported as `remote-unavailable`). */
  | "500"
  /** The door knows the caller and refuses: `READ_ONLY` on the project. */
  | "read-only"
  /** The door knows the caller and refuses: no access to the project. */
  | "permission"
  /** The request never answers. */
  | "hang";

/** A credential the door issued; `generation` counts them per Mate. */
export interface FakeMateCredential {
  readonly environmentId: EnvironmentId;
  readonly generation: number;
}

export interface FakeMateLink {
  readonly phase: "connected" | "blocked";
  readonly reason?: ConnectionBlockedReason;
}

export interface FakeMate {
  readonly origin: string;
  readonly projectId: string;
  readonly descriptor: () => ExecutionEnvironmentDescriptor;
  /** `/healthz`: the container answers while it is up. */
  readonly healthz: () => "ok" | "unreachable";
  /** The container stops or starts answering at all. */
  readonly setReachable: (reachable: boolean) => void;
  /** A redeploy replaced the Mate's data history: a new environment at the same origin. */
  readonly redeploy: (environmentId: EnvironmentId) => void;
  /** What the Mate's own key last proved (`zerops.identity`), with the check's instant. */
  readonly setIdentity: (identity: "unknown" | "ok" | "failed", checkedAt: string) => void;
  /** Queues the door's next answers; once they are spent it admits again. */
  readonly scriptDoor: (...answers: ReadonlyArray<FakeDoorAnswer>) => void;
  /** Descriptor reads that reached the Mate. */
  readonly descriptorReads: () => number;
  /** Door exchanges that reached the Mate, in order, with the throwaway each presented. */
  readonly doorCalls: () => ReadonlyArray<{ readonly doorToken: string }>;
  /** `/.well-known/t3/environment`, as `fetchRemoteEnvironmentDescriptor` reads it. */
  readonly readDescriptor: (httpBaseUrl: string) => Promise<ExecutionEnvironmentDescriptor>;
  /** The door and the token exchange, as the prepare command runs them. */
  readonly prepare: (input: {
    readonly httpBaseUrl: string;
    readonly doorToken: string;
    readonly expectedProjectId?: string;
  }) => Promise<AtomCommandResult<FakeMateCredential, unknown>>;
  /** The socket's verdict on a credential: rejected once the session was revoked. */
  readonly socket: (credential: FakeMateCredential) => FakeMateLink;
  /** Every credential issued so far is rejected (`blocked(authentication)`) from now on. */
  readonly revokeSessions: () => void;
  /** The socket blocks every credential on this reason until it is set back to null. */
  readonly blockSockets: (reason: ConnectionBlockedReason | null) => void;
}

export interface FakeMateOptions {
  readonly origin: string;
  readonly projectId: string;
  readonly environmentId: EnvironmentId;
  readonly serverVersion?: string;
  /** A 0.11.0 Mate: no `zerops.identity`, no `update`, no newer capabilities. */
  readonly oldServer?: boolean;
}

const OLD_SERVER_VERSION = "0.11.0";

export function makeFakeMate(options: FakeMateOptions): FakeMate {
  let environmentId = options.environmentId;
  let identity: { readonly value: "unknown" | "ok" | "failed"; readonly checkedAt: string } = {
    value: "ok",
    checkedAt: "2026-09-23T10:00:00.000Z",
  };
  let reachable = true;
  let revokedBelow = 0;
  let generation = 0;
  let blockedOn: ConnectionBlockedReason | null = null;
  let reads = 0;
  const script: Array<FakeDoorAnswer> = [];
  const calls: Array<{ readonly doorToken: string }> = [];
  const serverVersion = options.oldServer
    ? OLD_SERVER_VERSION
    : (options.serverVersion ?? "0.12.0");

  const descriptor = (): ExecutionEnvironmentDescriptor => ({
    environmentId,
    label: "zcp",
    platform: { os: "linux", arch: "x64" },
    serverVersion,
    capabilities: { repositoryIdentity: true },
    basePath: "/mate",
    zerops: options.oldServer
      ? { projectId: options.projectId }
      : {
          projectId: options.projectId,
          identity: identity.value,
          identityCheckedAt: identity.checkedAt,
        },
  });

  const unreachable = () =>
    new ConnectionTransientError({ reason: "network", detail: "The Mate did not answer." });

  return {
    origin: options.origin,
    projectId: options.projectId,
    descriptor,
    healthz: () => (reachable ? "ok" : "unreachable"),
    setReachable: (next) => {
      reachable = next;
    },
    redeploy: (next) => {
      environmentId = next;
    },
    setIdentity: (value, checkedAt) => {
      identity = { value, checkedAt };
    },
    scriptDoor: (...answers) => {
      script.push(...answers);
    },
    descriptorReads: () => reads,
    doorCalls: () => calls,
    readDescriptor: async () => {
      reads += 1;
      if (!reachable) throw unreachable();
      return descriptor();
    },
    prepare: (input) => {
      calls.push({ doorToken: input.doorToken });
      if (!reachable) return Promise.resolve(AsyncResult.failure(Cause.fail(unreachable())));
      const answer = script.shift() ?? "ok";
      switch (answer) {
        case "ok":
          generation += 1;
          return Promise.resolve(AsyncResult.success({ environmentId, generation }));
        case "500":
          return Promise.resolve(
            AsyncResult.failure(
              Cause.fail(
                new ConnectionTransientError({
                  reason: "remote-unavailable",
                  detail: "The environment could not authorize the connection.",
                }),
              ),
            ),
          );
        case "read-only":
        case "permission":
          return Promise.resolve(
            AsyncResult.failure(
              Cause.fail(new ConnectionBlockedError({ reason: answer, detail: "Not yours." })),
            ),
          );
        case "hang":
          return new Promise(() => undefined);
      }
    },
    socket: (credential) => {
      if (blockedOn !== null) return { phase: "blocked", reason: blockedOn };
      if (credential.environmentId !== environmentId) {
        return { phase: "blocked", reason: "configuration" };
      }
      return credential.generation <= revokedBelow
        ? { phase: "blocked", reason: "authentication" }
        : { phase: "connected" };
    },
    revokeSessions: () => {
      revokedBelow = generation;
    },
    blockSockets: (reason) => {
      blockedOn = reason;
    },
  };
}
