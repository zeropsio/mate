/**
 * The flow's verbs as command attempts (DESIGN §4.9, §4.7 "Verbs", §2.D D8): Merge, Release and
 * Roll back, each keyed by its target, so a refusal on one pull request or group never shows on
 * another.
 *
 * ```
 *  requested ─[capability waitable]─► awaiting-capability (≤ 30 s) ─allowed─► pending
 *  requested ─[allowed]─► pending ─accepted─► accepted, and what it changed is read again
 *                          pending ─Gitea's no─► refused(its words)
 *                          pending ─answer lost after a possible write─► uncertain, read again
 *  awaiting-capability ─wait ran out, or nothing can bring it─► refused(capability, retryable)
 * ```
 *
 * - The capability is the Gitea session's (§4.3 `forge(origin)`), asked before the attempt and
 *   again before each write of a compound command; waiting for it never counts against a write.
 * - Settlement invalidates exactly what the verb changed: a merge, its repository and the stage
 *   deployments that repository's `main` feeds; a release or a roll back, the group repo.
 * - A write is never sent twice: a second press while one runs is the same attempt, and an
 *   attempt whose answer was lost is `uncertain`, never retried.
 *
 * @module flow/flowCommands
 */
import {
  CapabilityRefusal,
  CAPABILITY_WAIT_MS,
  type Capability,
} from "../data/access/capabilities.ts";
import type { GrantCapability } from "../data/access/grant.ts";
import type { ServiceRef } from "../data/types.ts";
import { GiteaApiError, type GiteaClient } from "../giteaClient.ts";
import type { Invalidation } from "../knowledge/invalidation.ts";
import { flowVerbKey, GROUP_REPOSITORY } from "../projectFlow.ts";
import { RELEASE_NOT_A_RELEASER, rollbackTo } from "../release.ts";

export type FlowCommand =
  | {
      readonly kind: "merge";
      readonly origin: string;
      /** The group's Gitea org. */
      readonly slug: string;
      readonly repository: string;
      readonly number: number;
      /** The stage services the repository's `main` deploys to (`GroupFlow.feeds`). */
      readonly feeds: ReadonlyArray<ServiceRef>;
    }
  | {
      readonly kind: "release";
      readonly origin: string;
      readonly slug: string;
      readonly groupId: string;
      /** The tag the offer suggested, and the message listing what it releases. */
      readonly tag: string;
      readonly message: string;
    }
  | {
      readonly kind: "roll-back";
      readonly origin: string;
      readonly slug: string;
      readonly groupId: string;
      /** The earlier release whose commits are released again. */
      readonly tag: string;
    };

export type FlowRefusal =
  /** The Gitea session does not allow it now; asking again later may find it. */
  | {
      readonly kind: "capability";
      readonly reason: Refused["reason"];
      readonly retryable: boolean;
      readonly words: string;
    }
  /** Gitea's own no, before anything was written or to the write itself. */
  | { readonly kind: "gitea"; readonly status: number | null; readonly words: string }
  /** What the verb acts on is not there to act on. */
  | { readonly kind: "nothing-to-do"; readonly words: string };

export type FlowAttempt =
  | { readonly phase: "awaiting-capability" }
  | { readonly phase: "pending" }
  | { readonly phase: "accepted" }
  | { readonly phase: "refused"; readonly refusal: FlowRefusal }
  | { readonly phase: "uncertain"; readonly words: string };

export const FLOW_COMMAND_UNCERTAIN = "Check the project before trying again.";
const GITEA_NOT_SIGNED_IN = "Gitea isn't signed in right now.";
const GITEA_SILENT = "Gitea didn't answer.";
const NO_MAIN_TO_TAG = "The group repository has no main to tag.";

export interface FlowCommandPorts {
  /** The Gitea session's capability now (`GiteaSessions.capability`). */
  readonly capability: (origin: string) => Capability;
  /** Told when the sessions change: the moment to ask the capability again. */
  readonly subscribe: (listener: () => void) => () => void;
  readonly clientFor: (origin: string) => GiteaClient | null;
  readonly invalidate: (invalidation: Invalidation) => void;
  /** Arms a timer; the returned function disarms it. */
  readonly setTimer: (delayMs: number, fire: () => void) => () => void;
}

export interface FlowCommands {
  /** Runs the verb, or joins the attempt already running on its target; answers how it settled. */
  readonly run: (command: FlowCommand) => Promise<FlowAttempt>;
  /** The latest attempt on the command's target; `null` before the first. */
  readonly attempt: (command: FlowCommand) => FlowAttempt | null;
  /** Told the key of every target whose attempt changed. */
  readonly subscribe: (listener: (key: string) => void) => () => void;
  /** The account closed: waits end refused; writes in flight finish and settle unheard. */
  readonly dispose: () => void;
}

/** What a settled verb changed at its source (§4.7 "Verbs"). */
export function flowCommandInvalidations(command: FlowCommand): ReadonlyArray<Invalidation> {
  switch (command.kind) {
    case "merge":
      return [
        {
          topic: "forge-repo",
          origin: command.origin,
          owner: command.slug,
          repo: command.repository,
        },
        ...command.feeds.map((service): Invalidation => ({ topic: "deployment", service })),
      ];
    case "release":
    case "roll-back":
      return [
        {
          topic: "forge-repo",
          origin: command.origin,
          owner: command.slug,
          repo: GROUP_REPOSITORY,
        },
      ];
  }
}

type Refused = Extract<Capability, { readonly allowed: false }>;

/** A refusal of the grant's, which `CapabilityRefusal` words; the rest are a session's. */
const isGrantRefusal = (
  capability: Refused,
): capability is Extract<GrantCapability, { readonly allowed: false }> =>
  capability.reason !== "gitea-session" && capability.reason !== "mate-not-connected";

function capabilityRefusal(capability: Refused) {
  const words = isGrantRefusal(capability)
    ? new CapabilityRefusal(capability).message
    : GITEA_NOT_SIGNED_IN;
  return {
    phase: "refused",
    refusal: {
      kind: "capability",
      reason: capability.reason,
      retryable: capability.reason !== "epoch-closed",
      words,
    },
  } as const;
}

/** A write's failure: Gitea's no is a refusal; no answer, or a server that broke, may have written. */
function writeSettled(cause: unknown, words: (error: GiteaApiError) => string): FlowAttempt {
  if (cause instanceof GiteaApiError && cause.status < 500) {
    return {
      phase: "refused",
      refusal: { kind: "gitea", status: cause.status, words: words(cause) },
    };
  }
  return { phase: "uncertain", words: FLOW_COMMAND_UNCERTAIN };
}

/** A read before the write failed: nothing was written. */
function readRefused(cause: unknown): FlowAttempt {
  return {
    phase: "refused",
    refusal:
      cause instanceof GiteaApiError
        ? { kind: "gitea", status: cause.status, words: cause.detail ?? cause.message }
        : { kind: "gitea", status: null, words: GITEA_SILENT },
  };
}

const nothingToDo = (words: string): FlowAttempt => ({
  phase: "refused",
  refusal: { kind: "nothing-to-do", words },
});

export function makeFlowCommands(ports: FlowCommandPorts): FlowCommands {
  const attempts = new Map<string, FlowAttempt>();
  const running = new Map<string, Promise<FlowAttempt>>();
  const listeners = new Set<(key: string) => void>();
  /** Every capability wait still open, ended at once by `dispose`. */
  const waits = new Set<() => void>();
  let disposed = false;

  const set = (key: string, attempt: FlowAttempt): void => {
    attempts.set(key, attempt);
    for (const listener of listeners) listener(key);
  };

  /** Allowed now, or once the session allows it within the wait; otherwise why not. */
  const admitted = (origin: string): Promise<Capability> => {
    const now = ports.capability(origin);
    if (now.allowed || !now.waitable || disposed) return Promise.resolve(now);
    return new Promise((resolve) => {
      const finish = () => {
        waits.delete(end);
        unsubscribe();
        disarm();
        resolve(disposed ? { allowed: false, reason: "epoch-closed", waitable: false } : check());
      };
      const check = () => ports.capability(origin);
      const end = () => finish();
      waits.add(end);
      const unsubscribe = ports.subscribe(() => {
        const next = check();
        if (next.allowed || !next.waitable) finish();
      });
      const disarm = ports.setTimer(CAPABILITY_WAIT_MS, finish);
    });
  };

  /** A client for the next write, or the refusal that stands in its way. */
  const clientForWrite = (origin: string): GiteaClient | FlowAttempt => {
    const capability = ports.capability(origin);
    if (!capability.allowed) return capabilityRefusal(capability);
    return (
      ports.clientFor(origin) ??
      capabilityRefusal({ allowed: false, reason: "gitea-session", waitable: true })
    );
  };

  const tag = async (
    command: Extract<FlowCommand, { readonly kind: "release" | "roll-back" }>,
    client: GiteaClient,
    name: string,
    message: string,
  ): Promise<FlowAttempt> => {
    let target: string | undefined;
    try {
      target = (await client.getBranch(command.slug, GROUP_REPOSITORY, "main"))?.commit?.id;
    } catch (cause) {
      return readRefused(cause);
    }
    if (target === undefined) return nothingToDo(NO_MAIN_TO_TAG);
    // A compound command asks again before its write (§4.9).
    const writer = clientForWrite(command.origin);
    if (!("createTag" in writer)) return writer;
    try {
      await writer.createTag(command.slug, GROUP_REPOSITORY, { tag: name, target, message });
      return { phase: "accepted" };
    } catch (cause) {
      return writeSettled(cause, (error) =>
        error.status === 403 ? RELEASE_NOT_A_RELEASER : "Gitea would not create the tag.",
      );
    }
  };

  const act = async (command: FlowCommand, client: GiteaClient): Promise<FlowAttempt> => {
    switch (command.kind) {
      case "merge":
        try {
          await client.mergePullRequest(command.slug, command.repository, command.number);
          return { phase: "accepted" };
        } catch (cause) {
          return writeSettled(
            cause,
            (error) => `Gitea would not merge it: ${error.detail ?? error.message}`,
          );
        }
      case "release":
        return tag(command, client, command.tag, command.message);
      case "roll-back": {
        let tags;
        try {
          tags = await client.listTags(command.slug, GROUP_REPOSITORY);
        } catch (cause) {
          return readRefused(cause);
        }
        const earlier = tags.find((entry) => entry.name === command.tag);
        const plan =
          earlier === undefined
            ? undefined
            : rollbackTo({
                tag: earlier.name,
                message: earlier.message ?? "",
                existingTags: tags.map((entry) => entry.name),
              });
        if (plan === undefined) {
          return nothingToDo(`${command.tag} does not list commits this build can read.`);
        }
        return tag(command, client, plan.tag, plan.message);
      }
    }
  };

  const attemptOf = async (key: string, command: FlowCommand): Promise<FlowAttempt> => {
    if (!ports.capability(command.origin).allowed) set(key, { phase: "awaiting-capability" });
    const capability = await admitted(command.origin);
    if (!capability.allowed) return capabilityRefusal(capability);
    const client = clientForWrite(command.origin);
    if (!("mergePullRequest" in client)) return client;
    set(key, { phase: "pending" });
    const settled = await act(command, client);
    if (!disposed && (settled.phase === "accepted" || settled.phase === "uncertain")) {
      for (const invalidation of flowCommandInvalidations(command)) ports.invalidate(invalidation);
    }
    return settled;
  };

  return {
    run: (command) => {
      const key = flowVerbKey(command);
      const inFlight = running.get(key);
      if (inFlight !== undefined) return inFlight;
      if (disposed) {
        return Promise.resolve(
          capabilityRefusal({ allowed: false, reason: "epoch-closed", waitable: false }),
        );
      }
      const settled = attemptOf(key, command).then((attempt) => {
        running.delete(key);
        if (!disposed) set(key, attempt);
        return attempt;
      });
      running.set(key, settled);
      return settled;
    },
    attempt: (command) => attempts.get(flowVerbKey(command)) ?? null,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const end of waits) end();
      listeners.clear();
    },
  };
}
