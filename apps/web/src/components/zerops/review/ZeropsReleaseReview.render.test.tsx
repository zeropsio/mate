import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import {
  makeAccountStore,
  accountReadsAtom,
  releaseReviewRequest,
  releaseReviewScope,
  releaseReviewId,
} from "@t3tools/client-runtime/data";
import { AccountDataContext } from "~/zerops/ZeropsAccountData";
import { makeSampledAccount } from "~/zerops/__fixtures__/sampledAccount";
import type {
  ReleaseServicePlan,
  ReviewReleaseRequest,
  NativeReleaseIdentity,
} from "@t3tools/shared/hqRelease";
import { HqEnvironmentId, ProjectId } from "@t3tools/contracts";
import type { HqAppDetailRead } from "@t3tools/client-runtime/data";
import type { FlowReleaseRow } from "@t3tools/client-runtime/zerops";
import type { HqChange } from "@t3tools/shared/hqChanges";
import {
  Window,
  type HTMLButtonElement as TestButton,
  type HTMLInputElement as TestInput,
} from "happy-dom";
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { placeAddresses, withPlaceAddresses } from "~/zerops/__fixtures__/placeAddresses";
import { useAddressesSheet } from "~/zerops/addressesSheet";
import type { FlowVerbOutcome } from "~/zerops/flowVerbs";
import type { ZeropsProjectFlow } from "~/zerops/projectFlows";

import { ZeropsReleaseReview } from "./ZeropsReleaseReview";

const state = vi.hoisted(() => ({
  value: {} as {
    flows: Map<string, ZeropsProjectFlow>;
    detail: HqAppDetailRead;
    /** What the review asked of the project flows, each draw: the apps and the options. */
    asked: Array<{ ids: ReadonlyArray<string>; options: unknown }>;
    mateNames: Map<string, string>;
    release: (group: string, tag?: string, plan?: ReleaseServicePlan) => Promise<FlowVerbOutcome>;
    rollBack: (
      group: string,
      tag: string,
      reviewed?: { request: ReviewReleaseRequest; plan: ReleaseServicePlan },
    ) => Promise<FlowVerbOutcome>;
  },
}));
vi.mock("~/zerops/projectFlows", () => ({
  useProjectFlows: (ids: ReadonlyArray<string>, options?: unknown) => {
    state.value.asked.push({ ids, options });
    return { flows: state.value.flows };
  },
  useMateNames: () => state.value.mateNames,
  useEveryAppId: () => [],
  useAppsEnvironments: () => ({}),
}));
vi.mock("~/zerops/useHqAppDetail", () => ({ useHqAppDetail: () => state.value.detail }));
vi.mock("~/zerops/flowVerbs", () => ({
  useFlowVerbs: () => ({
    pending: new Set(),
    trouble: null,
    release: (flow: ZeropsProjectFlow, tag?: string, plan?: ReleaseServicePlan) =>
      state.value.release(flow.groupId, tag, plan),
    rollBack: (
      flow: ZeropsProjectFlow,
      tag: string,
      reviewed?: { request: ReviewReleaseRequest; plan: ReleaseServicePlan },
    ) => state.value.rollBack(flow.groupId, tag, reviewed),
  }),
}));
vi.mock("~/zerops/useZeropsCandidates", () => ({
  useZeropsCandidates: () => ({ listing: null }),
  useZeropsDetailCandidates: () => ({ listing: null }),
}));
vi.mock("@t3tools/client-runtime/zerops/projections", () => ({
  heldCandidates: () => ({ rows: [] }),
}));
vi.mock("~/zerops/useZeropsReviewMates", () => ({ useZeropsReviewMates: () => new Map() }));
vi.mock("~/zerops/fixMates", () => ({ useFixMates: () => [] }));
vi.mock("~/zerops/importServices", () => ({ useImportServices: () => vi.fn() }));
vi.mock("~/zerops/fixRequest", () => ({ useAskMateToFix: () => vi.fn() }));
vi.mock("~/zerops/useNowMs", () => ({ useNowMs: () => NOW, useSecondsNowMs: () => NOW }));
const compared = vi.hoisted(() => ({ asks: [] as Array<unknown> }));
vi.mock("~/zerops/useReleaseComparisons", () => ({
  useReleaseComparisons: (asks: unknown) => {
    compared.asks.push(asks);
    return new Map();
  },
}));
vi.mock("./ZeropsChangeReview", () => ({ ZeropsChangeReview: () => null }));
vi.mock("./ZeropsReleaseSteps", () => ({
  useReleaseSteps: () => ({ step: { view: "release" }, shown: undefined, open: vi.fn() }),
  ZeropsReleaseSteps: ({ release }: { release: ReactNode }) => release,
}));

const NOW = Date.parse("2026-10-03T22:45:09Z");
const BEFORE = "0fb60a1".padEnd(40, "0");
const HEAD = "18270a2".padEnd(40, "0");

/** The application's merged change #6, as its change list holds it. */
const CHANGE_6 = {
  repo: "appdev",
  number: 6,
  title: "Set version to 1.0.0",
  mateProjectId: "toby",
  mergedSha: HEAD,
  mergedAt: new Date(NOW).toISOString(),
} as unknown as HqChange;

/** The application's detail as HQ says it: the release carries #6, recorded. */
function detailOf(over: Partial<HqAppDetailRead> = {}): HqAppDetailRead {
  return {
    releases: [],
    repos: undefined,
    changes: [CHANGE_6],
    releaseChanges: {
      state: "known",
      changes: [{ repo: "appdev", number: 6, title: "Set version to 1.0.0" }],
    },
    recipes: {},
    read: "read",
    failure: null,
    live: true,
    reconnecting: false,
    ...over,
  };
}
function row(tag: string, commit: string, live = true): FlowReleaseRow {
  return {
    tag,
    verdict: "approved",
    detail: undefined,
    line: `app ${commit}`,
    entries: [{ service: "app", commit }],
    taggedAt: new Date(NOW - 20_000).toISOString(),
    standing: live ? "live" : undefined,
    word: live ? "Live" : "Approved",
    rollBack: false,
    failedEntries: [],
  };
}
function flow(): ZeropsProjectFlow {
  return {
    groupId: "xyz",
    declarations: [
      {
        name: "prod",
        tier: "production",
        id: HqEnvironmentId.make("p-prod"),
        target: { kind: "zerops", projectId: ProjectId.make("p-prod") },
        sources: ["release"],
      },
    ],
    declarationsRead: true,
    recipeRead: true,
    environments: [],
    environmentInputs: [],
    unreadEnvironments: [],
    recipeTiers: [],
    pullRequests: [],
    changesKnown: true,
    merged: [],
    releases: [row("v0.1.4", BEFORE)],
    releasesKnown: true,
    repos: [
      {
        name: "appdev",
        mainHead: HEAD,
        updatedAt: new Date(NOW).toISOString(),
        releaseVersion: { tag: "v1.0.0", path: "package.json" },
      },
    ],
    codeRepos: undefined,
    mateTier: undefined,
    release: {
      gate: { allowed: true },
      permission: { allowed: true },
      releaseTarget: {
        environmentId: HqEnvironmentId.make("p-prod"),
        createdAt: "2026-10-31T00:00:00Z",
        declaration: "9007199254740993",
        target: { kind: "zerops", projectId: ProjectId.make("p-prod") },
      },
      groupHead: "a".repeat(40),
      suggestion: "v0.1.5",
      comparison: [
        {
          service: "app",
          candidate: HEAD.slice(0, 7),
          production: BEFORE.slice(0, 7),
          changed: true,
        },
      ],
      entries: [{ service: "app", commit: HEAD }],
      inFlight: undefined,
      stalled: undefined,
      contentsKnown: true,
      contents: [
        {
          repository: "appdev",
          services: ["app"],
          total: 1,
          truncated: false,
          commits: [
            {
              sha: HEAD,
              subject: "Set version to 1.0.0",
              authorName: "Toby",
              at: new Date(NOW).toISOString(),
              change: { number: 6, title: "Set version to 1.0.0", mateProjectId: "toby" },
            },
          ],
        },
      ],
      untold: [],
      runs: new Map([["app", { kind: "commit", sha: BEFORE }]]),
      repositories: new Map([["app", "appdev"]]),
    },
  };
}
let root: Root | undefined;
let dataRegistry: AtomRegistry.AtomRegistry | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  dataRegistry?.dispose();
  dataRegistry = undefined;
  vi.unstubAllGlobals();
  useAddressesSheet.getState().close();
});
async function mount(
  release: typeof state.value.release,
  target: ComponentProps<typeof ZeropsReleaseReview>["target"] = {
    kind: "release",
    groupId: "xyz",
  },
  rollBack: typeof state.value.rollBack = async () => ({ ok: false, reason: "unused" }),
  shape: (base: ZeropsProjectFlow) => ZeropsProjectFlow = (base) => base,
  wrap: (children: ReactNode) => ReactNode = (children) => children,
  detail: HqAppDetailRead = detailOf(),
  reviewPlan?: ReleaseServicePlan | null,
) {
  const window = new Window();
  for (const name of [
    "window",
    "document",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "Element",
    "Node",
    "navigator",
  ] as const)
    vi.stubGlobal(name, window[name]);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.value = {
    flows: new Map([["xyz", shape(flow())]]),
    detail,
    asked: [],
    mateNames: new Map(),
    release,
    rollBack,
  };
  const registry = AtomRegistry.make();
  dataRegistry = registry;
  const store = makeAccountStore(registry);
  const sampled = makeSampledAccount({ registry, store, orgId: "org", answer: () => null });
  const account = {
    ...sampled,
    demandDetail: (demand: Parameters<typeof sampled.demandDetail>[0]) => {
      if (demand.family !== "hqReleaseReview") return sampled.demandDetail(demand);
      const input = releaseReviewRequest(demand.ownerId);
      if (input === null) return () => {};
      const scope = releaseReviewScope("org", demand.ownerId);
      for (const event of [
        { kind: "demand", demanded: true },
        { kind: "attempt" },
        { kind: "handshake" },
      ] as const)
        store.dispatch({ kind: "stream", key: scope, now: 0, event });
      const generation = store.state().streams.get(scope)!.generation;
      store.dispatch({ kind: "baseline-begin", scope, generation });
      if (reviewPlan === null) return () => {};
      const id = releaseReviewId("org", demand.ownerId);
      store.dispatch({
        kind: "baseline-commit",
        scope,
        generation,
        via: "hq-stream",
        members: [id],
        rows: [
          {
            family: "hqReleaseReview",
            id,
            revision: { kind: "hq", incarnation: `review/${id}`, revision: generation },
            value: reviewPlan ?? {
              hash: "c".repeat(64),
              operations: input.request.entries.map((entry) => ({
                kind: "deploy",
                service: entry.service,
                sha: entry.sha,
              })),
            },
          },
        ],
      });
      store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "baseline-committed" } });
      return () =>
        store.dispatch({
          kind: "stream",
          key: scope,
          now: 0,
          event: { kind: "demand", demanded: false },
        });
    },
  };
  registry.set(accountReadsAtom, account);
  const container = window.document.createElement("div");
  window.document.body.append(container);
  root = createRoot(container as unknown as HTMLElement);
  const render = () =>
    root!.render(
      <RegistryContext value={registry}>
        <AccountDataContext value={account}>
          {wrap(<ZeropsReleaseReview target={target} titleId="release" onClose={() => {}} />)}
        </AccountDataContext>
      </RegistryContext>,
    );
  await act(async () => render());
  return { container, render };
}

describe("the release dialog's press", () => {
  it("invalid version prevents releasing production", async () => {
    const release = vi.fn(async (): Promise<FlowVerbOutcome> => ({ ok: true, tag: "v0.1.5" }));
    const { container } = await mount(release);
    const input = container.querySelector<TestInput>('input[aria-label="Version"]')!;
    const key = Object.keys(input).find((name) => name.startsWith("__reactProps$"));
    const props = Reflect.get(input, key!) as {
      onChange: (event: { target: { value: string } }) => void;
    };
    expect(props.onChange).toBeTypeOf("function");
    await act(async () => props.onChange({ target: { value: "not-a-version" } }));
    expect(container.textContent).toContain("Use major.minor.patch, for example 1.0.0.");
    const submit = container.querySelector<TestButton>("[data-review-primary]")!;
    expect(submit.disabled).toBe(true);
    await act(async () => submit.click());
    expect(release).not.toHaveBeenCalled();
  });

  it("holds the offered #6 and v0.1.4 even when HQ and production update before React draws the press", async () => {
    const { container, render } = await mount(async () => {
      const before = state.value.flows.get("xyz")!;
      state.value.flows.set("xyz", {
        ...before,
        releases: [row("v0.1.5", HEAD), row("v0.1.4", BEFORE, false)],
        release: {
          ...before.release,
          suggestion: "v0.1.6",
          contents: [],
          comparison: [
            {
              service: "app",
              candidate: HEAD.slice(0, 7),
              production: HEAD.slice(0, 7),
              changed: false,
            },
          ],
        },
      });
      render();
      return { ok: true, tag: "v0.1.5" };
    });
    await act(async () => container.querySelector<TestButton>("[data-review-primary]")!.click());
    expect(container.textContent).toContain("Set version to 1.0.0");
    expect(container.textContent).toMatch(/roll back to v0\.1\.4/iu);
    expect(container.textContent).toContain("v0.1.5 is live");
  });

  it("starts at the next patch, offers main's declaration, and sends the person's version", async () => {
    const release = vi.fn(async (): Promise<FlowVerbOutcome> => ({
      ok: false,
      reason: "HQ refused it",
    }));
    const { container } = await mount(release);
    const field = container.querySelector<TestInput>('input[aria-label="Version"]');
    expect(field?.value).toBe("0.1.5");
    expect(container.textContent).toContain("Your code names v1.0.0.");
    const suggestion = [...container.querySelectorAll<TestButton>("button")].find(
      (button) => button.textContent === "Use it",
    );
    expect(suggestion).toBeDefined();
    await act(async () => suggestion!.click());
    expect(field!.value).toBe("1.0.0");
    expect(container.querySelector("[data-review-primary]")?.textContent).toContain(
      "Release v1.0.0",
    );
    await act(async () => container.querySelector<TestButton>("[data-review-primary]")!.click());
    expect(release).toHaveBeenCalledWith(
      "xyz",
      "v1.0.0",
      expect.objectContaining({ hash: "c".repeat(64) }),
    );
    expect(field!.disabled).toBe(false);
    expect(container.textContent).toContain("HQ refused it");
  });
});

describe("the roll back dialog's press", () => {
  it("holds the delta it offered and the tag it will make while HQ's flow moves under the request", async () => {
    compared.asks.length = 0;
    let answer: (outcome: FlowVerbOutcome) => void = () => {};
    const { container, render } = await mount(
      async () => ({ ok: false, reason: "unused" }),
      { kind: "rollback", groupId: "xyz", tag: "v0.1.4" },
      () => {
        const before = state.value.flows.get("xyz")!;
        state.value.flows.set("xyz", {
          ...before,
          release: {
            ...before.release,
            suggestion: "v0.1.6",
            runs: new Map([["app", { kind: "commit", sha: BEFORE }]]),
          },
        });
        render();
        return new Promise<FlowVerbOutcome>((resolve) => {
          answer = resolve;
        });
      },
      (base) => ({
        ...base,
        releases: [row("v0.1.5", HEAD), row("v0.1.4", BEFORE, false)],
        release: {
          ...base.release,
          suggestion: "v0.1.5",
          runs: new Map([["app", { kind: "commit", sha: HEAD }]]),
        },
      }),
    );
    const offered = compared.asks.at(-1);
    expect(offered).toBeDefined();
    await act(async () => container.querySelector<TestButton>("[data-review-primary]")!.click());
    expect(container.textContent).toContain("v0.1.5");
    expect(container.textContent).not.toContain("v0.1.6");
    expect(compared.asks.at(-1)).toBe(offered);
    await act(async () => answer({ ok: true, tag: "v0.1.5", deploys: { jobs: [], note: null } }));
    expect(compared.asks.at(-1)).toBe(offered);
  });
});

describe("the release dialog's way to a domain of your own", () => {
  const PRODUCTION = {
    projectId: "p-prod",
    target: { kind: "zerops", projectId: "p-prod" },
    name: "prod",
    tier: "production",
    sources: ["release"],
    services: [],
    environment: "prod",
    keyHeld: true,
    keyInvalid: false,
  } as unknown as ZeropsProjectFlow["environmentInputs"][number];
  const withProduction =
    (production = PRODUCTION) =>
    (base: ZeropsProjectFlow): ZeropsProjectFlow => ({
      ...base,
      environmentInputs: [production],
    });
  /** The release HQ takes, and production running it by the time the answer is drawn. */
  const lands = (render: () => void) => async (): Promise<FlowVerbOutcome> => {
    const before = state.value.flows.get("xyz")!;
    state.value.flows.set("xyz", {
      ...before,
      releases: [row("v0.1.5", HEAD), row("v0.1.4", BEFORE, false)],
      release: { ...before.release, suggestion: "v0.1.6", contents: [] },
    });
    render();
    return { ok: true, tag: "v0.1.5" };
  };
  const domainDoor = (container: Awaited<ReturnType<typeof mount>>["container"]) =>
    [...container.querySelectorAll<TestButton>("button")].find((button) =>
      button.textContent?.includes("Put it on your domain"),
    );

  async function released(
    places: Parameters<typeof withPlaceAddresses>[0],
    production = PRODUCTION,
  ) {
    let draw = () => {};
    const { container, render } = await mount(
      async () => lands(draw)(),
      undefined,
      undefined,
      withProduction(production),
      withPlaceAddresses(places),
    );
    draw = render;
    const offered = domainDoor(container);
    await act(async () => container.querySelector<TestButton>("[data-review-primary]")!.click());
    expect(container.textContent).toContain("v0.1.5 is live");
    return { container, offered };
  }

  it("offers Put it on your domain once a release to production is live and production has no domain of its own, and opens the sheet to add one", async () => {
    const { container, offered } = await released({ "p-prod": placeAddresses([]) });
    expect(offered, "Not before the release is live.").toBeUndefined();
    const door = domainDoor(container);
    expect(door).toBeDefined();
    await act(async () => door!.click());
    expect(useAddressesSheet.getState().target).toEqual({
      orgId: "org",
      projectId: "p-prod",
      groupId: "xyz",
      intent: "add-domain",
    });
  });

  it.each([
    ["has a domain of its own", placeAddresses(["shop.example.com"])],
    ["is still being read", placeAddresses("reading")],
  ])("does not offer Put it on your domain while production %s", async (_case, production) => {
    const { container } = await released({ "p-prod": production });
    expect(domainDoor(container)).toBeUndefined();
  });

  it("does not offer Put it on your domain where production is a Git destination", async () => {
    const git = {
      ...PRODUCTION,
      target: { kind: "git", branch: "production", delivery: "direct" },
    } as unknown as typeof PRODUCTION;
    const { container } = await released({ "p-prod": placeAddresses([]) }, git);
    expect(domainDoor(container)).toBeUndefined();
  });
});

describe("a review from what HQ already stores", () => {
  const comparedOnOpen = () =>
    state.value.asked.some(
      ({ options }) => (options as { compare?: boolean } | undefined)?.compare,
    );
  const OUTSIDE = {
    sha: "c".repeat(40),
    subject: "Bump lockfile",
    authorName: "Toby",
    at: new Date(NOW).toISOString(),
    change: null,
  };
  const withOutside =
    (summary: { total: number; pending?: boolean }) =>
    (base: ZeropsProjectFlow): ZeropsProjectFlow => ({
      ...base,
      release: {
        ...base.release,
        summary: { total: summary.total, more: 0, subjects: [], atLeast: false },
        summaryRead: summary.pending === true ? "pending" : undefined,
        contents: [
          {
            ...base.release.contents[0]!,
            commits: [...base.release.contents[0]!.commits, OUTSIDE],
          },
        ],
      },
    });
  const noRelease = async (): Promise<FlowVerbOutcome> => ({ ok: false, reason: "unused" });
  const showCommits = (container: Awaited<ReturnType<typeof mount>>["container"]) =>
    [...container.querySelectorAll<TestButton>("button")].find(
      (button) => button.textContent === "Show commits",
    );

  it("A release review lists the changes going live from the release offer, with no compare on open", async () => {
    const { container } = await mount(noRelease);
    expect(container.textContent).toContain("Set version to 1.0.0");
    expect(comparedOnOpen()).toBe(false);
  });

  it("A release review says the changes going live are not known yet while HQ has not recorded them", async () => {
    const { container } = await mount(
      noRelease,
      undefined,
      undefined,
      undefined,
      undefined,
      detailOf({ releaseChanges: { state: "pending" } }),
    );
    expect(container.textContent).toContain("Not known yet.");
    expect(container.textContent).not.toContain("Set version to 1.0.0");
    expect(container.textContent).not.toContain("0 changes");
    expect(comparedOnOpen()).toBe(false);
  });

  it("A release review compares what goes out when HQ records no changes for a release", async () => {
    await mount(
      noRelease,
      undefined,
      undefined,
      undefined,
      undefined,
      detailOf({ releaseChanges: undefined }),
    );
    expect(comparedOnOpen()).toBe(true);
  });

  it("A release review counts commits outside changes and lists them only when asked", async () => {
    const { container } = await mount(noRelease, undefined, undefined, withOutside({ total: 3 }));
    expect(container.textContent).toContain("2 commits outside changes");
    expect(container.textContent).not.toContain("Bump lockfile");
    expect(comparedOnOpen()).toBe(false);
    await act(async () => showCommits(container)!.click());
    expect(comparedOnOpen()).toBe(true);
    expect(container.textContent).toContain("Bump lockfile");
    expect(showCommits(container)).toBeUndefined();
  });

  it("A release review counts no commits outside changes while HQ has not read the offer", async () => {
    const { container } = await mount(
      noRelease,
      undefined,
      undefined,
      withOutside({ total: 0, pending: true }),
    );
    expect(container.textContent).not.toContain("outside changes");
    expect(showCommits(container)).toBeUndefined();
  });

  it("A release review lists the commits outside changes from what HQ stored, with no compare on ask", async () => {
    const { container } = await mount(
      noRelease,
      undefined,
      undefined,
      undefined,
      undefined,
      detailOf({
        releaseOutside: {
          count: 3,
          commits: [
            {
              repo: "acme/web",
              sha: "d".repeat(40),
              subject: "Bump lockfile",
              authorName: "Toby",
              at: new Date(NOW).toISOString(),
            },
          ],
        },
      }),
    );
    expect(container.textContent).toContain("3 commits outside changes");
    expect(container.textContent).not.toContain("Bump lockfile");
    await act(async () => showCommits(container)!.click());
    expect(container.textContent).toContain("Bump lockfile");
    expect(container.textContent).toContain("The newest 1 are shown.");
    expect(comparedOnOpen()).toBe(false);
    expect(
      state.value.asked.every(
        ({ options }) => options === undefined || !(options as { compare?: boolean }).compare,
      ),
    ).toBe(true);
  });

  it("A release review says the commits outside changes are not known yet while HQ has not stored them", async () => {
    const { container } = await mount(
      noRelease,
      undefined,
      undefined,
      undefined,
      undefined,
      detailOf({ releaseOutside: { count: 0, commits: [], summaryRead: "pending" } }),
    );
    expect(container.textContent).toContain("Commits outside changes: not known yet.");
    expect(showCommits(container)).toBeUndefined();
  });

  describe("a rollback", () => {
    const target = { kind: "rollback", groupId: "xyz", tag: "v0.1.4" } as const;
    const releases = (history: boolean) =>
      [
        {
          tag: "v0.1.5",
          state: "approved",
          rollbackOf: null,
          ...(history
            ? {
                history: {
                  ranges: [],
                  changes: [{ repo: "appdev", number: 6, title: "Set version to 1.0.0" }],
                  commitCount: 1,
                  outsideCommitCount: 0,
                },
              }
            : {}),
        },
        { tag: "v0.1.4", state: "approved", rollbackOf: null, history: undefined },
      ] as unknown as HqAppDetailRead["releases"];
    const shape = (base: ZeropsProjectFlow): ZeropsProjectFlow => ({
      ...base,
      releases: [row("v0.1.5", HEAD), row("v0.1.4", BEFORE, false)],
    });

    it("A rollback review lists what leaves and comes back from recorded release histories", async () => {
      compared.asks.length = 0;
      const { container } = await mount(
        noRelease,
        target,
        undefined,
        shape,
        undefined,
        detailOf({ releases: releases(true) }),
      );
      expect(container.textContent).toContain("Set version to 1.0.0");
      expect(container.textContent).toContain("Nothing comes back.");
      expect(compared.asks.every((asks) => (asks as Map<string, unknown>).size === 0)).toBe(true);
    });

    it("A rollback review says what leaves is not known yet for a release HQ recorded no history of, and compares only when asked", async () => {
      compared.asks.length = 0;
      const { container } = await mount(
        noRelease,
        target,
        undefined,
        shape,
        undefined,
        detailOf({ releases: releases(false) }),
      );
      expect(container.textContent).toContain("Not known yet.");
      expect(compared.asks.every((asks) => (asks as Map<string, unknown>).size === 0)).toBe(true);
      const compare = [...container.querySelectorAll<TestButton>("button")].find(
        (button) => button.textContent === "Compare",
      );
      await act(async () => compare!.click());
      expect((compared.asks.at(-1) as Map<string, unknown>).size).toBe(1);
    });
  });
});

it("An uncertain review keeps the original plan and tag through changed offers and accepts only its exact recorded receipt.", async () => {
  let draw = () => {};
  let original: NativeReleaseIdentity | undefined;
  const release = vi.fn(
    async (_app: string, tag?: string, plan?: ReleaseServicePlan): Promise<FlowVerbOutcome> => {
      const before = state.value.flows.get("xyz")!;
      if (tag === undefined || plan === undefined || before.release.releaseTarget === undefined)
        throw new Error("no captured review");
      original = {
        tag,
        planHash: plan.hash,
        groupHead: before.release.groupHead!,
        entries: before.release.entries.map((entry) => ({
          service: entry.service,
          sha: entry.commit,
        })),
        releaseTarget: before.release.releaseTarget,
        principal: "ada",
      };
      state.value.flows.set("xyz", {
        ...before,
        release: {
          ...before.release,
          suggestion: "v9.0.0",
          releaseTarget: { ...before.release.releaseTarget, declaration: "9007199254740994" },
        },
      });
      draw();
      return { ok: false, uncertain: true, reason: "The original answer is unknown.", original };
    },
  );
  const { container, render } = await mount(release);
  draw = render;
  await act(async () => container.querySelector<TestButton>("[data-review-primary]")!.click());
  expect(container.textContent).toContain("v0.1.5");
  expect(container.textContent).not.toContain("Release v9.0.0");
  expect(container.textContent).toContain("The original answer is unknown.");
  const originalVersion = container.querySelector<TestInput>('input[aria-label="Version"]');
  if (originalVersion !== null) {
    expect(originalVersion.value).toBe("0.1.5");
    expect(originalVersion.disabled).toBe(true);
  }
  const receipt = {
    tag: original!.tag,
    sha: original!.groupHead,
    entries: original!.entries,
    target: "zerops" as const,
    releaseTarget: original!.releaseTarget,
    planHash: original!.planHash,
    by: "ada",
    at: "2026-10-31T00:00:00Z",
    state: "approved" as const,
    reason: null,
    rollbackOf: null,
  };
  await act(async () => {
    state.value.detail = {
      ...state.value.detail,
      releases: [{ ...receipt, planHash: "d".repeat(64) }],
    };
    render();
  });
  expect(container.textContent).toContain("The original answer is unknown.");
  await act(async () => {
    state.value.detail = { ...state.value.detail, releases: [receipt] };
    render();
  });
  expect(container.textContent).not.toContain("The original answer is unknown.");
  expect(release).toHaveBeenCalledTimes(1);
});

it("Rollback approves the fixed new tag, earlier sources and exact declaration whose Native effects were reviewed.", async () => {
  const rollback = vi.fn(async (): Promise<FlowVerbOutcome> => ({ ok: true, tag: "v0.1.5" }));
  const { container } = await mount(
    async () => ({ ok: false, reason: "unused" }),
    { kind: "rollback", groupId: "xyz", tag: "v0.1.3" },
    rollback,
    (base) => ({ ...base, releases: [row("v0.1.4", HEAD), row("v0.1.3", BEFORE, false)] }),
  );
  const button = container.querySelector<TestButton>("[data-review-primary]");
  expect(button?.disabled).toBe(false);
  await act(async () => button!.click());
  expect(rollback).toHaveBeenCalledWith("xyz", "v0.1.3", {
    request: {
      tag: "v0.1.5",
      groupHead: "a".repeat(40),
      entries: [{ service: "app", sha: BEFORE }],
      target: "zerops",
      releaseTarget: flow().release.releaseTarget,
      rollbackOf: "v0.1.3",
    },
    plan: { hash: "c".repeat(64), operations: [{ kind: "deploy", service: "app", sha: BEFORE }] },
  });
});

it.each(["create", "control", "no_effect"] as const)(
  "A DB-only Native %s plan is reviewable with explicit [] even when code counts offer nothing.",
  async (kind) => {
    const plan: ReleaseServicePlan = {
      hash: "c".repeat(64),
      operations:
        kind === "create"
          ? [
              {
                kind: "create",
                service: "database",
                settings: { hostname: "database", type: "postgresql:single@16", override: false },
                cost: "One billed service",
              },
            ]
          : kind === "control"
            ? [
                { kind: "stop", service: "old", serviceId: "S1", reason: "No longer declared" },
                { kind: "start", service: "database", serviceId: "S2", reason: "Declared again" },
              ]
            : [],
    };
    const release = vi.fn(async (): Promise<FlowVerbOutcome> => ({ ok: true, tag: "v0.1.5" }));
    const { container } = await mount(
      release,
      undefined,
      undefined,
      (base) => ({
        ...base,
        release: {
          ...base.release,
          gate: { allowed: false, reason: "No new code commits." },
          entries: [],
          missingServices: [],
        },
      }),
      undefined,
      undefined,
      plan,
    );
    const button = container.querySelector<TestButton>("[data-review-primary]");
    expect(button?.disabled).toBe(false);
    if (kind === "no_effect")
      expect(container.textContent).toContain(
        "No production service changes are required by this reviewed plan.",
      );
    await act(async () => button!.click());
    expect(release).toHaveBeenCalledWith("xyz", "v0.1.5", plan);
  },
);

it.each(["permission", "unknown_review", "unknown_declaration"] as const)(
  "A DB-only Native review has no approval authority from empty counts with %s.",
  async (missing) => {
    const release = vi.fn(async (): Promise<FlowVerbOutcome> => ({ ok: true }));
    const { container } = await mount(
      release,
      undefined,
      undefined,
      (base) => ({
        ...base,
        release: {
          ...base.release,
          entries: [],
          gate: { allowed: false, reason: "No new code commits." },
          ...(missing === "permission"
            ? { permission: { allowed: false, reason: "Not a releaser" } }
            : missing === "unknown_declaration"
              ? { releaseTarget: undefined }
              : {}),
        },
      }),
      undefined,
      undefined,
      missing === "unknown_review" ? null : { hash: "c".repeat(64), operations: [] },
    );
    const button = container.querySelector<TestButton>("[data-review-primary]");
    expect(button?.disabled).toBe(true);
    await act(async () => button?.click());
    expect(release).not.toHaveBeenCalled();
  },
);
