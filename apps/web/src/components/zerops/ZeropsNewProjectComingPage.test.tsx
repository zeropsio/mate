// @vitest-environment happy-dom
import { act, createElement as h, type ReactNode } from "react";
import { create, type ReactTestRenderer, type ReactTestRendererJSON } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { KEEP_TAB_OPEN_LINE } from "~/zerops/mateArrival";
import type { NewProjectBirth } from "~/zerops/newProjectBirth";

import { ZeropsNewProjectComingPage } from "./ZeropsNewProjectComingPage";

const app = vi.hoisted(() => ({
  navigate: vi.fn(async (_to: unknown) => undefined),
}));

/** The creations this tab holds, as their operations say them, and what each verb did. */
const held = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = {
    creations: {} as Record<string, unknown>,
    listeners,
    set(next: Record<string, unknown>) {
      state.creations = next;
      for (const listener of listeners) listener();
    },
    letGo: (birthId: string) => {
      const { [birthId]: _gone, ...rest } = state.creations;
      state.set(rest);
    },
  };
  return state;
});
const verbs = vi.hoisted(() => ({
  tryAgain: vi.fn(),
  startOver: vi.fn((creation: { readonly birthId: string }) => held.letGo(creation.birthId)),
  dismiss: vi.fn((birthId: string) => held.letGo(birthId)),
}));
vi.mock("~/zerops/creations", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useCreation: (birthId: string) =>
      useSyncExternalStore(
        (listener) => {
          held.listeners.add(listener);
          return () => held.listeners.delete(listener);
        },
        () => held.creations[birthId],
      ),
    tryCreationAgain: verbs.tryAgain,
    startAddOver: verbs.startOver,
    dismissCreation: verbs.dismiss,
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => app.navigate,
  Link: ({ children }: { readonly children?: ReactNode }) => h("a", null, children),
}));
vi.mock("~/zerops/ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({ user: { id: "u-ada" } }),
}));
vi.mock("./ZeropsMateEmptyState", () => ({
  MateEmptyStateView: ({
    coming,
    mate,
  }: {
    readonly coming: {
      readonly kind: string;
      readonly sentence?: string;
      readonly below: ReactNode;
    };
    readonly mate: { readonly name: string; readonly project: string | undefined };
  }) =>
    h(
      "section",
      { "data-kind": coming.kind },
      mate.project === undefined ? mate.name : `${mate.name} on ${mate.project}`,
      h("p", null, coming.sentence ?? ""),
      coming.below,
    ),
}));
vi.mock("./ZeropsMateComingPage", async () => {
  const actual =
    await vi.importActual<typeof import("./ZeropsMateComingPage")>("./ZeropsMateComingPage");
  return {
    ...actual,
    MateComingFrame: ({ children }: { readonly children?: ReactNode }) => h("main", null, children),
    MateComingHeader: () => null,
  };
});
vi.mock("../ui/button", () => ({
  Button: ({
    children,
    onClick,
  }: {
    readonly children?: ReactNode;
    readonly onClick?: () => void;
  }) => h("button", { onClick }, children),
}));

/** Acme CRM, pressed a moment ago: registering it in the organization's HQ. */
const ACME: NewProjectBirth = {
  organizationId: "org-acme",
  birthId: "b-acme",
  name: "Acme CRM",
  botName: "Vera",
  face: { tint: "rose", shape: "seal" },
  locationId: null,
  agents: [],
  startedAt: Date.parse("2026-09-30T10:00:00.000Z"),
  hq: { projectId: "hq-1", address: "https://hq-1-8080.prg1.zerops.app" },
  appId: null,
  intent: null,
  step: "registry",
  failed: null,
  projectId: null,
};

let tree: ReactTestRenderer | undefined;

function openDetails() {
  const disclosure = tree!.root
    .findAllByType("button")
    .find((node) => node.props["data-slot"] === "collapsible-trigger")!;
  expect(disclosure.props["aria-expanded"]).toBe(false);
  const target = document.createElement("button");
  act(() =>
    disclosure.props.onClick({
      currentTarget: target,
      target,
      nativeEvent: new MouseEvent("click"),
      preventDefault() {},
      stopPropagation() {},
      defaultPrevented: false,
    }),
  );
}

function hold(birth: NewProjectBirth | undefined) {
  act(() => {
    held.set(birth === undefined ? {} : { [birth.birthId]: birth });
  });
}

function openView(birthId = "b-acme") {
  act(() => {
    tree = create(h(ZeropsNewProjectComingPage, { birthId }));
  });
}

/** Everything the view says, as one line. */
/** Everything the view says, as its text reads. */
const said = () => textOf(tree?.toJSON() ?? null).replace(/\s+/g, " ");

function textOf(node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null): string {
  if (node === null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  return (node.children ?? []).map(textOf).join(" ");
}

/** Each step as the arrival draws it, in order: which, and where it stands. */
const steps = () =>
  tree?.root
    .findAll((node) => node.props["data-arrival-step"] !== undefined)
    .map(
      (node) => `${String(node.props["data-arrival-step"])}:${String(node.props["data-state"])}`,
    ) ?? [];

const kind = () => tree?.root.findByType("section").props["data-kind"];

/** The steps this tab runs, under the row that holds them: `row › label:state`. */
const substeps = () =>
  tree?.root
    .findAll((node) => node.props["data-arrival-substep"] !== undefined)
    .map((node) => {
      let row = node.parent;
      while (row !== null && row.props["data-arrival-step"] === undefined) row = row.parent;
      return `${String(row?.props["data-arrival-step"])} › ${textOf(node.children as never)
        .replace(/\s+/g, " ")
        .trim()}:${String(node.props["data-state"])}`;
    }) ?? [];

const button = (label: string) =>
  tree?.root.findAllByType("button").find((node) => node.children.join("") === label);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  app.navigate.mockClear();
  for (const verb of Object.values(verbs)) verb.mockClear();
  hold(undefined);
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});

// The owner, 2026-09-30: "you should add the project and the first mate in the same step, then
// you should go to the mate detail and the only diff would be the progress".
describe("a New project's first Mate, before its project exists", () => {
  it("is coming up on its project, the project's own steps before its own", () => {
    hold(ACME);
    openView();
    expect(kind()).toBe("coming");
    expect(said()).toContain("Vera on Acme CRM");
    // The project's own steps, then its first Mate's workspace, then the person's own sign-in.
    expect(steps()).toEqual(["registry:active", "workspace:waiting", "you:you"]);
    expect(said()).toContain("Acme CRM");
    expect(said()).toContain("Vera's workspace");
    expect(said()).toContain("You sign Vera in with your Claude or ChatGPT subscription");
    expect(app.navigate).not.toHaveBeenCalled();
  });

  it("hands the route to its Mate's own view the moment the platform takes its project, in place of this one", () => {
    hold({
      ...ACME,
      appId: "app-acme",
      step: "create",
    });
    openView();
    expect(app.navigate).not.toHaveBeenCalled();
    hold({ ...ACME, step: "created", projectId: "p-vera" });
    expect(app.navigate).toHaveBeenCalledTimes(1);
    expect(app.navigate).toHaveBeenCalledWith({
      to: "/mate/$projectId",
      params: { projectId: "p-vera" },
      replace: true,
    });
  });

  it("says why a step stopped, and Try again resumes it", () => {
    const stopped = { ...ACME, failed: { reason: "No room in this account.", uncertain: false } };
    hold(stopped);
    openView();
    expect(kind()).toBe("failed");
    expect(said()).not.toContain("No room in this account.");
    openDetails();
    expect(said()).toContain("No room in this account.");
    act(() => {
      button("Try again")?.props.onClick();
    });
    expect(verbs.tryAgain).toHaveBeenCalledWith(stopped);
  });

  it("never offers to make again what the platform may have made, only the way to the projects", () => {
    hold({
      ...ACME,
      step: "create",
      failed: { reason: "The project may already exist.", uncertain: true },
    });
    openView();
    expect(said()).toContain("The project may already exist.");
    expect(button("Try again")).toBeUndefined();
    expect(button("Go to projects")).toBeDefined();
  });

  it("says a creation this tab no longer holds is not here, with the way to the projects", () => {
    openView();
    expect(kind()).toBe("unreachable");
    expect(said()).toContain("This Mate");
    expect(said()).toContain("This conversation isn't in your Zerops projects.");
    expect(button("Go to projects")).toBeDefined();
    expect(app.navigate).not.toHaveBeenCalled();
  });
});

// Run 6 (the owner, 2026-10-03: "why are these two screens separate?"): the steps this tab runs
// are the project's row's own, and the page asks for the tab only while they run.
describe("the steps this tab runs, on the Mate's own view", () => {
  const IDA: NewProjectBirth = {
    ...ACME,
    birthId: "add-1",
    botName: "Ida",
    step: "create",
    adds: { appId: "g-acme", registers: true },
  };

  it("draws a New project's under the project's row, and asks for the tab while they run", () => {
    hold({ ...ACME, step: "registry" });
    openView();
    expect(substeps()).toEqual([
      "registry › Registered:active",
      "registry › Created:waiting",
      "registry › Vera registered:waiting",
      "registry › Container:waiting",
      "registry › Closed off:waiting",
    ]);
    expect(steps()[0]).toBe("registry:active");
    expect(said()).toContain(KEEP_TAB_OPEN_LINE);
  });

  it("draws an added Mate's under its copy, from the press", () => {
    hold(IDA);
    openView("add-1");
    expect(kind()).toBe("coming");
    expect(said()).toContain("Ida on Acme CRM");
    expect(steps()).toEqual(["copy:active", "workspace:waiting", "you:you"]);
    expect(substeps()).toEqual([
      "copy › Created:active",
      "copy › Ida registered:waiting",
      "copy › Container:waiting",
      "copy › Closed off:waiting",
    ]);
    expect(said()).toContain(KEEP_TAB_OPEN_LINE);
  });

  it.each([
    { verb: "Dismiss", called: () => expect(verbs.dismiss).toHaveBeenCalledWith("add-1") },
    {
      verb: "Start over",
      called: () =>
        expect(verbs.startOver).toHaveBeenCalledWith(expect.objectContaining({ birthId: "add-1" })),
    },
  ])("ends an Add refused before Zerops took anything: $verb", ({ verb, called }) => {
    hold({ ...IDA, failed: { reason: "No room in this account.", uncertain: false } });
    openView("add-1");
    expect(button("Try again")).toBeDefined();
    act(() => {
      button(verb)?.props.onClick();
    });
    called();
    // Let go of, its view goes with it, to the projects.
    expect(app.navigate).toHaveBeenCalledWith({ to: "/zerops", replace: true });
  });

  // Run 6's second review: one Zerops may have made had no way to end but the projects.
  it("lets an Add Zerops may have made be dismissed, never started over", () => {
    hold({ ...IDA, failed: { reason: "Zerops may have created it.", uncertain: true } });
    openView("add-1");
    expect(button("Go to projects")).toBeDefined();
    expect(button("Start over")).toBeUndefined();
    act(() => {
      button("Dismiss")?.props.onClick();
    });
    expect(verbs.dismiss).toHaveBeenCalledWith("add-1");
    expect(app.navigate).toHaveBeenCalledWith({ to: "/zerops", replace: true });
  });

  it("says where one stopped, in its place, with Try again, and no longer asks for the tab", () => {
    hold({ ...IDA, failed: { reason: "No room in this account.", uncertain: false } });
    openView("add-1");
    expect(kind()).toBe("failed");
    expect(substeps()[0]).toBe("copy › Created:failed");
    expect(said()).not.toContain("No room in this account.");
    openDetails();
    expect(said()).toContain("No room in this account.");
    expect(said()).not.toContain(KEEP_TAB_OPEN_LINE);
    expect(button("Try again")).toBeDefined();
  });
});
