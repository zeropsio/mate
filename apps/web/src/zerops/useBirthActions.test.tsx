import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import { HqError } from "@t3tools/client-runtime/zerops/hq";
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { pressRegistration } from "./matePress";
import { useBirthActions } from "./useBirthActions";

const fixture = vi.hoisted(() => ({
  holdPress: vi.fn(),
  endPress: vi.fn(),
  run: vi.fn(),
  birth: {
    id: "birth-1",
    appId: "app-1",
    appName: "Shop",
    face: "rose:seal",
    projectId: "project-1" as string | null,
    importProcessId: null,
    placement: "attached" as const,
    intent: undefined,
    progress: {
      phase: "container-starting" as const,
      next: { kind: "record-import" as const, receipt: "service-1" },
      reason: null,
    },
    canContinue: true,
    canDelete: true,
  },
}));

vi.mock("@t3tools/client-runtime/data", async (original) => {
  const actual = await original<typeof import("@t3tools/client-runtime/data")>();
  const { Atom } = await import("effect/reactivity");
  const births = Atom.make({ open: [fixture.birth] });
  return {
    ...actual,
    accountReadsAtom: Atom.make({ orgId: "org-1" }),
    sharedBirthsAtom: () => births,
  };
});
vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({
    activeOrganization: { id: "org-1" },
    user: { id: "user-1" },
    client: {},
  }),
}));
vi.mock("./accountOperations", () => ({
  HQ_UNFOLLOWED: "unfollowed",
  useAccountOperationsOptional: () => ({ run: fixture.run }),
}));
vi.mock("./accountHq", () => ({
  configuredHq: () => ({}),
  accountHqApi: () => ({ holdPress: fixture.holdPress, endPress: fixture.endPress }),
}));
vi.mock("./accountLifetime", async (original) => ({
  ...(await original<typeof import("./accountLifetime")>()),
  captureAccountLifetime: () => () => true,
}));
vi.mock("./pressStreams", () => ({ pressStreamOf: () => null }));
vi.mock("./accountInvalidations", () => ({ invalidateZerops: vi.fn() }));
vi.mock("./sharedBirths", () => ({ waitForBirthPlacement: vi.fn() }));
vi.mock("./zeropsDataContext", () => ({ useZeropsData: () => ({ organizationRef: vi.fn() }) }));
vi.mock("./useGitBrowse", () => ({ useGitBrowseReads: () => ({ views: [] }) }));
vi.mock("./matePress", () => ({
  pressPlatform: vi.fn(),
  pressRegistration: vi.fn(),
  runPress: vi.fn(),
}));

const seeded = { ...fixture.birth };

let tree: ReactTestRenderer | undefined;
let proceed: ReturnType<typeof useBirthActions>["proceed"];
let deleteBirthOnly: ReturnType<typeof useBirthActions>["deleteBirthOnly"];
function Probe() {
  ({ proceed, deleteBirthOnly } = useBirthActions([fixture.birth]));
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.holdPress.mockReset();
  fixture.endPress.mockReset().mockResolvedValue(undefined);
  fixture.run.mockReset().mockResolvedValue(undefined);
  Reflect.deleteProperty(fixture.birth, "adopted");
  Object.assign(fixture.birth, seeded);
  vi.mocked(pressRegistration).mockReset();
  act(() => {
    tree = create(
      createElement(RegistryContext.Provider, { value: AtomRegistry.make() }, createElement(Probe)),
    );
  });
});

it.each([
  { case: "an unbound birth", projectId: null, adopted: false },
  { case: "an adopted birth", projectId: "project-1", adopted: true },
])(
  "deletes $case without asking the client to delete its application",
  async ({ projectId, adopted }) => {
    fixture.birth.projectId = projectId;
    if (adopted) Object.assign(fixture.birth, { adopted: true });
    await deleteBirthOnly("birth-1", projectId);
    expect(fixture.run.mock.calls).toEqual([
      [
        { kind: "delete-birth", orgId: "org-1", appId: "app-1", birthId: "birth-1" },
        { orgId: "org-1", unobserved: "unfollowed" },
      ],
    ]);
  },
);
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});

it("Continue reports a recovered import only after HQ records its receipt", async () => {
  const denied = new HqError({
    kind: "refused",
    code: "forbidden",
    reason: "not_mate_operator",
    status: 403,
    message: "HQ refused the press write",
  });
  fixture.holdPress.mockResolvedValueOnce(undefined).mockRejectedValueOnce(denied);
  const refused = await proceed("birth-1").then(
    () => true,
    () => false,
  );
  expect(fixture.holdPress).toHaveBeenCalledTimes(2);
  expect(fixture.holdPress).toHaveBeenLastCalledWith(
    "project-1",
    expect.objectContaining({ importProcessId: "service-1" }),
  );

  fixture.holdPress.mockReset().mockRejectedValueOnce(denied);
  const skipped = await proceed("birth-1").then(
    () => true,
    () => false,
  );
  expect(fixture.holdPress).toHaveBeenCalledTimes(1);

  fixture.holdPress.mockReset().mockResolvedValue(undefined);
  const recorded = await proceed("birth-1");
  expect(fixture.holdPress).toHaveBeenCalledTimes(2);
  expect({ refused, skipped, recorded }).toEqual({
    refused: false,
    skipped: false,
    recorded: "started",
  });
});

it("Continue registers an adopted project's Mate as its record, never attaching the project again", async () => {
  Object.assign(fixture.birth, {
    adopted: true,
    placement: "unplaced",
    intent: {
      projectName: "Existing",
      recipe: { kind: "none" },
      agents: ["codex"],
      standUp: false,
      automated: false,
      placement: { role: "dev", name: "Nova", chief: false },
      location: null,
      userRoles: [],
    },
  });
  vi.mocked(pressRegistration).mockReturnValue(async () => {});
  await proceed("birth-1");
  expect(vi.mocked(pressRegistration).mock.calls.map(([, registration]) => registration)).toEqual([
    { hq: {}, kind: "mate-record", record: { face: "rose:seal" }, standUp: false },
  ]);
});
