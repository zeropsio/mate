/**
 * Reads every project's flow once for the whole account, and holds the verbs
 * that move it (`projectFlowContext.ts`, D26).
 *
 * Each part is read from the party that can prove it. HQ says which of a
 * group's projects are its stage and production, and how each deploy of
 * theirs went (`hqEnvironmentsAtom`), and what is waiting to land and what
 * landed — its Mates' changes (`hqChangesAtom`) — both down the
 * organization's stream; its recipe says which tiers a group can add and the
 * repository each runtime builds from (`useZeropsAppRecipes`). The account
 * says which projects a group holds and which version each service runs, as
 * its store states it, and Gitea says what was released
 * (`useZeropsGroupForge`). Each group's flow is the same object until one of
 * its own parts changes, so one group answering never republishes another.
 *
 * Release is not offered: its offer moves to HQ next, and until then the
 * gate says so. What each stop runs is the account's deployment store's
 * answer (`flow/deploymentStore.ts`). A change is merged and closed in HQ, as
 * the person, and comes back down HQ's stream.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  botDisplayName,
  deployedCommit,
  environmentRow,
  flowChanges,
  flowVerbKey,
  groupStopsOf,
  releaseRunBy,
  nameStopByRelease,
  readZeropsMembership,
  releaseDeploys,
  releaseInFlight,
  releaseRow,
  rollbackTo,
  suggestReleaseTags,
  summarizeEnvironmentServices,
  GROUP_REPOSITORY,
  type EnvironmentRow,
  type FlowPullRequest,
  type FlowRelease,
  type GroupEnvironmentRowInput,
  type GroupStopProject,
  type GroupStops,
  type FlowVerb,
} from "@t3tools/client-runtime/zerops";
import { HQ_NOT_OPEN, hqRefusalWords, type HqApi } from "@t3tools/client-runtime/zerops/hq";
import { flowVerbInvalidations, type Deployment } from "@t3tools/client-runtime/zerops/flow";
import { ZeropsServiceId } from "@t3tools/client-runtime/zerops/data";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { mateDiagnostics } from "@t3tools/client-runtime/zerops/diagnostics";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { zeropsThrowawayPlatform } from "@t3tools/client-runtime/zerops/doorThrowaway";
import type { ChangeLink, HqChange } from "@t3tools/shared/hqChanges";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { hqChangesAtom, hqEnvironmentsAtom, hqStructureAtom } from "../state/zerops";
import { useStopDeployments } from "./accountForge";
import { accountHqApi, useAccountHq } from "./accountHq";
import { useAccountGitea } from "./giteaProject";
import { giteaClientFor, useGiteaSession } from "./accountGiteaSessions";
import {
  ZeropsProjectFlowContext,
  type FlowVerbOutcome,
  type ZeropsProjectFlow,
  type ZeropsProjectFlowValue,
} from "./projectFlowContext";
import { useNowMs } from "./useNowMs";
import { useZeropsAtomSelections, ZeropsDataContext } from "./zeropsDataContext";
import { useZeropsAppRecipes } from "./useZeropsAppRecipes";
import {
  useZeropsGroupForge,
  type ZeropsGroupForgeState,
  type ZeropsGroupForges,
} from "./useZeropsGroupForge";
import { useZeropsRegistry } from "./useZeropsRegistry";
import {
  HeldInventoryContext,
  inventoryProjectRefKey,
  projectAuthority,
  withheldProjectNotice,
} from "./inventoryContext";
import { useZeropsInventory } from "./ZeropsInventoryProvider";
import { useZeropsSession } from "./ZeropsSessionProvider";

const EMPTY_FLOWS: ReadonlyMap<string, ZeropsProjectFlow> = new Map();
const EMPTY_SLUGS: ReadonlyMap<string, string> = new Map();
/** What a verb says when it is pressed while the flows stand and no Gitea token is held. */
const SIGNING_IN_AGAIN = "Signing in to Gitea again. Try it again in a moment.";
/** How long a verb whose call landed stays pending while the flow has not read its effect back. */
export const HELD_VERB_MS = 30_000;
/** What a second press of a verb that is still running says: the first one is the one that counts. */
export const VERB_ALREADY_RUNNING = "It is already on its way.";

const refused = (reason: string): FlowVerbOutcome => ({ ok: false, reason });

/** A change's verb, merge or close, which HQ answers. */
type ChangeVerb = Extract<FlowVerb, { readonly kind: "merge" | "close" }>;

/** What a merge refused for a head nobody was shown says: HQ's own words for it. */
const HEAD_NOT_SHOWN = hqRefusalWords({ code: "conflict", reason: "head_moved" });

/**
 * A verb whose call landed, waiting until its effect is read: a tag, for any forge answer of its
 * group after the one it landed against; a change merged or closed, for HQ's stream to no longer
 * hold it open.
 */
interface HeldVerb {
  readonly groupId: string;
  readonly against:
    | { readonly kind: "forge"; readonly answer: ZeropsGroupForgeState | undefined }
    | { readonly kind: "change"; readonly repository: string; readonly number: number };
  readonly sinceMs: number;
}

/** Whether the held verb's effect is read, or its group's forge can no longer say. */
function effectRead(
  held: HeldVerb,
  forge: ZeropsGroupForgeState | undefined,
  failed: boolean,
  flow: ZeropsProjectFlow | undefined,
): boolean {
  const { against } = held;
  if (against.kind === "forge") return failed || forge !== against.answer;
  return !(
    flow?.pullRequests.some(
      (pull) => pull.repository === against.repository && pull.number === against.number,
    ) ?? false
  );
}

/** One group's changes as its flow shows them: the open ones a push reached, and the landed. */
export interface GroupChanges {
  readonly pullRequests: ReadonlyArray<FlowPullRequest>;
  readonly merged: ReadonlyArray<FlowPullRequest>;
}

/** A group HQ holds no change of. */
const NO_CHANGES: GroupChanges = { pullRequests: [], merged: [] };

/**
 * Each application's changes as rows, by the identity of its changes as HQ last sent them, so an
 * application nothing came down for keeps its rows.
 */
const changeRows = new WeakMap<ReadonlyArray<HqChange>, Map<string, GroupChanges>>();

/** Every application's changes as its group's flow shows them, at HQ's official address. */
function groupChangesOf(
  changes: ReadonlyMap<string, ReadonlyArray<HqChange>>,
  hqAddress: string,
): ReadonlyMap<string, GroupChanges> {
  const byGroup = new Map<string, GroupChanges>();
  for (const [appId, list] of changes) {
    let byAddress = changeRows.get(list);
    if (byAddress === undefined) {
      byAddress = new Map();
      changeRows.set(list, byAddress);
    }
    let rows = byAddress.get(hqAddress);
    if (rows === undefined) {
      rows = flowChanges({ changes: list, hqAddress });
      byAddress.set(hqAddress, rows);
    }
    byGroup.set(appId, rows);
  }
  return byGroup;
}

/** What the flow says while HQ has never told it any change, and does not answer. */
export const HQ_CHANGES_UNANSWERED = "HQ is not answering right now.";

/** The newest landed change of an application's recipe: what `main`'s tiers may have moved with. */
function recipeRevision(changes: ReadonlyArray<HqChange> | undefined): string | undefined {
  let newest: HqChange | undefined;
  for (const change of changes ?? []) {
    if (change.repo !== RECIPE_REPO || change.mergedAt === null) continue;
    if (newest?.mergedAt == null || change.mergedAt > newest.mergedAt) newest = change;
  }
  return newest?.mergedSha ?? undefined;
}

/** Each group's stops as last built, with the content they were built from. */
const builtStops = new Map<string, { readonly key: string; readonly stops: GroupStops }>();

/**
 * A group's stops: the same object for as long as what they are built from reads the same, so one
 * group's change never republishes another's flow.
 */
function groupStopsFor(groupId: string, input: Parameters<typeof groupStopsOf>[0]): GroupStops {
  const { recipe } = input;
  const key = JSON.stringify([
    input.environments,
    input.projects,
    [...input.versions],
    recipe === undefined ? null : [recipe.tiers, [...recipe.repositories]],
  ]);
  const before = builtStops.get(groupId);
  if (before?.key === key) return before.stops;
  const stops = groupStopsOf(input);
  builtStops.set(groupId, { key, stops });
  return stops;
}

/** What *Release* says while its offer is not built: it moves to HQ next. */
export const RELEASE_MOVES_TO_HQ = "Releases move to HQ next; none is offered until then.";

/** Stands for a part a group has no answer for, as a key of {@link joinedFlows}. */
const UNREAD_HALF = {};

/**
 * Every group's flow, by the identity of its parts: a group whose parts did not
 * change keeps its flow object.
 */
const joinedFlows = new WeakMap<
  object,
  WeakMap<object, WeakMap<object, Map<string, ZeropsProjectFlow>>>
>();

/**
 * Joins each group's parts into its flow. A group is shown once any part
 * answered.
 */
export function joinProjectFlows(input: {
  readonly groups: ReadonlyArray<{ readonly groupId: string; readonly slug: string }>;
  /** Each group's stops, by its id, while HQ has told its environments. */
  readonly stops: ReadonlyMap<string, GroupStops>;
  readonly forges: ZeropsGroupForges;
  /** Each group's changes, by its id; `null` while HQ has told nothing of them. */
  readonly changes: ReadonlyMap<string, GroupChanges> | null;
  /** Why HQ has told nothing of them, while it does not answer. */
  readonly changesFailure: string | undefined;
  /** The clock a release in flight is bounded by (`releaseInFlight`). */
  readonly nowMs: number;
  /** Why the grant withholds a project, by project id, for each project it withholds alone. */
  readonly withheld: ReadonlyMap<string, string>;
}): ReadonlyMap<string, ZeropsProjectFlow> {
  const flows = new Map<string, ZeropsProjectFlow>();
  for (const group of input.groups) {
    const stops = input.stops.get(group.groupId);
    const forge = input.forges.get(group.groupId);
    const changes =
      input.changes === null ? undefined : (input.changes.get(group.groupId) ?? NO_CHANGES);
    if (stops === undefined && forge === undefined && changes === undefined) continue;
    let byForge = joinedFlows.get(stops ?? UNREAD_HALF);
    if (byForge === undefined) {
      byForge = new WeakMap();
      joinedFlows.set(stops ?? UNREAD_HALF, byForge);
    }
    let byChanges = byForge.get(forge ?? UNREAD_HALF);
    if (byChanges === undefined) {
      byChanges = new WeakMap();
      byForge.set(forge ?? UNREAD_HALF, byChanges);
    }
    let byGroup = byChanges.get(changes ?? UNREAD_HALF);
    if (byGroup === undefined) {
      byGroup = new Map();
      byChanges.set(changes ?? UNREAD_HALF, byGroup);
    }
    const withheld = new Map(
      (stops?.environments ?? []).flatMap(({ projectId }) => {
        const notice = input.withheld.get(projectId);
        return notice === undefined ? [] : [[projectId, notice] as const];
      }),
    );
    const released = forge !== undefined && "tags" in forge.released ? forge.released : undefined;
    const { production, failed } = releaseDeploys(stops?.environments ?? []);
    const inFlight = releaseInFlight({
      newest: released?.newest,
      production,
      failed,
      nowMs: input.nowMs,
    });
    const key = JSON.stringify([
      group.groupId,
      group.slug,
      inFlight ?? null,
      changes === undefined ? (input.changesFailure ?? null) : null,
      [...withheld],
    ]);
    let flow = byGroup.get(key);
    if (flow === undefined) {
      flow = projectFlow(
        group,
        { stops, forge, changes, changesFailure: input.changesFailure },
        inFlight,
        withheld,
      );
      byGroup.set(key, flow);
    }
    flows.set(group.groupId, flow);
  }
  return flows;
}

/**
 * A stop's row. A production is named by the newest release all its services run, where one
 * does; a stage, and a production no release matches, keep the first labelled service's name.
 */
function stopRow(
  entry: GroupEnvironmentRowInput,
  releases: ReadonlyArray<FlowRelease>,
): EnvironmentRow {
  const row = environmentRow(entry);
  if (entry.tier !== "production") return row;
  const running = new Map<string, string>();
  for (const service of entry.services) {
    const sha = deployedCommit(service.appVersionName);
    if (sha !== undefined) running.set(service.hostname, sha);
  }
  const tag = releaseRunBy(releases, running);
  return tag === undefined ? row : nameStopByRelease(row, tag);
}

function projectFlow(
  group: { readonly groupId: string; readonly slug: string },
  halves: {
    readonly stops: GroupStops | undefined;
    readonly forge: ZeropsGroupForgeState | undefined;
    readonly changes: GroupChanges | undefined;
    readonly changesFailure: string | undefined;
  },
  inFlight: string | undefined,
  /** Why the grant withholds each of the group's projects it withholds alone. */
  withheld: ReadonlyMap<string, string>,
): ZeropsProjectFlow {
  const { stops, forge, changes } = halves;
  const environmentInputs = stops?.environments ?? [];
  const released = forge !== undefined && "tags" in forge.released ? forge.released : undefined;
  // A production the grant withholds shows nothing it runs (DESIGN §3.4), so
  // nothing is measured against it, and no release is listed.
  const withheldProduction = environmentInputs.find(
    (entry) => entry.tier === "production" && withheld.has(entry.projectId),
  );
  const productionWithheld =
    withheldProduction === undefined ? undefined : withheld.get(withheldProduction.projectId);
  const sides = releaseDeploys(environmentInputs.filter((entry) => !withheld.has(entry.projectId)));
  const releaseList = released?.releases ?? [];
  const live = releaseRunBy(releaseList, sides.production);
  const releaseRows = releaseList.map((entry, index) =>
    releaseRow(entry, index, {
      production: sides.production,
      failed: sides.failed,
      live: entry.tag === live,
    }),
  );
  return {
    groupId: group.groupId,
    slug: group.slug,
    declarations: stops?.declarations ?? [],
    declarationsRead: stops !== undefined,
    environments: environmentInputs.map((entry) => stopRow(entry, releaseList)),
    environmentInputs,
    missing: stops?.missing ?? [],
    pullRequests: changes?.pullRequests ?? [],
    changesKnown: changes !== undefined,
    changesFailure: changes === undefined ? halves.changesFailure : undefined,
    merged: changes?.merged ?? [],
    releases: releaseRows,
    release: {
      gate: { allowed: false, reason: productionWithheld ?? RELEASE_MOVES_TO_HQ },
      suggestion: suggestReleaseTags(released?.tags ?? []).patch,
      comparison: [],
      entries: [],
      inFlight,
      contents: [],
    },
  };
}

export function ZeropsProjectFlowProvider({ children }: { readonly children: ReactNode }) {
  const session = useZeropsSession();
  const inventory = useZeropsInventory();
  const organization = session.activeOrganization;
  const clientId = organization?.id;
  const accountGitea = useAccountGitea(clientId);
  const giteaOrigin = accountGitea?.state.url;
  const brokerOrigin = accountGitea?.state.brokerUrl;
  const signedInToMate = session.status === "signed-in";

  const registry = useZeropsRegistry();
  const platform = useMemo(() => zeropsThrowawayPlatform(session.client), [session.client]);
  const {
    signedIn,
    readable,
    trouble: signInTrouble,
  } = useGiteaSession({
    giteaOrigin,
    brokerOrigin,
    clientId,
    platform,
  });

  /**
   * Every group the registry knows, with the projects the account tags into
   * it and their runtime services — the account's half of every row. Read from
   * the inventory as held: a project the grant withholds is still in its group
   * (DESIGN M7), and its stop renders withheld where it is drawn.
   */
  const held = useContext(HeldInventoryContext);
  const data = useContext(ZeropsDataContext);
  const groupProjects = useMemo(
    () =>
      new Map(
        registry.registry.groups.map((entry) => [
          entry.groupId,
          (held === null ? [] : held.projects)
            .filter((project) => readZeropsMembership(project).groupId === entry.groupId)
            .map((project): GroupStopProject => {
              const services = held?.services.get(project.id);
              const { role } = readZeropsMembership(project);
              return {
                projectId: project.id,
                name: project.name,
                ...(role === undefined ? {} : { role }),
                services:
                  services?.status === "resolved"
                    ? summarizeEnvironmentServices(services.services).deployable.map(
                        ({ serviceId, hostname }) => ({ serviceId, hostname }),
                      )
                    : [],
              };
            }),
        ]),
      ),
    [held, registry.registry.groups],
  );
  // What each group service runs, as the account's store states it, read live.
  const statedServices = useMemo(() => {
    if (data === null) return [];
    return [...groupProjects.values()].flat().flatMap((project) => {
      const ref = inventory.projectRefs.get(project.projectId);
      if (ref === undefined) return [];
      return project.services.map(
        (service) =>
          [
            service.serviceId,
            data.runtime.reads.deployedVersion({
              kind: "service",
              project: ref,
              serviceId: ZeropsServiceId.make(service.serviceId),
            }),
          ] as const,
      );
    });
  }, [data, groupProjects, inventory.projectRefs]);
  const stated = useZeropsAtomSelections(statedServices);
  const forgeGroups = useMemo(
    () => registry.registry.groups.map(({ groupId, slug }) => ({ groupId, slug })),
    [registry.registry.groups],
  );

  // Each group's recipe, read again once a change of it lands.
  const hqChanges = useAtomValue(hqChangesAtom);
  const recipeApps = useMemo(
    () =>
      new Map(
        registry.registry.groups.map(({ groupId }) => [
          groupId,
          hqChanges === null ? undefined : recipeRevision(hqChanges.get(groupId)),
        ]),
      ),
    [hqChanges, registry.registry.groups],
  );
  const recipes = useZeropsAppRecipes({ apps: recipeApps, enabled: signedInToMate });

  // Each group's stops, from HQ's environments and the account's half.
  const heldEnvironments = useAtomValue(hqEnvironmentsAtom);
  const groupStops = useMemo(() => {
    const built = new Map<string, GroupStops>();
    if (heldEnvironments === null) return built;
    for (const [groupId, projects] of groupProjects) {
      const environments = heldEnvironments.get(groupId);
      if (environments === undefined) continue;
      const versions = new Map(
        projects.flatMap(({ services }) =>
          services.flatMap(({ serviceId }) => {
            // A version the store does not state yet names nothing: the row is quieter until it does.
            const version = stated.get(serviceId);
            if (version?.state !== "known" || version.value.name === null) return [];
            return [[serviceId, version.value.name] as const];
          }),
        ),
      );
      built.set(
        groupId,
        groupStopsFor(groupId, { environments, projects, versions, recipe: recipes.get(groupId) }),
      );
    }
    return built;
  }, [groupProjects, heldEnvironments, recipes, stated]);

  /**
   * What each project the account holds runs, from the account's deployment store
   * (`flow/deploymentStore.ts`): the platform's own service listing and the builds running in the
   * project. Every project is a stop wherever it is drawn — in a group by its tags, or in none —
   * and none of this waits on Gitea or its registry. As with the inventory's own demand, a project
   * refused to the account (G6) or not ACTIVE holds nothing open.
   */
  const stops = useMemo(() => {
    const inactive = new Set(
      inventory.projects.filter(({ status }) => status !== "ACTIVE").map(({ id }) => id),
    );
    return [...inventory.projectRefs.values()].flatMap((ref) => {
      const authority = inventory.authority.get(inventoryProjectRefKey(ref));
      const refused = authority?.kind === "withheld" && authority.reason === "access-denied";
      return refused || inactive.has(ref.projectId) ? [] : [ref];
    });
  }, [inventory.authority, inventory.projectRefs, inventory.projects]);
  const stopDeployments = useStopDeployments(stops);
  // A project the grant withholds shows its stop withheld, at this read (DESIGN §4.2 G12), demanded
  // or not.
  const deployments = useMemo<ReadonlyMap<string, Shown<Deployment>>>(
    () =>
      new Map(
        [...inventory.projectRefs.values()].flatMap(({ projectId }) => {
          const authority = projectAuthority(inventory, projectId);
          if (authority.kind === "withheld") {
            return [
              [
                projectId,
                { state: "withheld", reason: authority.reason, cause: authority.cause },
              ] as const,
            ];
          }
          const deployment = stopDeployments.get(projectId);
          return deployment === undefined ? [] : [[projectId, deployment] as const];
        }),
      ),
    [inventory, stopDeployments],
  );

  const [trouble, setTrouble] = useState<string | null>(null);
  // The token is back, so the verbs act again and the sentence saying they would not is gone.
  const [troubleReadable, setTroubleReadable] = useState(readable);
  if (troubleReadable !== readable) {
    setTroubleReadable(readable);
    if (readable && trouble === SIGNING_IN_AGAIN) setTrouble(null);
  }
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const enabled = signedInToMate && signedIn;
  const {
    forges,
    failures: forgeFailures,
    invalidate: invalidateForge,
  } = useZeropsGroupForge({
    giteaOrigin,
    groups: forgeGroups,
    enabled,
    readable,
  });

  /**
   * Why the grant withholds each project it withholds alone; a lapse withholds every flow below
   * instead (DESIGN §3.4).
   */
  const withheld = useMemo(
    () =>
      new Map(
        [...inventory.projectRefs.values()].flatMap(({ projectId }) => {
          const notice = withheldProjectNotice(inventory, projectId);
          return notice === null ? [] : [[projectId, notice] as const];
        }),
      ),
    [inventory],
  );

  // A release in flight stops holding Release back once it is old enough (`releaseInFlight`).
  const nowMs = useNowMs();
  // A Mate's changes, down the organization's HQ stream, linked at its official address. They
  // need no Gitea, so the flows stand on them wherever HQ answers.
  const accountHq = useAccountHq(clientId);
  const hqAddress = accountHq.hq.kind === "official" ? accountHq.hq.address : undefined;
  const hqApi = useMemo(
    () =>
      accountHq.hq.kind === "official" && clientId !== undefined
        ? accountHqApi(session.client, clientId, accountHq.hq)
        : null,
    [accountHq.hq, clientId, session.client],
  );
  const hqStructure = useAtomValue(hqStructureAtom);
  const changes = useMemo(
    () =>
      hqChanges === null || hqAddress === undefined ? null : groupChangesOf(hqChanges, hqAddress),
    [hqAddress, hqChanges],
  );
  const changesFailure =
    hqStructure?.unavailableSince === null || hqStructure === null
      ? undefined
      : HQ_CHANGES_UNANSWERED;
  const flows = useMemo<ReadonlyMap<string, ZeropsProjectFlow>>(
    () =>
      signedInToMate
        ? joinProjectFlows({
            groups: forgeGroups,
            stops: groupStops,
            forges,
            changes,
            changesFailure,
            nowMs,
            withheld,
          })
        : EMPTY_FLOWS,
    [changes, changesFailure, forgeGroups, forges, groupStops, nowMs, signedInToMate, withheld],
  );

  // Time to the first pull request row, per group, for diagnostics.
  useEffect(() => {
    for (const flow of flows.values()) {
      if (flow.pullRequests.length > 0)
        mateDiagnostics.recordOnce({ kind: "flow-pr-row", groupId: flow.groupId });
    }
  }, [flows]);

  /** Re-reads what a settled verb changed, in its own group and nothing else (`flow/verbs.ts`). */
  const reread = useCallback(
    (verb: FlowVerb, groupId: string | undefined) => {
      if (groupId === undefined) return;
      const changed = flowVerbInvalidations(verb);
      if (changed.forge !== null) invalidateForge(groupId, changed.forge);
    },
    [invalidateForge],
  );

  /**
   * The verbs running now, by key. A second press before React draws the first as pending would
   * otherwise act twice — for a release, a second tag.
   */
  const running = useRef(new Set<string>());

  /**
   * Holds the verb's key in `pending` while it runs, then re-reads what it changed; how it went is
   * `act`'s answer, and a verb already running answers that it is.
   */
  const run = useCallback(
    async (
      verb: FlowVerb,
      groupId: string | undefined,
      act: () => Promise<FlowVerbOutcome>,
    ): Promise<FlowVerbOutcome> => {
      const key = flowVerbKey(verb);
      if (running.current.has(key)) return refused(VERB_ALREADY_RUNNING);
      running.current.add(key);
      setPending((current) => new Set(current).add(key));
      try {
        return await act();
      } finally {
        running.current.delete(key);
        setPending((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
        reread(verb, groupId);
      }
    },
    [reread],
  );

  /**
   * A verb whose call landed, by its key, with the group's forge answer it landed against. The
   * verb stays pending until the forge answers again, the group's forge read fails, or
   * {@link HELD_VERB_MS} passes: until then the flow still offers what was just done — the
   * release it just tagged. A settled entry is dropped.
   */
  const [awaiting, setAwaiting] = useState<ReadonlyMap<string, HeldVerb>>(() => new Map());
  /**
   * The forge answers as drawn last. A verb is held when its call returns, against the answer
   * current then — a pass that answered while the call ran did not read its effect either.
   */
  const latestForges = useRef(forges);
  useEffect(() => {
    latestForges.current = forges;
  }, [forges]);
  const hold = useCallback((verb: FlowVerb, groupId: string | undefined) => {
    if (groupId === undefined) return;
    setAwaiting((current) =>
      new Map(current).set(flowVerbKey(verb), {
        groupId,
        against:
          verb.kind === "merge" || verb.kind === "close"
            ? { kind: "change", repository: verb.repository, number: verb.number }
            : { kind: "forge", answer: latestForges.current.get(groupId) },
        sinceMs: Date.now(),
      }),
    );
  }, []);
  const letGo = useCallback((key: string, entry: HeldVerb) => {
    setAwaiting((current) => {
      if (current.get(key) !== entry) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }, []);
  useEffect(() => {
    const timers = [...awaiting].map(([key, entry]) =>
      setTimeout(() => letGo(key, entry), entry.sinceMs + HELD_VERB_MS - Date.now()),
    );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [awaiting, letGo]);

  const slugs = useMemo(
    () => new Map(registry.registry.groups.map((entry) => [entry.groupId, entry.slug])),
    [registry.registry.groups],
  );
  const mateNames = useMemo(
    () =>
      new Map(
        inventory.projects.map((project) => [
          project.id,
          botDisplayName({
            bot: readZeropsMembership(project).bot,
            projectName: project.name,
          }),
        ]),
      ),
    [inventory.projects],
  );

  /**
   * A client to act as the person with, or `null` with the reason said where the verbs are: the
   * flows stand through a failed reacquire while no token is held, and a verb pressed then
   * would otherwise do nothing and say nothing. With no Gitea on the account there is nothing
   * to sign in to again, and no verb to press.
   */
  const actingClient = useCallback(() => {
    if (giteaOrigin === undefined) return null;
    const client = giteaClientFor(giteaOrigin);
    if (client === null) setTrouble(SIGNING_IN_AGAIN);
    return client;
  }, [giteaOrigin]);

  /** Says a refusal where the verbs are, and hands it back to the surface that pressed it. */
  const refuse = useCallback((reason: string): FlowVerbOutcome => {
    setTrouble(reason);
    return refused(reason);
  }, []);

  /**
   * A tag on a commit of the group repo's `main`, as the person; Gitea's tag protection is the
   * real gate. Whether the tag was made, or why not.
   */
  const tagAs = useCallback(
    async (
      slug: string,
      target: string | undefined,
      tag: string,
      message: string,
    ): Promise<FlowVerbOutcome> => {
      const client = actingClient();
      if (client === null) return refused(SIGNING_IN_AGAIN);
      if (target === undefined) return refuse("The group repository has no main to tag.");
      try {
        await client.createTag(slug, GROUP_REPOSITORY, { tag, target, message });
        setTrouble(null);
        return { ok: true, tag };
      } catch (cause) {
        return refuse(
          cause instanceof Error && "status" in cause && cause.status === 403
            ? "Only releasers can tag."
            : "Gitea would not create the tag.",
        );
      }
    },
    [actingClient, refuse],
  );

  // Release's offer moves to HQ next (`RELEASE_MOVES_TO_HQ`): until then nothing is tagged.
  const release = useCallback(
    async (): Promise<FlowVerbOutcome> => refused(RELEASE_MOVES_TO_HQ),
    [],
  );

  const rollBack = useCallback(
    async (groupId: string, earlier: string): Promise<FlowVerbOutcome> => {
      const flow = flows.get(groupId);
      if (flow === undefined) return refused("This project has not been read yet.");
      const client = actingClient();
      if (client === null) return refused(SIGNING_IN_AGAIN);
      const verb: FlowVerb = { kind: "roll-back", groupId, tag: earlier };
      return run(verb, groupId, async () => {
        const tags = await client.listTags(flow.slug, GROUP_REPOSITORY).catch(() => []);
        const found = tags.find((entry) => entry.name === earlier);
        const plan =
          found === undefined
            ? undefined
            : rollbackTo({
                tag: found.name,
                message: found.message ?? "",
                existingTags: tags.map((entry) => entry.name),
              });
        if (plan === undefined)
          return refuse(`${earlier} does not list commits this build can read.`);
        const { slug } = flow;
        const head = await client.getBranch(slug, GROUP_REPOSITORY, "main").catch(() => undefined);
        const made = await tagAs(slug, head?.commit?.id, plan.tag, plan.message);
        if (made.ok) hold(verb, groupId);
        return made;
      });
    },
    [actingClient, flows, hold, refuse, run, tagAs],
  );

  /**
   * A change merged or closed in HQ, as the person: held until HQ's stream no longer holds it open,
   * nothing read again; HQ's refusal is handed back in its words to the review that pressed it.
   */
  const changeVerb = useCallback(
    async (
      verb: ChangeVerb,
      act: (api: HqApi, link: ChangeLink) => Promise<unknown>,
    ): Promise<FlowVerbOutcome> => {
      if (hqApi === null) return refused(HQ_NOT_OPEN);
      const link = { appId: verb.groupId, repo: verb.repository, number: verb.number };
      return run(verb, verb.groupId, async () => {
        try {
          await act(hqApi, link);
        } catch (cause) {
          return refused(zeropsErrorMessage(cause));
        }
        hold(verb, verb.groupId);
        return { ok: true };
      });
    },
    [hold, hqApi, run],
  );

  const merge = useCallback(
    (
      groupId: string,
      change: { readonly repository: string; readonly number: number },
      expectedHead: string | undefined,
    ): Promise<FlowVerbOutcome> => {
      // Only the head whose change was shown: one nobody saw is never merged, and HQ is not asked.
      if (expectedHead === undefined) return Promise.resolve(refused(HEAD_NOT_SHOWN));
      return changeVerb({ kind: "merge", groupId, ...change }, (api, link) =>
        api.mergeChange(link, expectedHead),
      );
    },
    [changeVerb],
  );

  const close = useCallback(
    (
      groupId: string,
      change: { readonly repository: string; readonly number: number },
    ): Promise<FlowVerbOutcome> =>
      changeVerb({ kind: "close", groupId, ...change }, (api, link) => api.closeChange(link)),
    [changeVerb],
  );

  // While the account's access lapses, the groups the registry names and what was read of them
  // are withheld with every project (§3.1); the reads themselves are kept for the next grant.
  const lapsed = inventory.account.kind === "withheld";
  // A held verb waits for its effect in the group's forge answer, or for the re-read to fail: a
  // forge half that fails says so where the verbs are (`trouble`), so the wait has nothing left to
  // hold.
  const settled = useMemo(
    () =>
      [...awaiting].filter(([, entry]) =>
        effectRead(
          entry,
          forges.get(entry.groupId),
          forgeFailures.has(entry.groupId),
          flows.get(entry.groupId),
        ),
      ),
    [awaiting, flows, forgeFailures, forges],
  );
  useEffect(() => {
    if (settled.length === 0) return;
    setAwaiting((current) => {
      const next = new Map(current);
      for (const [key, entry] of settled) if (next.get(key) === entry) next.delete(key);
      return next;
    });
  }, [settled]);
  const pendingOrHeld = useMemo<ReadonlySet<string>>(() => {
    const waiting = [...awaiting.keys()].filter((key) => !settled.some(([done]) => done === key));
    return waiting.length === 0 ? pending : new Set([...pending, ...waiting]);
  }, [awaiting, pending, settled]);
  const value = useMemo<ZeropsProjectFlowValue>(
    () => ({
      giteaOrigin,
      hqAddress,
      signedIn,
      readable,
      signInTrouble,
      flows: lapsed ? EMPTY_FLOWS : flows,
      deployments,
      slugs: lapsed ? EMPTY_SLUGS : slugs,
      mateNames,
      pending: pendingOrHeld,
      // Flows that stand with no token say why where the verbs are, ahead of what a verb said.
      trouble: (signedIn ? signInTrouble : null) ?? trouble,
      release,
      rollBack,
      merge,
      close,
    }),
    [
      close,
      deployments,
      flows,
      giteaOrigin,
      hqAddress,
      lapsed,
      mateNames,
      merge,
      pendingOrHeld,
      readable,
      release,
      rollBack,
      signInTrouble,
      signedIn,
      slugs,
      trouble,
    ],
  );

  return (
    <ZeropsProjectFlowContext.Provider value={value}>{children}</ZeropsProjectFlowContext.Provider>
  );
}
