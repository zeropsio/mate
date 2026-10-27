/**
 * "Add stage" and "Add production", asked from a project's menu in the left menu or from the
 * project's own page: they open the form the projects page's own ⋯ opens, on that
 * page, where the creation's checklist runs. They only landed on the page once, leaving the person
 * to find the verb again (the owner, 2026-09-30: a menu item must open what it names).
 *
 * The store holds the one ask in the air; the projects page takes it as it draws, so the form
 * opens once per ask and never again on a later visit.
 */
import type { GroupEnvironmentTier } from "@t3tools/client-runtime/zerops";
import { create } from "zustand";

/** A stage or a production asked for in a project. */
export interface SetUpEnvironmentAsk {
  readonly groupId: string;
  readonly role: "stage" | "prod";
}

interface SetUpEnvironmentState {
  readonly asked: SetUpEnvironmentAsk | null;
  readonly ask: (groupId: string, tier: GroupEnvironmentTier) => void;
  /** The ask in the air, handed over once: it is gone after. */
  readonly take: () => SetUpEnvironmentAsk | null;
}

export const useSetUpEnvironment = create<SetUpEnvironmentState>((set, get) => ({
  asked: null,
  ask: (groupId, tier) => {
    set({ asked: { groupId, role: tier === "production" ? "prod" : "stage" } });
  },
  take: () => {
    const { asked } = get();
    if (asked !== null) set({ asked: null });
    return asked;
  },
}));

/** The setup form submits to the mounted account's one coordinator, never directly to HQ. */
export interface GitEnvironmentSetup {
  readonly connect: (
    repo: string,
    url: string,
    token: string,
    replace: boolean,
    branch?: string,
  ) => Promise<import("@t3tools/shared/hqChanges").HqRemoteProbe>;
  readonly preview: (
    branch: string,
  ) => Promise<ReadonlyArray<import("@t3tools/shared/hqChanges").HqGitAdoption>>;
  readonly add: (
    request: import("@t3tools/shared/hqChanges").AddGitEnvironmentRequest,
  ) => Promise<void>;
}

export function gitEnvironmentSetup(input: {
  readonly orgId: string;
  readonly appId: string;
  readonly hqProjectId: string;
  readonly operations: Pick<
    import("./accountOperations").AccountOperations,
    "run" | "runGitCandidate"
  >;
}): GitEnvironmentSetup {
  const { operations, ...scope } = input;
  return {
    connect: (repo, url, token, replace, branch) => {
      if (operations.runGitCandidate === undefined)
        return Promise.reject(new Error("Update the client to connect a Git remote."));
      return operations.runGitCandidate(
        replace
          ? {
              kind: "replace-git-remote-token",
              ...scope,
              repo,
              ...(branch === undefined ? {} : { branch }),
            }
          : {
              kind: "connect-git-remote",
              ...scope,
              repo,
              url,
              ...(branch === undefined ? {} : { branch }),
            },
        token,
      );
    },
    preview: (branch) =>
      operations.run(
        {
          kind: "preview-git-environment",
          ...scope,
          request: { target: { kind: "git", branch, delivery: "direct" } },
        },
        {
          orgId: scope.orgId,
          unobserved: "HQ isn't answering. Review the branch again when it returns.",
        },
      ),
    add: async (request) => {
      await operations.run(
        { kind: "add-git-environment", ...scope, request },
        {
          orgId: scope.orgId,
          unobserved:
            "HQ isn't answering. It may have added the environment; check its record before trying again.",
        },
      );
    },
  };
}
