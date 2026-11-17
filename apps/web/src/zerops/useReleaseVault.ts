/**
 * What a release reads that production's vault lacks (`releaseVault`), wired to the tab: the
 * production tier from the application's detail (where each service builds from, the setup it
 * deploys), each released service's zerops.yaml at the commit the release deploys from HQ's Git
 * browser (pinned to its commit, read once), and production's variables, held while asked.
 */
import {
  releaseVault,
  type GitBrowseView,
  type ReleasedSetup,
  type ReleaseVaultView,
} from "@t3tools/client-runtime/data";
import {
  releaseReadTargets,
  zeropsYamlSetupEnv,
  ZEROPS_YAML_NAMES,
} from "@t3tools/client-runtime/zerops";
import type { GitBrowseValue } from "@t3tools/client-runtime/zerops/gitBrowse/reads";
import { Atom } from "effect/reactivity";
import { useMemo } from "react";

import { useGitBrowseReads } from "./useGitBrowse";
import { useHqAppDetail } from "./useHqAppDetail";
import { useAccountOrgId, useDetailDemand, useProjection } from "./ZeropsAccountData";

const READING: ReleaseVaultView = { state: "reading" };
const UNKNOWN: ReleaseVaultView = { state: "unknown" };
const READING_ATOM = Atom.make(READING);

/** A deploy file as read: its text, still being read, or not to be read here. */
type FileRead = string | "reading" | "unreadable";

const fileOf = (view: GitBrowseView<GitBrowseValue<"blob">> | undefined): FileRead | "absent" => {
  if (view === undefined || view.state === "unread") return "reading";
  if (view.state === "known")
    return view.answer.content === null || view.answer.truncated
      ? "unreadable"
      : view.answer.content;
  // HQ refuses a path the commit lacks: the next name is read, as Core reads it.
  return view.state === "refused" ? "absent" : "unreadable";
};

export function useReleaseVault(input: {
  readonly appId: string | undefined;
  /** Production's Zerops project; none for a production that is not one. */
  readonly productionProjectId: string | undefined;
  /** Each service the release deploys, at its commit. */
  readonly deploys: ReadonlyArray<{ readonly service: string; readonly sha: string }>;
  /** The services the release creates in production, by hostname. */
  readonly creates: ReadonlyArray<string>;
  readonly enabled: boolean;
}): ReleaseVaultView {
  const { appId, productionProjectId, enabled } = input;
  const asked = enabled && appId !== undefined && productionProjectId !== undefined;
  const orgId = useAccountOrgId();
  const detail = useHqAppDetail(asked ? appId : null);
  const tier = detail.recipes.production;
  const tierYaml = tier?.state === "present" ? tier.importYaml : undefined;
  const deploysKey = JSON.stringify(input.deploys);
  const targets = useMemo(
    () =>
      tierYaml === undefined
        ? []
        : releaseReadTargets(
            tierYaml,
            JSON.parse(deploysKey) as ReadonlyArray<{ service: string; sha: string }>,
          ),
    [deploysKey, tierYaml],
  );
  const request = (repository: string, sha: string, path: string) => ({
    appId: appId ?? "",
    repo: repository,
    read: "blob" as const,
    params: { sha, path },
  });
  const first = useGitBrowseReads(
    asked
      ? targets.map((target) => request(target.repository, target.sha, ZEROPS_YAML_NAMES[0]))
      : [],
    asked,
  );
  const firsts = targets.map((_, at) => fileOf(first.views[at]));
  const fallback = targets.flatMap((target, at) => (firsts[at] === "absent" ? [target] : []));
  const second = useGitBrowseReads(
    asked
      ? fallback.map((target) => request(target.repository, target.sha, ZEROPS_YAML_NAMES[1]))
      : [],
    asked,
  );
  const files: ReadonlyArray<FileRead> = targets.map((target, at) => {
    const said = firsts[at]!;
    if (said !== "absent") return said;
    const next = fileOf(second.views[fallback.indexOf(target)]);
    return next === "absent" ? "unreadable" : next;
  });
  const reading = files.includes("reading");
  const releasedKey = JSON.stringify(
    reading
      ? []
      : targets.flatMap((target, at): ReadonlyArray<ReleasedSetup> => {
          const file = files[at]!;
          const env =
            file === "reading" || file === "unreadable"
              ? undefined
              : zeropsYamlSetupEnv(file, target.setup);
          return env === undefined ? [] : [{ hostname: target.hostname, ...env }];
        }),
  );
  const released = useMemo(
    () => JSON.parse(releasedKey) as ReadonlyArray<ReleasedSetup>,
    [releasedKey],
  );
  const createsKey = input.creates.join("\n");
  useDetailDemand("projectVariables", undefined, asked ? (productionProjectId ?? null) : null);
  useDetailDemand("serviceVariable", undefined, asked ? (productionProjectId ?? null) : null);
  const key = useMemo(
    () =>
      !asked || orgId === null || productionProjectId === undefined || released.length === 0
        ? null
        : {
            orgId,
            projectId: productionProjectId,
            released,
            creates: createsKey === "" ? [] : createsKey.split("\n"),
          },
    [asked, createsKey, orgId, productionProjectId, released],
  );
  const view = useProjection(releaseVault, key, READING_ATOM);
  if (!asked) return UNKNOWN;
  // The tier says where each service builds from: until HQ said it nothing is read.
  if (tier === undefined)
    return detail.failure === null && detail.read !== "read" ? READING : UNKNOWN;
  if (tierYaml === undefined || targets.length === 0) return UNKNOWN;
  if (reading) return READING;
  // No deploy file read as one: what Zerops would refuse is not guessed at.
  if (released.length === 0) return UNKNOWN;
  return view;
}
