/**
 * *Change face…* as `useMateActions` offers it, wherever a Mate is listed: beside Rename, where
 * the viewer may change the Mate; its dialog opening on the face the Mate wears; a save that is
 * one write to the organization's HQ, closing once HQ takes it; and a refusal said in the dialog,
 * nothing else changed. *Rename Mate* renames the Mate's project in Zerops, whose name is the
 * Mate's (D3).
 */
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { ZeropsApiClient, type ZeropsMateFace } from "@t3tools/client-runtime/zerops";
import {
  makeAccountStore,
  creationPressStoreAtom,
  makeOperations,
  makeHqExecutor,
  makeZeropsExecutor,
  accountReadsAtom,
  historyScope,
  projectsScope,
  sharedBirthsAtom,
  operationProgress,
  runToEnd,
  type AccountStore,
  type Operations,
  type RunToEnd,
  type Projection,
  shownMateVisibilitiesAtom,
} from "@t3tools/client-runtime/data";
import { liveProjects, membershipInputs } from "@t3tools/client-runtime/data/fixtures";
import { Atom } from "effect/reactivity";
import { HqError } from "@t3tools/client-runtime/zerops/hq";
import type { MateLiveView } from "@t3tools/shared/hqMates";
import type { HqMateOfferStates, HqPlacement } from "@t3tools/client-runtime/zerops/hq";
import { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { act, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Menu } from "../components/ui/menu";
import { MateMenuItems } from "../components/zerops/SidebarMateMenu";
import { SharedBirthStage } from "../components/zerops/ZeropsMateComingPage";
import { SidebarZeropsTree } from "../components/zerops/SidebarZeropsTree";
import { sidebarMateVerbs } from "./useSidebarMateMenus";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ZeropsMenuAction } from "../components/zerops/ZeropsProjectMenu";
import { zeropsSessionAtom } from "../state/zerops";
import {
  captureAccountLifetime,
  currentAccountId,
  closeAccountLifetime,
  openAccountLifetime,
} from "./accountLifetime";
import { useMateActions, type MateActions } from "./useMateActions";
import { menuRowsAtom } from "./menuRows";
import type { ZeropsCandidatePresentation } from "./useZeropsCandidates";
import { mountHqNavigation } from "~/zerops/__fixtures__/hqNavigation";
import { useDeleteApplicationDialog } from "~/zerops/deleteApplicationDialog";
import { appAtomRegistry } from "~/rpc/atomRegistry";

interface AssignDialogProps {
  readonly candidates: ReadonlyArray<{ readonly userId: string; readonly name: string }>;
  readonly readingOrganization?: string | undefined;
  readonly readFailed?:
    | { readonly organization: string; readonly onReadAgain: () => void }
    | undefined;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onSubmit: (ownerUserId: string) => void;
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
  edit: { kind: "allowed" },
  detach: { kind: "allowed" },
};

const mock = vi.hoisted(() => ({
  /** Where HQ answers a Mate may go, as its move opens (`move-offers`). */
  moveTo: {} as Readonly<Record<string, ReadonlyArray<string>>>,
  moveAnswer: null as (() => Promise<Readonly<Record<string, ReadonlyArray<string>>>>) | null,
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
  faceStore: null as AccountStore | null,
  faceRegistry: null as AtomRegistry.AtomRegistry | null,
  faceOperations: null as Operations | null,
  faceRun: null as RunToEnd | null,
  deleteRun: null as RunToEnd | null,
  liveBirths: false,
  /** HQ's move of a project, and its creation of an application a Mate is moved into. */
  moveProject: vi.fn(),
  moveRemainders: new Map<
    string,
    { requestId: string; projectId: string; from: string; to: string }
  >(),
  moveIntents: [] as unknown[],
  runReceipts: new Map<string, unknown>(),
  createApp: vi.fn(),
  restartContainer: vi.fn(),
  births: [] as Array<import("@t3tools/client-runtime/data").SharedBirth>,
  proceedBirth: vi.fn(),
  deleteBirthOnly: vi.fn(),
  coming: undefined as import("@t3tools/client-runtime/data").MateComing | undefined,
  deployDialog: null as { candidate: ZeropsCandidatePresentation; onClose: () => void } | null,
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
  roleCode: "OWNER",
  organizationId: "org-acme",
  /** Who the session says is signed in; null where it names nobody. */
  user: { id: "user-ada" } as { readonly id: string } | null,
  listing: { current: undefined as unknown },
  /** The press's marker on each container, by service id, as the store states it. */
  dialog: { current: null as FaceDialogProps | null },
  /** The account's hand-over operation, answered with where it stands: a promise the test answers. */
  handOverMate: vi.fn(),
  assignDialog: { current: null as AssignDialogProps | null },
  /** What the hook asked the account's bus to read again. */
  invalidated: [] as Array<unknown>,
  /** The tokens the account deleted, by id. */
  deletedTokens: [] as Array<string>,
  retirementCompleted: vi.fn(),
  deleteTokenFailure: false,
  mateKeyFailure: false,
  deleteProject: vi.fn(),
  setDeleting: vi.fn(),
  prepareProjectDeletion: vi.fn(),
  completeProjectDeletion: vi.fn(),
  keyReads: 0,
  /** The id of the key a Mate named to HQ; none where it named none. */
  mateKey: null as string | null,
  keyAnswer: null as (() => Promise<string | null>) | null,
  /** The delete dialog as the hook mounts it. */
  deleteDialog: {
    current: null as {
      readonly onOpenChange: (open: boolean) => void;
      readonly onConfirm: (alsoApplication?: boolean) => void;
      readonly error: string | null;
      readonly name: string;
      readonly words: { readonly label: string; readonly submit: string };
      readonly cleanup?: boolean;
      readonly application?: { readonly name: string };
    } | null,
  },
  /** The kinds of the account's cells the hook asked for. */
  asked: [] as Array<string>,
  /** The organization's token list, as the platform would answer it were it read. */
  tokens: [] as Array<unknown>,
  /** The organization's members as the person's own Zerops read holds them. */
  members: { status: "loading", members: [] } as {
    readonly status: string;
    readonly members: ReadonlyArray<unknown>;
  },
  /** The details the hook held, by family and owner, in order. */
  demanded: [] as Array<string>,
  /** The details the hook asked to read again. */
  retried: [] as Array<unknown>,
  /** The Move dialog as the hook mounts it: where it offers the Mate to go. */
  moveDialog: {
    current: null as {
      readonly name: string;
      readonly choices: {
        readonly apps: ReadonlyArray<{ readonly id: string; readonly name: string }>;
      };
      readonly onSubmit: (membership: unknown) => void;
      readonly reading?: boolean;
      readonly readError?: string;
      readonly onReadAgain?: () => void;
      readonly pending?: boolean;
      readonly error?: string | null;
    } | null,
  },
}));

vi.mock("../state/entities", async (original) => ({
  ...(await original<typeof import("../state/entities")>()),
  useThreadShells: () => mock.threads,
}));
vi.mock("./useHqOffers", async (original) => ({
  ...(await original<typeof import("./useHqOffers")>()),
  useMateOffers: () => mock.mateOffers,
  // HQ offers writing the structure to the org's owners and admins (`create_app`).
  useOrgOffers: () => () =>
    mock.roleCode === "OWNER" || mock.roleCode === "ADMIN"
      ? { kind: "allowed" }
      : { kind: "refused", reason: "not_structure_writer" },
}));
vi.mock("./ZeropsAccountData", async (original) => ({
  ...(await original<typeof import("./ZeropsAccountData")>()),
  useProjection: (
    projection: Projection<unknown, unknown>,
    key: unknown,
    fallback: Atom.Atom<unknown>,
  ) => {
    const value = useAtomValue(
      (mock.liveBirths || projection.name === "faceAction") &&
        key !== null &&
        mock.faceStore !== null
        ? mock.faceStore.data.project(projection, key)
        : fallback,
    );
    if (mock.liveBirths) return value;
    if (projection.name === "faceAction") return value;
    if (projection.name === "organizationMembers") return key === null ? value : mock.members;
    return {
      renames: currentAccountId() === mock.user?.id ? mock.moveRemainders : new Map(),
      deletions: [],
    };
  },
  useAccountOrgId: () => (mock.liveBirths ? mock.organizationId : null),
  useDetailDemand: (family: string, _listing: unknown, ownerId: string | null) => {
    if (ownerId !== null) mock.demanded.push(`${family}:${ownerId}`);
  },
  useAccountDataOptional: () => ({
    moveOffers: () =>
      (mock.moveAnswer?.() ?? Promise.resolve(mock.moveTo)).then((moveTo) => ({
        moveTo,
        refused: {},
      })),
    retryDetail: (demand: unknown) => {
      mock.retried.push(demand);
    },
  }),
}));
vi.mock("./deleteProject", async (original) => ({
  ...(await original<typeof import("./deleteProject")>()),
  useDeleteProject: () => mock.deleteProject,
}));
vi.mock("./useMenuMateReadings", async (original) => ({
  ...(await original<typeof import("./useMenuMateReadings")>()),
  useMateComingOf: () => () => mock.coming,
}));
vi.mock("./useNowMs", async (original) => {
  const actual = await original<typeof import("./useNowMs")>();
  return {
    ...actual,
    useNowMs: () => (mock.liveBirths ? 0 : actual.useNowMs()),
    useSecondsNowMs: (active: boolean) => (mock.liveBirths ? 0 : actual.useSecondsNowMs(active)),
    useWakeAt: (deadlines: ReadonlyArray<number>) =>
      mock.liveBirths ? 0 : actual.useWakeAt(deadlines),
  };
});
vi.mock("./sharedBirths", async (original) => {
  const actual = await original<typeof import("./sharedBirths")>();
  return {
    ...actual,
    useSharedBirths: () => (mock.liveBirths ? actual.useSharedBirths() : mock.births),
  };
});
vi.mock("./useBirthActions", async (original) => ({
  ...(await original<typeof import("./useBirthActions")>()),
  useBirthActions: () => ({ proceed: mock.proceedBirth, deleteBirthOnly: mock.deleteBirthOnly }),
}));
vi.mock("./MateDeployConfirmation", () => ({
  MateDeployConfirmation: (props: NonNullable<typeof mock.deployDialog>) => {
    mock.deployDialog = props;
    return null;
  },
}));
vi.mock("./mateRestart", async (original) => ({
  ...(await original<typeof import("./mateRestart")>()),
  useRestartMate: () => mock.restartContainer,
}));
vi.mock("./zeropsContainers", async (original) => ({
  ...(await original<typeof import("./zeropsContainers")>()),
  readContainerInitAt: async () => null,
  intendContainer: () => {},
}));
vi.mock("../components/zerops/ZeropsRestartMateDialog", () => ({
  ZeropsRestartMateDialog: (props: NonNullable<typeof mock.restartDialog.current>) => {
    mock.restartDialog.current = props;
    return null;
  },
}));

vi.mock("./accountEnvironments", async (original) => ({
  ...(await original<typeof import("./accountEnvironments")>()),
  currentAccountEnvironments: () => ({ setDeleting: mock.setDeleting }),
}));

vi.mock("./accountInvalidations", async (original) => ({
  ...(await original<typeof import("./accountInvalidations")>()),
  invalidateZerops: (invalidation: unknown) => {
    mock.invalidated.push(invalidation);
  },
}));

vi.mock("./ZeropsSessionProvider", async (original) => ({
  ...(await original<typeof import("./ZeropsSessionProvider")>()),
  useZeropsSession: () => ({
    activeOrganization: {
      id: mock.organizationId,
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
vi.mock("./accountOperations", async (original) => ({
  ...(await original<typeof import("./accountOperations")>()),
  useAccountOperations: () => ({
    submit: async (intent: { readonly kind: string }) => {
      if (intent.kind === "hand-over-mate") return mock.handOverMate(intent);
      try {
        await mock.renameProject(intent);
        if ("projectId" in intent) mock.moveRemainders.delete(String(intent.projectId));
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
    readProgress: (id: string) =>
      mock.faceStore === null
        ? { stage: "uncertain" }
        : mock.faceRegistry!.get(mock.faceStore.data.project(operationProgress, id)),
    // HQ still has no new answer in this surface fixture; owner recovery is tested in hqWrites.
    askAgain: async (id: string) => {
      if (!mock.faceStore?.state().operations.has(id))
        throw new Error("This request belongs to a closed account.");
    },
    untilMoveRemainder: async ({ requestId }: { requestId: string }) => {
      const remainder = [...mock.moveRemainders.values()].find(
        (value) => value.requestId === requestId,
      );
      return remainder === undefined
        ? { kind: "done" }
        : {
            kind: "rename",
            projectId: remainder.projectId,
            from: remainder.from,
            name: remainder.to,
          };
    },
    // A press's writes: none is answered here.
    run: async (
      intent: {
        readonly kind: string;
        readonly orgId?: string;
        readonly face?: string;
        readonly name?: string;
        readonly projectId?: string;
        readonly to?: unknown;
        readonly rename?: { from: string; name: string };
        readonly completion?: string;
        readonly tokenId?: string;
      },
      options: { requestId?: string; orgId?: string; unobserved?: string },
    ) => {
      if (intent.kind === "delete-project" && mock.deleteRun !== null)
        return mock.deleteRun(
          { kind: "delete-project", orgId: intent.orgId!, projectId: intent.projectId! },
          {
            ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
            orgId: options.orgId!,
            unobserved: options.unobserved!,
          },
        );
      if (intent.kind === "update-mate-face")
        return mock.faceRun!(
          {
            kind: "update-mate-face",
            orgId: intent.orgId!,
            projectId: intent.projectId!,
            face: intent.face!,
          },
          {
            ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
            orgId: options.orgId!,
            unobserved: options.unobserved!,
          },
        );
      if (options.requestId !== undefined && mock.runReceipts.has(options.requestId))
        return mock.runReceipts.get(options.requestId);
      if (intent.kind === "move-project") {
        mock.moveIntents.push(intent);
        if (intent.projectId !== undefined) mock.moveRemainders.delete(intent.projectId);
        await mock.moveProject(intent.projectId, intent.to);
        if (
          intent.rename !== undefined &&
          intent.projectId !== undefined &&
          intent.rename.from !== intent.rename.name
        )
          mock.moveRemainders.set(intent.projectId, {
            requestId: options.requestId ?? "move",
            projectId: intent.projectId,
            from: intent.rename.from,
            to: intent.rename.name,
          });
      }
      if (intent.kind === "prepare-mate-deletion") {
        mock.keyReads++;
        const active = captureAccountLifetime();
        const keyTokenId =
          mock.keyAnswer !== null
            ? await mock.keyAnswer()
            : mock.mateKeyFailure
              ? await Promise.reject(new Error("HQ is unavailable"))
              : mock.mateKey;
        if (!active()) return { keyTokenId, completion: "unused" };
        const result = {
          keyTokenId,
          completion: await mock.prepareProjectDeletion(intent.projectId),
        };
        if (options.requestId !== undefined) mock.runReceipts.set(options.requestId, result);
        return result;
      }
      if (intent.kind === "delete-project") await mock.deleteProject(intent.projectId);
      if (intent.kind === "complete-mate-deletion")
        await mock.completeProjectDeletion(intent.projectId, intent.completion);
      if (intent.kind === "complete-key-retirement") mock.retirementCompleted();
      if (intent.kind === "retire-mate-key") {
        mock.deletedTokens.push(intent.tokenId!);
        if (mock.deleteTokenFailure) throw new Error("Key retirement refused");
      }
      if (intent.kind === "create-app") return { appId: (await mock.createApp(intent.name)).id };
      if (options.requestId !== undefined) mock.runReceipts.set(options.requestId, undefined);
      return undefined;
    },
  }),
}));
// The account's runtime: no platform command is answered here.
vi.mock("./zeropsDataContext", async (original) => ({
  ...(await original<typeof import("./zeropsDataContext")>()),
  useZeropsData: () => ({
    organizationRef: (organizationId: string) => ({ organizationId }),
    projectRef: (organizationId: string, projectId: string) => ({ organizationId, projectId }),
    runtime: {},
  }),
}));
vi.mock("./useZeropsCandidates", async (original) => ({
  ...(await original<typeof import("./useZeropsCandidates")>()),
  useZeropsDetailCandidates: () => ({ listing: mock.listing.current, refresh: () => {} }),
  useTakenBotNames: () => ({ names: [], complete: true }),
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useRouter: () => ({ state: { matches: [] }, navigate: () => {} }),
  useNavigate: () => () => undefined,
}));
vi.mock("./useOpenMate", async (original) => ({
  ...(await original<typeof import("./useOpenMate")>()),
  useOpenMate: () => () => {},
}));
vi.mock("../routes/-environmentTargets", async (original) => ({
  ...(await original<typeof import("../routes/-environmentTargets")>()),
  useEnvironmentLinks: () => ({ linkTarget: () => undefined }),
}));
vi.mock("./usePressesElsewhere", async (original) => ({
  ...(await original<typeof import("./usePressesElsewhere")>()),
  usePressesElsewhere: () => (projectId: string) => mock.pressElsewhere(projectId),
}));
vi.mock("./inventoryContext", async (original) => {
  const { useDialogState } = await import("./useDialogState");
  return {
    ...(await original<typeof import("./inventoryContext")>()),
    useProjectDialog: useDialogState,
  };
});
vi.mock("./accountHq", async (original) => ({
  ...(await original<typeof import("./accountHq")>()),
  configuredHq: () => ({ projectId: "p-hq", address: "https://hq.example.test" }),
  accountHqApi: () => ({
    updateMate: mock.updateMate,
    moveProject: mock.moveProject,
    createApp: mock.createApp,
    prepareProjectDeletion: mock.prepareProjectDeletion,
    completeProjectDeletion: mock.completeProjectDeletion,
  }),
}));
vi.mock("./projectOrderPreference", async (original) => ({
  ...(await original<typeof import("./projectOrderPreference")>()),
  useProjectOrderOptions: () => ({ order: "name" }),
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
  const handed = useMateActions({ serverVersions: new Map() });
  seen.push(handed);
  return <>{handed.dialogs}</>;
}

function SharedBirthProbe() {
  const birth = useAtomValue(sharedBirthsAtom("user-ada")).open[0];
  return birth === undefined ? null : <SharedBirthStage birth={birth} />;
}

const renderedText = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(renderedText).join("");

const mounted: ReactTestRenderer[] = [];
beforeEach(() => {
  openAccountLifetime("user-ada");
  appAtomRegistry.set(creationPressStoreAtom, makeAccountStore(appAtomRegistry));
  mock.coming = undefined;
  mock.births = [];
  mock.liveBirths = false;
  mock.deleteRun = null;
  mock.proceedBirth.mockReset().mockResolvedValue("started");
  mock.deleteBirthOnly.mockReset().mockResolvedValue(undefined);
  mock.deployDialog = null;
  mock.restartContainer.mockReset();
  mock.restartContainer.mockResolvedValue(undefined);
  mock.threads = [];
  mock.restartDialog.current = null;
  mock.roleCode = "OWNER";
  mock.organizationId = "org-acme";
  mock.mateOffers = () => OWNER_OFFERS;
  mock.moveTo = { acme: KINDS, new: KINDS };
  mock.moveAnswer = null;
  mock.user = { id: "user-ada" };
  mock.pressElsewhere = () => "stopped";
  mock.registry = { groups: [] };
  mock.dialog.current = null;
  mock.assignDialog.current = null;
  mock.handOverMate.mockReset();
  mock.invalidated = [];
  mock.deletedTokens = [];
  mock.retirementCompleted.mockClear();
  mock.deleteTokenFailure = false;
  mock.mateKeyFailure = false;
  mock.keyReads = 0;
  mock.prepareProjectDeletion.mockReset().mockResolvedValue("completion-fen");
  mock.completeProjectDeletion.mockReset().mockResolvedValue(undefined);
  mock.deleteProject.mockReset().mockResolvedValue({ value: undefined });
  mock.setDeleting.mockReset();
  mock.members = { status: "loading", members: [] };
  mock.demanded = [];
  mock.retried = [];
  mock.mateKey = null;
  mock.keyAnswer = null;
  mock.deleteDialog.current = null;
  mock.moveDialog.current = null;
  mock.updateMate.mockReset();
  mock.moveRemainders.clear();
  mock.moveIntents = [];
  mock.runReceipts.clear();
  mock.moveProject.mockReset();
  mock.createApp.mockReset();
  mock.renameProject.mockReset();
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
  appAtomRegistry.get(creationPressStoreAtom)?.close();
  appAtomRegistry.set(creationPressStoreAtom, null);
  vi.unstubAllGlobals();
});

/** The hook mounted, over `registry` where the case seeds HQ's structure in one. */
function mount(
  registry?: AtomRegistry.AtomRegistry,
  seed?: (store: AccountStore) => void,
  element: ReactElement = <Probe />,
): void {
  registry ??= AtomRegistry.make();
  mock.faceRegistry = registry;
  mock.faceStore = makeAccountStore(registry);
  seed?.(mock.faceStore);
  const unused = () => Promise.reject(new Error("Unexpected HQ write"));
  mock.faceOperations = makeOperations({
    makeId: () => "unnamed-face",
    store: mock.faceStore,
    executors: {
      hq: makeHqExecutor({
        zerops: { mintIntegrationToken: unused, deleteIntegrationToken: unused },
        apiOf: () => ({
          answerKeptGit: unused,
          completeProjectDeletion: unused,
          updateMate: mock.updateMate,
          commentOnChange: unused,
          renameApp: unused,
          deleteApp: unused,
          createApp: unused,
          recordBirth: unused,
          bindBirth: unused,
          registerBirthChief: unused,
          deleteBirth: unused,
          claimBirthAttempt: unused,
          endBirthAttempt: unused,
          attachProject: unused,
          createMate: unused,
          recordClosedOff: unused,
          keepDeployToken: unused,
          release: unused,
          rollback: unused,
          redeploy: unused,
          addService: unused,
          mergeChange: unused,
          closeChange: unused,
          handChange: unused,
          setChief: unused,
          decideProposal: unused,
          handOver: unused,
        }),
      }),
    },
  });
  mock.faceRun = runToEnd({ operations: mock.faceOperations, store: mock.faceStore, registry });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  act(() => {
    mounted.push(
      create(
        registry === undefined ? (
          element
        ) : (
          <RegistryContext.Provider value={registry}>{element}</RegistryContext.Provider>
        ),
      ),
    );
  });
}

const verbs = (candidate: ZeropsCandidatePresentation) =>
  actions()
    .actionsFor(candidate, { mate: true, groupId: "acme", role: "dev" } as never)
    .filter((entry): entry is ZeropsMenuAction => !("separator" in entry));

it("a bound shared birth offers Continue and Delete through the same Mate actions", async () => {
  mock.births = [
    {
      id: "birth",
      appId: "acme",
      appName: "Acme",
      face: "",
      projectId: FEN.project.id,
      importProcessId: null,
      placement: "attached",
      intent: undefined,
      progress: { phase: "project-created", next: { kind: "import" }, reason: null },
      canContinue: true,
      canDelete: true,
    },
  ];
  mount();
  expect(verbs(FEN).map((entry) => entry.id)).toEqual(["continue", "delete"]);
  await act(async () => {
    verbs(FEN)[0]!.onSelect();
  });
  expect(mock.proceedBirth).toHaveBeenCalledWith("birth");
  mock.births = [{ ...mock.births[0]!, canContinue: false }];
  act(() => {
    mounted[0]!.update(
      <RegistryContext.Provider value={mock.faceRegistry!}>
        <Probe />
      </RegistryContext.Provider>,
    );
  });
  expect(verbs(FEN).map((entry) => entry.id)).toEqual(["delete"]);
});

it("Remove cleans up only the failed creation's project", async () => {
  const registry = AtomRegistry.make();
  const noDom = Object.fromEntries(
    ["Node", "Element", "HTMLElement", "ShadowRoot"].map((name) => [name, function none() {}]),
  );
  vi.stubGlobal("window", Object.assign(new EventTarget(), noDom));
  vi.stubGlobal("document", Object.assign(new EventTarget(), { activeElement: null, body: {} }));
  for (const [name, type] of Object.entries(noDom)) vi.stubGlobal(name, type);
  const orgId = "org-acme";
  const projects = new Map([
    ["Ada", { id: "Ada", name: "Shop - Ada", status: "ACTIVE", clientId: orgId }],
    ["created-1", { id: "created-1", name: "Shop - Nova", status: "ACTIVE", clientId: orgId }],
  ]);
  mock.liveBirths = true;
  mock.listing.current = {
    state: "known",
    value: [],
    asOf: { ordinal: 1, atMs: 1_000 },
    coverage: "complete",
    freshness: { kind: "live" },
  };
  registry.set(zeropsSessionAtom, {
    status: "signed-in",
    organizationStatus: "selected",
    activeOrganization: { organizationId: orgId, id: orgId },
  } as never);
  mount(
    registry,
    (store) => {
      registry.set(accountReadsAtom, {
        data: store.data,
        orgId,
        demandDetail: () => () => {},
        renewHeld: () => {},
      });
      liveProjects(orgId, [...projects.values()]).forEach(store.dispatch);
      membershipInputs("OWNER", true, 1, orgId).forEach(store.dispatch);
      const history = historyScope(orgId, "created-1");
      store.dispatch({
        kind: "stream",
        key: history,
        now: 0,
        event: { kind: "demand", demanded: true },
      });
      store.dispatch({ kind: "stream", key: history, now: 0, event: { kind: "attempt" } });
      store.dispatch({ kind: "stream", key: history, now: 0, event: { kind: "handshake" } });
      store.dispatch({ kind: "baseline-begin", scope: history, generation: 1 });
      store.dispatch({
        kind: "baseline-commit",
        scope: history,
        generation: 1,
        via: "zerops-read",
        members: ["created-1-creation"],
        rows: [
          {
            family: "process",
            id: "created-1-creation",
            value: {
              id: "created-1-creation",
              projectId: "created-1",
              serviceStackIds: [],
              status: "FAILED",
              actionName: "project.create",
              created: "2026-11-05T10:00:00Z",
              error: { code: "creationFailed", message: "Project capacity exhausted." },
            },
            revision: { kind: "zerops", version: 1 },
          },
        ],
      });
      store.dispatch({
        kind: "stream",
        key: history,
        now: 0,
        event: { kind: "baseline-committed" },
      });
      mountHqNavigation(
        registry,
        orgId,
        {
          structure: {
            apps: [
              {
                id: "shop",
                name: "Shop",
                projects: [
                  { projectId: "Ada", name: "Shop - Ada", kind: "mate", mate: { face: "" } },
                ],
                births: [
                  {
                    id: "birth",
                    projectId: "created-1",
                    face: "rose:seal",
                    madeBy: "user-ada",
                    intent: {
                      projectName: "Shop - Nova",
                      recipe: { kind: "none" },
                      agents: ["codex"],
                      standUp: false,
                      automated: false,
                      placement: { role: "dev", name: "Nova", chief: false },
                      location: null,
                      userRoles: [],
                    },
                    attempts: {},
                  },
                ],
              },
            ],
            ungrouped: [],
          },
        },
        store,
      );
    },
    <SharedBirthProbe />,
  );
  const store = mock.faceStore!;
  const calls: Array<{ method: string; path: string; status: number }> = [];
  const client = new ZeropsApiClient({
    baseUrl: "https://api.example.test",
    fetch: async (url, init) => {
      const method = init?.method ?? "GET";
      const path = new URL(url).pathname;
      const projectId = path.split("/").at(-1)!;
      if (method !== "DELETE" || !projects.has(projectId))
        throw new Error(`Unexpected ${method} ${path}`);
      projects.delete(projectId);
      const response = Response.json({
        id: "proc-delete",
        actionName: "project.delete",
        status: "PENDING",
      });
      calls.push({ method, path, status: response.status });
      store.dispatch({
        kind: "membership",
        scope: projectsScope(orgId),
        generation: 1,
        delta: { add: [], remove: [projectId] },
      });
      store.dispatch({
        kind: "proven-deletion",
        family: "project",
        id: projectId,
        evidence: "The fake platform completed deletion",
      });
      return response;
    },
  });
  client.restoreSession({
    accessToken: "test",
    refreshToken: "test",
    expiresIn: 432_000,
    userId: "user-ada",
  });
  const executor = makeZeropsExecutor({
    client,
    hqApiOf: () => null,
    viewerOf: () => ({ id: orgId, name: "Acme", membershipId: "member", roleCode: "OWNER" }),
    active: () => true,
    readDetail: async () => false,
    store,
    registry,
    demandDetail: () => () => {},
    revalidate: () => {},
    nowMs: () => 0,
    run: () => Promise.reject(new Error("Unexpected nested operation")),
    makeId: () => "nested",
  });
  const operations = makeOperations({
    store,
    executors: { zerops: executor },
    makeId: () => "delete",
  });
  const run = runToEnd({ operations, store, registry });
  const completed = Promise.withResolvers<void>();
  mock.deleteRun = async (intent, options) => {
    try {
      return await run(intent, options);
    } catch (error) {
      completed.reject(error);
      throw error;
    }
  };
  mock.completeProjectDeletion.mockImplementation(async () => completed.resolve());

  expect(registry.get(sharedBirthsAtom("user-ada")).open).toMatchObject([
    { id: "birth", projectId: "created-1", canDelete: true },
  ]);
  const stage = mounted.at(-1)!;
  expect(renderedText(stage.root)).toContain("Project capacity exhausted.");
  const deleteButton = stage.root.find(
    (node) => node.type === "button" && renderedText(node) === "Delete",
  );
  act(() => {
    deleteButton.props.onClick();
  });
  expect(mock.deleteDialog.current).toMatchObject({
    name: "Nova",
    words: { label: "Type Nova to confirm", submit: "Delete Nova" },
  });
  await act(async () => {
    mock.deleteDialog.current!.onConfirm();
  });

  expect(mock.deleteDialog.current?.error ?? null).toBeNull();
  expect(calls).toEqual([
    { method: "DELETE", path: "/api/rest/public/project/created-1", status: 200 },
  ]);
  await act(async () => {
    await completed.promise;
  });
  expect([...projects.keys()]).toEqual(["Ada"]);
  const menu = registry.get(menuRowsAtom(orgId, [], { waitedOut: false, drawn: true }));
  let sidebar: ReactTestRenderer | undefined;
  act(() => {
    sidebar = create(
      <RegistryContext.Provider value={registry}>
        <SidebarZeropsTree
          candidates={menu.rows}
          complete={menu.settled}
          onSelect={() => {}}
          onBrowseProjects={() => {}}
        />
      </RegistryContext.Provider>,
    );
  });
  mounted.push(sidebar!);
  const names = sidebar!.root.findAll(
    (node) => node.props["data-zerops-surface"] === "sidebar-mate-name",
  );
  expect(names.map(renderedText).join(" ")).toContain("Ada");
});

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
    // HQ answered, so the finished dialog fades without claiming it is still saving.
    expect(mock.dialog.current).toMatchObject({ open: false, pending: false });
    act(() => {
      mock.dialog.current!.onOpenChangeComplete(false);
    });
    mock.dialog.current = null;
    act(() => {
      mounted[0]!.update(<Probe />);
    });
    expect(mock.dialog.current).toBeNull();
  });

  it.each([false, true])(
    "a dismissed face save cannot reopen or replace a later dialog (reopen %s)",
    async (reopen) => {
      let answer!: (value: unknown) => void;
      mock.updateMate.mockReturnValue(
        new Promise((resolve) => {
          answer = resolve;
        }),
      );
      mount();
      openFace(FEN);
      await act(async () => mock.dialog.current!.onSave({ tint: "rose", shape: "seal" }));
      act(() => {
        mock.dialog.current!.onCancel();
        mock.dialog.current!.onOpenChangeComplete(false);
      });
      mock.dialog.current = null;
      if (reopen) openFace(QUINN);
      await act(async () => answer(undefined));
      act(() => mounted[0]!.update(<Probe />));
      if (reopen) expect(mock.dialog.current).toMatchObject({ open: true, name: "Quinn" });
      else expect(mock.dialog.current).toBeNull();
    },
  );

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
    mock.updateMate.mockRejectedValue(
      new HqError({
        kind: "refused",
        code: "forbidden",
        message: "HQ refused the change (forbidden).",
      }),
    );
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
  it("keeps a lost face request visible after closing and reopening without sending it again", async () => {
    mock.updateMate.mockRejectedValue(
      new HqError({ kind: "uncertain", code: "network", message: "HQ's answer was lost." }),
    );
    mount();
    openFace(FEN);
    await act(async () => mock.dialog.current!.onSave({ tint: "rose", shape: "seal" }));
    expect(mock.dialog.current).toMatchObject({ open: true, pending: false });
    expect(mock.dialog.current?.error).toContain("may have saved");
    act(() => {
      mock.dialog.current!.onCancel();
      mock.dialog.current!.onOpenChangeComplete(false);
    });
    openFace(FEN);
    expect(mock.dialog.current?.error).toContain("may have saved");
    await act(async () => mock.dialog.current!.onSave({ tint: "rose", shape: "seal" }));
    expect(mock.updateMate).toHaveBeenCalledOnce();
    expect(mock.dialog.current).toMatchObject({ open: true, pending: false });
  });
  it("a reopened account can save a face without inheriting the previous lifetime's request", async () => {
    const registry = AtomRegistry.make();
    mock.updateMate.mockRejectedValue(
      new HqError({ kind: "uncertain", code: "network", message: "HQ's answer was lost." }),
    );
    mount(registry);
    openFace(FEN);
    await act(async () => mock.dialog.current!.onSave({ tint: "rose", shape: "seal" }));
    act(() => mounted.splice(0).forEach((tree) => tree.unmount()));
    closeAccountLifetime();
    openAccountLifetime("user-ada");
    appAtomRegistry.set(creationPressStoreAtom, makeAccountStore(appAtomRegistry));
    mock.updateMate.mockReset().mockResolvedValue(undefined);
    mock.dialog.current = null;
    mount(registry);
    openFace(FEN);
    await act(async () => mock.dialog.current!.onSave({ tint: "rose", shape: "seal" }));
    expect(mock.updateMate).toHaveBeenCalledOnce();
    expect(mock.dialog.current).toMatchObject({ open: false, pending: false, error: null });
  });
});

/** The hook mounted over HQ's navigation holding `candidates` in Acme Docs. */
function mountHeld(candidates: ReadonlyArray<ZeropsCandidatePresentation> = [FEN]): void {
  const registry = AtomRegistry.make();
  mountHqNavigation(registry, "org-acme", {
    structure: {
      ungrouped: [],
      apps: [
        {
          id: "acme",
          name: "Acme Docs",
          projects: candidates.map((candidate) => ({
            projectId: candidate.project.id,
            kind: "mate",
            mate: { name: candidate.project.name, face: "" },
          })),
        },
      ],
    } as never,
    person: {
      mine: false,
      ownerUserId: null,
      waitsOnViewer: false,
      unseen: null,
    },
  });
  mount(registry);
}

// E2E F7: a refused hand-over closed its dialog and said nothing. The dialog stays until HQ
// answers, says a refusal there, and closes only on HQ's yes.
describe("useMateActions — Hand this Mate over", () => {
  const EVA = { id: "cu-eva", userId: "u-eva", status: "ACTIVE", user: { fullName: "Eva" } };
  const openAssign = () => {
    const entry = verbs(FEN).find((verb) => verb.id === "assign");
    act(() => {
      entry!.onSelect();
    });
  };

  // The person's role in the organization, as Zerops reads it, puts the verb in the Mate's menu.
  it.each([
    ["OWNER", true],
    ["ADMIN", true],
    ["BASIC_USER", false],
    ["READ_ONLY", false],
  ])(
    "offers Hand over this Mate in the Mate's menu to an owner or admin of the organization, and nowhere else: %s",
    (role, offered) => {
      mock.roleCode = role;
      mountHeld();
      expect(verbs(FEN).some((verb) => verb.id === "assign")).toBe(offered);
    },
  );

  // Whom to hand it to is the organization's members, read with the person's own Zerops token.
  it("reads the organization's members once its picker opens, never on load, and lists them by person", () => {
    mock.members = { status: "ready", members: [EVA] };
    mountHeld();
    expect(mock.demanded).toEqual([]);
    openAssign();
    expect(mock.demanded).toContain("organizationMembers:org-acme");
    expect(mock.assignDialog.current?.candidates).toEqual([{ userId: "u-eva", name: "Eva" }]);
    expect(mock.assignDialog.current?.readingOrganization).toBeUndefined();
  });

  it("says it reads the organization until its people are there to pick", () => {
    mountHeld();
    openAssign();
    expect(mock.assignDialog.current?.readingOrganization).toBe("Acme");
  });

  it("says it could not read the organization's people, and asks again on Try again", () => {
    mock.members = { status: "failed", members: [] };
    mountHeld();
    openAssign();
    expect(mock.assignDialog.current?.readFailed?.organization).toBe("Acme");
    act(() => {
      mock.assignDialog.current!.readFailed!.onReadAgain();
    });
    expect(mock.retried).toEqual([{ family: "organizationMembers", ownerId: "org-acme" }]);
  });

  const answered = (progress: unknown, evidence: string | null = null) => ({
    requestId: "r1",
    progress,
    evidence,
  });

  it("says a refused hand-over's reason in the dialog, which stays open", async () => {
    mock.handOverMate.mockResolvedValue(
      answered({ stage: "refused", reason: "HQ refused the hand-over." }),
    );
    mountHeld();
    openAssign();
    expect(mock.assignDialog.current).toMatchObject({ pending: false, error: null });
    await act(async () => {
      mock.assignDialog.current!.onSubmit("u-eva");
    });
    expect(mock.handOverMate).toHaveBeenCalledWith({
      kind: "hand-over-mate",
      orgId: "org-acme",
      projectId: FEN.project.id,
      ownerUserId: "u-eva",
    });
    expect(mock.assignDialog.current).toMatchObject({
      pending: false,
      error: "HQ refused the hand-over.",
    });
    // Nothing changed hands: the grant is not asked again.
    expect(mock.invalidated).toEqual([]);
  });

  // HQ stopped part way: its owner may have moved already, so the grants are read again.
  it("names the phase HQ stopped the hand-over at in the dialog, and reads the grants again", async () => {
    const stopped =
      "The hand-over stopped while installing its new key (unavailable). Hand it over again to finish.";
    mock.handOverMate.mockResolvedValue(
      answered({ stage: "refused", reason: stopped, code: "handover_unfinished" }),
    );
    mountHeld();
    openAssign();
    await act(async () => {
      mock.assignDialog.current!.onSubmit("u-eva");
    });
    expect(mock.assignDialog.current).toMatchObject({ pending: false, error: stopped });
    expect(mock.invalidated).toEqual([{ topic: "access", change: "grants-written" }]);
  });

  // F11: the person who handed a Mate over sees its new owner at once — the grant's round reads
  // the project's grants again — never only after the next round.
  it("asks the access grant to read the projects again once the platform takes it", async () => {
    mock.handOverMate.mockResolvedValue(
      answered({ stage: "done", operationId: FEN.project.id, outcome: "succeeded" }),
    );
    mountHeld();
    openAssign();
    await act(async () => {
      mock.assignDialog.current!.onSubmit("u-eva");
    });
    expect(mock.invalidated).toEqual([{ topic: "access", change: "grants-written" }]);
  });

  it("says a hand-over it could not tell landed, and reads the grants again", async () => {
    mock.handOverMate.mockResolvedValue(
      answered({
        stage: "unresolved",
        operationId: null,
        nextActor: "person",
        nextAction: "Check who owns the Mate, then hand it over again",
      }),
    );
    mountHeld();
    openAssign();
    await act(async () => {
      mock.assignDialog.current!.onSubmit("u-eva");
    });
    expect(mock.assignDialog.current).toMatchObject({
      pending: false,
      error: "Check who owns the Mate, then hand it over again.",
    });
    expect(mock.invalidated).toEqual([{ topic: "access", change: "grants-written" }]);
  });

  it("closes once the platform takes it", async () => {
    let answer: (value: unknown) => void = () => {};
    mock.handOverMate.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    mountHeld();
    openAssign();
    await act(async () => {
      mock.assignDialog.current!.onSubmit("u-eva");
    });
    expect(mock.assignDialog.current).toMatchObject({ pending: true, error: null });
    mock.assignDialog.current = null;
    await act(async () => {
      answer(answered({ stage: "done", operationId: FEN.project.id, outcome: "succeeded" }));
    });
    act(() => {
      mounted.at(-1)!.update(<Probe />);
    });
    expect(mock.assignDialog.current).toBeNull();
  });
});

// A Mate HQ holds no record of — claimed from the pool, or its record lost — is finished by whoever
// HQ's rule lets create the record (`create_mate_record`): its record, its key lowered.
// Only once HQ's structure is known does a Mate it places nowhere have no record.

// F6b (e2e, 2026-10-03): Dan's press, for the application mate-rig-e2e-d, stopped before his
// container and before HQ's record — his project tagged `mate`, in no application, with no container.
// The press this tab still holds knows his application, his name and his face; Finish setup wrote a
// new Mate, "Asha", in no application, instead of finishing Dan into his.

// F6b (2026-10-03): its record in its application before its container, so a press whose container
// never came leaves a Mate HQ holds there — finished from HQ's record in any browser, under HQ's
// name, never as a new Mate.

// B5: two browsers. A slow press the other one still holds at HQ is no half-made Mate, however
// old its project. An expired hold awaits evidence; only a terminal import permits Finish setup.

describe("useMateActions — a Mate's own verbs, where its door opens for this person", () => {
  const STOPPED = {
    ...FEN,
    group: "unavailable",
    project: { ...FEN.project, status: "STOPPED" },
  } as ZeropsCandidatePresentation;
  const ids = () => verbs(STOPPED).map((verb) => verb.id);

  it.each([
    {
      who: "a member",
      role: "BASIC_USER",
      visibility: "open",
      user: { id: "user-ada" },
      known: true,
      offered: true,
    },
    {
      who: "a read-only member, whose Mate is listed",
      role: "READ_ONLY",
      visibility: "listed",
      user: { id: "user-ada" },
      known: true,
      offered: false,
    },
    // An HQ that has not said takes nothing of Zerops' away: Zerops refuses in its own words.
    {
      who: "a member HQ has said nothing of yet",
      role: "BASIC_USER",
      visibility: "open",
      user: { id: "user-ada" },
      known: false,
      offered: true,
    },
  ] as const)("$who: Start offered $offered", ({ role, visibility, user, known, offered }) => {
    mock.roleCode = role;
    mock.user = user;
    // Whether its door opens is the Mate's visibility, as the account reads it from the person's
    // Zerops role (`mateVisibility`); HQ may not have said anything yet.
    mock.mateOffers = () => (known ? OWNER_OFFERS : undefined);
    mock.listing.current = {
      state: "known",
      value: [STOPPED],
      asOf: { ordinal: 1, atMs: 1_000 },
      coverage: "complete",
      freshness: { kind: "live" },
    };
    mount(
      AtomRegistry.make({
        initialValues: [
          [shownMateVisibilitiesAtom(STOPPED.project.id), { [STOPPED.project.id]: visibility }],
        ],
      }),
    );
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

  it("offers no previous account's rename recovery to the next account", async () => {
    mock.renameProject.mockRejectedValueOnce(new Error("No access."));
    await pressMove(SHOP);
    expect(verbs(named).map((verb) => verb.id)).toContain("finish-rename");
    act(() => {
      closeAccountLifetime();
      openAccountLifetime("user-eva");
    });
    expect(verbs(named).map((verb) => verb.id)).not.toContain("finish-rename");
  });

  it("sends one Move and keeps its failure in the review", async () => {
    let refuse!: (cause: Error) => void;
    mock.moveProject.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          refuse = reject;
        }),
    );
    mount();
    await act(async () =>
      verbs(named)
        .find((verb) => verb.id === "move")!
        .onSelect(),
    );
    await act(async () => {
      const submit = mock.moveDialog.current!.onSubmit;
      submit({ kind: "group", appId: "acme", role: "dev" });
      submit({ kind: "group", appId: "acme", role: "dev" });
    });
    expect(mock.moveProject).toHaveBeenCalledTimes(1);
    expect(mock.moveDialog.current?.pending).toBe(true);
    await act(async () =>
      refuse(new Error("The held environment changed. Read its placement again.")),
    );
    expect(mock.moveDialog.current?.pending).toBe(false);
    expect(mock.moveDialog.current?.error).toContain("held environment changed");
    expect(mock.renameProject).not.toHaveBeenCalled();
  });

  it("does not move or rename after a new-project answer reaches a later account", async () => {
    let answer!: (app: { id: string }) => void;
    mock.createApp.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    mount();
    await act(async () =>
      verbs(named)
        .find((verb) => verb.id === "move")!
        .onSelect(),
    );
    await act(async () => mock.moveDialog.current!.onSubmit(SHOP));
    await act(async () => {
      closeAccountLifetime();
      openAccountLifetime("user-eva");
      answer({ id: "app-shop" });
    });
    expect(mock.moveProject).not.toHaveBeenCalled();
    expect(mock.renameProject).not.toHaveBeenCalled();
  });
});

describe("useMateActions — Move, for the person who made the Mate", () => {
  it.each([false, true])(
    "shows a failed destination read, with retry only for a transient failure (%s)",
    async (refused) => {
      mock.moveAnswer = () =>
        Promise.reject({
          outcome: refused ? "definitive-refusal" : "transient",
          message: "HQ cannot list destinations",
        });
      mount();
      await act(async () =>
        verbs(FEN)
          .find((verb) => verb.id === "move")!
          .onSelect(),
      );
      expect(mock.moveDialog.current?.readError).toContain("HQ cannot list destinations");
      expect(mock.moveDialog.current?.choices.apps).toEqual([]);
      expect(typeof mock.moveDialog.current?.onReadAgain).toBe(refused ? "undefined" : "function");
    },
  );

  it.each(["account", "organization"] as const)(
    "does not open old destination choices after changing %s",
    async (changed) => {
      let answer!: (choices: typeof mock.moveTo) => void;
      mock.moveAnswer = () =>
        new Promise((resolve) => {
          answer = resolve;
        });
      mount();
      await act(async () =>
        verbs(FEN)
          .find((verb) => verb.id === "move")!
          .onSelect(),
      );
      await act(async () => {
        if (changed === "account") {
          closeAccountLifetime();
          openAccountLifetime("user-eva");
        } else {
          mock.organizationId = "org-eva";
          mounted.at(-1)!.update(<Probe />);
        }
      });
      await act(async () => {
        answer(mock.moveTo);
      });
      expect(mock.moveDialog.current?.choices.apps).toEqual([]);
    },
  );
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

  // End-to-end regression: a birth cut before its Mate was attached leaves its application empty in HQ.
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

// Audit K3: deleting a Mate deleted its project and left its key on the account — 59 such orphans
// on Example Org, and a member holding tokens cannot be taken off the org. The key goes with it now, by the
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
    });
    expect(mock.retirementCompleted).toHaveBeenCalledOnce();
    expect(mock.deletedTokens).toEqual(retired);
  });
});

// Karel 2026-10-22 (app-lifecycle.md): the last Mate's Delete asks whether its project goes too.
describe("useMateActions — the last Mate's Delete", () => {
  const STAGE = {
    ...mate("Docs stage"),
    project: {
      ...mate("Docs stage").project,
      id: "acme-docs-stage",
      tagList: [],
      hq: { appId: "acme", appName: "Acme Docs", kind: "stage", mate: null },
    },
    service: undefined,
  } as unknown as ZeropsCandidatePresentation;

  it.each([
    {
      case: "the last Mate deleting its project too opens the project's Delete, confirmed, once the Mate is gone",
      listed: [FEN, STAGE],
      also: true,
      asked: "Acme Docs",
      opened: {
        confirmed: true,
        target: {
          appId: "acme",
          name: "Acme Docs",
          stages: [{ projectId: "acme-docs-stage", name: "Docs stage" }],
          productions: [],
        },
      },
    },
    {
      case: "the last Mate keeping its project deletes only the Mate",
      listed: [FEN, STAGE],
      also: false,
      asked: "Acme Docs",
      opened: null,
    },
    {
      case: "a Mate with a colleague in its project is not asked",
      listed: [FEN, QUINN],
      also: true,
      asked: undefined,
      opened: null,
    },
  ])("$case", async ({ listed, also, asked, opened }) => {
    useDeleteApplicationDialog.getState().close();
    mock.listing.current = { ...(mock.listing.current as object), value: listed };
    mount();
    act(() => {
      verbs(FEN)
        .find((verb) => verb.id === "delete")!
        .onSelect();
    });
    expect(mock.deleteDialog.current?.application?.name).toBe(asked);
    await act(async () => {
      mock.deleteDialog.current!.onConfirm(also);
    });
    expect(mock.retirementCompleted).toHaveBeenCalledOnce();
    expect(useDeleteApplicationDialog.getState().request).toEqual(opened);
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
    {
      label: "idle Mate",
      titles: [],
      expected:
        "Fen's container stops and starts again, which takes a minute or two. Its conversations stay.",
    },
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
    {
      label: "stale",
      current: false,
      online: true,
      expected:
        "Fen's container stops and starts again, which takes a minute or two. Its conversations stay.",
    },
    {
      label: "offline",
      current: true,
      online: false,
      expected:
        "Fen's container stops and starts again, which takes a minute or two. Its conversations stay.",
    },
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

  it("sends no deletion preparation or destructive write after the account changes during key lookup", async () => {
    let answer!: (key: string) => void;
    mock.keyAnswer = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    openDelete();
    await confirm();
    await act(async () => {
      closeAccountLifetime();
      openAccountLifetime("user-eva");
      answer("tok-fen");
    });
    expect(mock.prepareProjectDeletion).not.toHaveBeenCalled();
    expect(mock.deleteProject).not.toHaveBeenCalled();
    expect(mock.completeProjectDeletion).not.toHaveBeenCalled();
    expect(mock.deletedTokens).toEqual([]);
  });

  it("a deletion finishing after dismissal cannot resurrect its confirmation", async () => {
    let finish!: () => void;
    mock.deleteProject.mockImplementation(
      () =>
        new Promise<{ value: undefined }>((resolve) => {
          finish = () => resolve({ value: undefined });
        }),
    );
    openDelete();
    await confirm();
    act(() => mock.deleteDialog.current!.onOpenChange(false));
    mock.deleteDialog.current = null;
    await act(async () => finish());
    act(() => mounted[0]!.update(<Probe />));
    expect(mock.deleteDialog.current).toBeNull();
    expect(mock.completeProjectDeletion).toHaveBeenCalledOnce();
  });

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

const menuAccessCases: ReadonlyArray<{
  name: string;
  person: { readonly role: string; readonly grants?: Readonly<Record<string, string>> };
  actions: ReadonlyArray<string>;
  recordWritable: boolean;
}> = [
  {
    name: "org OWNER",
    person: { role: "OWNER" },
    recordWritable: true,
    actions: ["rename", "face", "assign", "move", "delete"],
  },
  {
    name: "org ADMIN",
    person: { role: "ADMIN" },
    recordWritable: true,
    actions: ["rename", "face", "assign", "move", "delete"],
  },
  {
    name: "Developer with their Mate OWNER grant",
    person: { role: "Developer", grants: { Ada: "OWNER" } },
    recordWritable: true,
    actions: ["rename", "face", "move", "delete"],
  },
  {
    name: "Developer with a BASIC_USER grant",
    person: { role: "Developer", grants: { Ada: "BASIC_USER" } },
    recordWritable: false,
    actions: [],
  },
  ...(["OWNER", "ADMIN"] as const).map((grant) => ({
    name: `NO_ACCESS with a ${grant} grant`,
    person: { role: "NO_ACCESS" as const, grants: { Ada: grant } },
    recordWritable: true,
    actions: ["rename", "face", "move", "delete"],
  })),
  {
    name: "NO_ACCESS with a BASIC_USER grant",
    person: { role: "NO_ACCESS", grants: { Ada: "BASIC_USER" } },
    recordWritable: false,
    actions: [],
  },
  { name: "org READ_ONLY", person: { role: "READ_ONLY" }, recordWritable: false, actions: [] },
  {
    name: "NO_ACCESS with a READ_ONLY grant",
    person: { role: "NO_ACCESS", grants: { Ada: "READ_ONLY" } },
    recordWritable: false,
    actions: [],
  },
];

describe("B: Mate menu access", () => {
  it.each(
    menuAccessCases.map((row) => ({
      row,
      title: `${row.name} sees only their permitted Mate management actions`,
    })),
  )("$title", ({ row }) => {
    mock.roleCode = row.person.role;
    const grant = row.person.grants?.Ada;
    // HQ's offered record is an input, separate from Zerops' project grant.
    const allowed = row.recordWritable;
    mock.mateOffers = () => ({
      ...OWNER_OFFERS,
      edit: allowed ? { kind: "allowed" } : { kind: "refused", reason: "not_project_admin" },
      detach: allowed ? { kind: "allowed" } : { kind: "refused", reason: "not_project_admin" },
    });
    const held = mate("Ada");
    const candidate = {
      ...held,
      project: {
        ...held.project,
        userRoles: grant === undefined ? [] : [{ clientUserId: "member-ada", roleCode: grant }],
      },
    };
    mountHeld([candidate]);
    const html = renderToStaticMarkup(
      <Menu>
        <MateMenuItems
          actions={{
            muted: false,
            rename: actions().renameInPlace(candidate),
            changeFace: actions().changeFace(candidate),
            entries: sidebarMateVerbs(verbs(candidate)),
          }}
          apps={[]}
          onOpenMate={() => {}}
          onRename={() => {}}
          shortcuts={false}
          unread={false}
        />
      </Menu>,
    );
    const management = [...html.matchAll(/data-zerops-mate-menu="([^"]+)"/gu)]
      .map((match) => match[1])
      .filter((id) => ["rename", "face", "assign", "move", "delete"].includes(id!));
    expect(management).toEqual(row.actions);
    for (const tag of html.match(
      /<[^>]*data-zerops-mate-menu="(?:rename|face|assign|move|delete)"[^>]*>/gu,
    ) ?? []) {
      expect(tag).not.toContain('aria-disabled="true"');
      expect(tag).not.toContain('data-disabled=""');
    }
  });
});

it("a Mate with no deployment opens its Redeploy recovery from the shared menu", () => {
  mock.coming = { kind: "failed", line: "Nothing is deployed yet.", verb: "redeploy" };
  const candidate: ZeropsCandidatePresentation = {
    ...FEN,
    group: "provisioning",
    service: { ...FEN.service!, status: "READY_TO_DEPLOY", activeAppVersion: null },
  };
  mount();
  expect(verbs(candidate).map((verb) => verb.id)).not.toContain("restart");
  const redeploy = verbs(candidate).find((verb) => verb.id === "redeploy");
  expect(redeploy?.label).toBe("Redeploy");
  act(() => redeploy!.onSelect());
  expect(mock.deployDialog?.candidate).toEqual(candidate);
  expect(mock.restartContainer).not.toHaveBeenCalled();
});
