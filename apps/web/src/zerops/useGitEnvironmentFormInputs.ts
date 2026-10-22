/**
 * What the Git environment sheet reads and writes for one application, as HQ streams it: the
 * environment names it holds, its repositories, HQ's offers and the account's coordinator. The
 * projects page's Add stage / Add production open the sheet on it.
 */
import { useAtomValue } from "@effect/atom-react";
import { shownCanonicalHqListNavigationAtom } from "@t3tools/client-runtime/data";
import type { CanonicalHqNavigationEnvironment } from "@t3tools/shared/hqStream";

import type { GitEnvironmentFormProps } from "../components/zerops/GitEnvironmentForm";
import { useAccountOperationsOptional } from "./accountOperations";
import { hqProjectIdOf } from "./hqWrites";
import { gitEnvironmentSetup } from "./setUpEnvironment";
import { useHqAppDetail } from "./useHqAppDetail";
import { useHqOffers } from "./useHqOffers";

export type GitEnvironmentFormInputs = Pick<
  GitEnvironmentFormProps,
  "takenNames" | "repos" | "offered" | "unavailableReason" | "setup"
>;

/**
 * The sheet's inputs for an application of the organization; `undefined` without either, or
 * outside an account's coordinator.
 */
export function useGitEnvironmentFormInputs(
  orgId: string | null | undefined,
  appId: string | null,
): GitEnvironmentFormInputs | undefined {
  const navigation = useAtomValue(shownCanonicalHqListNavigationAtom);
  const detail = useHqAppDetail(appId);
  const hqOffers = useHqOffers();
  const operations = useAccountOperationsOptional();
  const hqProjectId = orgId == null ? null : hqProjectIdOf(orgId);
  if (orgId == null || appId === null || hqProjectId === null || operations === null)
    return undefined;
  const app = navigation.structure?.apps.find((entry) => entry.id === appId);
  const add = hqOffers.state(app?.can, "add_git_environment");
  const offered = (verb: string) => hqOffers.state(app?.can, verb).kind === "allowed";
  return {
    takenNames:
      navigation.live && Array.isArray(app?.environments)
        ? app.environments.map((environment) => environment.name)
        : undefined,
    repos: detail.live ? detail.repos : undefined,
    offered: {
      add: add.kind === "allowed",
      connect: offered("connect_remote"),
      replace: offered("replace_remote_token"),
    },
    unavailableReason: hqOffers.words(add),
    setup: gitEnvironmentSetup({ orgId, appId, hqProjectId, operations }),
  };
}

/**
 * The application a Zerops project is in, as HQ's structure holds it: its id, name and
 * environments — `undefined` while HQ's structure is not live or refuses them.
 */
export function useApplicationOfProject(projectId: string | undefined):
  | {
      readonly id: string;
      readonly name: string;
      readonly environments: ReadonlyArray<CanonicalHqNavigationEnvironment> | undefined;
    }
  | undefined {
  const navigation = useAtomValue(shownCanonicalHqListNavigationAtom);
  if (projectId === undefined) return undefined;
  const app = navigation.structure?.apps.find((entry) =>
    entry.projects.some((project) => project.projectId === projectId),
  );
  return app === undefined
    ? undefined
    : {
        id: app.id,
        name: app.name,
        environments:
          navigation.live && Array.isArray(app.environments) ? app.environments : undefined,
      };
}
