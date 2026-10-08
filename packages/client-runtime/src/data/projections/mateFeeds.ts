import {
  parseCrewHome,
  type CrewDefinition,
  type CrewDefinitionIssue,
} from "@t3tools/shared/crewHome";
import type { Known, FailureReason } from "../../zerops/knowledge/index.ts";
import {
  mateFeedId,
  mateFeedLink,
  mateFeedScope,
  type MateFeedFamily,
  type MateFeedKey,
  type MateFeedValues,
} from "../families/mateFeeds.ts";
import { sameValue } from "./equal.ts";
import type { Projection } from "../store.ts";
import type { StreamFault } from "../streamMachine.ts";
const failureOf = (fault: StreamFault): FailureReason =>
  fault.code === "unsupported"
    ? { kind: "unsupported", capability: fault.message }
    : fault.code === "malformed"
      ? { kind: "malformed", detail: fault.message }
      : fault.outcome === "definitive-refusal" ||
          fault.outcome === "authoritative-denial" ||
          fault.outcome === "access-unverified"
        ? { kind: "refused", code: fault.code ?? fault.outcome, words: fault.message }
        : { kind: "transport", detail: fault.message };
/** Coverage and freshness come from the stream; a missing payload never asserts a negative. */
const makeMateFeedProjection = <F extends MateFeedFamily>(
  family: F,
): Projection<MateFeedKey<F>, Known<MateFeedValues[F]>> => ({
  name: family,
  keyOf: mateFeedId,
  equals: sameValue,
  derive: (read, key) => {
    const fact = read.fact(family, mateFeedId(key));
    const source = read.stream(mateFeedScope(key));
    const stream = { ...source, fault: read.stream(mateFeedLink(key)).fault ?? source.fault };
    const retryAtMs = stream.next.kind === "retry" ? stream.next.at : null;
    const blocked =
      fact.kind === "withheld" ||
      stream.fault?.outcome === "authoritative-denial" ||
      stream.fault?.outcome === "access-unverified";
    if (blocked || (fact.kind !== "known" && stream.fault !== null))
      return {
        state: "failed",
        failure: failureOf(
          stream.fault ?? { outcome: "authoritative-denial", message: "Access denied." },
        ),
        atMs: 0,
        attempt: stream.failures,
        retryAtMs,
      };
    if (fact.kind === "known")
      return {
        state: "known",
        value: fact.value.snapshot as MateFeedValues[F],
        asOf: {
          ordinal: fact.revision.kind === "mate-link" ? fact.revision.sequence : 0,
          atMs: fact.value.observedAtMs,
        },
        coverage: read.coverage(mateFeedScope(key)) === "complete" ? "complete" : "partial",
        freshness:
          stream.phase === "live" ||
          (stream.mode === "once" && stream.phase === "paused" && stream.fault === null)
            ? { kind: stream.mode === "realtime" ? "live" : "settled" }
            : stream.phase === "baselining" || stream.phase === "connecting"
              ? { kind: "revalidating", sinceMs: 0 }
              : {
                  kind: "stale",
                  sinceMs: 0,
                  reason:
                    stream.fault === null || stream.fault.outcome === "transient"
                      ? { kind: "source-recovering", retryAtMs }
                      : {
                          kind: "revalidation-failed",
                          failure: failureOf(stream.fault),
                          attempt: stream.failures,
                          retryAtMs,
                        },
                },
      };
    return ["connecting", "baselining", "recovering", "reauthenticating"].includes(stream.phase)
      ? { state: "reading", sinceMs: 0, attempt: stream.generation }
      : { state: "unread", waitingFor: "mate-session" };
  },
});
const projections = new Map<
  MateFeedFamily,
  Projection<MateFeedKey, Known<MateFeedValues[MateFeedFamily]>>
>();
export function mateFeed<F extends MateFeedFamily>(
  family: F,
): Projection<MateFeedKey<F>, Known<MateFeedValues[F]>> {
  let projection = projections.get(family);
  if (projection === undefined) {
    projection = makeMateFeedProjection<MateFeedFamily>(family);
    projections.set(family, projection);
  }
  return projection as Projection<MateFeedKey<F>, Known<MateFeedValues[F]>>;
}
export const mateLifecycle = mateFeed("mateLifecycle");
export const agentLogin = mateFeed("mateAgentAuth");
export const mateCrew = mateFeed("mateCrew");
export const crewHomeFiles = mateFeed("mateCrewFiles");
export const terminalSession = mateFeed("mateTerminal");

/** Editors consume a parsed home; missing evidence never becomes an empty crew. */
export function crewHome(files: Known<MateFeedValues["mateCrewFiles"]>): {
  readonly definition: CrewDefinition | null;
  readonly issues: ReadonlyArray<CrewDefinitionIssue>;
} {
  if (files.state !== "known") return { definition: null, issues: [] };
  // The id only names the server directory and has no editor meaning.
  const parsed = parseCrewHome("crew", files.value.files);
  return { definition: parsed.definition ?? null, issues: parsed.issues };
}
