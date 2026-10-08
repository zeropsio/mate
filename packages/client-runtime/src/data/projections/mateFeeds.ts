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
import type { Coverage, PublicRead } from "../model.ts";
import type { StreamState } from "../streamMachine.ts";
import type { StreamFault } from "../streamMachine.ts";
/** The native result retains the same owner evidence as projection consumers. */
export type MateFeedReading<T> = Known<T> & {
  readonly evidence?: {
    readonly fact: PublicRead<{ readonly snapshot: T; readonly observedAtMs: number }>;
    readonly coverage: Coverage;
    readonly stream: StreamState;
  };
};
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
): Projection<MateFeedKey<F>, MateFeedReading<MateFeedValues[F]>> => ({
  name: family,
  keyOf: mateFeedId,
  equals: sameValue,
  derive: (read, key) => {
    const fact = read.fact(family, mateFeedId(key));
    const source = read.stream(mateFeedScope(key));
    const stream = { ...source, fault: read.stream(mateFeedLink(key)).fault ?? source.fault };
    let known: Known<MateFeedValues[F]>;
    const retryAtMs = stream.next.kind === "retry" ? stream.next.at : null;
    const blocked =
      fact.kind === "withheld" ||
      stream.fault?.outcome === "authoritative-denial" ||
      stream.fault?.outcome === "access-unverified";
    if (blocked || (fact.kind !== "known" && stream.fault !== null))
      known = {
        state: "failed",
        failure: failureOf(
          stream.fault ?? { outcome: "authoritative-denial", message: "Access denied." },
        ),
        atMs: 0,
        attempt: stream.failures,
        retryAtMs,
      };
    else if (fact.kind === "known")
      known = {
        state: "known",
        value: fact.value.snapshot as MateFeedValues[F],
        asOf: {
          ordinal: fact.revision.kind === "mate-link" ? fact.revision.sequence : 0,
          atMs: fact.value.observedAtMs,
        },
        coverage: read.coverage(mateFeedScope(key)) === "complete" ? "complete" : "partial",
        freshness:
          stream.fault === null &&
          (stream.phase === "live" || (stream.mode === "once" && stream.phase === "paused"))
            ? { kind: stream.mode === "realtime" ? "live" : "settled" }
            : stream.fault === null &&
                (stream.phase === "baselining" || stream.phase === "connecting")
              ? { kind: "revalidating", sinceMs: 0 }
              : {
                  kind: "stale",
                  sinceMs: 0,
                  reason:
                    stream.fault === null
                      ? { kind: "source-recovering", retryAtMs }
                      : {
                          kind: "revalidation-failed",
                          failure: failureOf(stream.fault),
                          attempt: stream.failures,
                          retryAtMs,
                        },
                },
      };
    else
      known = ["connecting", "baselining", "recovering", "reauthenticating"].includes(stream.phase)
        ? { state: "reading", sinceMs: 0, attempt: stream.generation }
        : { state: "unread", waitingFor: "mate-session" };
    return {
      ...known,
      evidence: {
        fact: fact as PublicRead<{
          readonly snapshot: MateFeedValues[F];
          readonly observedAtMs: number;
        }>,
        coverage: read.coverage(mateFeedScope(key)),
        stream,
      },
    };
  },
});
const projections = new Map<
  MateFeedFamily,
  Projection<MateFeedKey, MateFeedReading<MateFeedValues[MateFeedFamily]>>
>();
export function mateFeed<F extends MateFeedFamily>(
  family: F,
): Projection<MateFeedKey<F>, MateFeedReading<MateFeedValues[F]>> {
  let projection = projections.get(family);
  if (projection === undefined) {
    projection = makeMateFeedProjection<MateFeedFamily>(family);
    projections.set(family, projection);
  }
  return projection as Projection<MateFeedKey<F>, MateFeedReading<MateFeedValues[F]>>;
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
