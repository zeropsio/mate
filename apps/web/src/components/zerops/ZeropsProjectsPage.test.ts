import { EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  autoConnectServedZeropsEnvironment,
  hasNoZeropsProject,
  removeFailedZeropsProject,
  retryZeropsProjectConnection,
  ZeropsProjectsHeader,
} from "./ZeropsProjectsPage";
import { exchangeZeropsContainerIdentity } from "~/zerops/useZeropsIdentityExchange";
import projectsPageSource from "./ZeropsProjectsPage.tsx?raw";
import mateActionsSource from "../../zerops/useMateActions.tsx?raw";
import groupDetailSource from "./ZeropsGroupDetail.tsx?raw";

const APP_ORIGIN = "https://zcp-24cb-8080.prg1.zerops.app";
/** A throwaway the door tests hand over in place of a person's own token. */
const TEST_THROWAWAY = {
  platform: {
    mint: async () => ({ id: "token-1", token: "a-throwaway-value" }),
    remove: async () => undefined,
  },
  clientId: "an-org",
  projectId: "a-project",
  nonce: "n1",
};

const ZEROPS_DOOR_GATE = {
  status: "requires-auth",
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: ["zerops-throwaway", "one-time-token"],
    sessionMethods: ["bearer-access-token", "dpop-access-token"],
    sessionCookieName: "t3_session",
  },
} as const;
const SAME_ORIGIN_CANDIDATE = {
  group: "ready" as const,
  containerOrigin: APP_ORIGIN,
};

describe("same-origin Zerops identity bootstrap", () => {
  it("routes configuration reads through scoped resources", () => {
    expect(projectsPageSource).toContain(
      "readZeropsResourceOnce(runtime.resources, request, unmountRef.current?.signal)",
    );
    expect(projectsPageSource).not.toContain(".readAuthorizedAgents(");
    // The recipe is the group repo's, read as the person over Gitea — there is
    // no Zerops endpoint for it and no mock standing in for one any more.
    expect(projectsPageSource).not.toContain(".readRecipeGroup(");
    expect(projectsPageSource).toContain("useZeropsGroupRecipe(");
  });

  it("routes project and service writes through typed runtime commands", () => {
    for (const method of [
      "nameProjectAgent",
      "updateProjectGroupTags",
      "importDevelopmentContainer",
      "enableZeropsMate",
      "enableSubdomainAccess",
      "createProject",
      "importProject",
      "importServicesIntoProject",
      "createToolProject",
      "deleteProject",
    ]) {
      expect(projectsPageSource).not.toContain(`client.${method}(`);
    }
    expect(projectsPageSource).toContain("runtime.commands.createProject(");
    expect(projectsPageSource).toContain("runtime.commands.deleteProject(");
    expect(projectsPageSource).toContain("runtime.commands.importServices(");
    expect(projectsPageSource).toContain("readObservedServices:");
    expect(projectsPageSource).not.toContain("listProjectServices(");
  });

  it("retries the failed ready-container identity exchange instead of restarting provisioning", () => {
    const retryIdentity = vi.fn();
    const retryProvisioning = vi.fn();

    retryZeropsProjectConnection({
      connectError: "Could not connect to this container.",
      readyOrigin: APP_ORIGIN,
      retryIdentity,
      retryProvisioning,
    });

    expect(retryIdentity).toHaveBeenCalledTimes(1);
    expect(retryIdentity).toHaveBeenCalledWith(APP_ORIGIN);
    expect(retryProvisioning).not.toHaveBeenCalled();
  });

  it.each([
    { connectError: null, readyOrigin: APP_ORIGIN },
    { connectError: "Project lookup failed.", readyOrigin: null },
  ])("keeps non-identity failures on the provisioning retry path", (input) => {
    const retryIdentity = vi.fn();
    const retryProvisioning = vi.fn();

    retryZeropsProjectConnection({ ...input, retryIdentity, retryProvisioning });

    expect(retryProvisioning).toHaveBeenCalledTimes(1);
    expect(retryIdentity).not.toHaveBeenCalled();
  });

  it("exposes a compact account header and preserves selection behavior", () => {
    const markup = renderToStaticMarkup(createElement(ZeropsProjectsHeader, {}));
    const attempted = { current: false };
    const connect = vi.fn();
    const input = {
      attempted,
      status: "signed-in" as const,
      zeropsToken: "zerops-account-token",
      appOrigin: APP_ORIGIN,
      authGate: ZEROPS_DOOR_GATE,
      candidates: [SAME_ORIGIN_CANDIDATE],
      connect,
    };

    autoConnectServedZeropsEnvironment(input);
    autoConnectServedZeropsEnvironment(input);

    expect(markup).toContain('data-zerops-project-scope="true"');
    expect(markup).toContain("<h1");
    expect(markup).toContain(">Projects<");
    expect(markup).not.toContain("Environments");
    // The bar above carries the brand; the title row does not repeat it, and
    // no sentence sits under the title — the projects below say what it is.
    expect(markup).not.toContain("micro-label");
    expect(markup).not.toContain(">Zerops<");
    expect(markup).not.toContain("<p");
    // No creating action in the title row: the left menu's "New project" is
    // the entry, and the reload glyph is the row's only action.
    expect(markup).not.toContain("New project");
    expect(markup).not.toContain('data-zerops-primitive="pill"');
    expect(
      renderToStaticMarkup(createElement(ZeropsProjectsHeader, { onRefresh: () => {} })),
    ).toContain('aria-label="Refresh"');
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("fires exactly once for the unauthenticated container that served the app", () => {
    const attempted = { current: false };
    const connect = vi.fn();
    const input = {
      attempted,
      status: "signed-in" as const,
      zeropsToken: "zerops-account-token",
      appOrigin: APP_ORIGIN,
      authGate: ZEROPS_DOOR_GATE,
      candidates: [SAME_ORIGIN_CANDIDATE],
      connect,
    };

    autoConnectServedZeropsEnvironment(input);
    autoConnectServedZeropsEnvironment(input);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(APP_ORIGIN);
  });

  it.each([
    {
      name: "the served container already has a session",
      authGate: ZEROPS_DOOR_GATE,
      candidates: [{ ...SAME_ORIGIN_CANDIDATE, group: "connected" as const }],
      zeropsToken: "zerops-account-token",
    },
    {
      name: "the served container is already establishing its session",
      authGate: ZEROPS_DOOR_GATE,
      candidates: [
        {
          ...SAME_ORIGIN_CANDIDATE,
          connection: { phase: "connecting" as const },
        },
      ],
      zeropsToken: "zerops-account-token",
    },
    {
      name: "the candidate belongs to another origin",
      authGate: ZEROPS_DOOR_GATE,
      candidates: [
        { group: "ready" as const, containerOrigin: "https://another-container.example" },
      ],
      zeropsToken: "zerops-account-token",
    },
    {
      name: "the Zerops account token is absent",
      authGate: ZEROPS_DOOR_GATE,
      candidates: [SAME_ORIGIN_CANDIDATE],
      zeropsToken: null,
    },
    {
      name: "the server does not offer the Zerops throwaway door",
      authGate: {
        ...ZEROPS_DOOR_GATE,
        auth: { ...ZEROPS_DOOR_GATE.auth, bootstrapMethods: ["one-time-token"] as const },
      },
      candidates: [SAME_ORIGIN_CANDIDATE],
      zeropsToken: "zerops-account-token",
    },
  ])("does not fire when $name", ({ authGate, candidates, zeropsToken }) => {
    const connect = vi.fn();

    autoConnectServedZeropsEnvironment({
      attempted: { current: false },
      status: "signed-in",
      zeropsToken,
      appOrigin: APP_ORIGIN,
      authGate,
      candidates,
      connect,
    });

    expect(connect).not.toHaveBeenCalled();
  });

  it("waits for the candidate catalog without spending its one attempt", () => {
    const attempted = { current: false };
    const connect = vi.fn();
    const input = {
      attempted,
      status: "signed-in" as const,
      zeropsToken: "zerops-account-token",
      appOrigin: APP_ORIGIN,
      authGate: ZEROPS_DOOR_GATE,
      connect,
    };

    autoConnectServedZeropsEnvironment({ ...input, candidates: [] });
    autoConnectServedZeropsEnvironment({
      ...input,
      candidates: [SAME_ORIGIN_CANDIDATE],
    });

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("leaves a registered environment's settled failure to the shell repair", () => {
    const attempted = { current: false };
    const connect = vi.fn();
    const input = {
      attempted,
      status: "signed-in" as const,
      zeropsToken: "zerops-account-token",
      appOrigin: APP_ORIGIN,
      authGate: ZEROPS_DOOR_GATE,
      connect,
    };

    autoConnectServedZeropsEnvironment({
      ...input,
      candidates: [
        {
          ...SAME_ORIGIN_CANDIDATE,
          connection: { phase: "connecting" },
        },
      ],
    });
    autoConnectServedZeropsEnvironment({
      ...input,
      candidates: [
        {
          ...SAME_ORIGIN_CANDIDATE,
          connection: { phase: "error" },
        },
      ],
    });

    expect(connect).not.toHaveBeenCalled();
    expect(attempted.current).toBe(false);
  });

  it("surfaces the identity exchange failure reason", async () => {
    const connect = vi
      .fn()
      .mockResolvedValue(AsyncResult.failure(Cause.fail(new Error("Session token expired."))));

    const result = await exchangeZeropsContainerIdentity({
      containerOrigin: APP_ORIGIN,
      appOrigin: APP_ORIGIN,
      basePath: "/mate/",
      throwaway: TEST_THROWAWAY,
      connect,
    });

    expect(connect).toHaveBeenCalledWith({
      httpBaseUrl: `${APP_ORIGIN}/mate`,
      doorToken: "a-throwaway-value",
    });
    expect(result).toEqual({
      _tag: "Failure",
      error: "Could not connect to this container. Session token expired.",
    });
  });

  it("does not attempt an exchange without the Zerops account token", async () => {
    const connect = vi.fn();

    const result = await exchangeZeropsContainerIdentity({
      containerOrigin: APP_ORIGIN,
      appOrigin: APP_ORIGIN,
      basePath: "/mate/",
      throwaway: null,
      connect,
    });

    expect(connect).not.toHaveBeenCalled();
    expect(result).toEqual({
      _tag: "Failure",
      error: "Sign in to Zerops again to connect this container.",
    });
  });

  it("returns the authenticated environment", async () => {
    const environmentId = EnvironmentId.make("environment-1");
    const connect = vi.fn().mockResolvedValue(AsyncResult.success(environmentId));

    const result = await exchangeZeropsContainerIdentity({
      containerOrigin: APP_ORIGIN,
      appOrigin: APP_ORIGIN,
      basePath: "/mate/",
      throwaway: TEST_THROWAWAY,
      connect,
    });

    expect(result).toEqual({ _tag: "Success", environmentId });
  });
});

describe("removeFailedZeropsProject", () => {
  it("deletes, then forgets the creation and re-reads the list, in that order", async () => {
    const calls: Array<string> = [];
    const outcome = await removeFailedZeropsProject({
      projectId: "proj-1",
      deleteProject: async (projectId) => {
        calls.push(`delete:${projectId}`);
      },
      forgetCreation: (projectId) => {
        calls.push(`forget:${projectId}`);
      },
      refresh: () => {
        calls.push("refresh");
      },
    });

    expect(outcome).toEqual({ ok: true });
    expect(calls).toEqual(["delete:proj-1", "forget:proj-1", "refresh"]);
  });

  it("keeps the handoff and the list when the platform refuses the delete", async () => {
    const calls: Array<string> = [];
    const outcome = await removeFailedZeropsProject({
      projectId: "proj-1",
      deleteProject: () => Promise.reject(new Error("A process is running.")),
      forgetCreation: (projectId) => {
        calls.push(`forget:${projectId}`);
      },
      refresh: () => {
        calls.push("refresh");
      },
    });

    expect(outcome).toEqual({ ok: false, error: "A process is running." });
    expect(calls).toEqual([]);
  });
});

describe("hasNoZeropsProject", () => {
  const candidate = (tagList: ReadonlyArray<string>) =>
    ({ project: { id: tagList.join("|"), name: "p", status: "ACTIVE", tagList } }) as never;

  it.each([
    ["nothing at all", [], true],
    ["a project in a group", [candidate(["mate:g:aaa", "mate:role:dev"])], false],
    ["a project in no group", [candidate([])], false],
    // A tool is not a project: an account holding only Gitea has not started.
    ["only a tool", [candidate(["mate:tool:gitea"])], true],
  ] as const)("says an account with %s has no project: %s", (_case, candidates, expected) => {
    expect(hasNoZeropsProject({ candidates, unread: false })).toBe(expected);
  });

  it("answers no while the first list is still being read", () => {
    // Otherwise the invitation paints for a second and the roster takes it back.
    expect(hasNoZeropsProject({ candidates: [], unread: true })).toBe(false);
  });

  it("keeps an empty organization's invitation up while its list is re-read", () => {
    // The owner's run of 2026-09-17: a re-read every twenty seconds while a
    // creation was on its way, and the page painted "Reading your projects…"
    // over what it had a moment ago.
    expect(hasNoZeropsProject({ candidates: [], unread: false })).toBe(true);
  });

  it("answers no while a creation this client made is not listed yet", () => {
    // The wizard lands here before the inventory carries the new project;
    // the invitation must not paint in that gap only to be taken back.
    expect(hasNoZeropsProject({ candidates: [], unread: false, creationPending: true })).toBe(
      false,
    );
  });
});

describe("an environment's menu", () => {
  it("carries a Mate's verbs only for a Mate — a stage or a production has none", () => {
    // The audit run, 2026-09-17: a stage's menu offered "Hand this Mate over"
    // and "Change project or role". The gate used to be repeated on every
    // entry; now the whole set is withheld at once, which cannot be got half
    // right.
    expect(projectsPageSource).toContain(
      "actions={mate ? mateActions.actionsFor(candidate, tags, updateMenuActions ?? []) : []}",
    );
  });

  it("gates each verb on what this person may finish, wherever the menu is drawn", () => {
    // Guide 0.8: a verb the platform would refuse from this role is not
    // offered. The gate lives with the verb now, so a second surface cannot
    // grow a menu without it.
    expect(mateActionsSource).toContain("resolveMateVerbs({ project: candidate.project, viewer })");
    expect(mateActionsSource).toContain("...(verbs.assign");
    expect(mateActionsSource).toContain("...(verbs.move");
    expect(mateActionsSource).toContain("...(verbs.rename");
    expect(mateActionsSource).toContain("...(verbs.move && tags.groupId !== undefined");
  });

  it("carries the update verbs wherever a Mate is listed, not only on the projects screen", () => {
    // "Check for updates" and "Update to x.y.z" come from a control that
    // holds the server's own answer, so a page that lists Mates mounts it
    // per Mate rather than re-deriving the verbs. A project's page used to
    // be the one place a Mate's update could not be started from.
    expect(groupDetailSource).toContain("<ZeropsMateUpdateControl environmentId=");
    expect(groupDetailSource).toContain("{({ menuActions }) => menu(menuActions)}");
  });
});
