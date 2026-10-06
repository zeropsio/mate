import type { FlowReleaseRow } from "@t3tools/client-runtime/zerops";
import {
  Window,
  type HTMLButtonElement as TestButton,
  type HTMLInputElement as TestInput,
} from "happy-dom";
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { FlowVerbOutcome } from "~/zerops/flowVerbs";
import type { ZeropsProjectFlow } from "~/zerops/projectFlows";

import { ZeropsReleaseReview } from "./ZeropsReleaseReview";

const state = vi.hoisted(() => ({
  value: {} as {
    flows: Map<string, ZeropsProjectFlow>;
    mateNames: Map<string, string>;
    release: (group: string, tag?: string) => Promise<FlowVerbOutcome>;
    rollBack: (group: string, tag: string) => Promise<FlowVerbOutcome>;
  },
}));
vi.mock("~/zerops/projectFlows", () => ({
  useProjectFlows: () => ({ flows: state.value.flows }),
  useMateNames: () => state.value.mateNames,
  useEveryAppId: () => [],
  useAppsEnvironments: () => ({}),
}));
vi.mock("~/zerops/flowVerbs", () => ({
  useFlowVerbs: () => ({
    pending: new Set(),
    trouble: null,
    release: (flow: ZeropsProjectFlow, tag?: string) => state.value.release(flow.groupId, tag),
    rollBack: (flow: ZeropsProjectFlow, tag: string) => state.value.rollBack(flow.groupId, tag),
  }),
}));
vi.mock("~/zerops/useZeropsCandidates", () => ({ useZeropsCandidates: () => ({ listing: null }) }));
vi.mock("@t3tools/client-runtime/zerops/projections", () => ({
  heldCandidates: () => ({ rows: [] }),
}));
vi.mock("~/zerops/useZeropsReviewMates", () => ({ useZeropsReviewMates: () => new Map() }));
vi.mock("~/zerops/fixMates", () => ({ useFixMates: () => [] }));
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
    failedEntry: undefined,
  };
}
function flow(): ZeropsProjectFlow {
  return {
    groupId: "xyz",
    declarations: [{ name: "prod", tier: "production", project: "p-prod", sources: ["release"] }],
    declarationsRead: true,
    recipeRead: true,
    environments: [],
    environmentInputs: [],
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
    release: {
      gate: { allowed: true },
      permission: { allowed: true },
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
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});
async function mount(
  release: typeof state.value.release,
  target: ComponentProps<typeof ZeropsReleaseReview>["target"] = {
    kind: "release",
    groupId: "xyz",
  },
  rollBack: typeof state.value.rollBack = async () => ({ ok: false, reason: "unused" }),
  shape: (base: ZeropsProjectFlow) => ZeropsProjectFlow = (base) => base,
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
    mateNames: new Map(),
    release,
    rollBack,
  };
  const container = window.document.createElement("div");
  window.document.body.append(container);
  root = createRoot(container as unknown as HTMLElement);
  const render = () =>
    root!.render(<ZeropsReleaseReview target={target} titleId="release" onClose={() => {}} />);
  await act(async () => render());
  return { container, render };
}

describe("the release dialog's press", () => {
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
    expect(container.querySelector(".rv-meta")?.textContent).toBe("replaces v0.1.4·1 change");
    expect(container.textContent).toContain("#6 Set version to 1.0.0");
    expect(container.textContent).toContain("Roll back to v0.1.4");
    expect(container.textContent).toContain("Released v0.1.5");
  });

  it("starts at the next patch, offers main's declaration, and sends the person's version", async () => {
    const release = vi.fn(async (): Promise<FlowVerbOutcome> => ({
      ok: false,
      reason: "HQ refused it",
    }));
    const { container } = await mount(release);
    const field = container.querySelector<TestInput>('input[aria-label="Version"]');
    expect(field?.value).toBe("0.1.5");
    const suggestion = [...container.querySelectorAll<TestButton>("button")].find((button) =>
      button.textContent?.includes("Use v1.0.0"),
    );
    expect(suggestion).toBeDefined();
    await act(async () => suggestion!.click());
    expect(field!.value).toBe("1.0.0");
    expect(container.querySelector("[data-review-primary]")?.textContent).toContain(
      "Release v1.0.0",
    );
    await act(async () => container.querySelector<TestButton>("[data-review-primary]")!.click());
    expect(release).toHaveBeenCalledWith("xyz", "v1.0.0");
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
