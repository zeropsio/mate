// @vitest-environment happy-dom
import { act, createElement as h, type ReactNode } from "react";
import { create, type ReactTestRenderer, type ReactTestRendererJSON } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { KEEP_TAB_OPEN_LINE } from "~/zerops/mateArrival";
import { useNewMate } from "~/zerops/newMate";
import { useNewProjectBirths, type NewProjectBirth } from "~/zerops/newProjectBirth";

import { ZeropsNewProjectComingPage } from "./ZeropsNewProjectComingPage";

const app = vi.hoisted(() => ({
  navigate: vi.fn(async (_to: unknown) => undefined),
}));

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

/** Acme CRM, pressed a moment ago on an account with no Git hosting: standing it up. */
const ACME: NewProjectBirth = {
  id: "g-acme",
  organizationId: "org-acme",
  groupId: "g-acme",
  name: "Acme CRM",
  botName: "Vera",
  face: { tint: "rose", shape: "seal" },
  locationId: null,
  agents: [],
  startedAt: Date.parse("2026-09-30T10:00:00.000Z"),
  withGitea: true,
  giteaProjectId: null,
  step: "gitea",
  failed: null,
  projectId: null,
  progress: null,
};

let tree: ReactTestRenderer | undefined;

function hold(birth: NewProjectBirth | undefined) {
  act(() => {
    useNewProjectBirths.setState({ births: birth === undefined ? {} : { [birth.id]: birth } });
  });
}

function openView(birthId = "g-acme") {
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
    expect(steps()).toEqual([
      "git-hosting:active",
      "registry:waiting",
      "workspace:waiting",
      "you:you",
    ]);
    expect(said()).toContain("Git hosting");
    expect(said()).toContain("Vera's workspace");
    expect(said()).toContain("You sign Vera in with your Claude or ChatGPT subscription");
    expect(app.navigate).not.toHaveBeenCalled();
  });

  it("hands the route to its Mate's own view the moment the platform takes its project, in place of this one", () => {
    hold({ ...ACME, withGitea: false, giteaProjectId: "gitea-1", step: "create" });
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
    hold({ ...ACME, failed: { reason: "No room in this account.", uncertain: false } });
    openView();
    expect(kind()).toBe("failed");
    expect(said()).toContain("No room in this account.");
    act(() => {
      button("Try again")?.props.onClick();
    });
    expect(useNewProjectBirths.getState().births["g-acme"]?.failed).toBeNull();
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
    id: "add-1",
    botName: "Ida",
    withGitea: false,
    giteaProjectId: "gitea-1",
    step: "create",
    adds: { displayName: "Acme CRM - Ida", registers: true },
  };

  it("draws a New project's under the project's row, and asks for the tab while they run", () => {
    hold({ ...ACME, withGitea: false, giteaProjectId: "gitea-1", step: "registry" });
    openView();
    expect(substeps()).toEqual([
      "registry › Registered:active",
      "registry › Created:waiting",
      "registry › Closed off:waiting",
      "registry › Vera registered:waiting",
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
      "copy › Container:waiting",
      "copy › Closed off:waiting",
      "copy › Ida registered:waiting",
    ]);
    expect(said()).toContain(KEEP_TAB_OPEN_LINE);
  });

  it.each([
    {
      verb: "Dismiss",
      then: { asked: null },
    },
    {
      verb: "Start over",
      then: {
        asked: expect.objectContaining({
          groupId: "g-acme",
          again: { botName: "Ida", name: "Acme CRM - Ida", tint: "rose", shape: "seal" },
        }),
      },
    },
  ])("ends an Add refused before Zerops took anything: $verb", ({ verb, then }) => {
    useNewMate.setState({ asked: null });
    hold({ ...IDA, failed: { reason: "No room in this account.", uncertain: false } });
    openView("add-1");
    expect(button("Try again")).toBeDefined();
    act(() => {
      button(verb)?.props.onClick();
    });
    expect(useNewProjectBirths.getState().births["add-1"]).toBeUndefined();
    expect(app.navigate).toHaveBeenCalledWith({ to: "/zerops", replace: true });
    expect(useNewMate.getState()).toMatchObject(then);
    useNewMate.setState({ asked: null });
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
    expect(useNewProjectBirths.getState().births["add-1"]).toBeUndefined();
    expect(app.navigate).toHaveBeenCalledWith({ to: "/zerops", replace: true });
  });

  it("says where one stopped, in its place, with Try again, and no longer asks for the tab", () => {
    hold({ ...IDA, failed: { reason: "No room in this account.", uncertain: false } });
    openView("add-1");
    expect(kind()).toBe("failed");
    expect(substeps()[0]).toBe("copy › Created · No room in this account.:failed");
    expect(said()).not.toContain(KEEP_TAB_OPEN_LINE);
    expect(button("Try again")).toBeDefined();
  });
});
