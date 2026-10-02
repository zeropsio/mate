/**
 * Reads every project's flow once for the whole account, and holds the verbs
 * that move it (`projectFlowContext.ts`, D26).
 *
 * Three reads are joined here, each from the party that can prove it: the
 * account says which projects a group holds and which commit each service
 * of them runs (`useZeropsGroupDeploys`), HQ says what is waiting to land and
 * what landed — its Mates' changes, down the organization's stream
 * (`hqChangesAtom`) — and Gitea says what was released
 * (`useZeropsGroupForge`). The declarations in the group repo say which of
 * those projects are environments and what feeds them; the registry says
 * which Gitea org a group is. Each part is kept per group, and a group's flow
 * is the same object until one of its own parts changes, so one group
 * answering never republishes another.
 *
 * Signed in to Mate is signed in to Gitea (D21): the provider signs the tab
 * in by itself, and until that lands the Gitea halves are empty and the
 * surfaces say so where they stand. A Mate's changes need no Gitea, nor does
 * what each stop runs: the account's deployment store's answer
 * (`flow/deploymentStore.ts`).
 */
import { useAtomValue } from "@effect/atom-react";
import {
  botDisplayName,
  deployedCommit,
  environmentRow,
  flowChanges,
  flowVerbKey,
  releaseRunBy,
  nameStopByRelease,
  readZeropsMembership,
  releaseDeploys,
  releaseInFlight,
  releaseMessage,
  releaseOffer,
  releaseRow,
  releaseTagName,
  rollbackTo,
  summarizeEnvironmentServices,
  GROUP_REPOSITORY,
  type EnvironmentRow,
  type FlowPullRequest,
  type FlowRelease,
  type GroupEnvironmentRowInput,
  type FlowVerb,
  type ZeropsService,
} from "@t3tools/client-runtime/zerops";
import {
  flowReleaseGate,
  flowVerbInvalidations,
  type Deployment,
  type FlowHalf,
} from "@t3tools/client-runtime/zerops/flow";
import {
  statedDeployKey,
  ZeropsServiceId,
  type ZeropsServiceDeployedVersion,
} from "@t3tools/client-runtime/zerops/data";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { mateDiagnostics } from "@t3tools/client-runtime/zerops/diagnostics";
import { zeropsThrowawayPlatform } from "@t3tools/client-runtime/zerops/doorThrowaway";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import type { HqChange } from "@t3tools/shared/hqChanges";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { hqChangesAtom, hqStructureAtom } from "../state/zerops";
import { useStopDeployments } from "./accountForge";
import { useAccountHq } from "./accountHq";
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
import { useZeropsDeployedVersionReader } from "./useZeropsDeployedVersion";
import {
  useZeropsGroupDeploys,
  type ZeropsDeployGroup,
  type ZeropsGroupDeployState,
  type ZeropsGroupDeploys,
} from "./useZeropsGroupDeploys";
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
const EMPTY_HEADS: ReadonlyMap<string, string> = new Map();
const EMPTY_SLUGS: ReadonlyMap<string, string> = new Map();
/** What a verb says when it is pressed while the flows stand and no Gitea token is held. */
const SIGNING_IN_AGAIN = "Signing in to Gitea again. Try it again in a moment.";
/** How long a verb whose call landed stays pending while the flow has not read its effect back. */
export const HELD_VERB_MS = 30_000;
/** What a second press of a verb that is still running says: the first one is the one that counts. */
export const VERB_ALREADY_RUNNING = "It is already on its way.";

const DONE: FlowVerbOutcome = { ok: true };
const refused = (reason: string): FlowVerbOutcome => ({ ok: false, reason });

/**
 * A verb whose call landed (a tag), waiting for any forge answer of its group after the one it
 * landed against.
 */
interface HeldVerb {
  readonly groupId: string;
  readonly against: ZeropsGroupForgeState | undefined;
  readonly sinceMs: number;
}

/** Whether the group's forge has answered since the held verb landed, or can no longer say. */
function effectRead(
  held: HeldVerb,
  forge: ZeropsGroupForgeState | undefined,
  failed: boolean,
): boolean {
  return failed || forge !== held.against;
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

/** What the platform pushed as a service's active deploy: when it was activated, and its name. */
/**
 * What a service runs, as a group's read is keyed on it: the push's activation and name, and the
 * name the account's store states once it does — so a group read that had to fall back while the
 * store was slow reads again the moment the store answers.
 */
export function activeDeployOf(
  service: ZeropsService | undefined,
  stated?: Shown<ZeropsServiceDeployedVersion>,
): string | undefined {
  const version = service?.activeAppVersion;
  if (version === null || version === undefined) return undefined;
  return `${version.lastUpdate ?? ""} ${version.name ?? ""} ${statedDeployKey(stated)}`;
}

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

/** Why each group's latest read of either half failed, while it keeps failing. */
export interface FlowFailures {
  readonly deploys: ReadonlyMap<string, string>;
  readonly forge: ReadonlyMap<string, string>;
}

/**
 * Joins each group's parts into its flow. A group is shown once any part
 * answered; the release is offered only once both Gitea and the account have,
 * and says why while either fails (`flow/release.ts`).
 */
export function joinProjectFlows(input: {
  readonly groups: ReadonlyArray<{ readonly groupId: string; readonly slug: string }>;
  readonly deploys: ZeropsGroupDeploys;
  readonly forges: ZeropsGroupForges;
  /** Each group's changes, by its id; `null` while HQ has told nothing of them. */
  readonly changes: ReadonlyMap<string, GroupChanges> | null;
  /** Why HQ has told nothing of them, while it does not answer. */
  readonly changesFailure: string | undefined;
  readonly mayRelease: boolean;
  /** The clock a release in flight is bounded by (`releaseInFlight`). */
  readonly nowMs: number;
  /** Why the grant withholds a project, by project id, for each project it withholds alone. */
  readonly withheld: ReadonlyMap<string, string>;
  readonly failures: FlowFailures;
}): ReadonlyMap<string, ZeropsProjectFlow> {
  const flows = new Map<string, ZeropsProjectFlow>();
  for (const group of input.groups) {
    const deployed = input.deploys.get(group.groupId);
    const forge = input.forges.get(group.groupId);
    const changes =
      input.changes === null ? undefined : (input.changes.get(group.groupId) ?? NO_CHANGES);
    if (deployed === undefined && forge === undefined && changes === undefined) continue;
    let byForge = joinedFlows.get(deployed ?? UNREAD_HALF);
    if (byForge === undefined) {
      byForge = new WeakMap();
      joinedFlows.set(deployed ?? UNREAD_HALF, byForge);
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
    const failures = {
      deploys: input.failures.deploys.get(group.groupId),
      forge: input.failures.forge.get(group.groupId),
    };
    const withheld = new Map(
      (deployed?.environments ?? []).flatMap(({ projectId }) => {
        const notice = input.withheld.get(projectId);
        return notice === undefined ? [] : [[projectId, notice] as const];
      }),
    );
    const released = forge !== undefined && "tags" in forge.released ? forge.released : undefined;
    const { production, failed } = releaseDeploys(deployed?.environments ?? []);
    const inFlight = releaseInFlight({
      newest: released?.newest,
      production,
      failed,
      nowMs: input.nowMs,
    });
    const key = JSON.stringify([
      group.groupId,
      group.slug,
      input.mayRelease,
      inFlight ?? null,
      failures.deploys ?? null,
      failures.forge ?? null,
      changes === undefined ? (input.changesFailure ?? null) : null,
      [...withheld],
    ]);
    let flow = byGroup.get(key);
    if (flow === undefined) {
      flow = projectFlow(
        group,
        { deployed, forge, changes, changesFailure: input.changesFailure, failures },
        { mayRelease: input.mayRelease, inFlight },
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

/** Where one half stands for the release: failing, answered, or not yet. */
function half(answered: boolean, failure: string | undefined): FlowHalf {
  if (failure !== undefined) return { failed: failure };
  return answered ? "read" : "unread";
}

function projectFlow(
  group: { readonly groupId: string; readonly slug: string },
  halves: {
    readonly deployed: ZeropsGroupDeployState | undefined;
    readonly forge: ZeropsGroupForgeState | undefined;
    readonly changes: GroupChanges | undefined;
    readonly changesFailure: string | undefined;
    readonly failures: { readonly deploys: string | undefined; readonly forge: string | undefined };
  },
  release: { readonly mayRelease: boolean; readonly inFlight: string | undefined },
  /** Why the grant withholds each of the group's projects it withholds alone. */
  withheld: ReadonlyMap<string, string>,
): ZeropsProjectFlow {
  const { deployed, forge, changes, failures } = halves;
  const environmentInputs = deployed?.environments ?? [];
  const released = forge !== undefined && "tags" in forge.released ? forge.released : undefined;
  // Releases that did not answer say why, like a forge read that failed
  // outright: tags kept from an earlier read are not what a release checks.
  const forgeFailure = failures.forge ?? forge?.released.failure;
  // A production the grant withholds shows nothing it runs (DESIGN §3.4), so
  // nothing is measured against it: no release is offered, and none listed.
  const withheldProduction = environmentInputs.find(
    (entry) => entry.tier === "production" && withheld.has(entry.projectId),
  );
  const productionWithheld =
    withheldProduction === undefined ? undefined : withheld.get(withheldProduction.projectId);
  const sides = releaseDeploys(environmentInputs.filter((entry) => !withheld.has(entry.projectId)));
  // What a release lists is what is merged (D28), whether or not the group
  // has a stage: a stage is a place that runs `main` too, not a gate the
  // tag waits behind, and one mid-deploy must not change what Release
  // means. Holding production until a stage has the commit is said once,
  // explicitly, as `requireOnStage`.
  const releaseList = released?.releases ?? [];
  const live = releaseRunBy(releaseList, sides.production);
  const releaseRows = releaseList.map((entry, index) =>
    releaseRow(entry, index, {
      production: sides.production,
      failed: sides.failed,
      live: entry.tag === live,
    }),
  );
  const offer = releaseOffer({
    mayRelease: release.mayRelease,
    inFlight: release.inFlight,
    candidate: deployed?.mainHeads ?? EMPTY_HEADS,
    production: sides.production,
    tags: released?.tags ?? [],
  });
  return {
    groupId: group.groupId,
    slug: group.slug,
    declarations: deployed?.declarations ?? [],
    declarationsRead: deployed !== undefined,
    environments: environmentInputs.map((entry) => stopRow(entry, releaseList)),
    environmentInputs,
    mainHeads: deployed?.mainHeads ?? EMPTY_HEADS,
    missing: deployed?.missing ?? [],
    pullRequests: changes?.pullRequests ?? [],
    changesKnown: changes !== undefined,
    changesFailure: changes === undefined ? halves.changesFailure : undefined,
    merged: changes?.merged ?? [],
    releases: releaseRows,
    release: {
      ...offer,
      inFlight: release.inFlight,
      target: deployed?.groupHead,
      gate:
        productionWithheld === undefined
          ? flowReleaseGate(offer.gate, {
              deploys: half(deployed !== undefined, failures.deploys),
              forge: half(released !== undefined, forgeFailure),
            })
          : { allowed: false, reason: productionWithheld },
      contents: productionWithheld === undefined ? (deployed?.releaseContents ?? []) : [],
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
  // What each group service runs, as the account's store states it, read live: a slow first
  // statement re-keys its group once it lands (`activeDeployOf`).
  const statedServices = useMemo(() => {
    if (data === null || held === null) return [];
    return registry.registry.groups.flatMap((entry) =>
      held.projects
        .filter((project) => readZeropsMembership(project).groupId === entry.groupId)
        .flatMap((project) => {
          const services = held.services.get(project.id);
          const ref = inventory.projectRefs.get(project.id);
          if (services?.status !== "resolved" || ref === undefined) return [];
          return summarizeEnvironmentServices(services.services).deployable.map(
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
        }),
    );
  }, [data, held, inventory.projectRefs, registry.registry.groups]);
  const stated = useZeropsAtomSelections(statedServices);
  const groups = useMemo<ReadonlyArray<ZeropsDeployGroup>>(
    () =>
      registry.registry.groups.map((entry) => ({
        groupId: entry.groupId,
        slug: entry.slug,
        projects: (held === null ? [] : held.projects)
          .filter((project) => readZeropsMembership(project).groupId === entry.groupId)
          .map((project) => {
            const services = held?.services.get(project.id);
            const tags = readZeropsMembership(project);
            return {
              projectId: project.id,
              name: project.name,
              ...(tags.role === undefined ? {} : { role: tags.role }),
              services:
                services?.status === "resolved"
                  ? summarizeEnvironmentServices(services.services).deployable.map((service) => {
                      const pushed = services.services.find(
                        (entry) => entry.id === service.serviceId,
                      );
                      return {
                        ...service,
                        activeDeploy: activeDeployOf(pushed, stated.get(service.serviceId)),
                        activeVersionId: pushed?.activeAppVersion?.id ?? undefined,
                      };
                    })
                  : [],
            };
          }),
      })),
    [held, registry.registry.groups, stated],
  );
  const forgeGroups = useMemo(
    () => groups.map(({ groupId, slug }) => ({ groupId, slug })),
    [groups],
  );

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
  const readVersion = useZeropsDeployedVersionReader();
  const enabled = signedInToMate && signedIn;
  const {
    deploys,
    failures: deployFailures,
    invalidate: invalidateDeploys,
  } = useZeropsGroupDeploys({
    groups,
    giteaOrigin,
    readVersion,
    enabled,
    readable,
  });
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
   * Whether this person may tag. The app's own gate — Gitea's tag protection
   * is the one that decides, and a `403` from it says the same sentence
   * (`release.ts`). The group's releasers are the org's admins.
   */
  const mayRelease = organization?.roleCode === "ADMIN" || organization?.roleCode === "OWNER";

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
  const hqChanges = useAtomValue(hqChangesAtom);
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
            groups,
            deploys,
            forges,
            changes,
            changesFailure,
            mayRelease,
            nowMs,
            withheld,
            failures: { deploys: deployFailures, forge: forgeFailures },
          })
        : EMPTY_FLOWS,
    [
      changes,
      changesFailure,
      deployFailures,
      deploys,
      forgeFailures,
      forges,
      groups,
      mayRelease,
      nowMs,
      signedInToMate,
      withheld,
    ],
  );

  // Time to the first pull request row, per group, for diagnostics.
  useEffect(() => {
    for (const flow of flows.values()) {
      if (flow.pullRequests.length > 0)
        mateDiagnostics.recordOnce({ kind: "flow-pr-row", groupId: flow.groupId });
    }
  }, [flows]);

  const groupOfSlug = useMemo(
    () => new Map(registry.registry.groups.map((entry) => [entry.slug, entry.groupId])),
    [registry.registry.groups],
  );

  /** Re-reads what a settled verb changed, in its own group and nothing else (`flow/verbs.ts`). */
  const reread = useCallback(
    (verb: FlowVerb, groupId: string | undefined) => {
      if (groupId === undefined) return;
      const changed = flowVerbInvalidations(verb);
      if (changed.forge !== null) invalidateForge(groupId, changed.forge);
      if (changed.deploys !== null) invalidateDeploys(groupId, changed.deploys);
    },
    [invalidateDeploys, invalidateForge],
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
        against: latestForges.current.get(groupId),
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

  const createPullRequest = useCallback(
    async (
      slug: string,
      input: {
        readonly repository: string;
        readonly head: string;
        readonly base: string;
        readonly title: string;
      },
    ) => {
      const client = actingClient();
      if (client === null) return;
      await run(
        { kind: "open", slug, repository: input.repository, head: input.head },
        groupOfSlug.get(slug),
        async () => {
          try {
            await client.createPullRequest(slug, input.repository, {
              head: input.head,
              base: input.base,
              title: input.title,
            });
            setTrouble(null);
            return DONE;
          } catch (cause) {
            return refuse(`Gitea would not open the pull request: ${zeropsErrorMessage(cause)}`);
          }
        },
      );
    },
    [actingClient, groupOfSlug, refuse, run],
  );

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

  const release = useCallback(
    async (groupId: string): Promise<FlowVerbOutcome> => {
      const flow = flows.get(groupId);
      if (flow === undefined) return refused("This project has not been read yet.");
      // What the offer showed, not a second derivation of it: the two would
      // differ for a project releasing what is merged (D28).
      const entries = flow.release.entries;
      if (entries.length === 0) return refused("Nothing is merged to release.");
      const verb: FlowVerb = { kind: "release", groupId };
      return run(verb, groupId, async () => {
        // The `main` head the offer was computed from — never a head read at the press, which may
        // hold what the person was not shown.
        const made = await tagAs(
          flow.slug,
          flow.release.target,
          releaseTagName(flow.release.suggestion.replace(/^v/u, "")),
          releaseMessage(entries),
        );
        if (made.ok) hold(verb, groupId);
        return made;
      });
    },
    [flows, hold, run, tagAs],
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

  // While the account's access lapses, the groups the registry names and what was read of them
  // are withheld with every project (§3.1); the reads themselves are kept for the next grant.
  const lapsed = inventory.account.kind === "withheld";
  // A held verb waits for its effect in the group's forge answer, or for the re-read to fail: a
  // forge half that fails says so where the verbs are (`flowReleaseGate`, `trouble`), so the wait
  // has nothing left to hold.
  const settled = useMemo(
    () =>
      [...awaiting].filter(([, entry]) =>
        effectRead(entry, forges.get(entry.groupId), forgeFailures.has(entry.groupId)),
      ),
    [awaiting, forgeFailures, forges],
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
      createPullRequest,
      release,
      rollBack,
    }),
    [
      createPullRequest,
      deployments,
      flows,
      giteaOrigin,
      hqAddress,
      lapsed,
      mateNames,
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
