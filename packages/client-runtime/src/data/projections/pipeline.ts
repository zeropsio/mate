/**
 * One pipeline as its read by id states it (`pipeline`): known, still being read, refused — the
 * platform has no such version this account can open — or answered with a row its family cannot
 * read. A read that keeps failing says so, retrying or stopped, rather than waiting on a clock.
 *
 * @module data/projections/pipeline
 */
import { pipelineScope, type PipelineValue } from "../families/pipeline.ts";
import type { Projection } from "../store.ts";
import { streamTrouble } from "../streamMachine.ts";
import { sameValue } from "./equal.ts";

export type PipelineRead =
  | { readonly kind: "known"; readonly value: PipelineValue }
  | { readonly kind: "reading" }
  /** The read keeps failing: retrying on its own, or stopped until the person asks again. */
  | { readonly kind: "trouble"; readonly trouble: "retrying" | "stopped" }
  /** Refused: Zerops has no such version, or none this account can open. */
  | { readonly kind: "missing" }
  /** Its one row answered, and the family could not read it. */
  | { readonly kind: "unreadable" };

export const pipelineRead: Projection<
  { readonly orgId: string; readonly versionId: string },
  PipelineRead
> = {
  name: "pipelineRead",
  keyOf: ({ orgId, versionId }) => `${orgId}/${versionId}`,
  derive: (read, { orgId, versionId }) => {
    const fact = read.fact("pipeline", versionId);
    if (fact.kind === "known") return { kind: "known", value: fact.value };
    const scope = pipelineScope(orgId, versionId);
    const stream = read.stream(scope);
    if (stream.phase === "refused") return { kind: "missing" };
    if (read.coverage(scope) === "partial") return { kind: "unreadable" };
    const trouble = streamTrouble(stream);
    return trouble === null ? { kind: "reading" } : { kind: "trouble", trouble };
  },
  equals: sameValue,
};
