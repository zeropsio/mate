import type { ZeropsDataState } from "./state.ts";
import type {
  CollectionRead,
  CommandAttemptRef,
  CommandAttemptState,
  DesiredInterestState,
  EntityKnowledge,
  EntityRead,
  InterestState,
  ProjectKey,
  ProjectRecord,
  ProjectRef,
  ProjectTopologyRead,
  ServiceRecord,
  ServiceRef,
  ViewObservation,
} from "./types.ts";
import { projectKeyOf, queryKeyOf, serviceKeyOf } from "./types.ts";

type Interests = ZeropsDataState["interests"];
type InterestsOfView = Pick<ViewObservation, "required" | "optional">;

/**
 * The interests one view observes, by project: a project's own interests and those of no project
 * (an organization's inventory), in the order the state holds them. Every project's view is read on
 * each publication, so the interests are indexed once per interests map, not once per project.
 */
interface InterestIndex {
  /** In state order. */
  readonly interests: ReadonlyArray<DesiredInterestState>;
  /** The positions of each project's own interests, and under `null` those of no project. */
  readonly positions: ReadonlyMap<ProjectKey | null, ReadonlyArray<number>>;
  /** The views already read, by project key; `undefined` for the view of every interest. */
  readonly views: Map<ProjectKey | undefined, InterestsOfView>;
}

const interestIndexes = new WeakMap<Interests, InterestIndex>();

function interestIndexOf(interests: Interests): InterestIndex {
  const held = interestIndexes.get(interests);
  if (held !== undefined) return held;
  const ordered: Array<DesiredInterestState> = [];
  const positions = new Map<ProjectKey | null, Array<number>>();
  for (const desired of interests.values()) {
    const descriptor = desired.descriptor;
    const key = "project" in descriptor ? projectKeyOf(descriptor.project) : null;
    const position = ordered.length;
    ordered.push(desired);
    const atKey = positions.get(key);
    if (atKey === undefined) positions.set(key, [position]);
    else atKey.push(position);
  }
  const index: InterestIndex = { interests: ordered, positions, views: new Map() };
  interestIndexes.set(interests, index);
  return index;
}

function interestsOfView(index: InterestIndex, project: ProjectKey | undefined): InterestsOfView {
  const held = index.views.get(project);
  if (held !== undefined) return held;
  const own = project === undefined ? [] : (index.positions.get(project) ?? []);
  const unscoped = project === undefined ? [] : (index.positions.get(null) ?? []);
  const required: InterestState[] = [];
  const optional: InterestState[] = [];
  const take = (position: number) => {
    const desired = index.interests[position]!;
    (desired.required ? required : optional).push(desired.interest);
  };
  if (project === undefined) {
    index.interests.forEach((_, position) => take(position));
  } else {
    // Both position lists are ascending: merged, they keep the state's order.
    let o = 0;
    let u = 0;
    while (o < own.length || u < unscoped.length) {
      if (u >= unscoped.length || (o < own.length && own[o]! < unscoped[u]!)) take(own[o++]!);
      else take(unscoped[u++]!);
    }
  }
  const view = { required, optional };
  index.views.set(project, view);
  return view;
}

const observationOf = (state: ZeropsDataState, project?: ProjectRef): ViewObservation => ({
  ...interestsOfView(
    interestIndexOf(state.interests),
    project === undefined ? undefined : projectKeyOf(project),
  ),
  access: state.access,
});

const projectKnowledge = (
  record: ProjectRecord | undefined,
  ref: ProjectRef,
): EntityKnowledge<ProjectRecord> => {
  if (record === undefined) return { knowledge: "unresolved", ref };
  if (record.identity.knowledge === "unavailable") {
    return {
      knowledge: "unavailable",
      ref,
      reason: record.identity.reason,
      since: record.identity.stamp,
    };
  }
  if (record.identity.knowledge === "observed" && record.lifecycle.knowledge === "observed") {
    return { knowledge: "observed", record };
  }
  return { knowledge: "unresolved", ref };
};

const serviceKnowledge = (
  record: ServiceRecord | undefined,
  ref: ServiceRef,
): EntityKnowledge<ServiceRecord> => {
  if (record === undefined) return { knowledge: "unresolved", ref };
  if (record.identity.knowledge === "unavailable") {
    return {
      knowledge: "unavailable",
      ref,
      reason: record.identity.reason,
      since: record.identity.stamp,
    };
  }
  if (record.identity.knowledge === "observed" && record.lifecycle.knowledge === "observed") {
    return { knowledge: "observed", record };
  }
  return { knowledge: "unresolved", ref };
};

export const selectProject = (
  state: ZeropsDataState,
  ref: ProjectRef,
): EntityRead<ProjectRecord> => ({
  value: projectKnowledge(state.inventory.projects.get(projectKeyOf(ref)), ref),
  observation: observationOf(state, ref),
});

/** One service: its record as the account's store holds it (`serviceBridge.ts`). */
export const selectService = (
  state: ZeropsDataState,
  ref: ServiceRef,
  record: ServiceRecord | undefined,
): EntityRead<ServiceRecord> => ({
  value: serviceKnowledge(record, ref),
  observation: observationOf(state, ref.project),
});

/** A project's topology: its services as the account's store holds them (`serviceBridge.ts`). */
export function selectTopology(
  state: ZeropsDataState,
  project: ProjectRef,
  services: CollectionRead<ServiceRecord>,
): ProjectTopologyRead {
  const projectRead = selectProject(state, project);
  return {
    project: projectRead,
    services,
    observation: observationOf(state, project),
  };
}

export const selectCommandAttempt = (
  state: ZeropsDataState,
  attempt: CommandAttemptRef,
): CommandAttemptState | null => {
  if (
    attempt.accountEpoch !== state.scope.epoch ||
    attempt.account.apiOrigin !== state.scope.account.apiOrigin ||
    attempt.account.accountId !== state.scope.account.accountId
  )
    return null;
  return state.commands.get(attempt.attemptId) ?? null;
};
