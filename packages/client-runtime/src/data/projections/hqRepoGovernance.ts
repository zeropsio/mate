import type { HqRepoGovernance } from "@t3tools/shared/hqChanges";
import {
  repoGovernanceId,
  repoGovernanceLink,
  repoGovernanceScope,
  repoGovernanceSubject,
} from "../families/hqRepoGovernance.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { sameValue } from "./equal.ts";
import type { HqAppKey } from "./hqAppDetail.ts";

export type RepoGovernanceRead =
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly governance: HqRepoGovernance | null }
  | { readonly kind: "unavailable" };

export interface RepoGovernanceProjection {
  readonly wanted: boolean;
  readonly of: Readonly<Record<string, RepoGovernanceRead>>;
}

export function rulesForSubject(
  read: ProjectionReads,
  key: HqAppKey,
  subject: ReturnType<typeof repoGovernanceSubject>,
) {
  const fact = read.fact("hqRepoGovernance", repoGovernanceId(key));
  const stream = read.stream(repoGovernanceScope(key));
  // A failed GET faults this scope's dedicated settings link. A refusal also faults the scope.
  const fault = read.stream(repoGovernanceLink(key)).fault ?? stream.fault;
  const waiting: RepoGovernanceRead =
    fault !== null || stream.phase === "refused" ? { kind: "unavailable" } : { kind: "reading" };
  if (fact.kind !== "known")
    return {
      of: Object.fromEntries(subject.map(([name]) => [name, waiting] as const)),
      matches: false,
    };
  const held = new Map(fact.value.map((entry) => [entry.name, entry]));
  let matches = subject.length === held.size;
  const of = Object.fromEntries(
    subject.map(([name, url, synced]): [string, RepoGovernanceRead] => {
      const entry = held.get(name);
      if (entry?.url === url && entry.synced === synced)
        return [name, { kind: "read", governance: entry.governance }];
      matches = false;
      return [name, waiting];
    }),
  );
  return { of, matches };
}

export const hqRepoGovernance: Projection<HqAppKey, RepoGovernanceProjection> = {
  name: "hqRepoGovernance",
  keyOf: repoGovernanceId,
  derive: (read, key) => {
    const detail = read.fact("hqAppDetail", `${key.appId}/repos`);
    if (detail.kind !== "known") return { wanted: false, of: {} };
    const subject = repoGovernanceSubject(detail.value);
    return { wanted: subject.length > 0, of: rulesForSubject(read, key, subject).of };
  },
  equals: sameValue,
};
