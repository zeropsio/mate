/**
 * Reads every project's flow once for the whole account, and holds the verbs
 * that move it (`projectFlowContext.ts`, D26).
 *
 * Two reads are joined here, each from the party that can prove it: the
 * account says which projects a group holds and which commit each service
 * of them runs (`useZeropsGroupDeploys`), Gitea says what is waiting to land
 * and what was released (`useZeropsGroupForge`). The declarations in the
 * group repo say which of those projects are environments and what feeds
 * them; the registry says which Gitea org a group is. Each half is kept per
 * group, and a group's flow is the same object until one of its own halves
 * changes, so one group answering never republishes another.
 *
 * Signed in to Mate is signed in to Gitea (D21): the provider signs the tab
 * in by itself, and until that lands every flow is empty and the surfaces
 * say so where they stand. What each stop runs is the account's deployment
 * store's answer (`flow/deploymentStore.ts`) and needs no Gitea at all.
 */
import {
  botDisplayName,
  environmentRow,
  flowVerbKey,
  readZeropsGroupTags,
  releaseDeploys,
  releaseInFlight,
  releaseMessage,
  releaseOffer,
  releaseRow,
  releaseTagName,
  rollbackTo,
  summarizeEnvironmentServices,
  GROUP_REPOSITORY,
  type FlowPullRequest,
  type FlowVerb,
  type ZeropsService,
} from "@t3tools/client-runtime/zerops";
import {
  flowReleaseGate,
  flowVerbInvalidations,
  type Deployment,
  type FlowHalf,
} from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { mateDiagnostics } from "@t3tools/client-runtime/zerops/diagnostics";
import { zeropsThrowawayPlatform } from "@t3tools/client-runtime/zerops/doorThrowaway";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { useStopDeployments } from "./accountForge";
import { useAccountGitea } from "./giteaProject";
import { giteaClientFor, useGiteaSession } from "./accountGiteaSessions";
import {
  ZeropsProjectFlowContext,
  type ZeropsProjectFlow,
  type ZeropsProjectFlowValue,
} from "./projectFlowContext";
import { useNowMs } from "./useNowMs";
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

/** What the platform pushed as a service's active deploy: when it was activated, and its name. */
function activeDeployOf(service: ZeropsService | undefined): string | undefined {
  const version = service?.activeAppVersion;
  if (version === null || version === undefined) return undefined;
  return `${version.lastUpdate ?? ""} ${version.name ?? ""}`;
}

/** Stands for a half a group has no answer for, as a key of {@link joinedFlows}. */
const UNREAD_HALF = {};

/**
 * Every group's flow, by the identity of its two halves: a group whose halves
 * did not change keeps its flow object.
 */
const joinedFlows = new WeakMap<object, WeakMap<object, Map<string, ZeropsProjectFlow>>>();

/** Why each group's latest read of either half failed, while it keeps failing. */
export interface FlowFailures {
  readonly deploys: ReadonlyMap<string, string>;
  readonly forge: ReadonlyMap<string, string>;
}

/**
 * Joins each group's two halves into its flow. A group is shown once either
 * half answered; the release is offered only once both have, and says why
 * while either half fails (`flow/release.ts`).
 */
export function joinProjectFlows(input: {
  readonly groups: ReadonlyArray<{ readonly groupId: string; readonly slug: string }>;
  readonly deploys: ZeropsGroupDeploys;
  readonly forges: ZeropsGroupForges;
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
    if (deployed === undefined && forge === undefined) continue;
    let byForge = joinedFlows.get(deployed ?? UNREAD_HALF);
    if (byForge === undefined) {
      byForge = new WeakMap();
      joinedFlows.set(deployed ?? UNREAD_HALF, byForge);
    }
    let byGroup = byForge.get(forge ?? UNREAD_HALF);
    if (byGroup === undefined) {
      byGroup = new Map();
      byForge.set(forge ?? UNREAD_HALF, byGroup);
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
    const inFlight = releaseInFlight({
      newest: released?.newest,
      production: releaseDeploys(deployed?.environments ?? []).production,
      nowMs: input.nowMs,
    });
    const key = JSON.stringify([
      group.groupId,
      group.slug,
      input.mayRelease,
      inFlight ?? null,
      failures.deploys ?? null,
      failures.forge ?? null,
      [...withheld],
    ]);
    let flow = byGroup.get(key);
    if (flow === undefined) {
      flow = projectFlow(
        group,
        { deployed, forge, failures },
        { mayRelease: input.mayRelease, inFlight },
        withheld,
      );
      byGroup.set(key, flow);
    }
    flows.set(group.groupId, flow);
  }
  return flows;
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
    readonly failures: { readonly deploys: string | undefined; readonly forge: string | undefined };
  },
  release: { readonly mayRelease: boolean; readonly inFlight: string | undefined },
  /** Why the grant withholds each of the group's projects it withholds alone. */
  withheld: ReadonlyMap<string, string>,
): ZeropsProjectFlow {
  const { deployed, forge, failures } = halves;
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
    environments: environmentInputs.map((entry) => environmentRow(entry)),
    environmentInputs,
    missing: deployed?.missing ?? [],
    pullRequests: forge?.pullRequests ?? [],
    merged: forge?.merged ?? [],
    releases: (released?.releases ?? []).map((release, index) => releaseRow(release, index)),
    release: {
      ...offer,
      inFlight: release.inFlight,
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

  const registry = useZeropsRegistry({
    giteaProjectId: accountGitea?.projectId,
    enabled: signedInToMate,
  });
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
  const groups = useMemo<ReadonlyArray<ZeropsDeployGroup>>(
    () =>
      registry.registry.groups.map((entry) => ({
        groupId: entry.groupId,
        slug: entry.slug,
        projects: (held === null ? [] : held.projects)
          .filter((project) => readZeropsGroupTags(project.tagList ?? []).groupId === entry.groupId)
          .map((project) => {
            const services = held?.services.get(project.id);
            const tags = readZeropsGroupTags(project.tagList ?? []);
            return {
              projectId: project.id,
              name: project.name,
              ...(tags.role === undefined ? {} : { role: tags.role }),
              services:
                services?.status === "resolved"
                  ? summarizeEnvironmentServices(services.services).deployable.map((service) => ({
                      ...service,
                      activeDeploy: activeDeployOf(
                        services.services.find((entry) => entry.id === service.serviceId),
                      ),
                    }))
                  : [],
            };
          }),
      })),
    [held, registry.registry.groups],
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
  const flows = useMemo<ReadonlyMap<string, ZeropsProjectFlow>>(
    () =>
      enabled
        ? joinProjectFlows({
            groups,
            deploys,
            forges,
            mayRelease,
            nowMs,
            withheld,
            failures: { deploys: deployFailures, forge: forgeFailures },
          })
        : EMPTY_FLOWS,
    [deployFailures, deploys, enabled, forgeFailures, forges, groups, mayRelease, nowMs, withheld],
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

  /** Holds the verb's key in `pending` while it runs, then re-reads what it changed. */
  const run = useCallback(
    async (verb: FlowVerb, groupId: string | undefined, act: () => Promise<void>) => {
      const key = flowVerbKey(verb);
      setPending((current) => new Set(current).add(key));
      try {
        await act();
      } finally {
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
            bot: readZeropsGroupTags(project.tagList ?? []).bot,
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

  const mergePullRequest = useCallback(
    async (slug: string, pull: Pick<FlowPullRequest, "repository" | "number">) => {
      const client = actingClient();
      if (client === null) return;
      await run(
        { kind: "merge", slug, repository: pull.repository, number: pull.number },
        groupOfSlug.get(slug),
        async () => {
          try {
            await client.mergePullRequest(slug, pull.repository, pull.number);
            setTrouble(null);
          } catch (cause) {
            setTrouble(`Gitea would not merge it: ${zeropsErrorMessage(cause)}`);
          }
        },
      );
    },
    [actingClient, groupOfSlug, run],
  );

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
          } catch (cause) {
            setTrouble(`Gitea would not open the pull request: ${zeropsErrorMessage(cause)}`);
          }
        },
      );
    },
    [actingClient, groupOfSlug, run],
  );

  /** A tag on the group repo's `main`, as the person; Gitea's tag protection is the real gate. */
  const tagAs = useCallback(
    async (slug: string, tag: string, message: string) => {
      const client = actingClient();
      if (client === null) return;
      const head = await client.getBranch(slug, GROUP_REPOSITORY, "main").catch(() => undefined);
      const target = head?.commit?.id;
      if (target === undefined) {
        setTrouble("The group repository has no main to tag.");
        return;
      }
      try {
        await client.createTag(slug, GROUP_REPOSITORY, { tag, target, message });
        setTrouble(null);
      } catch (cause) {
        setTrouble(
          cause instanceof Error && "status" in cause && cause.status === 403
            ? "Only releasers can tag."
            : "Gitea would not create the tag.",
        );
      }
    },
    [actingClient],
  );

  const release = useCallback(
    async (groupId: string) => {
      const flow = flows.get(groupId);
      if (flow === undefined) return;
      // What the offer showed, not a second derivation of it: the two would
      // differ for a project releasing what is merged (D28).
      const entries = flow.release.entries;
      if (entries.length === 0) return;
      await run({ kind: "release", groupId }, groupId, () =>
        tagAs(
          flow.slug,
          releaseTagName(flow.release.suggestion.replace(/^v/u, "")),
          releaseMessage(entries),
        ),
      );
    },
    [flows, run, tagAs],
  );

  const rollBack = useCallback(
    async (groupId: string, earlier: string) => {
      const flow = flows.get(groupId);
      if (flow === undefined) return;
      const client = actingClient();
      if (client === null) return;
      await run({ kind: "roll-back", groupId, tag: earlier }, groupId, async () => {
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
        if (plan === undefined) {
          setTrouble(`${earlier} does not list commits this build can read.`);
          return;
        }
        await tagAs(flow.slug, plan.tag, plan.message);
      });
    },
    [actingClient, flows, run, tagAs],
  );

  // While the account's access lapses, the groups the registry names and what was read of them
  // are withheld with every project (§3.1); the reads themselves are kept for the next grant.
  const lapsed = inventory.account.kind === "withheld";
  const value = useMemo<ZeropsProjectFlowValue>(
    () => ({
      giteaOrigin,
      signedIn,
      readable,
      signInTrouble,
      flows: lapsed ? EMPTY_FLOWS : flows,
      deployments,
      slugs: lapsed ? EMPTY_SLUGS : slugs,
      mateNames,
      pending,
      // Flows that stand with no token say why where the verbs are, ahead of what a verb said.
      trouble: (signedIn ? signInTrouble : null) ?? trouble,
      mergePullRequest,
      createPullRequest,
      release,
      rollBack,
    }),
    [
      createPullRequest,
      deployments,
      flows,
      giteaOrigin,
      lapsed,
      mateNames,
      mergePullRequest,
      pending,
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
