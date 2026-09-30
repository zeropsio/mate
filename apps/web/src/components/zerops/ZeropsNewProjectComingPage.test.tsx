import { act, createElement as h, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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
};

let tree: ReactTestRenderer | undefined;

function hold(birth: NewProjectBirth | undefined) {
  act(() => {
    useNewProjectBirths.setState({ births: birth === undefined ? {} : { [birth.groupId]: birth } });
  });
}

function openView() {
  act(() => {
    tree = create(h(ZeropsNewProjectComingPage, { birthId: "g-acme" }));
  });
}

/** Everything the view says, as one line. */
const said = () =>
  (tree?.root.findAll((node) => typeof node.type === "string") ?? [])
    .flatMap((node) => node.children.filter((child) => typeof child === "string"))
    .join(" ");

/** Each step as the arrival draws it, in order: which, and where it stands. */
const steps = () =>
  tree?.root
    .findAll((node) => node.props["data-arrival-step"] !== undefined)
    .map(
      (node) => `${String(node.props["data-arrival-step"])}:${String(node.props["data-state"])}`,
    ) ?? [];

const kind = () => tree?.root.findByType("section").props["data-kind"];

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
    expect(said()).toContain("You sign Vera in");
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
