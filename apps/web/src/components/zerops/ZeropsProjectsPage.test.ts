import { EnvironmentId } from "@t3tools/contracts";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  ZeropsAccountId,
  ZeropsOrganizationId,
  makeZeropsApiOrigin,
  type OrganizationRef,
} from "@t3tools/client-runtime/zerops/data";
import type { Invalidation, Known } from "@t3tools/client-runtime/zerops/knowledge";
import { INVALIDATION_COALESCE_MS } from "@t3tools/client-runtime/zerops/knowledge/invalidation";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import { AsyncResult } from "effect/unstable/reactivity";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  autoConnectServedZeropsEnvironment,
  declaredEnvironmentSummary,
  hasNoZeropsProject,
  mateOpener,
  projectsGroupLine,
  projectsListingNotice,
  projectsTroubleView,
  readContainerAfter,
  readContainerAgain,
  removeFailedZeropsProject,
  retryZeropsProjectConnection,
  showsZeropsBirthLine,
  ZeropsProjectsHeader,
} from "./ZeropsProjectsPage";
import { bindTestInvalidationBus } from "~/zerops/__fixtures__/invalidationBus";
import { onZeropsInvalidation } from "~/zerops/accountInvalidations";
import { closeAccountLifetime, openAccountLifetime } from "~/zerops/accountLifetime";
import { exchangeZeropsContainerIdentity } from "@t3tools/client-runtime/zerops/identityExchange";
import projectsPageSource from "./ZeropsProjectsPage.tsx?raw";
import pressSource from "../../zerops/matePress.ts?raw";
import creationSource from "../../zerops/useEnvironmentCreation.ts?raw";
import mateActionsSource from "../../zerops/useMateActions.tsx?raw";
import groupDetailSource from "./ZeropsGroupDetail.tsx?raw";
import gitPageSource from "./ZeropsGitPage.tsx?raw";
import sidebarTreeSource from "./SidebarZeropsTree.tsx?raw";
import sidebarSource from "../Sidebar.tsx?raw";
import newProjectPortsSource from "../../zerops/useNewProjectBirthPorts.ts?raw";
import verdictPanelSource from "./primitives/VerdictPanel.tsx?raw";
import releaseRowsSource from "./ZeropsReleaseRows.tsx?raw";
import historyViewSource from "./ZeropsHistoryView.tsx?raw";

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
    expect(projectsPageSource).toContain("useReadGroupAgents()");
    expect(projectsPageSource).not.toContain(".readAuthorizedAgents(");
    // The recipe is the application's, read as the person through its HQ — there
    // is no Zerops endpoint for it and no mock standing in for one any more.
    expect(projectsPageSource).not.toContain(".readRecipeGroup(");
    expect(projectsPageSource).toContain("useZeropsGroupRecipe(");
  });

  it("routes project and service writes through typed runtime commands", () => {
    for (const method of [
      "writeProject",
      "importDevelopmentContainer",
      "writeMateFlag",
      "enableSubdomainAccess",
      "createProject",
      "importProject",
      "importServicesIntoProject",
      "deleteProject",
    ]) {
      expect(projectsPageSource).not.toContain(`client.${method}(`);
      expect(creationSource).not.toContain(`client.${method}(`);
    }
    // The creation itself is the account's (`useEnvironmentCreation`), shared with the New Mate
    // dialog over any view.
    expect(pressSource).toContain("data.runtime.commands.createProject(");
    expect(pressSource).toContain("data.runtime.commands.importServices(");
    expect(creationSource).toContain("readObservedServices:");
    expect(projectsPageSource).not.toContain("listProjectServices(");
    expect(creationSource).not.toContain("listProjectServices(");
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
    expect(markup).not.toMatch(/<p[\s>]/);
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

    const result = await exchangeZeropsContainerIdentity(
      { throwaway: TEST_THROWAWAY, connect },
      APP_ORIGIN,
      { reason: "user", servedApp: { origin: APP_ORIGIN, basePath: "/mate/" } },
    );

    expect(connect).toHaveBeenCalledWith({
      httpBaseUrl: `${APP_ORIGIN}/mate`,
      doorToken: "a-throwaway-value",
    });
    expect(result).toEqual({
      _tag: "Failure",
      error: "Could not connect to this container. Session token expired.",
      retryable: false,
    });
  });

  it("does not attempt an exchange without the Zerops account token", async () => {
    const connect = vi.fn();

    const result = await exchangeZeropsContainerIdentity({ throwaway: null, connect }, APP_ORIGIN, {
      reason: "user",
      servedApp: { origin: APP_ORIGIN, basePath: "/mate/" },
    });

    expect(connect).not.toHaveBeenCalled();
    expect(result).toEqual({
      _tag: "Failure",
      error: "Sign in to Zerops again to connect this container.",
      retryable: false,
    });
  });

  it("returns the authenticated environment", async () => {
    const environmentId = EnvironmentId.make("environment-1");
    const connect = vi.fn().mockResolvedValue(AsyncResult.success(environmentId));

    const result = await exchangeZeropsContainerIdentity(
      { throwaway: TEST_THROWAWAY, connect },
      APP_ORIGIN,
      { reason: "user", servedApp: { origin: APP_ORIGIN, basePath: "/mate/" } },
    );

    expect(result).toEqual({ _tag: "Success", environmentId });
  });
});

// Opening a Mate that exists runs a wait and a connect too; the checklist
// flashed on every click with a clock from the project's creation.
describe("showsZeropsBirthLine", () => {
  it.each([
    { name: "a Mate being born", births: ["p1"], expected: true },
    { name: "a Mate that exists, being opened", births: [], expected: false },
    { name: "another project's birth", births: ["p2"], expected: false },
  ])("$name: $expected", ({ births, expected }) => {
    expect(showsZeropsBirthLine({ projectId: "p1", birthProjectIds: new Set(births) })).toBe(
      expected,
    );
  });
});

const ORGANIZATION: OrganizationRef = {
  kind: "organization",
  account: {
    apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
    accountId: ZeropsAccountId.make("account"),
  },
  organizationId: ZeropsOrganizationId.make("org-1"),
};

/** What the account's bus delivers for the intents `run` sends, once their window has closed. */
async function heardFrom(run: () => unknown): Promise<ReadonlyArray<Invalidation>> {
  vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
  const hrtime = vi
    .spyOn(process.hrtime, "bigint")
    .mockImplementation(() => BigInt(Math.round(performance.now() * 1_000_000)));
  openAccountLifetime("account");
  const bus = bindTestInvalidationBus();
  const heard: Array<Invalidation> = [];
  const stop = onZeropsInvalidation((invalidation) => heard.push(invalidation));
  try {
    await run();
    await vi.advanceTimersByTimeAsync(INVALIDATION_COALESCE_MS);
    return heard;
  } finally {
    stop();
    bus.close();
    closeAccountLifetime();
    hrtime.mockRestore();
    vi.useRealTimers();
  }
}

describe("the page's refreshes are intents (DESIGN §6.2)", () => {
  const mate = { project: { id: "project-1" }, service: { id: "service-1" } };
  const read: Invalidation = { topic: "container", target: "project-1:service-1" };
  it.each([
    {
      name: "a re-probe reads its container again",
      run: () => readContainerAgain(mate),
      want: [read],
    },
    {
      name: "an accepted start or restart reads its container again",
      run: () => readContainerAfter(mate, Promise.resolve()),
      want: [read],
    },
    {
      name: "a refused start or restart reads nothing",
      run: () => readContainerAfter(mate, Promise.reject(new Error("refused"))).catch(() => {}),
      want: [],
    },
    {
      name: "a row without a container asks for nothing",
      run: () => readContainerAgain({ project: { id: "project-1" } }),
      want: [],
    },
  ])("$name", async ({ run, want }) => {
    expect(await heardFrom(run)).toEqual(want);
  });
});

describe("removeFailedZeropsProject", () => {
  it("deletes, then forgets the creation and reads its organization again", async () => {
    const calls: Array<string> = [];
    let outcome: unknown;
    const heard = await heardFrom(async () => {
      outcome = await removeFailedZeropsProject({
        projectId: "proj-1",
        organization: ORGANIZATION,
        deleteProject: async (projectId) => {
          calls.push(`delete:${projectId}`);
        },
        forgetCreation: (projectId) => {
          calls.push(`forget:${projectId}`);
        },
      });
    });

    expect(outcome).toEqual({ ok: true });
    expect(calls).toEqual(["delete:proj-1", "forget:proj-1"]);
    expect(heard).toEqual([{ topic: "inventory", organization: ORGANIZATION }]);
  });

  it("keeps the handoff and the list when the platform refuses the delete", async () => {
    const calls: Array<string> = [];
    let outcome: unknown;
    const heard = await heardFrom(async () => {
      outcome = await removeFailedZeropsProject({
        projectId: "proj-1",
        organization: ORGANIZATION,
        deleteProject: () => Promise.reject(new Error("A process is running.")),
        forgetCreation: (projectId) => {
          calls.push(`forget:${projectId}`);
        },
      });
    });

    expect(outcome).toEqual({ ok: false, error: "A process is running." });
    expect(calls).toEqual([]);
    expect(heard).toEqual([]);
  });
});

describe("hasNoZeropsProject", () => {
  const candidate = (tagList: ReadonlyArray<string>, appId?: string, tool?: "gitea") =>
    ({
      project: {
        id: [...tagList, appId ?? ""].join("|"),
        name: "p",
        status: "ACTIVE",
        tagList,
        ...(tool === undefined ? {} : { hqTool: tool }),
        ...(appId === undefined ? {} : { hq: { appId, appName: "P", kind: "mate", mate: null } }),
      },
    }) as never;
  const listing = (
    value: ReadonlyArray<ZeropsCandidate>,
    overrides: Partial<Extract<Known<ReadonlyArray<ZeropsCandidate>>, { state: "known" }>> = {},
  ): Known<ReadonlyArray<ZeropsCandidate>> => ({
    state: "known",
    value,
    asOf: { ordinal: 1, atMs: 10 },
    coverage: "complete",
    freshness: { kind: "live" },
    ...overrides,
  });

  it.each([
    ["nothing at all", [], true],
    ["a project in a group", [candidate([], "aaa")], false],
    ["a project in no group", [candidate([])], false],
    // A tool is not a project: an account holding only Gitea has not started.
    ["only a tool", [candidate([], undefined, "gitea")], true],
  ] as const)("says an account with %s has no project: %s", (_case, candidates, expected) => {
    expect(hasNoZeropsProject({ listing: listing(candidates) })).toBe(expected);
  });

  it.each<{ readonly name: string; readonly listing: Known<ReadonlyArray<ZeropsCandidate>> }>([
    { name: "unread", listing: { state: "unread", waitingFor: null } },
    { name: "being read", listing: { state: "reading", sinceMs: 10, attempt: 1 } },
    {
      name: "failed",
      listing: {
        state: "failed",
        failure: { kind: "transport", detail: "gateway" },
        atMs: 10,
        attempt: 1,
        retryAtMs: null,
      },
    },
    { name: "partial", listing: listing([], { coverage: "partial" }) },
  ])("answers no while the list is $name", ({ listing }) => {
    // Otherwise the invitation paints for a second and the roster takes it back.
    expect(hasNoZeropsProject({ listing })).toBe(false);
  });

  it("keeps an empty organization's invitation up while its list is re-read", () => {
    // The owner's run of 2026-09-17: a re-read every twenty seconds while a
    // creation was on its way, and the page painted "Reading your projects…"
    // over what it had a moment ago.
    expect(
      hasNoZeropsProject({
        listing: listing([], { freshness: { kind: "revalidating", sinceMs: 5 } }),
      }),
    ).toBe(true);
  });

  it("answers no while a creation this client made is not listed yet", () => {
    // The wizard lands here before the inventory carries the new project;
    // the invitation must not paint in that gap only to be taken back.
    expect(hasNoZeropsProject({ listing: listing([]), creationPending: true })).toBe(false);
  });
});

describe("the projects listing", () => {
  const held = (coverage: "complete" | "partial") =>
    ({
      state: "known",
      value: [],
      asOf: { ordinal: 1, atMs: 10 },
      coverage,
      freshness: { kind: "live" },
    }) satisfies Known<ReadonlyArray<ZeropsCandidate>>;

  it("the projects page shows a placeholder, never 'No projects', while the inventory is unread", () => {
    const unread: Known<ReadonlyArray<ZeropsCandidate>> = { state: "unread", waitingFor: null };

    expect(projectsListingNotice(unread, 0)).toEqual({
      region: "placeholder",
      // A quick answer never flickers it (§3.4).
      message: { text: "Reading your projects…", afterMs: 400, tone: "quiet" },
      affordance: null,
    });
    expect(hasNoZeropsProject({ listing: unread })).toBe(false);
  });

  it("says why a failed read shows no projects, with its cause and its own affordance", () => {
    expect(
      projectsListingNotice(
        {
          state: "failed",
          failure: { kind: "transport", detail: "gateway" },
          atMs: 10,
          attempt: 1,
          retryAtMs: null,
        },
        0,
      ),
    ).toEqual({
      region: "message",
      message: {
        text: "Couldn't read your projects. Zerops didn't answer.",
        afterMs: 0,
        tone: "alert",
      },
      affordance: { kind: "retry", label: "Try again" },
    });
  });

  it("says it is still reading over a partial list, never nothing", () => {
    expect(projectsListingNotice(held("partial"), 0)).toEqual({
      region: "value",
      message: { text: "Still reading…", afterMs: 0, tone: "quiet" },
      affordance: null,
    });
  });

  it("says nothing over a complete list it holds", () => {
    expect(projectsListingNotice(held("complete"), 0)).toBeNull();
  });

  describe("the page's own alert", () => {
    const failedListing = projectsListingNotice(
      {
        state: "failed",
        failure: { kind: "transport", detail: "gateway" },
        atMs: 10,
        attempt: 1,
        retryAtMs: null,
      },
      0,
    );
    const TROUBLE = "Zerops isn't answering. Trying again…";
    const EMPTY = "Your projects will show here once Zerops answers.";
    const heldNotice = projectsListingNotice(held("complete"), 0);

    it.each([
      {
        name: "rows it holds, while the account's line says the trouble: the rows, and no words",
        input: { connectError: null, inventoryError: TROUBLE, listingNotice: heldNotice, rows: 3 },
        view: { alert: null, listingNotice: heldNotice, empty: null },
      },
      {
        name: "nothing to show while the trouble lasts: its own empty words, with no retry",
        input: {
          connectError: null,
          inventoryError: TROUBLE,
          listingNotice: failedListing,
          rows: 0,
        },
        view: { alert: null, listingNotice: null, empty: EMPTY },
      },
      {
        name: "nothing to show while the trouble lasts, the list still reading: only the empty words",
        input: {
          connectError: null,
          inventoryError: TROUBLE,
          listingNotice: projectsListingNotice({ state: "reading", sinceMs: 0, attempt: 1 }, 0),
          rows: 0,
        },
        view: { alert: null, listingNotice: null, empty: EMPTY },
      },
      {
        name: "nothing to show, the list still reading, the trouble not yet spoken: the reading line",
        input: {
          connectError: null,
          inventoryError: null,
          listingNotice: projectsListingNotice({ state: "reading", sinceMs: 0, attempt: 1 }, 0),
          rows: 0,
        },
        view: {
          alert: null,
          listingNotice: projectsListingNotice({ state: "reading", sinceMs: 0, attempt: 1 }, 0),
          empty: null,
        },
      },
      {
        name: "a failed listing the account's line does not speak for: its cause, once",
        input: { connectError: null, inventoryError: null, listingNotice: failedListing, rows: 0 },
        view: { alert: null, listingNotice: failedListing, empty: null },
      },
      {
        name: "a connect failure, which is another region's: said, whatever the trouble",
        input: {
          connectError: "The container is unreachable.",
          inventoryError: TROUBLE,
          listingNotice: heldNotice,
          rows: 3,
        },
        view: { alert: "The container is unreachable.", listingNotice: heldNotice, empty: null },
      },
    ])("$name", ({ input, view }) => {
      expect(projectsTroubleView(input)).toEqual(view);
    });
  });
  it("keeps a complete stale listing's reconnect notice beside its rows", () => {
    const listing = {
      ...held("complete"),
      freshness: {
        kind: "stale",
        sinceMs: 10,
        reason: {
          kind: "source-recovering",
          retryAtMs: 1_000,
          coverageGap: true,
        },
      },
    } as const;
    expect(projectsListingNotice(listing, 0)).toMatchObject({
      region: "value",
      message: {
        text: `Reconnecting… Last data as of ${DateTime.formatLocal(DateTime.makeUnsafe(listing.asOf.atMs), { timeStyle: "medium" })}. Changes while disconnected may be missing.`,
      },
      affordance: { kind: "retry-now" },
    });
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
    // grow a menu without it: the platform's own verbs by its role function,
    // HQ's as HQ offers them (`useMateOffers`), none of either for an unknown person.
    expect(mateActionsSource).toContain("resolveMateVerbs({ project: candidate.project, viewer })");
    expect(mateActionsSource).toContain("...(platformVerbs.assign");
    // A Mate's name is its project's (D3): renaming it is the platform's verb.
    expect(mateActionsSource).toContain("...(platformVerbs.rename");
    expect(mateActionsSource).toContain("edit: verb(offers.edit),");
    expect(mateActionsSource).toContain('...(hqVerbs.move !== "no"');
    expect(mateActionsSource).toContain('...(hqVerbs.leave !== "no" && tags.groupId !== undefined');
    // Change face writes HQ's record of the Mate: HQ's gate, on a Mate.
    expect(mateActionsSource).toContain(
      'if (!changeFaceOffered({ candidate, mayEdit: hqVerbsOf(candidate).edit === "offered" })) {',
    );
  });

  it("carries the update verbs wherever a Mate is listed, not only on the projects screen", () => {
    // "Check for updates" and "Update to x.y.z" come from a control that
    // holds the server's own answer, so a page that lists Mates mounts it
    // per Mate rather than re-deriving the verbs. A project's page used to
    // be the one place a Mate's update could not be started from.
    expect(groupDetailSource).toMatch(/<ZeropsMateUpdateControl\s+environmentId=/u);
    expect(groupDetailSource).toContain("{({ menuActions }) => menu(menuActions)}");
    // The confirm dialog asks about the Mate by name: several are often
    // updated one after another.
    expect(groupDetailSource).toMatch(/<ZeropsMateUpdateControl[^>]*\bmateName=/u);
    expect(projectsPageSource).toMatch(/<ZeropsMateUpdateControl[^>]*\bmateName=/u);
  });
});

describe("a status word's hand", () => {
  /** Every `<StatusDot …/>` in a file, each as its own opening tag. */
  const statusDots = (source: string): ReadonlyArray<string> =>
    [...source.matchAll(/<StatusDot\b[\s\S]*?\/>/gu)].map((match) => match[0]);

  it.each([
    ["the projects screen", projectsPageSource],
    ["a project's own page", groupDetailSource],
    ["the Git page", gitPageSource],
    ["the verdict panel", verdictPanelSource],
    ["a project's releases", releaseRowsSource],
    ["a history", historyViewSource],
  ])("writes a state the way client-runtime wrote it, on %s", (_surface, source) => {
    // `deployWord` answers "Deployed" and `changeState` capitalises its first
    // letter on purpose. Drawn through the `MicroLabel` that is a StatusDot's
    // default, the projects screen and the Git page threw that away and said
    // NEEDS A REBASE where the left menu and the project's own page said
    // "Needs a rebase" — one fact, two hands, on surfaces a click apart. R5:
    // the words are the runtime's, and so is their case.
    //
    // Every surface that draws a change or an environment with a status dot
    // is listed here. The left menu draws none: a change row says Review and
    // production is a chip on its project's heading. A service's runtime
    // status on a card is not one of them either: the accepted `ServiceRow`
    // principle sets that word as a `MicroLabel` over the name, and it reads
    // as a label because that is what it is.
    const dots = statusDots(source);
    expect(dots.length).toBeGreaterThan(0);
    for (const dot of dots) {
      expect(dot).toMatch(/\bsentence\b|\bdotOnly\b/u);
    }
  });
});

describe("HQ's card", () => {
  it("is the organization's HQ, whose project is no project of the page's", () => {
    expect(projectsPageSource).toContain("hqCard={<ZeropsHqCard />}");
    // The project its anchor names, never one by its name (`withoutOfficialHq`).
    expect(projectsPageSource).toContain("withoutOfficialHq(groupTree.ungrouped, accountHq.hq)");
  });
});

describe("a project's next step on the projects page", () => {
  it("is groupFlow's, not a second derivation of what waits", () => {
    // The page, the left menu and a Mate's conversation read one derivation,
    // so the three cannot disagree about what a project needs next.
    expect(projectsPageSource).toContain("groupFlow(");
    expect(projectsPageSource).not.toContain("projectAttention(");
    expect(projectsPageSource).not.toContain("ZeropsGroupAnswer");
  });

  it("opens the release's review, the door every other page opens, named Review release in its cell and on the strip", () => {
    // The step's own words, which groupFlow writes as the door's: Release is the review's button.
    expect(projectsPageSource).toContain(
      "return <ZeropsReleaseVerb groupId={group.groupId} label={step.verb} />;",
    );
    expect(projectsPageSource).toContain(
      "<ZeropsReleaseVerb groupId={group.groupId} label={REVIEW_RELEASE_LABEL} />",
    );
    expect(groupDetailSource).toContain("export function ZeropsReleaseVerb(");
    expect(groupDetailSource).toContain('openReview({ kind: "release", groupId }, { from });');
  });

  it("merges, closes, releases and rolls back from no row: every such verb opens a review", () => {
    for (const source of [projectsPageSource, groupDetailSource]) {
      expect(source).not.toContain(".merge(");
      expect(source).not.toContain(".close(");
      expect(source).not.toContain(".release(");
      expect(source).not.toContain(".rollBack(");
    }
    expect(projectsPageSource).toContain('kind: "change",');
    expect(projectsPageSource).toContain(
      'openReview({ kind: "rollback", groupId: group.groupId, tag }, { from });',
    );
  });

  it("releases at the height of every other verb on the page, the project's own page keeping its own", () => {
    expect(groupDetailSource).toContain(
      '<ReleaseAction label={label} release={release} size="compact" />',
    );
    expect(groupDetailSource).toContain('readonly size?: "sm" | "compact";');
    expect(groupDetailSource).toContain("<ReleaseAction release={release} />");
  });

  it("offers production from the project's menu, never as a step in its row", () => {
    // No missing-tier rows ("not set up yet") and no foot of add verbs: a
    // project's menu adds a Mate, a stage or production. Adding production is
    // never a step that waits (`nextStepAwaitsSomebody`), so the row draws no
    // verb for it; the menu answers on `creatableRoles`, which is always read.
    expect(projectsPageSource.match(/requestEnvironment\(group\.groupId, "prod"\)/gu)).toHaveLength(
      1,
    );
    expect(projectsPageSource).toContain('creatableRoles(group).includes("prod")');
    expect(projectsPageSource).not.toContain("?.missing ??");
  });
});

describe("a creation under way on the projects page", () => {
  it("is drawn in its group from the one placing the left menu reads, and feeds the flow", () => {
    // A New project this tab is making included, from the press, on both.
    expect(projectsPageSource).toContain(
      "births: placedPressesIn(presses, activeOrganization?.id, Object.values(made)),",
    );
    expect(projectsPageSource).toContain("pending: group.pending,");
    expect(sidebarTreeSource).toContain("pending: group?.pending ?? [],");
    expect(sidebarSource).toContain("placedPressesIn(\n        zeropsPresses,");
  });

  it("is under way from the click: the add verbs are off before the group's agents are read", () => {
    // `creationRunning` disables every add verb, Add production included; a
    // creation that waited on the agents' read before saying so left the verb
    // pressable for a second creation of the same production.
    const start = projectsPageSource.indexOf("const createEnvironment = useCallback(");
    const body = projectsPageSource.slice(start);
    const underWay = body.indexOf(
      'setCreation({ name: choice.name, tier: tier ?? "mate", progress: [] });',
    );
    expect(underWay).toBeGreaterThan(-1);
    // The group's agents are read inside the creation, after the verbs are off.
    expect(underWay).toBeLessThan(body.indexOf("await runCreation("));
    expect(creationSource.indexOf("await readGroupAgents(request.environments)")).toBeGreaterThan(
      -1,
    );
    // A plan refused ends it, so the verbs come back.
    const refused = body.slice(body.indexOf('if (run.kind === "refused") {'));
    expect(refused.slice(0, refused.indexOf("return;"))).toContain("setCreation(null);");
  });

  it("lists the organization again the moment a creation is accepted, as New project does", () => {
    expect(creationSource).toContain("beginPress(");
    expect(creationSource).toContain('invalidateZerops({ topic: "inventory"');
    expect(newProjectPortsSource).toContain("beginPress(");
    expect(newProjectPortsSource).toContain(
      'invalidateZerops({ topic: "inventory", organization });',
    );
  });

  it("says why a merge or a release was refused, in the page's own trouble line", () => {
    const trouble = projectsPageSource.slice(
      projectsPageSource.indexOf("const trouble ="),
      projectsPageSource.indexOf(";", projectsPageSource.indexOf("const trouble =")),
    );
    expect(trouble).toContain("projectFlow.trouble");
    expect(projectsPageSource).toContain(
      '<p className="text-sm text-[var(--zerops-status-failed-text)]">{trouble}</p>',
    );
  });

  it("tells the left menu the release on its way, as the page reads it", () => {
    expect(sidebarSource).toContain("releaseInFlight: flow.release.inFlight,");
  });
});

describe("opening a Mate from the projects page", () => {
  it.each([
    { name: "a connected Mate opens", busy: false, action: "open", opens: true },
    { name: "a Mate coming up is still", busy: false, action: "pending", opens: false },
    { name: "a Mate whose verb runs is still", busy: true, action: "open", opens: false },
  ] as const)("$name", ({ busy, action, opens }) => {
    const open = vi.fn();
    const opener = mateOpener({ busy, action, open });
    expect(opener !== undefined).toBe(opens);
    opener?.();
    expect(open).toHaveBeenCalledTimes(opens ? 1 : 0);
  });

  it("is one opener for a Mate's card and for the flow's names and tiles", () => {
    expect(projectsPageSource).toContain("const select = mateOpenerOf(candidate);");
    expect(projectsPageSource).toContain("openMate={mateOpenerOf}");
    expect(projectsPageSource.match(/mateOpener\(\{/gu)).toHaveLength(1);
  });
});

describe("a declared environment's row", () => {
  const version = (label: string | undefined) => ({
    name: undefined,
    commit: label,
    sha: undefined,
    taggedBy: undefined,
    label,
  });
  it.each([
    [
      "an empty production",
      { line: "release", tone: "neutral", version: version(undefined) },
      "Nothing deployed yet",
    ],
    [
      "an empty stage",
      { line: "main", tone: "neutral", version: version(undefined) },
      "Nothing deployed yet",
    ],
    [
      "a first deploy on its way",
      { line: "release", tone: "pending", version: version(undefined) },
      "release",
    ],
    [
      "a deployed stage",
      { line: "main · e014b0e", tone: "good", version: version("e014b0e") },
      "main · e014b0e",
    ],
  ] as const)("says what %s runs, not a bare source", (_name, row, expected) => {
    expect(declaredEnvironmentSummary(row)).toBe(expected);
  });

  it("says an empty stage's first deploy as its cell does", () => {
    const row = { line: "main", tone: "neutral", version: version(undefined) } as const;
    expect(declaredEnvironmentSummary(row, { kind: "on-its-way" })).toBe("First deploy on its way");
    expect(declaredEnvironmentSummary(row, { kind: "failed" })).toBe("First deploy failed");
    expect(declaredEnvironmentSummary(row, { kind: "held" })).toBe("Stage awaits a deploy key");
  });
});

describe("a group's one line about itself", () => {
  const NONE = { finishing: undefined, halfMade: undefined };
  it.each([
    [{ ...NONE, placeholder: true, unfinished: "production" }, "Couldn't read this project's name"],
    [
      { ...NONE, placeholder: false, unfinished: "production" },
      "Couldn't finish setting up production",
    ],
    [{ ...NONE, placeholder: false, unfinished: "stage" }, "Couldn't finish setting up stage"],
    [{ ...NONE, placeholder: false, unfinished: undefined }, undefined],
    // Audit R2: a half-made environment is said, and finished only when the person asks.
    [
      { placeholder: false, unfinished: undefined, finishing: undefined, halfMade: "stage" },
      "Setting up stage isn't finished",
    ],
    [
      { placeholder: false, unfinished: "stage", finishing: "stage", halfMade: "stage" },
      "Finishing stage…",
    ],
  ] as const)("reads %j as %j — never the platform's own words", (input, expected) => {
    expect(projectsGroupLine(input)).toBe(expected);
  });

  it("keeps a background repair's failure off the page's error line", () => {
    expect(projectsPageSource).not.toContain("setToolError(`${entry.displayName}");
  });
});

describe("project rename permissions on the projects surfaces", () => {
  it("uses the same permission-aware rename menu for the row and detail", () => {
    expect(projectsPageSource).toContain("<ZeropsProjectRenameMenu");
    expect(groupDetailSource).toContain("<ZeropsProjectRenameMenu");
    for (const source of [projectsPageSource, groupDetailSource]) {
      expect(source).not.toContain('id: "rename-group"');
    }
  });

  it("preserves the existing environment creation offers independently of rename permission", () => {
    expect(projectsPageSource).toContain("...(groupIsEmpty(group)");
    expect(projectsPageSource).toContain("...(addsOfferedFor(group)");
    expect(projectsPageSource).toContain(
      '...(mayAddFor(group) && !groupIsEmpty(group) && creatableRoles(group).includes("prod")',
    );
    expect(projectsPageSource).toContain("if (creationRunning) return;");
  });
});
