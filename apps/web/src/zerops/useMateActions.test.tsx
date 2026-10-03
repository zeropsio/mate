/**
 * *Change face…* as `useMateActions` offers it, wherever a Mate is listed: beside Rename, where
 * the viewer may rename the Mate; its dialog opening on the face the Mate wears; a save that is
 * one write to the organization's HQ, closing once HQ takes it; and a refusal said in the dialog,
 * nothing else changed.
 */
import { RegistryContext } from "@effect/atom-react";
import type { ZeropsMateFace } from "@t3tools/client-runtime/zerops";
import type { HqPlacement } from "@t3tools/client-runtime/zerops/hq";
import { EnvironmentId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/unstable/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ZeropsMenuAction } from "../components/zerops/ZeropsProjectMenu";
import { hqStructureAtom, zeropsSessionAtom } from "../state/zerops";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { mateAddedBy, useMateActions, type MateActions } from "./useMateActions";
import type { ZeropsCandidatePresentation } from "./useZeropsCandidates";

interface AssignDialogProps {
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

const mock = vi.hoisted(() => ({
  /** HQ's `PATCH /api/mates/{projectId}`, a write here being the promise the test answers. */
  updateMate: vi.fn(),
  /** *Finish setup*'s steps, as the hook hands them over. */
  finishMateSetup: vi.fn(),
  roleCode: "OWNER",
  /** Who the session says is signed in; null where it names nobody. */
  user: { id: "user-ada" } as { readonly id: string } | null,
  listing: { current: undefined as unknown },
  /** The press's marker on each container, by service id, as the store states it. */
  markers: new Map<string, boolean | "unknown" | "unread">(),
  dialog: { current: null as FaceDialogProps | null },
  /** The platform's per-project role write a hand-over makes, a promise the test answers. */
  setProjectMemberRole: vi.fn(),
  assignDialog: { current: null as AssignDialogProps | null },
  /** What the hook asked the account's bus to read again. */
  invalidated: [] as Array<unknown>,
  /** The tokens the account deleted, by id. */
  deletedTokens: [] as Array<string>,
  /** The id of the key a Mate named to HQ; none where it named none. */
  mateKey: null as string | null,
  /** The delete dialog as the hook mounts it. */
  deleteDialog: { current: null as { readonly onConfirm: () => void } | null },
  /** The kinds of the account's cells the hook asked for. */
  asked: [] as Array<string>,
  /** The organization's token list, as the platform would answer it were it read. */
  tokens: [] as Array<unknown>,
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
      },
    },
    user: mock.user,
  }),
}));
// The account's runtime: no platform command is answered here.
vi.mock("./zeropsDataContext", () => ({
  useZeropsData: () => ({
    organizationRef: (organizationId: string) => ({ organizationId }),
    projectRef: (organizationId: string, projectId: string) => ({ organizationId, projectId }),
    runtime: {
      commands: {
        setProjectMemberRole: mock.setProjectMemberRole,
        deleteProject: async () => ({ value: undefined }),
      },
      reads: { setupMarker: () => null },
      cells: {
        known: (request: { readonly kind: string }) => {
          mock.asked.push(request.kind);
          return request;
        },
      },
    },
  }),
  runZeropsCommand: (command: Promise<unknown>) => command,
  // The organization's token list as the platform answers it, where it is read; nothing else is.
  useKnown: (cell: { readonly kind: string } | null) =>
    cell?.kind === "tokens"
      ? {
          state: "known",
          value: mock.tokens,
          asOf: { ordinal: 1, atMs: 0 },
          coverage: "complete",
          freshness: { kind: "settled" },
        }
      : { state: "unread" },
  // The press's marker on each container, as the case states it: absent unless it says.
  useZeropsAtomSelections: (selections: ReadonlyArray<readonly [string, unknown]>) =>
    new Map(selections.map(([serviceId]) => [serviceId, mock.markers.get(serviceId) ?? false])),
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
vi.mock("./inventoryContext", async () => {
  const { useState } = await import("react");
  return { useProjectDialog: () => useState(null) };
});
vi.mock("./useZeropsMateOwners", () => ({
  useZeropsOrganizationMembers: () => [],
  zeropsMateOwner: () => undefined,
}));
// The organization's official HQ, where a Mate's face is written.
vi.mock("./accountHq", async (original) => ({
  officialHq: (await original<typeof import("./accountHq")>()).officialHq,
  useAccountHq: () => ({
    status: "ready",
    hq: { kind: "official", projectId: "p-hq", address: "https://hq.example.test" },
    admins: [],
    reread: () => {},
  }),
  accountHqApi: () => ({ updateMate: mock.updateMate, mateKey: async () => mock.mateKey }),
}));
vi.mock("./projectOrderPreference", () => ({ useProjectOrderOptions: () => ({ order: "name" }) }));
// The press's steps, not run here: what *Finish setup* hands them is the case.
vi.mock("./matePress", async (original) => ({
  ...(await original<typeof import("./matePress")>()),
  beginPress: () => {},
  finishMateSetup: mock.finishMateSetup,
}));
vi.mock("../components/zerops/ZeropsDeleteMateDialog", () => ({
  ZeropsDeleteMateDialog: (props: { readonly onConfirm: () => void }) => {
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
// The dialog as the hook mounts it: what it is handed, and the two answers it gives.
vi.mock("../components/zerops/ZeropsChangeFaceDialog", () => ({
  ZeropsChangeFaceDialog: (props: FaceDialogProps) => {
    mock.dialog.current = props;
    return null;
  },
}));

/**
 * A Mate of Acme Docs as HQ places it, wearing `face` as HQ records it ("" where none was picked),
 * its stand-up asked by `asker` where one is.
 */
function mate(bot: string, face = "", asker?: string): ZeropsCandidatePresentation {
  const id = `acme-docs-${bot.toLowerCase()}`;
  const hq: HqPlacement = {
    appId: "acme",
    appName: "Acme Docs",
    kind: "mate",
    mate: { name: bot, face, ...(asker === undefined ? {} : { standupRequestedBy: asker }) },
  };
  return {
    key: `${id}:zcp`,
    group: "connected",
    presence: "known",
    environmentId: EnvironmentId.make(`env-${id}`),
    project: {
      id,
      name: `Acme Docs - ${bot}`,
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
    registry: { registry: { groups: [] } },
    serverVersions: new Map(),
  });
  seen.push(handed);
  return <>{handed.dialogs}</>;
}

const mounted: ReactTestRenderer[] = [];
beforeEach(() => {
  openAccountLifetime("user-ada");
  mock.roleCode = "OWNER";
  mock.user = { id: "user-ada" };
  mock.markers.clear();
  mock.dialog.current = null;
  mock.assignDialog.current = null;
  mock.setProjectMemberRole.mockReset();
  mock.invalidated = [];
  mock.asked = [];
  mock.tokens = [];
  mock.deletedTokens = [];
  mock.mateKey = null;
  mock.deleteDialog.current = null;
  mock.updateMate.mockReset();
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
    mount();
    const ids = verbs(FEN).map((verb) => verb.id);
    expect(ids.filter((id) => ["rename-agent", "face", "move", "leave"].includes(id))).toEqual([]);
    expect(actions().changeFace(FEN)).toBeUndefined();
    expect(actions().renameInPlace(FEN)).toBeUndefined();
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

  it("says a refused hand-over's reason in the dialog, which stays open", async () => {
    mock.setProjectMemberRole.mockRejectedValue(new Error("Zerops refused the hand-over."));
    mount();
    openAssign();
    expect(mock.assignDialog.current).toMatchObject({ pending: false, error: null });
    await act(async () => {
      mock.assignDialog.current!.onSubmit("cu-eva");
    });
    expect(mock.setProjectMemberRole).toHaveBeenCalledWith(
      { organizationId: "org-acme", projectId: FEN.project.id },
      { clientUserId: "cu-eva", roleCode: "OWNER" },
    );
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
    mock.setProjectMemberRole.mockResolvedValue(undefined);
    mount();
    openAssign();
    await act(async () => {
      mock.assignDialog.current!.onSubmit("cu-eva");
    });
    expect(mock.invalidated).toEqual([{ topic: "access", change: "grants-written" }]);
  });

  // F23 (e2e, 2026-10-03): Fin handed back to Karlos read OWNER twice, and the menu named the one
  // who had handed it over. A Mate has one OWNER: the hand over gives it to the person picked, then
  // takes it from whoever held it — the key's grant, not an OWNER, untouched.
  describe("one OWNER per Mate", () => {
    const KEY = { clientUserId: "cu-key", roleCode: "BASIC_USER" };
    const handed = {
      ...FEN.project,
      userRoles: [
        KEY,
        { clientUserId: "cu-eva", roleCode: "OWNER" },
        { clientUserId: "cu-ada", roleCode: "OWNER" },
      ],
    };

    it("gives it to the person picked, then takes it from its previous owner", async () => {
      mock.setProjectMemberRole.mockResolvedValueOnce(handed).mockResolvedValueOnce(undefined);
      mount();
      openAssign();
      await act(async () => {
        mock.assignDialog.current!.onSubmit("cu-eva");
      });
      expect(mock.setProjectMemberRole.mock.calls.map(([, input]) => input)).toEqual([
        { clientUserId: "cu-eva", roleCode: "OWNER" },
        { clientUserId: "cu-ada", roleCode: null },
      ]);
      expect(mock.invalidated).toEqual([{ topic: "access", change: "grants-written" }]);
    });

    it("says the hand over is not complete where its previous owner keeps it, and reads the grants again", async () => {
      mock.setProjectMemberRole
        .mockResolvedValueOnce(handed)
        .mockRejectedValueOnce(new Error("Zerops refused it."));
      mount();
      openAssign();
      await act(async () => {
        mock.assignDialog.current!.onSubmit("cu-eva");
      });
      // Open, saying what stands: the person picked has it, the previous owner still does.
      expect(mock.assignDialog.current).toMatchObject({
        pending: false,
        error: "It was handed over, but its previous owner still owns it too: Zerops refused it.",
      });
      // The first write landed: the grant is asked again, so the menu reads what the platform holds.
      expect(mock.invalidated).toEqual([{ topic: "access", change: "grants-written" }]);
    });
  });

  it("closes once the platform takes it", async () => {
    let answer: (value: unknown) => void = () => {};
    mock.setProjectMemberRole.mockReturnValue(
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
      answer(undefined);
    });
    act(() => {
      mounted[0]!.update(<Probe />);
    });
    expect(mock.assignDialog.current).toBeNull();
  });
});

// A Mate its press left open — marker present, not closed off, past the grace — is finished by
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
    // Were the list read: the Mate's key still ADMIN on its project, made by the viewer.
    mock.tokens = [
      {
        tokenId: "tok-ivo",
        name: `zcp-${candidate.project.name}`,
        grants: [{ projectId: candidate.project.id, roleCode: "ADMIN" }],
        createdByUser: "user-ada",
      },
    ];
    listing(candidate);
    mount();
    expect([offered(candidate), mock.asked.includes("tokens")]).toEqual([false, false]);
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
      registry.set(hqStructureAtom, {
        organizationId: "org-acme",
        structure: { ungrouped: [], apps: [] },
        changes: null,
        readAt: 1_000,
        current: true,
        unavailableSince: null,
      });
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
    listing();
    mount(hqRegistry(known));
    expect(finishVerb() !== undefined).toBe(want);
  });

  it("writes its record, then its birth closed off, with nobody's stand-up asked", async () => {
    mock.finishMateSetup.mockResolvedValue({ ok: true });
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
        record: { name: expect.any(String), face: expect.any(String) },
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
    key: "dan-project:zcp",
    group: "ready",
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
    registry.set(hqStructureAtom, {
      organizationId: "org-acme",
      structure: { ungrouped: [], apps: [] },
      changes: null,
      readAt: 1_000,
      current: true,
      unavailableSince: null,
    });
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
        botName: "Dan",
        face: FACE,
      },
      container: true,
    });
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
        mate: { name: "Dan", face: FACE },
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
      group: "ready",
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
    registry.set(hqStructureAtom, {
      organizationId: "org-acme",
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
                mate: { name: "Ivo", face: "coral:gem" },
              },
            ],
          },
        ],
      },
      changes: null,
      readAt: 1_000,
      current: true,
      unavailableSince: null,
    } as never);
    return registry;
  };

  it("registers it there again under HQ's name and face, writing no new Mate", async () => {
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
        mate: { name: "Ivo", face: { tint: "coral", shape: "gem" } },
      },
      // A Mate HQ holds is not adopted: its key is not touched.
      harden: false,
    });
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
    { who: "a member", role: "BASIC_USER", user: { id: "user-ada" }, offered: true },
    {
      who: "a read-only member, whose Mate is listed",
      role: "READ_ONLY",
      user: { id: "user-ada" },
      offered: false,
    },
    { who: "a person the session does not name", role: "OWNER", user: null, offered: false },
  ])("$who: Start offered $offered", ({ role, user, offered }) => {
    mock.roleCode = role;
    mock.user = user;
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
  it("offers no rename, face, move or leave on a Mate HQ has no record of", () => {
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
    expect(ids.filter((id) => ["rename-agent", "face", "move", "leave"].includes(id))).toEqual([]);
    expect(actions().renameInPlace(unrecorded)).toBeUndefined();
  });
});

describe("useMateActions — Move, for the person who made the Mate", () => {
  it("offers Change project or role to a member with no org access who owns the Mate's project", () => {
    mock.roleCode = "NO_ACCESS";
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
});

// Whether the viewer added a Mate reads who HQ's record says made it, so a Mate made by New
// project is its maker's to finish as one made by Add a Mate is.
describe("mateAddedBy — whether the viewer added this Mate", () => {
  const placed = (mate: Partial<NonNullable<HqPlacement["mate"]>>): HqPlacement => ({
    appId: "app-1",
    appName: "Acme",
    kind: "mate",
    mate: { name: "Fen", face: "", ...mate },
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
  ])("$case: $added", ({ hq, added }) => {
    expect(mateAddedBy({ hq }, "user-ada")).toBe(added);
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
