/**
 * What a stop runs, from its services (`stopDeploymentOf`), which every surface reads (DESIGN
 * §4.7).
 *
 * Pure (§7.2 rule 3): no network, no clock, no platform globals.
 *
 * @module flow/groupFlow
 */
import type { Freshness, Shown, Stamp } from "../knowledge/known.ts";
import type { KnowledgeSource } from "../knowledge/presentation.ts";
import type { Deployment, StopService } from "./deployment.ts";

/** An input and who answers for it, as a combination names the cause of one that failed. */
interface Part {
  readonly shown: Shown<unknown>;
  readonly source: KnowledgeSource;
}

/** The worst freshness first: a combination is as current as its least current part. */
const FRESHNESS_RANK: Record<Freshness["kind"], number> = {
  live: 0,
  settled: 1,
  revalidating: 2,
  paused: 3,
  stale: 4,
};

/** Which non-known state a combination takes: withheld, then failed, gone, reading, unread. */
const STATE_RANK: Record<Exclude<Shown<unknown>["state"], "known">, number> = {
  withheld: 0,
  failed: 1,
  gone: 2,
  reading: 3,
  unread: 4,
};

/**
 * Several inputs as one: known with the worst freshness and the narrowest coverage when every
 * part is, else the most telling part that is not, with the source that answers for it.
 */
function combine(parts: ReadonlyArray<Part>): {
  readonly shown: Shown<null>;
  readonly source: KnowledgeSource;
} {
  let blocking: Part | null = null;
  let freshness: Freshness = { kind: "live" };
  let asOf: Stamp = { ordinal: 0, atMs: 0 };
  let complete = true;
  let source: KnowledgeSource = "zerops";
  for (const part of parts) {
    const shown = part.shown;
    if (shown.state !== "known") {
      if (
        blocking === null ||
        STATE_RANK[shown.state] < STATE_RANK[blocking.shown.state as keyof typeof STATE_RANK]
      ) {
        blocking = part;
      }
      continue;
    }
    if (FRESHNESS_RANK[shown.freshness.kind] > FRESHNESS_RANK[freshness.kind]) {
      freshness = shown.freshness;
      source = part.source;
    }
    if (shown.asOf.ordinal > asOf.ordinal) asOf = shown.asOf;
    complete &&= shown.coverage === "complete";
  }
  if (blocking !== null) {
    return { shown: blocking.shown as Shown<never>, source: blocking.source };
  }
  return {
    shown: {
      state: "known",
      value: null,
      asOf,
      coverage: complete ? "complete" : "partial",
      freshness,
    },
    source,
  };
}

/** `value` under the combination's state, when it is known. */
function withValue<T>(combined: Shown<null>, value: () => T): Shown<T> {
  return combined.state === "known" ? { ...combined, value: value() } : combined;
}

const isKnown = <T>(shown: Shown<T>): shown is Extract<Shown<T>, { readonly state: "known" }> =>
  shown.state === "known";

/**
 * What a stop runs, from its services: the first deploying one by hostname, else the first
 * running one, else the first that is not known, else none — which only services that each run
 * none prove.
 */
export function stopDeploymentOf(services: Shown<ReadonlyArray<StopService>>): Shown<Deployment> {
  if (!isKnown(services)) return services as Shown<never>;
  const first = (kind: Deployment["kind"]) =>
    services.value.find(
      ({ deployment }) => deployment.state === "known" && deployment.value.kind === kind,
    );
  const answer = first("deploying") ?? first("running");
  if (answer !== undefined) return answer.deployment;
  const combined = combine([
    { shown: services, source: "zerops" },
    ...services.value.map(({ deployment }) => ({ shown: deployment, source: "zerops" as const })),
  ]);
  return withValue(combined.shown, (): Deployment => ({ kind: "none" }));
}

/**
 * How many of the newest releases the flow lists, each with HQ's verdict on it (D5): as many as
 * HQ answers (`@t3tools/shared/hqRelease`).
 */
export const RELEASES_SHOWN = 10;
