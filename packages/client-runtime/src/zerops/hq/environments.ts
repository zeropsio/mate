/**
 * An application's stage and production as HQ's structure carries them (SPEC §3.2b): each
 * environment's record — its project, tier, name, the branches it follows, its place in the order
 * they were declared, whether HQ holds a working deploy token for it — and, per service, its
 * newest deploy and the newest that went live. HQ sends them to whoever may read the application's
 * changes (`read_change`); one who only sees the application gets none.
 *
 * Decoded here against `apps/hq/src/structure.ts`'s `EnvironmentView` until the contract moves to
 * `@t3tools/shared`; a set this build cannot read is not known, and never takes the structure
 * beside it down.
 *
 * @module hq/environments
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** A deploy of a service of an environment, as HQ's record holds it. */
export const HqDeploy = Schema.Struct({
  sha: Schema.String,
  state: Schema.Literals(["pending", "deploying", "live", "failed"]),
  /** Whose failure: the build's own (`job`, final) or HQ's (`refused`, asked again); none else. */
  failure: Schema.NullOr(Schema.Literals(["job", "refused"])),
  message: Schema.NullOr(Schema.String),
  /** The platform's version and job it is read by: its log. */
  appVersionId: Schema.NullOr(Schema.String),
  processId: Schema.NullOr(Schema.String),
  /** Who last asked for it again ("Run again"); none while only HQ asked. */
  requestedBy: Schema.NullOr(Schema.String),
  /** When it last changed, ISO 8601. */
  at: Schema.String,
});
export type HqDeploy = typeof HqDeploy.Type;

export const HqEnvironment = Schema.Struct({
  projectId: Schema.String,
  tier: Schema.Literals(["stage", "production"]),
  name: Schema.String,
  /** The branches it follows: a stage `main`, a production `release`. */
  sources: Schema.Array(Schema.String),
  /** Its place among the application's environments, in the order they were declared: from 1. */
  order: Schema.Number,
  /** Whether HQ holds its deploy token; the token itself is never answered. */
  keyHeld: Schema.Boolean,
  /** Whether the token held no longer answers, or reaches more than its project. */
  keyInvalid: Schema.Boolean,
  /** Per service, by its hostname: its newest deploy, and the newest that went live. */
  deploys: Schema.Array(
    Schema.Struct({ service: Schema.String, latest: HqDeploy, live: Schema.NullOr(HqDeploy) }),
  ),
});
export type HqEnvironment = typeof HqEnvironment.Type;

const readEnvironments = Schema.decodeUnknownOption(Schema.Array(HqEnvironment));

/** An application's environments as HQ sent them; `undefined` where it sent none it can read. */
export function environmentsOf(value: unknown): ReadonlyArray<HqEnvironment> | undefined {
  return Option.getOrUndefined(readEnvironments(value));
}
