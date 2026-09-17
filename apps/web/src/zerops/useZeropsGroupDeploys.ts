/**
 * What every group's environments are running, for the projects screen.
 *
 * Three reads, in the one order they can happen in (`groupDeploys.ts`): the
 * group repo's `environments.yaml` says which environments there are, Zerops
 * says which commit each service of them is running, and Gitea says how that
 * deploy went. The middle one produces the commit the last one needs, so they
 * cannot be issued together.
 *
 * ## What a missing answer does: nothing
 *
 * Not signed in to Gitea in this tab, or the broker has not made the group's
 * repositories yet, and the group simply keeps the rows it already had — the
 * environments are still read from the account, they just carry no commit and
 * no deploy word. A row's height never depends on which of the three landed
 * (`environmentRow`), so the page does not move under somebody arriving.
 *
 * The platform read is the caller's to perform: the one-shot resource lease
 * lives on the screen that owns the account scope, and handing it in keeps
 * this module out of the page's import cycle.
 */

import {
  buildGroupEnvironmentRowInputs,
  deployStatusKey,
  missingEnvironmentRows,
  planDeployStatusReads,
  planDeployedVersionReads,
  readGroupEnvironments,
  RECIPE_TIER_PATHS,
  type GiteaCommitStatus,
  type GiteaPullRequest,
  type GroupEnvironment,
  type GroupEnvironmentRowInput,
  type GroupEnvironmentService,
  type GroupEnvironmentTier,
  type MissingEnvironmentRow,
} from "@t3tools/client-runtime/zerops";
import { useEffect, useState } from "react";

import { giteaClientFor } from "./giteaSession";

/** Where `environments.yaml` lives, and what the group repo is called. */
const GROUP_REPOSITORY = "group";
const ENVIRONMENTS_PATH = "environments.yaml";
/**
 * How often the group repo is read again while the screen is open. The
 * recipe lands on `main` minutes after the Mate is up, by the broker's hand
 * and not the account's, so nothing in the inventory says it did; the rows
 * that ask for a stage and a production follow it on this clock.
 */
export const GROUP_DEPLOYS_REFRESH_MS = 60_000;

/** One group, as this hook needs to see it. */
export interface ZeropsDeployGroup {
  readonly groupId: string;
  /** Its Gitea org, from the registry. */
  readonly slug: string;
  /** Every Zerops project of the group the account can see. */
  readonly projects: ReadonlyArray<{
    readonly projectId: string;
    readonly name: string;
    /** Its runtime services — the ones that hold code the broker deploys. */
    readonly services: ReadonlyArray<{ readonly serviceId: string; readonly hostname: string }>;
  }>;
}

/** What the group repo answers about one group. */
export interface ZeropsGroupDeployState {
  readonly environments: ReadonlyArray<GroupEnvironmentRowInput>;
  /** The recipe changes waiting on somebody — the group repo's open pulls. */
  readonly pullRequests: ReadonlyArray<GiteaPullRequest>;
  /** The tiers the recipe offers and the group has not added — the rows that ask. */
  readonly missing: ReadonlyArray<MissingEnvironmentRow>;
}

export type ZeropsGroupDeploys = ReadonlyMap<string, ZeropsGroupDeployState>;

const EMPTY: ZeropsGroupDeploys = new Map();

/** Serialises what the reads depend on, so an unchanged account is read once. */
function readKey(
  groups: ReadonlyArray<ZeropsDeployGroup>,
  giteaOrigin: string | undefined,
): string {
  return JSON.stringify([
    giteaOrigin ?? "",
    groups.map((group) => [
      group.slug,
      group.projects.map((project) => [
        project.projectId,
        project.services.map((service) => service.serviceId).toSorted(),
      ]),
    ]),
  ]);
}

export function useZeropsGroupDeploys(input: {
  readonly groups: ReadonlyArray<ZeropsDeployGroup>;
  readonly giteaOrigin: string | undefined;
  /** Reads one service's deployed version name, through the account's runtime. */
  readonly readVersion: (
    projectId: string,
    serviceId: string,
    signal: AbortSignal,
  ) => Promise<string | undefined>;
  readonly enabled: boolean;
}): ZeropsGroupDeploys {
  const { enabled, giteaOrigin, groups, readVersion } = input;
  const key = enabled && giteaOrigin !== undefined ? readKey(groups, giteaOrigin) : "";
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly deploys: ZeropsGroupDeploys;
  } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (key === "") return;
    const timer = window.setInterval(() => {
      setTick((count) => count + 1);
    }, GROUP_DEPLOYS_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [key]);

  useEffect(() => {
    if (key === "" || giteaOrigin === undefined) return;
    const client = giteaClientFor(giteaOrigin);
    const controller = new AbortController();

    void (async () => {
      const deploys = new Map<string, ZeropsGroupDeployState>();
      for (const group of groups) {
        if (controller.signal.aborted) return;
        // Signed in to Gitea or not, the group's declarations are the group
        // repo's: with no session there is nothing to declare from and the
        // group keeps whatever the account alone can say, which is nothing.
        const declarations =
          client === null
            ? []
            : await readDeclarations(client, group.slug).catch(
                (): ReadonlyArray<GroupEnvironment> => [],
              );
        const pullRequests =
          client === null
            ? []
            : await client
                .listPullRequests(group.slug, GROUP_REPOSITORY, { state: "open" })
                .catch((): ReadonlyArray<GiteaPullRequest> => []);
        const tiersOnMain =
          client === null
            ? []
            : await readTiersOnMain(client, group.slug).catch(
                (): ReadonlyArray<GroupEnvironmentTier> => [],
              );
        if (controller.signal.aborted) return;
        const missing = missingEnvironmentRows({ tiersOnMain, declarations });
        if (declarations.length === 0 && pullRequests.length === 0 && missing.length === 0)
          continue;

        const services: ReadonlyArray<GroupEnvironmentService> = group.projects.flatMap((project) =>
          project.services.map((service) => ({
            projectId: project.projectId,
            serviceId: service.serviceId,
            hostname: service.hostname,
          })),
        );
        const versions = new Map<string, string>();
        for (const read of planDeployedVersionReads({ declarations, services })) {
          const name = await readVersion(read.projectId, read.serviceId, controller.signal);
          if (controller.signal.aborted) return;
          if (name !== undefined) versions.set(read.serviceId, name);
        }

        const statuses = new Map<string, ReadonlyArray<GiteaCommitStatus>>();
        if (client !== null) {
          const reads = planDeployStatusReads({
            owner: group.slug,
            versions: services.map((service) => ({
              hostname: service.hostname,
              appVersionName: versions.get(service.serviceId),
            })),
          });
          for (const read of reads) {
            // A refusal is not an answer: the row says nothing about a deploy
            // it could not be told about, rather than calling it neutral.
            const answered = await client
              .listCommitStatuses(read.owner, read.repo, read.sha)
              .catch(() => null);
            if (controller.signal.aborted) return;
            if (answered !== null) statuses.set(deployStatusKey(read), answered);
          }
        }

        deploys.set(group.groupId, {
          pullRequests,
          missing,
          environments: buildGroupEnvironmentRowInputs({
            owner: group.slug,
            declarations,
            projectNames: new Map(
              group.projects.map((project) => [project.projectId, project.name]),
            ),
            services,
            versions,
            statuses,
          }),
        });
      }
      if (!controller.signal.aborted) setAnswer({ key, deploys });
    })();

    return () => {
      controller.abort();
    };
    // `key` is the serialisation of `groups`, which is what the reads depend
    // on; keying on the array's identity would read the whole account again
    // on every render. `tick` is the clock: the same reads again, with what
    // was read last staying up until they land.
  }, [giteaOrigin, groups, key, readVersion, tick]);

  return answer?.key === key ? answer.deploys : EMPTY;
}

/** The tiers whose import is on the group repo's `main` — what a person can add. */
async function readTiersOnMain(
  client: NonNullable<ReturnType<typeof giteaClientFor>>,
  slug: string,
): Promise<ReadonlyArray<GroupEnvironmentTier>> {
  const tiers: ReadonlyArray<GroupEnvironmentTier> = ["stage", "production"];
  const present = await Promise.all(
    tiers.map(async (tier) => {
      const file = await client
        .readFile(slug, GROUP_REPOSITORY, RECIPE_TIER_PATHS[tier], "main")
        .catch(() => undefined);
      return file === undefined ? [] : [tier];
    }),
  );
  return present.flat();
}

async function readDeclarations(
  client: NonNullable<ReturnType<typeof giteaClientFor>>,
  slug: string,
): Promise<ReadonlyArray<GroupEnvironment>> {
  const file = await client.readFile(slug, GROUP_REPOSITORY, ENVIRONMENTS_PATH, "main");
  return file === undefined ? [] : readGroupEnvironments(file.content);
}
