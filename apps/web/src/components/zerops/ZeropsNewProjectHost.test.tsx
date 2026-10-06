import { act, createElement as h } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "~/zerops/accountLifetime";
import { useNewProjectAsk } from "~/zerops/newProjectAsk";
import { useNewProjectBirths } from "~/zerops/newProjectBirth";

import type { NewProjectChoice } from "./ZeropsNewProjectForm";
import { ZeropsNewProjectHost } from "./ZeropsNewProjectHost";

const ORGANIZATION = {
  id: "org-acme",
  membershipId: "m-ada",
  name: "acme",
  roleCode: "OWNER",
  canCreateProjects: true,
};

const app = vi.hoisted(() => ({
  navigate: vi.fn(async (_to: unknown) => undefined),
  // Never answers: what comes after the press is the creation's, not the dialog's.
  pending: vi.fn(() => new Promise(() => undefined)),
  dialog: undefined as { readonly onCreate: (choice: NewProjectChoice) => void } | undefined,
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => app.navigate }));
vi.mock("~/zerops/ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({
    status: "signed-in",
    activeOrganization: ORGANIZATION,
    organizationStatus: "selected",
    organizations: [ORGANIZATION],
    selectOrganization: () => undefined,
    user: { id: "u-ada" },
    client: {},
  }),
}));
vi.mock("~/zerops/zeropsDataContext", () => ({
  useZeropsData: () => ({
    organizationRef: (id: string) => ({ id }),
    projectRef: (organizationId: string, projectId: string) => ({ organizationId, projectId }),
    runtime: {
      scope: "account",
      commands: {
        updateProjectTags: app.pending,
        createProjectWithMate: app.pending,
      },
    },
  }),
  runZeropsCommand: (command: Promise<unknown>) => command,
}));
vi.mock("~/zerops/useZeropsCandidates", () => ({
  useZeropsCandidates: () => ({ listing: { state: "unread", waitingFor: null } }),
  useTakenBotNames: () => ({ names: [], complete: true }),
}));
vi.mock("~/zerops/accountHq", () => ({
  useAccountHq: () => ({
    admins: [],
    hq: { kind: "official", projectId: "hq", address: "https://hq.example" },
  }),
  officialHq: (account: { hq: unknown }) => account.hq,
  accountHqApi: () => ({ createApp: app.pending, recordBirth: app.pending }),
}));
vi.mock("./ZeropsNewProjectForm", () => ({
  ZeropsNewProjectDialog: (props: { readonly onCreate: (choice: NewProjectChoice) => void }) => {
    app.dialog = props;
    return h("form", { "data-new-project": "" });
  },
}));

let tree: ReactTestRenderer | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  openAccountLifetime("u-ada");
  app.navigate.mockClear();
  app.dialog = undefined;
  useNewProjectBirths.setState({ births: {} });
  act(() => useNewProjectAsk.getState().ask());
  act(() => {
    tree = create(h(ZeropsNewProjectHost));
  });
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  closeAccountLifetime();
  vi.unstubAllGlobals();
});

const dialogShown = () =>
  tree?.root.findAll((node) => node.props["data-new-project"] !== undefined).length === 1;

// Run 6 (the owner, 2026-10-03: "why are these two screens separate?"): Create closes the dialog
// and lands on the first Mate's page at once; the creation runs on without the dialog.
describe("New project's Create", () => {
  it("closes the dialog and lands on its first Mate's page, the creation held and running", () => {
    expect(dialogShown()).toBe(true);
    act(() => {
      app.dialog?.onCreate({
        name: "Acme CRM",
        botName: "Vera",
        face: { tint: "rose", shape: "seal" },
      } as NewProjectChoice);
    });
    expect(dialogShown()).toBe(false);
    const births = Object.values(useNewProjectBirths.getState().births);
    expect(births).toHaveLength(1);
    expect(births[0]).toMatchObject({ name: "Acme CRM", botName: "Vera", failed: null });
    expect(app.navigate).toHaveBeenCalledWith({
      to: "/mate/new/$birthId",
      params: { birthId: births[0]?.birthId },
    });
  });
});
