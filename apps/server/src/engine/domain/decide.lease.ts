/**
 * Releasing the conversation's lease.
 *
 * @module engine/domain/decide.lease
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  type EffectOutcome,
  LeaseAlias,
  LeaseReleaseResult,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";

import type { StepBuilder } from "./decide.step.ts";

/**
 * Archiving is the person's word that the conversation's work is done: the branch of the lease it
 * is bound to goes back to its pool. zcp releases it only with nothing unsaved there (it never
 * forces), so a refusal keeps the binding and nothing is lost. A lease of no branch is kept: zcp
 * releases a branch, never one container.
 */
export const askLeaseRelease = (b: StepBuilder): void => {
  const lease = b.state.lease;
  if (lease === null || lease.branch === null) return;
  // One release at a time: archived again before it started, the one asked still runs.
  if (Object.values(b.state.effects).some((effect) => effect.kind === "lease.release")) return;
  b.effect(
    "lease.release",
    `${b.state.conversationId}/lease/${lease.alias}`,
    b.state.headSeq,
    null,
    {
      alias: lease.alias,
      branch: lease.branch,
      ...(lease.repo === undefined ? {} : { repo: lease.repo }),
    } satisfies LeaseReleasePayload,
  );
};

/** What a `lease.release` effect asks: the bound lease, and the branch (and repository) zcp releases. */
export interface LeaseReleasePayload {
  readonly alias: string;
  readonly branch: string;
  readonly repo?: string;
}

const decodeLeaseReleaseValue = Schema.decodeUnknownOption(
  Schema.Struct({ alias: LeaseAlias, branch: TrimmedNonEmptyString, result: LeaseReleaseResult }),
);

/**
 * The release's receipt; a release that went unbinds the conversation from the lease it named. An
 * outcome the handler never gave (the worker gave up on it) is a release not made, of the lease the
 * conversation is bound to; with none bound, the outcome alone records it.
 */
export const leaseReleaseSettled = (b: StepBuilder, outcome: EffectOutcome): void => {
  const value = outcome.kind === "ok" ? decodeLeaseReleaseValue(outcome.value) : Option.none();
  if (Option.isSome(value)) {
    const { alias, branch, result } = value.value;
    b.emit({ _tag: "LeaseReleaseSettled", alias, branch, result });
    // A release made only in part unbinds the conversation only when its own lease went.
    const went =
      result.outcome === "released" ||
      (result.outcome === "failed" &&
        result.released?.some((lease) => lease.lease === alias) === true);
    if (went && b.state.lease?.alias === alias) {
      b.emit({ _tag: "LeaseUnbound", alias });
    }
    return;
  }
  const lease = b.state.lease;
  if (lease === null || lease.branch === null) return;
  const reason =
    outcome.kind === "failed" || outcome.kind === "cut"
      ? outcome.reason
      : outcome.kind === "timed-out"
        ? `zcp did not answer the release within ${Math.round(outcome.after / 1000)} s`
        : "the release's answer could not be read";
  b.emit({
    _tag: "LeaseReleaseSettled",
    alias: lease.alias,
    branch: lease.branch,
    result: { outcome: "failed", reason },
  });
};
