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
 * say so where they stand. What each stop runs is the platform's pushed
 * answer (`flow/deployment.ts`) and needs no Gitea at all.
 */
import {
  botDisplayName,
  environmentRow,
  flowVerbKey,
  readZeropsGroupTags,
  releaseDeploys,
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
import type { CollectionRead, ServiceRecord } from "@t3tools/client-runtime/zerops/data";
import {
  flowReleaseGate,
  flowVerbInvalidations,
  stopDeployment,
  type Deployment,
  type FlowHalf,
} from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { mateDiagnostics } from "@t3tools/client-runtime/zerops/diagnostics";
import { zeropsThrowawayPlatform } from "@t3tools/client-runtime/zerops/doorThrowaway";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { findAccountGitea } from "./giteaProject";
import { useNowMs } from "./useNowMs";
import { giteaClientFor, useGiteaSession } from "./giteaSession";
import {
  ZeropsProjectFlowContext,
  type ZeropsProjectFlow,
  type ZeropsProjectFlowValue,
} from "./projectFlowContext";
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
  stabilizeZeropsAtom,
  useZeropsAtomSelections,
  useZeropsData,
  zeropsKnowledgeArraysEqual,
} from "./zeropsDataContext";
import { useZeropsInventory } from "./ZeropsInventoryProvider";
import { useZeropsSession } from "./ZeropsSessionProvider";

const EMPTY_FLOWS: ReadonlyMap<string, ZeropsProjectFlow> = new Map();
const EMPTY_HEADS: ReadonlyMap<string, string> = new Map();

/** A service listing whose members, membership and sources did not change. */
function sameServiceListing(
  left: CollectionRead<ServiceRecord>,
  right: CollectionRead<ServiceRecord>,
): boolean {
  return (
    left.query === right.query &&
    zeropsKnowledgeArraysEqual(left.value, right.value) &&
    left.observation.required.length === right.observation.required.length &&
    left.observation.required.every(
      (interest, index) => interest.status === right.observation.required[index]?.status,
    )
  );
}

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
    const key = JSON.stringify([
      group.groupId,
      group.slug,
      input.mayRelease,
      failures.deploys ?? null,
      failures.forge ?? null,
    ]);
    let flow = byGroup.get(key);
    if (flow === undefined) {
      flow = projectFlow(group, { deployed, forge, failures }, input.mayRelease);
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
  mayRelease: boolean,
): ZeropsProjectFlow {
  const { deployed, forge, failures } = halves;
  const environmentInputs = deployed?.environments ?? [];
  const released = forge !== undefined && "tags" in forge.released ? forge.released : undefined;
  // Releases that never answered say why, like a forge read that failed outright.
  const forgeFailure =
    failures.forge ??
    (forge !== undefined && "failure" in forge.released ? forge.released.failure : undefined);
  const sides = releaseDeploys(environmentInputs);
  // What a release lists is what is merged (D28), whether or not the group
  // has a stage: a stage is a place that runs `main` too, not a gate the
  // tag waits behind, and one mid-deploy must not change what Release
  // means. Holding production until a stage has the commit is said once,
  // explicitly, as `requireOnStage`.
  const offer = releaseOffer({
    mayRelease,
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
      gate: flowReleaseGate(offer.gate, {
        deploys: half(deployed !== undefined, failures.deploys),
        forge: half(released !== undefined, forgeFailure),
      }),
      contents: deployed?.releaseContents ?? [],
    },
  };
}

export function ZeropsProjectFlowProvider({ children }: { readonly children: ReactNode }) {
  const session = useZeropsSession();
  const inventory = useZeropsInventory();
  const organization = session.activeOrganization;
  const clientId = organization?.id;
  const accountGitea = findAccountGitea(inventory, clientId);
  const giteaOrigin = accountGitea?.state.url;
  const brokerOrigin = accountGitea?.state.brokerUrl;
  const signedInToMate = session.status === "signed-in";

  const registry = useZeropsRegistry({
    giteaProjectId: accountGitea?.projectId,
    enabled: signedInToMate,
  });
  const platform = useMemo(() => zeropsThrowawayPlatform(session.client), [session.client]);
  const { signedIn, trouble: signInTrouble } = useGiteaSession({
    giteaOrigin,
    brokerOrigin,
    clientId,
    platform,
  });

  /**
   * Every group the registry knows, with the projects the account tags into
   * it and their runtime services — the account's half of every row.
   */
  const groups = useMemo<ReadonlyArray<ZeropsDeployGroup>>(
    () =>
      registry.registry.groups.map((entry) => ({
        groupId: entry.groupId,
        slug: entry.slug,
        projects: inventory.projects
          .filter((project) => readZeropsGroupTags(project.tagList ?? []).groupId === entry.groupId)
          .map((project) => {
            const services = inventory.services.get(project.id);
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
    [inventory.projects, inventory.services, registry.registry.groups],
  );
  const forgeGroups = useMemo(
    () => groups.map(({ groupId, slug }) => ({ groupId, slug })),
    [groups],
  );

  /**
   * What each project's stops run, from the platform's own service listing:
   * the same reads the inventory holds demand for, selected here without a
   * second lease.
   */
  const { runtime } = useZeropsData();
  const serviceReadEntries = useMemo(
    () =>
      [...inventory.projectRefs.values()].map(
        (ref) =>
          [
            ref.projectId,
            stabilizeZeropsAtom(runtime.reads.servicesOf(ref), sameServiceListing),
          ] as const,
      ),
    [inventory.projectRefs, runtime],
  );
  const serviceReads = useZeropsAtomSelections<CollectionRead<ServiceRecord>>(serviceReadEntries);
  const nowMs = useNowMs();
  const deployments = useMemo<ReadonlyMap<string, Shown<Deployment>>>(
    () =>
      new Map(
        [...serviceReads].map(([projectId, read]) => [projectId, stopDeployment(read, nowMs)]),
      ),
    [nowMs, serviceReads],
  );

  const [trouble, setTrouble] = useState<string | null>(null);
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
  });
  const {
    forges,
    failures: forgeFailures,
    invalidate: invalidateForge,
  } = useZeropsGroupForge({
    giteaOrigin,
    groups: forgeGroups,
    enabled,
  });

  /**
   * Whether this person may tag. The app's own gate — Gitea's tag protection
   * is the one that decides, and a `403` from it says the same sentence
   * (`release.ts`). The group's releasers are the org's admins.
   */
  const mayRelease = organization?.roleCode === "ADMIN" || organization?.roleCode === "OWNER";

  const flows = useMemo<ReadonlyMap<string, ZeropsProjectFlow>>(
    () =>
      enabled
        ? joinProjectFlows({
            groups,
            deploys,
            forges,
            mayRelease,
            failures: { deploys: deployFailures, forge: forgeFailures },
          })
        : EMPTY_FLOWS,
    [deployFailures, deploys, enabled, forgeFailures, forges, groups, mayRelease],
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

  const mergePullRequest = useCallback(
    async (slug: string, pull: Pick<FlowPullRequest, "repository" | "number">) => {
      if (giteaOrigin === undefined) return;
      const client = giteaClientFor(giteaOrigin);
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
    [giteaOrigin, groupOfSlug, run],
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
      if (giteaOrigin === undefined) return;
      const client = giteaClientFor(giteaOrigin);
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
    [giteaOrigin, groupOfSlug, run],
  );

  /** A tag on the group repo's `main`, as the person; Gitea's tag protection is the real gate. */
  const tagAs = useCallback(
    async (slug: string, tag: string, message: string) => {
      if (giteaOrigin === undefined) return;
      const client = giteaClientFor(giteaOrigin);
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
    [giteaOrigin],
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
      if (flow === undefined || giteaOrigin === undefined) return;
      const client = giteaClientFor(giteaOrigin);
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
    [flows, giteaOrigin, run, tagAs],
  );

  const value = useMemo<ZeropsProjectFlowValue>(
    () => ({
      giteaOrigin,
      signedIn,
      signInTrouble,
      flows,
      deployments,
      slugs,
      mateNames,
      pending,
      trouble,
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
      mateNames,
      mergePullRequest,
      pending,
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
