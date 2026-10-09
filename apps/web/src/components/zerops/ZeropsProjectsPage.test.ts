import { removeFailedZeropsProject } from "./removeFailedZeropsProject";
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
import { AsyncResult } from "effect/reactivity";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  autoConnectServedZeropsEnvironment,
  declaredEnvironmentSummary,
  hasNoZeropsProject,
  projectsGroupLine,
  projectsListingNotice,
  projectsTroubleView,
  readContainerAfter,
  readContainerAgain,
  retryZeropsProjectConnection,
  showsZeropsBirthLine,
  ZeropsProjectsHeader,
  ProjectReleaseHistory,
} from "./ZeropsProjectsPage";
import { bindTestInvalidationBus } from "~/zerops/__fixtures__/invalidationBus";
import { onZeropsInvalidation } from "~/zerops/accountInvalidations";
import { closeAccountLifetime, openAccountLifetime } from "~/zerops/accountLifetime";
import { exchangeZeropsContainerIdentity } from "@t3tools/client-runtime/zerops/identityExchange";

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

  it("preserves account selection behavior", () => {
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

    // The bar above carries the brand; the title row does not repeat it, and
    // no sentence sits under the title — the projects below say what it is.

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
});

it("Decision: the owner asked for the review and its fixes; existing flows are reused, no new concepts.", () => {
  const html = renderToStaticMarkup(createElement(ZeropsProjectsHeader));
  expect(html).toContain(">Find<");
  expect(html).toContain(">New project<");
});

it("an expanded project shows its current release before a closed history disclosure", () => {
  const releases = [
    { tag: "v2", standing: undefined, word: "Approved", rollBack: true },
    { tag: "v1", standing: "live" as const, word: "Live", rollBack: false },
  ].map((release) => ({
    ...release,
    verdict: "approved" as const,
    detail: undefined,
    line: "app abc123",
    entries: [],
    taggedAt: undefined,
    failedEntry: undefined,
  }));
  const html = renderToStaticMarkup(
    createElement(ProjectReleaseHistory, {
      groupId: "shop",
      releases,
      pending: new Set<string>(),
      onRollBack: () => {},
    }),
  );
  expect(html).toContain("Release history (1)");
  expect(html).not.toContain("<details open");
  expect(html.indexOf("v1")).toBeLessThan(html.indexOf("<details"));
  expect(html.indexOf("v2")).toBeGreaterThan(html.indexOf("<details"));
});
