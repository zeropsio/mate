/**
 * *Change face…* as `useMateActions` offers it, wherever a Mate is listed: beside Rename, where
 * the viewer may change the Mate; its dialog opening on the face the Mate wears; a save that is
 * one write to the organization's HQ, closing once HQ takes it; and a refusal said in the dialog,
 * nothing else changed. *Rename Mate* renames the Mate's project in Zerops, whose name is the
 * Mate's (D3).
 */
import { RegistryContext } from "@effect/atom-react";
import { readZeropsMembership, type ZeropsMateFace } from "@t3tools/client-runtime/zerops";
import type { MateLiveView } from "@t3tools/shared/hqMates";
import type { HqMateOfferStates, HqPlacement } from "@t3tools/client-runtime/zerops/hq";
import { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/unstable/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useUnrenamedProjects } from "./unrenamedProjects";

import type { ZeropsMenuAction } from "../components/zerops/ZeropsProjectMenu";
import { zeropsSessionAtom } from "../state/zerops";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { KEY_WIDER_WHY, mateAddedBy, useMateActions, type MateActions } from "./useMateActions";
import type { ZeropsCandidatePresentation } from "./useZeropsCandidates";
import { mountHqNavigation } from "~/zerops/__fixtures__/hqNavigation";

interface AssignDialogProps {
  readonly candidates: ReadonlyArray<{ readonly clientUserId: string; readonly name: string }>;
  readonly readingOrganization?: string | undefined;
  readonly readFailed?:
    | { readonly organization: string; readonly onReadAgain: () => void }
    | undefined;
  readonly readRefused?: { readonly organization: string } | undefined;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onSubmit: (clientUserId: string) => void;
}

interface FaceDialogProps {
  readonly open: boolean;
  readonly name: string;
  readonly face: ZeropsMateFace;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onSave: (face: ZeropsMateFace) => void;
  readonly onCancel: () => void;
  readonly onOpenChangeComplete: (open: boolean) => void;
}

/** Every kind a Mate may take, as HQ lists where it may go. */
const KINDS = ["mate", "devstage", "stage", "production"];
/** What HQ offers an org owner of a Mate: everything, anywhere. */
const OWNER_OFFERS: HqMateOfferStates = {
  held: true,
  observe: { kind: "allowed" },
  edit: { kind: "allowed" },
  detach: { kind: "allowed" },
};

const mock = vi.hoisted(() => ({
  /** Where HQ answers a Mate may go, as its move opens (`move-offers`). */
  moveTo: {} as Readonly<Record<string, ReadonlyArray<string>>>,
  /** HQ's registry as the page hands it to the hook; empty by default. */
  registry: { groups: [] } as {
    groups: ReadonlyArray<{
      groupId: string;
      name: string;
      projects: ReadonlyArray<{ projectId: string; kind: "mate" | "stage" | "production" }>;
    }>;
  },
  /** Whether each Mate's press in another browser is at it, as HQ holds it; none by default. */
  pressElsewhere: (_projectId: string): "pressing" | "stopped" | "unknown" => "stopped",
  /** What HQ offers of each project (`useMateOffers`); an owner's by default. */
  mateOffers: (_projectId: string): unknown => undefined,
  /** HQ's `PATCH /api/mates/{projectId}`, a write here being the promise the test answers. */
  updateMate: vi.fn(),
  /** HQ's move of a project, and its creation of an application a Mate is moved into. */
  moveProject: vi.fn(),
  createApp: vi.fn(),
  restartContainer: vi.fn(),
  threads: [] as Array<{
    environmentId: string;
    title: string;
    session: { status: string; activeTurnId: string | null } | null;
    latestTurn: { state: string } | null;
  }>,
  restartDialog: {
    current: null as {
      readonly body: string;
      readonly onConfirm: () => void;
      readonly onCancel: () => void;
    } | null,
  },
  /** The platform's rename of a project, as the account's operation: resolves once Zerops took it. */
  renameProject: vi.fn(),
  /** *Finish setup*'s steps, as the hook hands them over. */
  finishMateSetup: vi.fn(),
  roleCode: "OWNER",
  /** Who the session says is signed in; null where it names nobody. */
  user: { id: "user-ada" } as { readonly id: string } | null,
  listing: { current: undefined as unknown },
  /** The press's marker on each container, by service id, as the store states it. */
  markers: new Map<string, boolean | "unknown" | "unread">(),
  dialog: { current: null as FaceDialogProps | null },
  /** The account's hand-over operation, answered with where it stands: a promise the test answers. */
  assignMateOwner: vi.fn(),
  assignDialog: { current: null as AssignDialogProps | null },
  /** What the hook asked the account's bus to read again. */
  invalidated: [] as Array<unknown>,
  /** The tokens the account deleted, by id. */
  deletedTokens: [] as Array<string>,
  deleteTokenFailure: false,
  mateKeyFailure: false,
  deleteProject: vi.fn(),
  setDeleting: vi.fn(),
  prepareProjectDeletion: vi.fn(),
  completeProjectDeletion: vi.fn(),
  keyReads: 0,
  /** The id of the key a Mate named to HQ; none where it named none. */
  mateKey: null as string | null,
  /** The delete dialog as the hook mounts it. */
  deleteDialog: {
    current: null as {
      readonly onConfirm: () => void;
      readonly error: string | null;
      readonly cleanup?: boolean;
    } | null,
  },
  /** The kinds of the account's cells the hook asked for. */
  asked: [] as Array<string>,
  /** The organization's token list, as the platform would answer it were it read. */
  tokens: [] as Array<unknown>,
  /** The Mates HQ was asked whom to hand over to, in order. */
  handoverAsked: [] as Array<string>,
  /** HQ's answer of whom a Mate may be handed over to. */
  handoverAnswer: (): Promise<ReadonlyArray<unknown>> => Promise.resolve([]),
  /** No account data is mounted: there is no HQ to ask. */
  noAccountData: false,
  /** The account HQ's read of the member list again. */
  reread: vi.fn(),
  /** The Move dialog as the hook mounts it: where it offers the Mate to go. */
  moveDialog: {
    current: null as {
      readonly name: string;
      readonly choices: {
        readonly apps: ReadonlyArray<{ readonly id: string; readonly name: string }>;
      };
      readonly onSubmit: (membership: unknown) => void;
    } | null,
  },
}));

vi.mock("../state/entities", () => ({ useThreadShells: () => mock.threads }));
vi.mock("./useHqOffers", () => ({
  useMateOffers: () => mock.mateOffers,
  // HQ offers writing the structure to the org's owners and admins (`create_app`).
  useOrgOffers: () => () =>
    mock.roleCode === "OWNER" || mock.roleCode === "ADMIN"
      ? { kind: "allowed" }
      : { kind: "refused", reason: "not_structure_writer" },
}));
vi.mock("./ZeropsAccountData", () => ({
  useAccountDataOptional: () =>
    mock.noAccountData
      ? null
      : {
          moveOffers: () => Promise.resolve(mock.moveTo),
          handoverCandidates: (projectId: string) => {
            mock.handoverAsked.push(projectId);
            return mock.handoverAnswer();
          },
        },
}));
vi.mock("./deleteProject", () => ({
  useDeleteProject: () => mock.deleteProject,
}));
vi.mock("./mateRestart", () => ({
  useRestartMate: () => mock.restartContainer,
}));
vi.mock("./zeropsContainers", () => ({
  readContainerInitAt: async () => null,
  intendContainer: () => {},
}));
vi.mock("../components/zerops/ZeropsRestartMateDialog", () => ({
  ZeropsRestartMateDialog: (props: NonNullable<typeof mock.restartDialog.current>) => {
    mock.restartDialog.current = props;
    return null;
  },
}));

vi.mock("./accountEnvironments", () => ({
  currentAccountEnvironments: () => ({ setDeleting: mock.setDeleting }),
}));

vi.mock("./accountInvalidations", () => ({
  invalidateZerops: (invalidation: unknown) => {
    mock.invalidated.push(invalidation);
  },
}));

vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({
    activeOrganization: {
      id: "org-acme",
      membershipId: "member-ada",
      name: "Acme",
      roleCode: mock.roleCode,
      canCreateProjects: true,
    },
    client: {
      deleteIntegrationToken: async ({ tokenId }: { readonly tokenId: string }) => {
        mock.deletedTokens.push(tokenId);
        if (mock.deleteTokenFailure) throw new Error("Key retirement refused");
      },
    },
    user: mock.user,
  }),
}));
// The account's operations: a rename Zerops refuses is said with its reason.
vi.mock("./accountOperations", () => ({
  useAccountOperations: () => ({
    submit: async (intent: { readonly kind: string }) => {
      if (intent.kind === "assign-mate-owner") return mock.assignMateOwner(intent);
      try {
        await mock.renameProject(intent);
        return {
          requestId: "r1",
          evidence: null,
          progress: { stage: "done", operationId: "p", outcome: "succeeded" },
        };
      } catch (cause) {
        return {
          requestId: "r1",
          evidence: null,
          progress: { stage: "refused", reason: (cause as Error).message },
        };
      }
    },
  }),
}));
// The account's runtime: no platform command is answered here.
vi.mock("./zeropsDataContext", () => ({
  useZeropsData: () => ({
    organizationRef: (organizationId: string) => ({ organizationId }),
    projectRef: (organizationId: string, projectId: string) => ({ organizationId, projectId }),
    runtime: {},
  }),
  // Each container's Mate variables: its press's marker as the case states it, absent unless it says.
  useZeropsAtomSelections: (selections: ReadonlyArray<readonly [string, unknown]>) =>
    new Map(
      selections.map(([serviceId]) => [
        serviceId,
        { flag: true, marker: mock.markers.get(serviceId) ?? false },
      ]),
    ),
}));
vi.mock("./useZeropsCandidates", () => ({
  useZeropsCandidates: () => ({ listing: mock.listing.current, refresh: () => {} }),
  useTakenBotNames: () => ({ names: [], complete: true }),
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ state: { matches: [] }, navigate: () => {} }),
}));
vi.mock("./useOpenMate", () => ({ useOpenMate: () => () => {} }));
vi.mock("../routes/-environmentTargets", () => ({
  useEnvironmentLinks: () => ({ linkTarget: () => undefined }),
}));
vi.mock("./usePressesElsewhere", () => ({
  usePressesElsewhere: () => (projectId: string) => mock.pressElsewhere(projectId),
}));
vi.mock("./inventoryContext", async () => {
  const { useState } = await import("react");
  return { useProjectDialog: () => useState(null) };
});
// The organization's official HQ, where a Mate's face is written.
vi.mock("./accountHq", async (original) => ({
  officialHq: (await original<typeof import("./accountHq")>()).officialHq,
  useAccountHq: () => ({
    status: "ready",
    hq: { kind: "official", projectId: "p-hq", address: "https://hq.example.test" },
    admins: [],
    reread: mock.reread,
  }),
  accountHqApi: () => ({
    updateMate: mock.updateMate,
    moveProject: mock.moveProject,
    createApp: mock.createApp,
    prepareProjectDeletion: mock.prepareProjectDeletion,
    completeProjectDeletion: mock.completeProjectDeletion,
    mateKey: async () => {
      mock.keyReads++;
      if (mock.mateKeyFailure) throw new Error("HQ is unavailable");
      return mock.mateKey;
    },
  }),
}));
vi.mock("./projectOrderPreference", () => ({ useProjectOrderOptions: () => ({ order: "name" }) }));
// The press's steps, not run here: what *Finish setup* hands them is the case.
vi.mock("./matePress", async (original) => ({
  ...(await original<typeof import("./matePress")>()),
  beginPress: () => {},
  finishMateSetup: mock.finishMateSetup,
}));
vi.mock("../components/zerops/ZeropsDeleteMateDialog", () => ({
  ZeropsDeleteMateDialog: (props: NonNullable<typeof mock.deleteDialog.current>) => {
    mock.deleteDialog.current = props;
    return null;
  },
}));
vi.mock("../components/zerops/ZeropsAssignMateDialog", () => ({
  ZeropsAssignMateDialog: (props: AssignDialogProps) => {
    mock.assignDialog.current = props;
    return null;
  },
}));
vi.mock("../components/zerops/ZeropsMoveToGroupDialog", () => ({
  ZeropsMoveToGroupDialog: (props: NonNullable<typeof mock.moveDialog.current>) => {
    mock.moveDialog.current = props;
    return null;
  },
}));
// The dialog as the hook mounts it: what it is handed, and the two answers it gives.
vi.mock("../components/zerops/ZeropsChangeFaceDialog", () => ({
  ZeropsChangeFaceDialog: (props: FaceDialogProps) => {
    mock.dialog.current = props;
    return null;
  },
}));

/**
 * A Mate of Acme Docs as HQ places it, its project named `name` in Zerops, wearing `face` as HQ
 * records it ("" where none was picked), its stand-up asked by `asker` where one is.
 */
function mate(name: string, face = "", asker?: string): ZeropsCandidatePresentation {
  const id = `acme-docs-${name.toLowerCase()}`;
  const hq: HqPlacement = {
    appId: "acme",
    appName: "Acme Docs",
    kind: "mate",
    mate: { face, ...(asker === undefined ? {} : { standupRequestedBy: asker }) },
  };
  return {
    key: `${id}:zcp`,
    group: "connected",
    presence: "known",
    environmentId: EnvironmentId.make(`env-${id}`),
    project: {
      id,
      name,
      status: "ACTIVE",
      clientId: "org-acme",
      tagList: ["mate"],
      hq,
    },
    service: { id: `zcp-${id}`, name: "zcp", status: "ACTIVE" },
  } as ZeropsCandidatePresentation;
}

const FEN = mate("Fen");
const QUINN = mate("Quinn", "coral:gem");

/** Every value the hook handed back, the latest last. */
const seen: Array<MateActions> = [];
const actions = () => seen.at(-1)!;
function Probe() {
  const handed = useMateActions({
    registry: { registry: mock.registry },
    serverVersions: new Map(),
  });
  seen.push(handed);
  return <>{handed.dialogs}</>;
}

const mounted: ReactTestRenderer[] = [];
beforeEach(() => {
  openAccountLifetime("user-ada");
  mock.restartContainer.mockReset();
  mock.restartContainer.mockResolvedValue(undefined);
  mock.threads = [];
  mock.restartDialog.current = null;
  mock.roleCode = "OWNER";
  mock.mateOffers = () => OWNER_OFFERS;
  mock.moveTo = { acme: KINDS, new: KINDS };
  mock.user = { id: "user-ada" };
  mock.markers.clear();
  mock.pressElsewhere = () => "stopped";
  mock.registry = { groups: [] };
  mock.dialog.current = null;
  mock.assignDialog.current = null;
  mock.assignMateOwner.mockReset();
  mock.invalidated = [];
  mock.deletedTokens = [];
  mock.deleteTokenFailure = false;
  mock.mateKeyFailure = false;
  mock.keyReads = 0;
  mock.prepareProjectDeletion.mockReset().mockResolvedValue("completion-fen");
  mock.completeProjectDeletion.mockReset().mockResolvedValue(undefined);
  mock.deleteProject.mockReset().mockResolvedValue({ value: undefined });
  mock.setDeleting.mockReset();
  mock.handoverAsked = [];
  mock.handoverAnswer = () => Promise.resolve([]);
  mock.noAccountData = false;
  mock.reread.mockReset();
  mock.mateKey = null;
  mock.deleteDialog.current = null;
  mock.moveDialog.current = null;
  mock.updateMate.mockReset();
  useUnrenamedProjects.setState({ left: new Map() });
  mock.moveProject.mockReset();
  mock.createApp.mockReset();
  mock.renameProject.mockReset();
  mock.finishMateSetup.mockReset();
  seen.length = 0;
  mock.listing.current = {
    state: "known",
    value: [FEN, QUINN],
    asOf: { ordinal: 1, atMs: 1_000 },
    coverage: "complete",
    freshness: { kind: "live" },
  };
});
afterEach(() => {
  for (const tree of mounted.splice(0)) {
    act(() => {
      tree.unmount();
    });
  }
  closeAccountLifetime();
});

/** The hook mounted, over `registry` where the case seeds HQ's structure in one. */
function mount(registry?: AtomRegistry.AtomRegistry): void {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  act(() => {
    mounted.push(
      create(
        registry === undefined ? (
          <Probe />
        ) : (
          <RegistryContext.Provider value={registry}>
            <Probe />
          </RegistryContext.Provider>
        ),
      ),
    );
  });
}

const verbs = (candidate: ZeropsCandidatePresentation) =>
  actions()
    .actionsFor(candidate, { mate: true, groupId: "acme", role: "dev" } as never)
    .filter((entry): entry is ZeropsMenuAction => !("separator" in entry));

function openFace(candidate: ZeropsCandidatePresentation): void {
  const entry = verbs(candidate).find((verb) => verb.id === "face");
  act(() => {
    entry!.onSelect();
  });
}

describe("useMateActions — Change face…", () => {
  it.each([
    { who: "an org owner", role: "OWNER", offered: true },
    { who: "an org admin", role: "ADMIN", offered: true },
    { who: "a member on a colleague's Mate", role: "BASIC_USER", offered: false },
    { who: "a read-only member", role: "READ_ONLY", offered: false },
  ])("$who: offered $offered, right after Rename Mate as Rename is", ({ role, offered }) => {
    mock.roleCode = role;
    // HQ offers the Mate's record exactly where the platform takes its rename.
    mock.mateOffers = () => ({
      ...OWNER_OFFERS,
      edit: offered ? { kind: "allowed" } : { kind: "refused", reason: "not_project_admin" },
    });
    mount();
    const ids = verbs(FEN).map((verb) => verb.id);
    expect(ids.includes("face")).toBe(offered);
    expect(ids.includes("rename-agent")).toBe(offered);
    if (offered) {
      expect(ids.indexOf("face")).toBe(ids.indexOf("rename-agent") + 1);
      expect(verbs(FEN).find((verb) => verb.id === "face")?.label).toBe("Change face…");
    }
    expect(actions().changeFace(FEN) !== undefined).toBe(offered);
  });

  it("offers no Mate verb of HQ's to a person the session does not name: unknown is no", () => {
    mock.user = null;
    mock.mateOffers = () => undefined;
    mount();
    const ids = verbs(FEN).map((verb) => verb.id);
    expect(ids.filter((id) => ["rename-agent", "face", "move", "leave"].includes(id))).toEqual([]);
    expect(actions().changeFace(FEN)).toBeUndefined();
    expect(actions().renameInPlace(FEN)).toBeUndefined();
  });

  // The web review, 2026-10-05: an HQ from before its offers says nothing of a Mate's: HQ's verbs
  // are drawn and not pressable, never taken away; the platform's rename stands.
  it("draws HQ's verbs not pressable on a Mate HQ has said nothing of", () => {
    const unsaid = { kind: "unknown" } as const;
    mock.mateOffers = () => ({
      held: true,
      observe: unsaid,
      edit: unsaid,
      detach: unsaid,
    });
    mount();
    expect(
      verbs(FEN)
        .filter((verb) => ["rename-agent", "face", "move", "leave"].includes(verb.id))
        .map((verb) => [verb.id, verb.disabled === true]),
    ).toEqual([
      ["rename-agent", false],
      ["face", true],
      ["move", true],
      ["leave", true],
    ]);
    // Its row's verbs are the door's and Zerops': they stand.
    expect(verbs(FEN).some((verb) => verb.id === "restart")).toBe(true);
  });

  it.each([
    {
      who: "a Mate wearing its name's tint",
      candidate: FEN,
      face: { tint: "sand", shape: "seal" },
    },
    {
      who: "a Mate whose face was picked",
      candidate: QUINN,
      face: { tint: "coral", shape: "gem" },
    },
  ])("opens its dialog on the face $who wears", ({ candidate, face }) => {
    mount();
    openFace(candidate);
    expect(mock.dialog.current).toMatchObject({ face, pending: false, error: null });
  });

  it("saves to HQ in one write, and closes once HQ takes it", async () => {
    let answer: (value: unknown) => void = () => {};
    mock.updateMate.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    mount();
    openFace(FEN);
    expect(mock.dialog.current).toMatchObject({ open: true });
    await act(async () => {
      mock.dialog.current!.onSave({ tint: "rose", shape: "seal" });
    });
    // Fen wore its name's tint: its name keeps its place among the names the tints are shared
    // out over (`changedMateFace`).
    expect(mock.updateMate).toHaveBeenCalledWith(FEN.project.id, { face: "rose:seal:named" });
    expect(mock.dialog.current).toMatchObject({ open: true, pending: true, error: null });
    await act(async () => {
      answer(undefined);
    });
    // It closes the way a dialog does, fading over the face it saved, still saying Saving…
    expect(mock.dialog.current).toMatchObject({ open: false, pending: true });
    act(() => {
      mock.dialog.current!.onOpenChangeComplete(false);
    });
    mock.dialog.current = null;
    act(() => {
      mounted[0]!.update(<Probe />);
    });
    expect(mock.dialog.current).toBeNull();
  });

  it("closes the way a dialog does on Cancel too, and then is gone", () => {
    mount();
    openFace(FEN);
    act(() => {
      mock.dialog.current!.onCancel();
    });
    expect(mock.dialog.current).toMatchObject({ open: false, pending: false });
    act(() => {
      mock.dialog.current!.onOpenChangeComplete(false);
    });
    mock.dialog.current = null;
    act(() => {
      mounted[0]!.update(<Probe />);
    });
    expect(mock.dialog.current).toBeNull();
    expect(mock.updateMate).not.toHaveBeenCalled();
  });

  it("says a refused write's reason in the dialog, and changes nothing else", async () => {
    mock.updateMate.mockRejectedValue(new Error("HQ refused the change (forbidden)."));
    mount();
    openFace(FEN);
    await act(async () => {
      mock.dialog.current!.onSave({ tint: "rose", shape: "seal" });
    });
    expect(mock.dialog.current).toMatchObject({
      open: true,
      pending: false,
      error: "HQ refused the change (forbidden).",
    });
    expect(mock.updateMate).toHaveBeenCalledTimes(1);
    expect(actions().trouble).toBeNull();
  });
});

// E2E F7: a refused hand-over closed its dialog and said nothing. The dialog stays until the
// platform answers, says a refusal there, and closes only on the platform's yes.
describe("useMateActions — Hand this Mate over", () => {
  const openAssign = () => {
    const entry = verbs(FEN).find((verb) => verb.id === "assign");
    act(() => {
      entry!.onSelect();
    });
  };

  // Whom a Mate may be handed over to is HQ's answer, asked as the picker opens.
  it("asks HQ whom to hand it to once its picker opens, never on load", () => {
    mount();
    expect(mock.handoverAsked).toEqual([]);
    openAssign();
    expect(mock.handoverAsked).toEqual([FEN.project.id]);
  });

  it("lists the people HQ answers", async () => {
    const ADA = { userId: "u-ada", clientUserId: "cu-ada", name: "Ada", avatarUrl: null };
    mock.handoverAnswer = () => Promise.resolve([ADA]);
    mount();
    await act(async () => {
      verbs(FEN)
        .find((verb) => verb.id === "assign")!
        .onSelect();
    });
    expect(mock.assignDialog.current?.candidates).toEqual([ADA]);
    expect(mock.assignDialog.current?.readingOrganization).toBeUndefined();
  });

  it("says it reads the organization until its people are there to pick", () => {
    mock.handoverAnswer = () => new Promise(() => {});
    mount();
    openAssign();
    expect(mock.assignDialog.current?.readingOrganization).toBe("Acme");
  });

  it("says it could not read the organization's people, and asks again on Try again", async () => {
    mock.handoverAnswer = () => Promise.reject(new Error("refused"));
    mount();
    await act(async () => {
      verbs(FEN)
        .find((verb) => verb.id === "assign")!
        .onSelect();
    });
    expect(mock.assignDialog.current?.readFailed?.organization).toBe("Acme");
    await act(async () => {
      mock.assignDialog.current!.readFailed!.onReadAgain();
    });
    expect(mock.handoverAsked).toEqual([FEN.project.id, FEN.project.id]);
  });

  it("says HQ refused to list them, and asks nothing again", async () => {
    mock.handoverAnswer = () =>
      Promise.reject({ outcome: "definitive-refusal", message: "HQ refused." });
    mount();
    await act(async () => {
      verbs(FEN)
        .find((verb) => verb.id === "assign")!
        .onSelect();
    });
    expect(mock.assignDialog.current?.readRefused?.organization).toBe("Acme");
    expect(mock.assignDialog.current?.readFailed).toBeUndefined();
    expect(mock.assignDialog.current?.readingOrganization).toBeUndefined();
  });

  it("says it could not read them where there is no HQ to ask, never reading forever", () => {
    mock.noAccountData = true;
    mount();
    openAssign();
    expect(mock.assignDialog.current?.readingOrganization).toBeUndefined();
    expect(mock.assignDialog.current?.readFailed?.organization).toBe("Acme");
  });

  const answered = (progress: unknown, evidence: string | null = null) => ({
    requestId: "r1",
    progress,
    evidence,
  });

  it("says a refused hand-over's reason in the dialog, which stays open", async () => {
    mock.assignMateOwner.mockResolvedValue(
      answered({ stage: "refused", reason: "Zerops refused the hand-over." }),
    );
    mount();
    openAssign();
    expect(mock.assignDialog.current).toMatchObject({ pending: false, error: null });
    await act(async () => {
      mock.assignDialog.current!.onSubmit("cu-eva");
    });
    expect(mock.assignMateOwner).toHaveBeenCalledWith({
      kind: "assign-mate-owner",
      orgId: "org-acme",
      projectId: FEN.project.id,
      clientUserId: "cu-eva",
    });
    expect(mock.assignDialog.current).toMatchObject({
      pending: false,
      error: "Zerops refused the hand-over.",
    });
    // Nothing changed hands: the grant is not asked again.
    expect(mock.invalidated).toEqual([]);
  });

  // F11: the person who handed a Mate over sees its new owner at once — the grant's round reads
  // the project's grants again — never only after the next round.
  it("asks the access grant to read the projects again once the platform takes it", async () => {
    mock.assignMateOwner.mockResolvedValue(
      answered({ stage: "done", operationId: FEN.project.id, outcome: "succeeded" }),
    );
    mount();
    openAssign();
    await act(async () => {
      mock.assignDialog.current!.onSubmit("cu-eva");
    });
    expect(mock.invalidated).toEqual([{ topic: "access", change: "grants-written" }]);
  });

  // F23 (e2e, 2026-10-03): a Mate has one OWNER. A hand over its previous owner still holds is
  // not complete, and says so; the first write landed, so the grant is read again.
  it("says the hand over is not complete where its previous owner keeps it, and reads the grants again", async () => {
    mock.assignMateOwner.mockResolvedValue(
      answered(
        { stage: "done", operationId: FEN.project.id, outcome: "failed" },
        "It was handed over, but its previous owner still owns it too: Zerops refused it.",
      ),
    );
    mount();
    openAssign();
    await act(async () => {
      mock.assignDialog.current!.onSubmit("cu-eva");
    });
    expect(mock.assignDialog.current).toMatchObject({
      pending: false,
      error: "It was handed over, but its previous owner still owns it too: Zerops refused it.",
    });
    expect(mock.invalidated).toEqual([{ topic: "access", change: "grants-written" }]);
  });

  it("says a hand-over it could not tell landed, and reads the grants again", async () => {
    mock.assignMateOwner.mockResolvedValue(
      answered({
        stage: "unresolved",
        operationId: null,
        nextActor: "person",
        nextAction: "Check who owns the Mate, then hand it over again",
      }),
    );
    mount();
    openAssign();
    await act(async () => {
      mock.assignDialog.current!.onSubmit("cu-eva");
    });
    expect(mock.assignDialog.current).toMatchObject({
      pending: false,
      error: "Check who owns the Mate, then hand it over again.",
    });
    expect(mock.invalidated).toEqual([{ topic: "access", change: "grants-written" }]);
  });

  it("closes once the platform takes it", async () => {
    let answer: (value: unknown) => void = () => {};
    mock.assignMateOwner.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    mount();
    openAssign();
    await act(async () => {
      mock.assignDialog.current!.onSubmit("cu-eva");
    });
    expect(mock.assignDialog.current).toMatchObject({ pending: true, error: null });
    mock.assignDialog.current = null;
    await act(async () => {
      answer(answered({ stage: "done", operationId: FEN.project.id, outcome: "succeeded" }));
    });
    act(() => {
      mounted[0]!.update(<Probe />);
    });
    expect(mock.assignDialog.current).toBeNull();
  });
});

// A Mate its press left open — marker present, not closed off, no press holding it — is finished by
// whoever may: an owner or an admin, or, for its close-off, the member who added it. Read off the
// store's markers, so a reload keeps it (pass 28 review).
describe("useMateActions — Finish setup on a Mate its press left open", () => {
  const LONG_AGO = "2026-09-01T10:00:00Z";
  const left = (made: { readonly by?: string; readonly container?: boolean } = {}) => {
    const base = mate("Ivo", "", made.by);
    const { service, ...rest } = base;
    return {
      ...rest,
      group: "ready",
      project: { ...base.project, created: LONG_AGO },
      ...(made.container === false ? {} : { service }),
    } as ZeropsCandidatePresentation;
  };
  const offered = (candidate: ZeropsCandidatePresentation) =>
    verbs(candidate).some((verb) => verb.id === "finish-setup");
  const listing = (candidate: ZeropsCandidatePresentation) => {
    mock.listing.current = {
      state: "known",
      value: [candidate],
      asOf: { ordinal: 1, atMs: 1_000 },
      coverage: "complete",
      freshness: { kind: "live" },
    };
  };

  it.each([
    { who: "an owner", role: "OWNER", by: "user-eva", container: true, want: true },
    {
      who: "the member who added it",
      role: "BASIC_USER",
      by: "user-ada",
      container: true,
      want: true,
    },
    { who: "another member", role: "BASIC_USER", by: "user-eva", container: true, want: false },
    // Nothing for a close-off to finish: an owner or an admin makes its container.
    {
      who: "the member who added it, with no container",
      role: "BASIC_USER",
      by: "user-ada",
      container: false,
      want: false,
    },
  ])("$who: offered $want", ({ role, by, container, want }) => {
    mock.roleCode = role;
    const candidate = left({ by, container });
    if (candidate.service !== undefined) mock.markers.set(candidate.service.id, true);
    listing(candidate);
    mount();
    expect(offered(candidate)).toBe(want);
  });

  it("offers nothing where the marker reads absent: an older Mate, made before the press", () => {
    mock.roleCode = "BASIC_USER";
    const candidate = left({ by: "user-ada" });
    listing(candidate);
    mount();
    expect(offered(candidate)).toBe(false);
  });

  // Step A, A11: the organization's token list is not read on a load; a key still ADMIN is
  // lowered when a person finishes setting the Mate up, never offered from that list.
  it("offers no harden from a token read on load", () => {
    mock.roleCode = "BASIC_USER";
    const candidate = left({ by: "user-ada" });
    listing(candidate);
    mount();
    expect(offered(candidate)).toBe(false);
  });
});

// ADR 0003's fallout: HQ says the key of a Mate it holds still reads other projects. No page's read
// repairs it (2026-10-03): its menu offers Finish setup, saying why, to whoever HQ offers editing
// the Mate's record — the one HQ tells the key's id to — and Finish setup's harden takes those
// grants off.
describe("useMateActions — Finish setup on a Mate whose key reads other projects", () => {
  const wider = (() => {
    const base = mate("Ivo");
    return {
      ...base,
      project: {
        ...base.project,
        created: "2026-09-01T10:00:00Z",
        hq: { ...base.project.hq!, mate: { face: "", keyWider: true } },
      },
    } as ZeropsCandidatePresentation;
  })();
  const finishVerb = () =>
    verbs(wider).find((verb): verb is ZeropsMenuAction => verb.id === "finish-setup");
  const listing = () => {
    mock.listing.current = {
      state: "known",
      value: [wider],
      asOf: { ordinal: 1, atMs: 1_000 },
      coverage: "complete",
      freshness: { kind: "live" },
    };
  };

  it.each([
    { who: "one HQ offers its record", edit: { kind: "allowed" } as const, want: KEY_WIDER_WHY },
    {
      who: "one HQ refuses its record",
      edit: { kind: "refused", reason: "not_project_admin" } as const,
      want: undefined,
    },
  ])("$who: offered, saying why: $want", ({ edit, want }) => {
    mock.roleCode = "BASIC_USER";
    mock.mateOffers = () => ({ ...OWNER_OFFERS, edit });
    listing();
    mount();
    expect(finishVerb()?.why).toBe(want);
  });

  it("hardens it, by the key HQ names as it runs", async () => {
    mock.roleCode = "BASIC_USER";
    mock.finishMateSetup.mockResolvedValue({ ok: true });
    listing();
    mount();
    await act(async () => {
      finishVerb()!.onSelect();
    });
    expect(mock.finishMateSetup.mock.calls[0]![0]).toMatchObject({
      projectId: wider.project.id,
      harden: true,
      keyWider: true,
    });
  });
});

// A Mate HQ holds no record of — claimed from the pool, or its record lost — is finished by whoever
// HQ's rule lets create the record (`create_mate_record`): its record, then its birth, closed off.
// Only once HQ's structure is known does a Mate it places nowhere have no record.
describe("useMateActions — Finish setup on a Mate HQ holds no record of", () => {
  const unrecorded = (() => {
    const base = mate("Ivo");
    const { hq: _placed, ...project } = base.project;
    return {
      ...base,
      group: "ready",
      project: { ...project, created: "2026-09-01T10:00:00Z" },
    } as ZeropsCandidatePresentation;
  })();
  /** The registry with the session's organization, and HQ's structure of it where `known`. */
  const hqRegistry = (known: boolean) => {
    const registry = AtomRegistry.make();
    registry.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: { organizationId: "org-acme" },
    } as never);
    if (known) {
      mountHqNavigation(registry, "org-acme", { structure: { ungrouped: [], apps: [] } });
    }
    return registry;
  };
  // Its membership as HQ places it: nowhere, so in no application.
  const finishVerb = () =>
    actions()
      .actionsFor(unrecorded, { mate: true } as never)
      .filter((entry): entry is ZeropsMenuAction => !("separator" in entry))
      .find((verb) => verb.id === "finish-setup");
  const listing = () => {
    mock.listing.current = {
      state: "known",
      value: [unrecorded],
      asOf: { ordinal: 1, atMs: 1_000 },
      coverage: "complete",
      freshness: { kind: "live" },
    };
  };

  it.each([
    { who: "an owner, HQ's structure known", role: "OWNER", known: true, want: true },
    {
      who: "a member HQ's rule does not let create it",
      role: "BASIC_USER",
      known: true,
      want: false,
    },
    { who: "an owner, HQ's structure not known yet", role: "OWNER", known: false, want: false },
  ])("$who: offered $want", ({ role, known, want }) => {
    mock.roleCode = role;
    // HQ offers writing its record to whom its rule lets.
    mock.mateOffers = () => ({
      held: false,
      createRecord:
        role === "OWNER" ? { kind: "allowed" } : { kind: "refused", reason: "not_project_admin" },
    });
    listing();
    mount(hqRegistry(known));
    expect(finishVerb() !== undefined).toBe(want);
  });

  it("writes its record, then its birth closed off, with nobody's stand-up asked", async () => {
    mock.finishMateSetup.mockResolvedValue({ ok: true });
    mock.mateOffers = () => ({ held: false, createRecord: { kind: "allowed" } });
    listing();
    mount(hqRegistry(true));
    await act(async () => {
      finishVerb()!.onSelect();
    });
    expect(mock.finishMateSetup).toHaveBeenCalledTimes(1);
    expect(mock.finishMateSetup.mock.calls[0]![0]).toMatchObject({
      projectId: unrecorded.project.id,
      registration: {
        hq: { kind: "official", projectId: "p-hq" },
        kind: "mate-record",
        record: { face: expect.any(String) },
        standUp: false,
      },
      hq: { kind: "official", projectId: "p-hq" },
      // Adopted: its key lowered from ADMIN, as the harden finds it.
      harden: true,
    });
  });
});

// F6b (e2e, 2026-10-03): Dan's press, for the application mate-rig-e2e-d, stopped before his
// container and before HQ's record — his project tagged `mate`, in no application, with no container.
// The press this tab still holds knows his application, his name and his face; Finish setup wrote a
// new Mate, "Asha", in no application, instead of finishing Dan into his.
describe("useMateActions — Finish setup on a Mate whose press here stopped before its container", () => {
  const FACE = { tint: "coral", shape: "gem" } as const;
  const startedAt = Date.now() - 2 * 60 * 60 * 1000;
  const DAN = {
    key: "dan-project",
    group: "unavailable",
    // Its project's services read, and no zcp among them: its press stopped before its container.
    missingContainer: true,
    presence: "known",
    environmentId: EnvironmentId.make("env-dan"),
    project: {
      id: "dan-project",
      name: "mate-rig-e2e-d - Dan",
      status: "ACTIVE",
      clientId: "org-acme",
      tagList: ["mate"],
      created: new Date(startedAt).toISOString(),
    },
  } as ZeropsCandidatePresentation;
  /** HQ's structure of the organization, known: Dan's application, holding nothing yet. */
  const known = () => {
    const registry = AtomRegistry.make();
    registry.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: { organizationId: "org-acme" },
    } as never);
    mountHqNavigation(registry, "org-acme", { structure: { ungrouped: [], apps: [] } });
    return registry;
  };
  // His membership as HQ places him: nowhere.
  const finishVerb = () =>
    actions()
      .actionsFor(DAN, { mate: true } as never)
      .filter((entry): entry is ZeropsMenuAction => !("separator" in entry))
      .find((verb) => verb.id === "finish-setup");

  beforeEach(async () => {
    const press = await vi.importActual<typeof import("./matePress")>("./matePress");
    press.beginPress({
      projectId: "dan-project",
      organizationId: "org-acme",
      startedAt,
      placement: {
        groupId: "app-d",
        groupName: "mate-rig-e2e-d",
        kind: "mate",
        displayName: "mate-rig-e2e-d - Dan",
        face: FACE,
      },
      container: true,
    });
    // HQ holds Dan nowhere, and offers his owner writing his record.
    mock.mateOffers = () => ({ held: false, createRecord: { kind: "allowed" } });
    mock.listing.current = {
      state: "known",
      value: [DAN],
      asOf: { ordinal: 1, atMs: 1_000 },
      coverage: "complete",
      freshness: { kind: "live" },
    };
  });
  afterEach(async () => {
    (await vi.importActual<typeof import("./matePress")>("./matePress")).forgetPress("dan-project");
  });

  it("is offered to an owner", () => {
    mount(known());
    expect(finishVerb()?.label).toBe("Finish setup");
  });

  it("finishes Dan into his application, under his name and face, and writes no new Mate", async () => {
    mock.finishMateSetup.mockResolvedValue({ ok: true });
    mount(known());
    await act(async () => {
      finishVerb()!.onSelect();
    });
    expect(mock.finishMateSetup).toHaveBeenCalledTimes(1);
    const handed = mock.finishMateSetup.mock.calls[0]![0];
    expect(handed).toMatchObject({
      projectId: "dan-project",
      container: { agents: [] },
      registration: {
        kind: "mate",
        groupId: "app-d",
        mate: { face: FACE },
      },
    });
  });
});

// F6b (2026-10-03): its record in its application before its container, so a press whose container
// never came leaves a Mate HQ holds there — finished from HQ's record in any browser, under HQ's
// name, never as a new Mate.
describe("useMateActions — Finish setup on a Mate HQ holds in its application, its container never come", () => {
  const IVO = (() => {
    const { service: _none, ...base } = mate("Ivo", "coral:gem");
    return {
      ...base,
      group: "unavailable",
      // Its project's services read, and no zcp among them.
      missingContainer: true,
      project: { ...base.project, created: "2026-09-01T10:00:00Z" },
    } as ZeropsCandidatePresentation;
  })();
  const known = () => {
    const registry = AtomRegistry.make();
    registry.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: { organizationId: "org-acme" },
    } as never);
    mountHqNavigation(registry, "org-acme", {
      structure: {
        ungrouped: [],
        apps: [
          {
            id: "acme",
            name: "Acme Docs",
            projects: [
              {
                projectId: IVO.project.id,
                kind: "mate",
                mate: { face: "coral:gem" },
              },
            ],
          },
        ],
      } as never,
    });
    return registry;
  };

  // Live, KRLS 2026-10-05: unknown is never missing. A Mate whose project's services are not read
  // yet — or could not be — has no container this browser knows of, and none it knows is missing:
  // no Finish setup, and no container imported for it.
  it("offers no Finish setup while its project's services are not read", () => {
    // Registered in its application, so only its container could make it half made.
    mock.registry = {
      groups: [
        {
          groupId: "acme",
          name: "Acme Docs",
          projects: [{ projectId: IVO.project.id, kind: "mate" }],
        },
      ],
    };
    const { missingContainer: _read, ...unread } = IVO;
    mock.listing.current = {
      state: "known",
      value: [unread as ZeropsCandidatePresentation],
      asOf: { ordinal: 1, atMs: 1_000 },
      coverage: "complete",
      freshness: { kind: "live" },
    };
    mount(known());
    expect(
      verbs(unread as ZeropsCandidatePresentation).some((verb) => verb.id === "finish-setup"),
    ).toBe(false);
  });

  it("registers it there again under HQ's face, writing no new Mate", async () => {
    mock.finishMateSetup.mockResolvedValue({ ok: true });
    mock.listing.current = {
      state: "known",
      value: [IVO],
      asOf: { ordinal: 1, atMs: 1_000 },
      coverage: "complete",
      freshness: { kind: "live" },
    };
    mount(known());
    const finish = verbs(IVO).find((verb) => verb.id === "finish-setup");
    expect(finish?.label).toBe("Finish setup");
    await act(async () => {
      finish!.onSelect();
    });
    expect(mock.finishMateSetup.mock.calls[0]![0]).toMatchObject({
      projectId: IVO.project.id,
      container: { agents: [] },
      registration: {
        kind: "mate",
        groupId: "acme",
        mate: { face: { tint: "coral", shape: "gem" } },
      },
      // A Mate HQ holds is not adopted: its key is not touched.
      harden: false,
    });
  });

  // Its key widened too, for one HQ does not tell that key: Finish setup is offered for its
  // container, and says nothing of a key it will not touch.
  it("says nothing of a widened key it will not narrow", async () => {
    mock.finishMateSetup.mockResolvedValue({ ok: true });
    mock.mateOffers = () => ({ ...OWNER_OFFERS, edit: { kind: "refused", reason: "not_admin" } });
    const wider = {
      ...IVO,
      project: { ...IVO.project, hq: { ...IVO.project.hq!, mate: { face: "", keyWider: true } } },
    } as ZeropsCandidatePresentation;
    mock.listing.current = {
      state: "known",
      value: [wider],
      asOf: { ordinal: 1, atMs: 1_000 },
      coverage: "complete",
      freshness: { kind: "live" },
    };
    mount(known());
    const finish = verbs(wider).find(
      (verb): verb is ZeropsMenuAction => verb.id === "finish-setup",
    );
    expect(finish?.why).toBeUndefined();
    await act(async () => {
      finish!.onSelect();
    });
    expect(mock.finishMateSetup.mock.calls[0]![0]).toMatchObject({
      harden: false,
      keyWider: false,
    });
  });
});

// B5: two browsers. A slow press the other one still holds at HQ is no half-made Mate, however
// old its project; the moment its hold runs out — its tab closed — it is, for Finish setup.
describe("useMateActions — Finish setup on a Mate another browser still presses", () => {
  const SLOW = (() => {
    const { service: _none, ...base } = mate("Una", "coral:gem");
    return {
      ...base,
      group: "unavailable",
      missingContainer: true,
      project: { ...base.project, created: "2026-09-01T10:00:00Z" },
    } as ZeropsCandidatePresentation;
  })();

  it.each([
    { held: "pressing", offered: false },
    { held: "unknown", offered: false },
    { held: "stopped", offered: true },
  ] as const)("its press elsewhere $held: Finish setup offered $offered", ({ held, offered }) => {
    mock.pressElsewhere = (projectId) => (projectId === SLOW.project.id ? held : "stopped");
    mount();
    expect(verbs(SLOW).some((verb) => verb.id === "finish-setup")).toBe(offered);
  });

  // A stage's press cut short before its registration: its record places it in its application
  // as a stage, and a stage is never set up as a Mate.
  it("offers no Mate's Finish setup on a stage its press's record places", () => {
    const STAGE = {
      ...SLOW,
      project: {
        ...SLOW.project,
        hq: {
          appId: "acme",
          appName: "Acme Docs",
          kind: "stage",
          mate: null,
          unregistered: true,
        },
      },
    } as ZeropsCandidatePresentation;
    mount();
    const offered = actions()
      .actionsFor(STAGE, readZeropsMembership(STAGE.project))
      .filter((entry): entry is ZeropsMenuAction => !("separator" in entry));
    expect(offered.some((verb) => verb.id === "finish-setup")).toBe(false);
  });
});

describe("useMateActions — a Mate's own verbs, where its door opens for this person", () => {
  const STOPPED = {
    ...FEN,
    group: "unavailable",
    project: { ...FEN.project, status: "STOPPED" },
  } as ZeropsCandidatePresentation;
  const ids = () => verbs(STOPPED).map((verb) => verb.id);

  it.each([
    { who: "a member", role: "BASIC_USER", user: { id: "user-ada" }, known: true, offered: true },
    {
      who: "a read-only member, whose Mate is listed",
      role: "READ_ONLY",
      user: { id: "user-ada" },
      known: true,
      offered: false,
    },
    // An HQ that has not said takes nothing of Zerops' away: Zerops refuses in its own words.
    {
      who: "a member HQ has said nothing of yet",
      role: "BASIC_USER",
      user: { id: "user-ada" },
      known: false,
      offered: true,
    },
  ])("$who: Start offered $offered", ({ role, user, known, offered }) => {
    mock.roleCode = role;
    mock.user = user;
    // HQ offers following the Mate to whom its door opens; it may not have said yet.
    mock.mateOffers = () =>
      known
        ? {
            ...OWNER_OFFERS,
            observe:
              role === "READ_ONLY"
                ? { kind: "refused", reason: "not_mate_operator" }
                : { kind: "allowed" },
          }
        : undefined;
    mock.listing.current = {
      state: "known",
      value: [STOPPED],
      asOf: { ordinal: 1, atMs: 1_000 },
      coverage: "complete",
      freshness: { kind: "live" },
    };
    mount();
    expect(ids().includes("start")).toBe(offered);
  });
});

describe("useMateActions — HQ's verbs only on a Mate HQ holds", () => {
  it("offers no face, move or leave on a Mate HQ has no record of: its rename is Zerops'", () => {
    const { hq: _none, ...project } = FEN.project as typeof FEN.project & { hq?: unknown };
    const unrecorded = { ...FEN, project } as ZeropsCandidatePresentation;
    mock.listing.current = {
      state: "known",
      value: [unrecorded],
      asOf: { ordinal: 1, atMs: 1_000 },
      coverage: "complete",
      freshness: { kind: "live" },
    };
    mount();
    const ids = verbs(unrecorded).map((verb) => verb.id);
    expect(ids.filter((id) => ["rename-agent", "face", "move", "leave"].includes(id))).toEqual([
      "rename-agent",
    ]);
    expect(actions().renameInPlace(unrecorded)).toBeDefined();
  });
});

// A Mate's name is its project's in Zerops, under its application's name. A rename is the
// project's, written by the account's one writer of the project's record, and offered where the
// platform takes it: never HQ's.
describe("useMateActions — Rename Mate", () => {
  const named = mate("Acme Docs - Fen");

  it("renames the Mate's project in Zerops in full, starting from its own name, and writes nothing to HQ", () => {
    mock.renameProject.mockReturnValue(Promise.resolve({ value: { kind: "written" } }));
    mount();
    const rename = actions().renameInPlace(named);
    expect(rename?.initialValue).toBe("Fen");
    act(() => {
      rename!.commit("Nova");
    });
    expect(mock.renameProject).toHaveBeenCalledWith({
      kind: "rename-project",
      orgId: "org-acme",
      projectId: named.project.id,
      name: "Acme Docs - Nova",
      from: "Acme Docs - Fen",
    });
    expect(mock.updateMate).not.toHaveBeenCalled();
  });

  it("renames nothing where the name is kept", () => {
    mount();
    act(() => {
      actions().renameInPlace(named)!.commit("Fen");
    });
    expect(mock.renameProject).not.toHaveBeenCalled();
  });

  it("starts from the whole name of a Mate not named under its application", () => {
    mount();
    expect(actions().renameInPlace(FEN)?.initialValue).toBe("Fen");
  });

  it("offers it to a member who owns the Mate's project, as the platform takes it", () => {
    mock.roleCode = "NO_ACCESS";
    const owned = {
      ...FEN,
      project: { ...FEN.project, userRoles: [{ clientUserId: "member-ada", roleCode: "OWNER" }] },
    } as ZeropsCandidatePresentation;
    mount();
    expect(verbs(owned).map((verb) => verb.id)).toContain("rename-agent");
    expect(actions().renameInPlace(owned)).toBeDefined();
  });
});

// Every project of an application is named in full in Zerops: a Mate moved into another
// application is renamed there after HQ's move, and the person is told where that did not happen.
describe("useMateActions — Move renames the Mate's project in Zerops", () => {
  const named = mate("Acme Docs - Fen");
  const written = { value: { kind: "written" } };
  const pressMove = async (membership: unknown) => {
    mock.moveProject.mockResolvedValue(undefined);
    mock.createApp.mockResolvedValue({ id: "app-shop" });
    mount();
    await act(async () => {
      verbs(named)
        .find((verb) => verb.id === "move")!
        .onSelect();
    });
    await act(async () => {
      mock.moveDialog.current!.onSubmit(membership);
    });
  };
  const SHOP = { kind: "new", name: "Shop", role: "dev" };

  it("renames it to its own name under the new application, after HQ moved it", async () => {
    mock.renameProject.mockReturnValue(Promise.resolve(written));
    await pressMove(SHOP);
    expect(mock.moveProject).toHaveBeenCalledTimes(1);
    expect(mock.renameProject).toHaveBeenCalledWith({
      kind: "rename-project",
      orgId: "org-acme",
      projectId: named.project.id,
      name: "Shop - Fen",
      from: "Acme Docs - Fen",
    });
  });

  it("renames it to its own name alone where it goes out of every application", async () => {
    mock.renameProject.mockReturnValue(Promise.resolve(written));
    await pressMove({ kind: "none" });
    expect(mock.moveProject).toHaveBeenCalledTimes(1);
    expect(mock.renameProject).toHaveBeenCalledWith({
      kind: "rename-project",
      orgId: "org-acme",
      projectId: named.project.id,
      name: "Fen",
      from: "Acme Docs - Fen",
    });
  });

  it("says the Mate is moved and its name is not, and offers to finish it with the same target", async () => {
    mock.renameProject.mockRejectedValueOnce(new Error("No access."));
    await pressMove(SHOP);
    expect(actions().trouble).toContain("Acme Docs - Fen was not renamed to Shop - Fen in Zerops");
    mock.renameProject.mockReturnValue(Promise.resolve(written));
    const finish = verbs(named).find((verb) => verb.id === "finish-rename");
    expect(finish).toBeDefined();
    await act(async () => {
      finish!.onSelect();
    });
    expect(mock.renameProject).toHaveBeenLastCalledWith({
      kind: "rename-project",
      orgId: "org-acme",
      projectId: named.project.id,
      name: "Shop - Fen",
      from: "Acme Docs - Fen",
    });
    expect(verbs(named).find((verb) => verb.id === "finish-rename")).toBeUndefined();
  });
  it("offers nothing to finish once the project was renamed since", async () => {
    mock.renameProject.mockRejectedValueOnce(new Error("No access."));
    await pressMove(SHOP);
    const since = { ...named, project: { ...named.project, name: "Milo" } };
    expect(verbs(since as ZeropsCandidatePresentation).map((verb) => verb.id)).not.toContain(
      "finish-rename",
    );
  });

  it("drops what was left once the Mate is moved again", async () => {
    mock.renameProject.mockRejectedValueOnce(new Error("No access."));
    await pressMove(SHOP);
    expect(verbs(named).map((verb) => verb.id)).toContain("finish-rename");
    // Back into its own application: nothing to rename, and nothing left to finish either.
    await act(async () => {
      mock.moveDialog.current!.onSubmit({ kind: "new", name: "Acme Docs", role: "dev" });
    });
    expect(verbs(named).map((verb) => verb.id)).not.toContain("finish-rename");
  });
});

describe("useMateActions — Move, for the person who made the Mate", () => {
  it("offers Change project or role to a member with no org access who owns the Mate's project", () => {
    mock.roleCode = "NO_ACCESS";
    // HQ lets its maker keep it a Mate in its application, and nothing more.
    mock.mateOffers = () => ({ ...OWNER_OFFERS, edit: { kind: "allowed" } });
    mock.moveTo = { acme: ["mate", "devstage"] };
    const made = {
      ...FEN,
      project: { ...FEN.project, userRoles: [{ clientUserId: "member-ada", roleCode: "OWNER" }] },
    } as ZeropsCandidatePresentation;
    mock.listing.current = {
      state: "known",
      value: [made],
      asOf: { ordinal: 1, atMs: 1_000 },
      coverage: "complete",
      freshness: { kind: "live" },
    };
    mount();
    expect(verbs(made).map((verb) => verb.id)).toContain("move");
  });

  // e2e-krls F29: a birth cut before its Mate was attached leaves its application empty in HQ.
  it("offers every application HQ offers it, one with no project in it too", async () => {
    mock.moveTo = { acme: KINDS, "app-g": KINDS };
    const registry = AtomRegistry.make();
    registry.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: { organizationId: "org-acme", id: "org-acme" },
    } as never);
    mountHqNavigation(registry, "org-acme", {
      structure: {
        ungrouped: [],
        apps: [
          {
            id: "acme",
            name: "Acme Docs",
            projects: [
              { projectId: FEN.project.id, kind: "mate", mate: { name: "Fen", face: "" } },
            ],
          },
          { id: "app-g", name: "mate-rig-e2e-g", projects: [] },
        ],
      } as never,
    });
    mock.listing.current = {
      state: "known",
      value: [FEN],
      asOf: { ordinal: 1, atMs: 1_000 },
      coverage: "complete",
      freshness: { kind: "live" },
    };
    mount(registry);
    await act(async () => {
      verbs(FEN)
        .find((verb) => verb.id === "move")!
        .onSelect();
    });

    expect(mock.moveDialog.current?.choices.apps.map((app) => app.name)).toContain(
      "mate-rig-e2e-g",
    );
  });

  it("names the Mate as its row in the left menu does", async () => {
    mount();
    await act(async () => {
      verbs(FEN)
        .find((verb) => verb.id === "move")!
        .onSelect();
    });

    expect(mock.moveDialog.current?.name).toBe("Fen");
  });
});

// Whether the viewer added a Mate reads who HQ's record says made it, so a Mate made by New
// project is its maker's to finish as one made by Add a Mate is.
describe("mateAddedBy — whether the viewer added this Mate", () => {
  const placed = (mate: Partial<NonNullable<HqPlacement["mate"]>>): HqPlacement => ({
    appId: "app-1",
    appName: "Acme",
    kind: "mate",
    mate: { face: "", ...mate },
  });
  it.each([
    { case: "HQ names its maker (New project)", hq: placed({ madeBy: "user-ada" }), added: true },
    {
      case: "its stand-up asked by them (a Mate recorded before HQ kept its maker)",
      hq: placed({ madeBy: null, standupRequestedBy: "user-ada" }),
      added: true,
    },
    { case: "somebody else made it", hq: placed({ madeBy: "user-fen" }), added: false },
    { case: "nothing names anybody", hq: placed({}), added: false },
    {
      case: "HQ says it waits on them (they signed it in)",
      hq: placed({}),
      waitsOnViewer: true,
      added: true,
    },
  ])("$case: $added", ({ hq, added, ...rest }) => {
    expect(mateAddedBy({ hq }, "user-ada", "waitsOnViewer" in rest && rest.waitsOnViewer)).toBe(
      added,
    );
  });
});

// Audit K3: deleting a Mate deleted its project and left its key on the account — 59 such orphans
// on KRLS, and a member holding tokens cannot be taken off the org. The key goes with it now, by the
// id the Mate named to HQ; none is matched by name where it named none.
describe("useMateActions — Delete Mate takes its key with it", () => {
  const deleteVerb = () => verbs(FEN).find((verb) => verb.id === "delete");

  it.each([
    { case: "by the id the Mate named", key: "tok-fen", retired: ["tok-fen"] },
    { case: "none where the Mate named none", key: null, retired: [] },
  ])("retires its key $case", async ({ key, retired }) => {
    mock.mateKey = key;
    mount();
    act(() => {
      deleteVerb()!.onSelect();
    });
    await act(async () => {
      mock.deleteDialog.current!.onConfirm();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mock.deletedTokens).toEqual(retired);
  });
});

describe("useMateActions — Restart", () => {
  it.each([
    {
      label: "another chat on this Mate",
      titles: ["Fix the build"],
      expected: "Fen is working on Fix the build; restarting interrupts that turn.",
    },
    {
      label: "several running chats",
      titles: ["Fix the build", "Ship the app"],
      expected:
        "Fen is working on Fix the build and Ship the app; restarting interrupts those turns.",
    },
    { label: "idle Mate", titles: [], expected: "Restart Fen?" },
  ])("confirms before restarting: $label", async ({ titles, expected }) => {
    mock.threads = [
      ...titles.map((title) => ({
        environmentId: FEN.environmentId!,
        title,
        session: { status: "running", activeTurnId: "turn" },
        latestTurn: { state: "running" },
      })),
      {
        environmentId: QUINN.environmentId!,
        title: "Other Mate's work",
        session: { status: "running", activeTurnId: "turn" },
        latestTurn: { state: "running" },
      },
      {
        environmentId: FEN.environmentId!,
        title: "Finished chat",
        session: { status: "ready", activeTurnId: null },
        latestTurn: { state: "completed" },
      },
    ];
    mount();
    act(() => {
      verbs(FEN)
        .find((verb) => verb.id === "restart")!
        .onSelect();
    });
    expect(mock.restartContainer).not.toHaveBeenCalled();
    expect(mock.restartDialog.current?.body).toBe(expected);
    await act(async () => {
      mock.restartDialog.current!.onConfirm();
    });
    expect(mock.restartContainer).toHaveBeenCalledTimes(1);
  });

  it("lets the person cancel without restarting", () => {
    mount();
    act(() => {
      verbs(FEN)
        .find((verb) => verb.id === "restart")!
        .onSelect();
    });
    expect(mock.restartDialog.current).not.toBeNull();
    act(() => {
      mock.restartDialog.current!.onCancel();
    });
    expect(mock.restartContainer).not.toHaveBeenCalled();
  });
});

it("uses only live HQ readings for an unopened Mate's confirmation", () => {
  for (const { current, online, expected } of [
    {
      label: "live",
      current: true,
      online: true,
      expected: "Fen is working on Fix the build; restarting interrupts that turn.",
    },
    { label: "stale", current: false, online: true, expected: "Restart Fen?" },
    { label: "offline", current: true, online: false, expected: "Restart Fen?" },
  ]) {
    const registry = AtomRegistry.make();
    registry.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: { organizationId: "org-acme" },
    } as never);
    mountHqNavigation(registry, "org-acme", {
      mates: Object.fromEntries([
        [
          FEN.project.id,
          {
            presence: {
              online,
              since: "2026-10-03T22:00:00Z",
              overview: online ? "live" : "stored",
            },
            threads: {
              omitted: 0,
              list: [
                {
                  id: ThreadId.make("thread-running"),
                  title: "Fix the build",
                  kind: "working",
                  turnId: TurnId.make("turn"),
                  turnState: "running",
                  completedAt: null,
                },
              ],
            },
          } satisfies MateLiveView,
        ],
      ]),
      live: current,
    });
    mount(registry);
    act(() => {
      verbs(FEN)
        .find((verb) => verb.id === "restart")!
        .onSelect();
    });
    expect(mock.restartDialog.current?.body).toBe(expected);
  }
});

describe("useMateActions — deletion failures finish visibly", () => {
  const confirm = async () => {
    await act(async () => {
      mock.deleteDialog.current!.onConfirm();
    });
  };
  const openDelete = () => {
    mount();
    act(() => {
      verbs(FEN)
        .find((verb) => verb.id === "delete")!
        .onSelect();
    });
  };

  it("removes connection demand before the delete runs and keeps it off through cleanup", async () => {
    let finish!: () => void;
    mock.deleteProject.mockImplementation(() => {
      expect(mock.setDeleting).toHaveBeenCalledExactlyOnceWith(FEN.project.id, true);
      return new Promise<{ value: undefined }>((resolve) => {
        finish = () => resolve({ value: undefined });
      });
    });
    mock.completeProjectDeletion.mockRejectedValueOnce(new Error("HQ deletion refused"));
    openDelete();
    await confirm();
    expect(mock.setDeleting).toHaveBeenCalledExactlyOnceWith(FEN.project.id, true);
    await act(async () => finish());
    expect(mock.deleteDialog.current?.error).toContain("HQ deletion refused");
    expect(mock.setDeleting.mock.calls).toEqual([[FEN.project.id, true]]);
    await confirm();
    expect(mock.deleteProject).toHaveBeenCalledTimes(1);
    expect(mock.setDeleting.mock.calls).toEqual([[FEN.project.id, true]]);
  });

  it("restores connection demand after a refused delete, before a manual new attempt", async () => {
    mock.deleteProject.mockRejectedValueOnce(new Error("Delete refused"));
    openDelete();
    await confirm();
    expect(mock.deleteDialog.current?.error).toContain("Delete refused");
    expect(mock.setDeleting.mock.calls).toEqual([
      [FEN.project.id, true],
      [FEN.project.id, false],
    ]);
    await confirm();
    expect(mock.setDeleting.mock.calls).toEqual([
      [FEN.project.id, true],
      [FEN.project.id, false],
      [FEN.project.id, true],
    ]);
  });

  it("tells HQ once after the delete process finishes, keeping completion failure visible for Again", async () => {
    let finish!: () => void;
    mock.deleteProject.mockReturnValue(
      new Promise<{ value: undefined }>((resolve) => {
        finish = () => resolve({ value: undefined });
      }),
    );
    openDelete();
    await confirm();
    expect(mock.prepareProjectDeletion).toHaveBeenCalledWith(FEN.project.id);
    expect(mock.completeProjectDeletion).not.toHaveBeenCalled();
    mock.completeProjectDeletion.mockRejectedValueOnce(new Error("HQ deletion refused"));
    await act(async () => {
      finish();
    });
    expect(mock.completeProjectDeletion).toHaveBeenCalledExactlyOnceWith(
      FEN.project.id,
      "completion-fen",
    );
    expect(mock.deleteDialog.current?.error).toContain("HQ deletion refused");
    expect(mock.deleteDialog.current?.cleanup).toBe(true);
    await confirm();
    expect(mock.deleteProject).toHaveBeenCalledTimes(1);
    expect(mock.completeProjectDeletion).toHaveBeenCalledTimes(2);
    await expect(mock.completeProjectDeletion.mock.results[1]!.value).resolves.toBeUndefined();
  });

  it("a failed key lookup refuses deletion and can be tried manually", async () => {
    mock.mateKeyFailure = true;
    openDelete();
    await confirm();
    expect(mock.deleteProject).not.toHaveBeenCalled();
    expect(mock.deleteDialog.current?.error).toContain("HQ is unavailable");
    mock.mateKeyFailure = false;
    await confirm();
    expect(mock.deleteProject).toHaveBeenCalledTimes(1);
  });

  it("retains the key after project deletion and retries only its retirement", async () => {
    mock.mateKey = "tok-fen";
    mock.deleteTokenFailure = true;
    openDelete();
    await confirm();
    expect(mock.deleteDialog.current?.cleanup).toBe(true);
    expect(mock.deleteDialog.current?.error).toContain("Key retirement refused");
    expect(mock.deleteProject).toHaveBeenCalledTimes(1);
    expect(mock.deletedTokens).toEqual(["tok-fen"]);
    mock.deleteTokenFailure = false;
    await confirm();
    expect(mock.keyReads).toBe(1);
    expect(mock.deleteProject).toHaveBeenCalledTimes(1);
    expect(mock.deletedTokens).toEqual(["tok-fen", "tok-fen"]);
  });
});
