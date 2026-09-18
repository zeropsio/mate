/**
 * Reads every project's flow once for the whole account, and holds the verbs
 * that move it (`projectFlowContext.ts`, D26).
 *
 * Two reads are joined here, each from the party that can prove it: the
 * account says which projects a group holds and which commit each service
 * of them runs (`useZeropsGroupDeploys`), Gitea says what is waiting to land
 * and what was released (`useZeropsGroupForge`). The declarations in the
 * group repo say which of those projects are environments and what feeds
 * them; the registry says which Gitea org a group is.
 *
 * Signed in to Mate is signed in to Gitea (D21): the provider signs the tab
 * in by itself, and until that lands every flow is empty and the surfaces
 * say so where they stand.
 */
import {
  botDisplayName,
  environmentRow,
  flowVerbKey,
  readZeropsGroupTags,
  releaseBasis,
  releaseDeploys,
  releaseMessage,
  releaseOffer,
  releaseRow,
  releaseTagName,
  rollbackTo,
  summarizeEnvironmentServices,
  GROUP_REPOSITORY,
  type FlowPullRequest,
} from "@t3tools/client-runtime/zerops";
import { zeropsThrowawayPlatform } from "@t3tools/client-runtime/zerops/doorThrowaway";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { findAccountGitea } from "./giteaProject";
import { giteaClientFor, useGiteaSession } from "./giteaSession";
import {
  ZeropsProjectFlowContext,
  type ZeropsProjectFlow,
  type ZeropsProjectFlowValue,
} from "./projectFlowContext";
import { useZeropsDeployedVersionReader } from "./useZeropsDeployedVersion";
import { useZeropsGroupDeploys, type ZeropsDeployGroup } from "./useZeropsGroupDeploys";
import { useZeropsGroupForge } from "./useZeropsGroupForge";
import { useZeropsRegistry } from "./useZeropsRegistry";
import { useZeropsInventory } from "./ZeropsInventoryProvider";
import { useZeropsSession } from "./ZeropsSessionProvider";

const EMPTY_FLOWS: ReadonlyMap<string, ZeropsProjectFlow> = new Map();

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
            return {
              projectId: project.id,
              name: project.name,
              services:
                services?.status === "resolved"
                  ? summarizeEnvironmentServices(services.services).deployable
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

  const [generation, setGeneration] = useState(0);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const readVersion = useZeropsDeployedVersionReader();
  const enabled = signedInToMate && signedIn;
  const deploys = useZeropsGroupDeploys({ groups, giteaOrigin, readVersion, enabled });
  const forges = useZeropsGroupForge({ giteaOrigin, groups: forgeGroups, generation, enabled });

  /**
   * Whether this person may tag. The app's own gate — Gitea's tag protection
   * is the one that decides, and a `403` from it says the same sentence
   * (`release.ts`). The group's releasers are the org's admins.
   */
  const mayRelease = organization?.roleCode === "ADMIN" || organization?.roleCode === "OWNER";

  const flows = useMemo<ReadonlyMap<string, ZeropsProjectFlow>>(() => {
    if (!enabled) return EMPTY_FLOWS;
    const next = new Map<string, ZeropsProjectFlow>();
    for (const group of groups) {
      const deployed = deploys.get(group.groupId);
      const forge = forges.get(group.groupId);
      if (deployed === undefined && forge === undefined) continue;
      const environmentInputs = deployed?.environments ?? [];
      const sides = releaseDeploys(environmentInputs);
      const tags = forge?.tags ?? [];
      const declarations = deployed?.declarations ?? [];
      // A project with no stage releases what is merged (D28): the candidate
      // is each production repository's `main`, which the deploys hook reads
      // only for such a project.
      const basis = releaseBasis(declarations);
      const candidate = basis === "main" ? (deployed?.mainHeads ?? new Map()) : sides.stage;
      next.set(group.groupId, {
        groupId: group.groupId,
        slug: group.slug,
        declarations,
        environments: environmentInputs.map((entry) => environmentRow(entry)),
        environmentInputs,
        missing: deployed?.missing ?? [],
        pullRequests: forge?.pullRequests ?? [],
        releases: (forge?.releases ?? []).map((release, index) => releaseRow(release, index)),
        release: releaseOffer({
          mayRelease,
          basis,
          candidate,
          production: sides.production,
          tags,
        }),
      });
    }
    return next;
  }, [deploys, enabled, forges, groups, mayRelease]);

  const settled = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);

  /** Holds the verb's key in `pending` while it runs, then reads the flow again. */
  const run = useCallback(
    async (key: string, act: () => Promise<void>) => {
      setPending((current) => new Set(current).add(key));
      try {
        await act();
      } finally {
        setPending((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
        settled();
      }
    },
    [settled],
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
        flowVerbKey({ kind: "merge", slug, repository: pull.repository, number: pull.number }),
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
    [giteaOrigin, run],
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
        flowVerbKey({ kind: "open", slug, repository: input.repository, head: input.head }),
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
    [giteaOrigin, run],
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
      await run(flowVerbKey({ kind: "release", groupId }), () =>
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
      await run(flowVerbKey({ kind: "roll-back", groupId, tag: earlier }), async () => {
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
      slugs,
      mateNames,
      pending,
      trouble,
      refresh: settled,
      mergePullRequest,
      createPullRequest,
      release,
      rollBack,
    }),
    [
      createPullRequest,
      flows,
      giteaOrigin,
      mateNames,
      mergePullRequest,
      pending,
      release,
      rollBack,
      settled,
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
